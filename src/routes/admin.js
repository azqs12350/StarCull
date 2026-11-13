// src/routes/admin.js — 管理员/同步接口（内部用，有 token 保护）
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { DB_FILE, UPLOAD_DIR } = require('../config');
const image = require('../image');
const convert = require('../convert');

const ADMIN_TOKENS = new Set([
  'starcull-admin-sync-2026'  // 小程序自动云存储迁移用
]);

function auth(req, res, next) {
  const token = (req.body && req.body.token) || (req.headers && req.headers['x-admin-token']);
  if (!token || !ADMIN_TOKENS.has(token)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

/* ---------- 数据导出（给 GitStarCull 提取脚本用） ---------- */

// GET /api/admin/export-db — 直接返回 db.json 原始文件（带时间戳校验）
router.get('/api/admin/export-db', auth, (req, res) => {
  const stat = fs.statSync(DB_FILE);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="db-${Date.now()}.json"`);
  res.setHeader('X-DB-Size', stat.size);
  res.setHeader('X-DB-Mtime', stat.mtimeMs);
  fs.createReadStream(DB_FILE).pipe(res);
});

// GET /api/admin/list-uploads — 递归列出 uploads 下所有图片相对路径
router.get('/api/admin/list-uploads', auth, (req, res) => {
  if (!fs.existsSync(UPLOAD_DIR)) {
    return res.json({ base: UPLOAD_DIR, files: [], totalBytes: 0 });
  }
  const files = [];
  let totalBytes = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (/\.(jpg|jpeg|png|webp|avif|gif|svg)$/i.test(name)) {
        files.push(path.relative(UPLOAD_DIR, abs).replace(/\\/g, '/'));
        totalBytes += st.size;
      }
    }
  };
  walk(UPLOAD_DIR);
  res.json({ base: UPLOAD_DIR, files, totalBytes, count: files.length });
});

/* ---------- 图片批量转 JPG + 压缩 ---------- */
// 具体转码逻辑在 src/convert.js（上传 / 启动自检 / 这里的接口共用）

// GET /api/admin/convert-jpg/status — 看看还有多少张需要转
router.get('/api/admin/convert-jpg/status', auth, (req, res) => {
  const { all, todo } = convert.listPending();
  res.json({
    ok: true,
    sharpReady: image.available(),
    total: all.length,
    needConvert: todo.length,
    totalBytes: all.reduce((s, f) => s + f.size, 0),
    needConvertBytes: todo.reduce((s, f) => s + f.size, 0)
  });
});

// POST /api/admin/convert-jpg — 把 uploads 下的图片统一转成 JPG 并压缩
// body: { limit?: number(默认20), dryRun?: boolean }
// 图片多时配合 limit 分批调用，返回 remaining 表示还剩多少
router.post('/api/admin/convert-jpg', auth, async (req, res) => {
  try {
    const result = await convert.convertBatch(req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.code === 'SHARP_MISSING') {
      return res.status(503).json({ ok: false, error: e.message });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
