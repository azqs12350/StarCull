'use strict';
/* StarCull · 路由层：用户 ↔ 管理员留言（会话 thread 模型） */

const express = require('express');
const crypto = require('crypto');
const { db, save } = require('../db');
const { requireUser, requireAdmin } = require('../security');

const router = express.Router();

// 单条消息上限
const MAX_CONTENT = 800;

/* ---------- 工具 ---------- */

function threadKey(userId) {
  return `u_${userId}`;
}

function normalizeContent(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.length > MAX_CONTENT) return s.slice(0, MAX_CONTENT);
  return s;
}

function ensureMessagesArray() {
  if (!Array.isArray(db.messages)) db.messages = [];
}

/* ========== 用户侧 ========== */

// 拉取当前用户的会话（对方=管理员）
router.get('/api/messages', requireUser, (req, res) => {
  ensureMessagesArray();
  const tk = threadKey(req.user.id);
  const thread = db.messages.filter((m) => m.threadId === tk).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
  const unreadByUser = thread.filter((m) => !m.fromUser && !m.read).length;
  res.json({ thread, unreadByUser });
});

// 用户发送消息给管理员
router.post('/api/messages', requireUser, (req, res) => {
  ensureMessagesArray();
  const content = normalizeContent(req.body && req.body.content);
  if (!content) return res.status(400).json({ error: 'Content cannot be empty.' });

  const msg = {
    id: crypto.randomUUID(),
    threadId: threadKey(req.user.id),
    userId: req.user.id,
    fromUser: true,
    fromName: req.user.username,
    content,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.messages.push(msg);
  save();
  res.json({ message: msg });
});

// 用户把管理员发来的消息全部标记为已读
router.put('/api/messages/read', requireUser, (req, res) => {
  ensureMessagesArray();
  const tk = threadKey(req.user.id);
  let n = 0;
  for (const m of db.messages) {
    if (m.threadId === tk && !m.fromUser && !m.read) {
      m.read = true;
      n++;
    }
  }
  if (n > 0) save();
  res.json({ marked: n });
});

/* ========== 管理员侧（独立端点，避免 requireUser 守卫冲突） ========== */

// 所有会话列表（每个用户一行，带最新消息摘要 + 未读数）
router.get('/api/studio/messages', requireAdmin, (req, res) => {
  ensureMessagesArray();
  const groups = new Map(); // threadId → 聚合对象

  for (const m of db.messages) {
    if (!groups.has(m.threadId)) {
      const user = db.users.find((u) => u.id === m.userId);
      groups.set(m.threadId, {
        threadId: m.threadId,
        userId: m.userId,
        username: user ? user.username : '(deleted)',
        createdAt: user ? user.createdAt : '',
        total: 0,
        unreadByAdmin: 0,
        lastMessage: null
      });
    }
    const g = groups.get(m.threadId);
    g.total++;
    if (m.fromUser && !m.read) g.unreadByAdmin++;
    g.lastMessage = m;
  }

  const threads = [...groups.values()]
    .sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));

  // 附带每个用户的抽奖状态（工作室常用）
  for (const t of threads) {
    const userDraws = db.draws.filter((d) => d.userId === t.userId);
    t.drawsCount = userDraws.length;
    const latestWin = userDraws
      .filter((d) => d.prizeType && d.prizeType !== 'none')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    t.latestDrawStatus = latestWin ? latestWin.status : null;
  }

  res.json({
    threads,
    totalUnread: threads.reduce((s, t) => s + t.unreadByAdmin, 0)
  });
});

// 管理员查看单个会话（顺便把管理员视角的未读清掉）
router.get('/api/studio/messages/:userId', requireAdmin, (req, res) => {
  ensureMessagesArray();
  const target = db.users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const tk = threadKey(target.id);
  const thread = db.messages
    .filter((m) => m.threadId === tk)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  let cleared = 0;
  for (const m of db.messages) {
    if (m.threadId === tk && m.fromUser && !m.read) {
      m.read = true;
      cleared++;
    }
  }
  if (cleared > 0) save();

  res.json({ thread, cleared });
});

// 管理员回复某个会话
router.post('/api/studio/messages/:userId', requireAdmin, (req, res) => {
  ensureMessagesArray();
  const target = db.users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const content = normalizeContent(req.body && req.body.content);
  if (!content) return res.status(400).json({ error: 'Content cannot be empty.' });

  const msg = {
    id: crypto.randomUUID(),
    threadId: threadKey(target.id),
    userId: target.id,
    fromUser: false,
    fromName: 'Studio',
    content,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.messages.push(msg);
  save();
  res.json({ message: msg });
});

// 管理员删除一条消息
router.delete('/api/studio/messages/:threadId/:msgId', requireAdmin, (req, res) => {
  ensureMessagesArray();
  const before = db.messages.length;
  db.messages = db.messages.filter(
    (m) => !(m.threadId === req.params.threadId && m.id === req.params.msgId)
  );
  if (db.messages.length === before) return res.status(404).json({ error: 'Message not found.' });
  save();
  res.json({ ok: true });
});

module.exports = router;
