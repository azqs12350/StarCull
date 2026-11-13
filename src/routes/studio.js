'use strict';
/* StarCull · 路由层：后台产品、账号、设置与抽奖记录 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('../config');
const { db, save } = require('../db');
const { sanitizeFolderName } = require('../utils');
const { requireAdmin, hashPassword, hashAnswer, validCredentials, publicUser } = require('../security');
const { presentProduct } = require('../serializers');
const { syncFolderProducts } = require('../catalog');
const { upload, saveUploadAsJpg } = require('../media');
const sync = require('../sync');

const router = express.Router();

/* ---------- studio ---------- */

router.get('/api/studio', requireAdmin, (req, res) => {
  syncFolderProducts();
  const nameOf = (id) => (db.users.find((u) => u.id === id) || {}).username || '—';

  res.json({
    products: db.products.map((p) => ({
      ...presentProduct(p, req.user),
      voters: p.starredBy.map(nameOf)
    })),
    accounts: db.users.map((u) => {
      const draw = db.draws
        .filter((d) => d.userId === u.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        username: u.username,
        role: u.role,
        points: u.points || 0,
        stars: db.products.filter((p) => p.starredBy.includes(u.id)).length,
        drawCode: draw ? draw.code : null,
        prizeType: draw ? draw.prizeType : null,
        drawStatus: draw ? draw.status : null,
        joined: u.createdAt,
        hasSecurityQuestion: !!(u.securityQuestion && u.securityAnswerHash),
        securityQuestion: u.securityQuestion || ''
      };
    }),
    draws: db.draws.map((d) => {
      const product = db.products.find((p) => p.id === d.productId);
      return {
        id: d.id,
        code: d.code,
        username: nameOf(d.userId),
        titleZh: product ? product.titleZh : '',
        titleEn: product ? product.titleEn : 'Removed piece',
        image: product ? product.image : '',
        prizeType: d.prizeType,
        status: d.status,
        shipping: d.shipping,
        createdAt: d.createdAt
      };
    }),
    settings: db.settings
  });
});

router.post('/api/studio/products', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const titleZh = String(req.body.titleZh || '').trim();
    const titleEn = String(req.body.titleEn || '').trim();
    if (!titleZh && !titleEn) {
      return res.status(400).json({ error: 'Give the piece a title.' });
    }

    // Fallback: support legacy single-language field name
    const seriesZh = String(req.body.seriesZh || req.body.series || '').trim();
    const seriesEn = String(req.body.seriesEn || req.body.series || '').trim();
    const folder = sanitizeFolderName(seriesZh || seriesEn);

    const noteZh = String(req.body.noteZh || req.body.note || '').trim();
    const noteEn = String(req.body.noteEn || req.body.note || '').trim();

    let image = String(req.body.imageUrl || '').trim();
    if (req.file) {
      // 统一转 JPG，超大自动压缩
      const saved = await saveUploadAsJpg(req.file, folder);
      image = saved.relPath;
    }
    if (!image) {
      return res.status(400).json({ error: 'Add an image for the piece.' });
    }
    if (!/^\/uploads\//.test(image)) {
      return res.status(400).json({ error: 'Unsupported image reference.' });
    }

    const product = {
      id: crypto.randomUUID(),
      titleZh, titleEn,
      seriesZh, seriesEn,
      noteZh, noteEn,
      image,
      starredBy: [],
      likedBy: [],
      dislikedBy: [],
      createdAt: new Date().toISOString()
    };
    db.products.push(product);
    save();
    // Fire-and-forget sync push to CDN (non-blocking, errors logged to console).
    if (image && image.startsWith('/')) void sync.pushFile(image).catch(() => {});
    res.json({ product: presentProduct(product, req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed.' });
  }
});

router.put('/api/studio/products/:id', requireAdmin, (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Piece not found.' });

  const body = req.body || {};
  if (typeof body.titleZh === 'string') product.titleZh = body.titleZh.trim();
  if (typeof body.titleEn === 'string') product.titleEn = body.titleEn.trim();
  if (typeof body.seriesZh === 'string') product.seriesZh = body.seriesZh.trim();
  if (typeof body.seriesEn === 'string') product.seriesEn = body.seriesEn.trim();
  if (typeof body.noteZh === 'string') product.noteZh = body.noteZh.trim();
  if (typeof body.noteEn === 'string') product.noteEn = body.noteEn.trim();

  // Require at least one title
  if (!product.titleZh && !product.titleEn) {
    return res.status(400).json({ error: 'Give the piece a title.' });
  }

  save();
  res.json({ product: presentProduct(product, req.user) });
});

router.delete('/api/studio/products/:id', requireAdmin, (req, res) => {
  const index = db.products.findIndex((p) => p.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Piece not found.' });

  const [removed] = db.products.splice(index, 1);

  // Delete local file + sync to CDN
  if (removed.image && removed.image.startsWith('/uploads/')) {
    const file = path.resolve(UPLOAD_DIR, removed.image.slice('/uploads/'.length));
    if (file.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) fs.unlink(file, () => {});
    void sync.deleteFile(removed.image).catch(() => {});
  } else if (removed.image && removed.image.startsWith('/art/')) {
    // Seed SVG art — only delete from CDN (local seed copies are shared)
    void sync.deleteFile(removed.image).catch(() => {});
  }

  save();
  res.json({ ok: true });
});

router.delete('/api/studio/draws/:id', requireAdmin, (req, res) => {
  const index = db.draws.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Draw not found.' });
  db.draws.splice(index, 1);
  save();
  res.json({ ok: true });
});

router.put('/api/studio/settings', requireAdmin, (req, res) => {
  const pct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return Math.round(n * 10) / 10;
  };
  const winRate = pct(req.body.winRate);
  const framedRate = pct(req.body.framedRate);
  const sw = Number(req.body.starWeight);
  const starWeight = Number.isFinite(sw) && sw >= 0 && sw <= 1000 ? Math.round(sw * 10) / 10 : null;
  if (winRate === null || framedRate === null || starWeight === null) {
    return res.status(400).json({ error: 'Percentages must be numbers between 0 and 100 (star weight up to 1000).' });
  }
  db.settings = { winRate, framedRate, starWeight };
  save();
  res.json({ settings: db.settings });
});

/* ---------- studio: account management ---------- */

function findAccount(name) {
  const lower = String(name || '').toLowerCase();
  return db.users.find((u) => u.username.toLowerCase() === lower) || null;
}

router.post('/api/studio/accounts', requireAdmin, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const problem = validCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });
  if (findAccount(username)) {
    return res.status(409).json({ error: 'That account name is already taken.' });
  }

  const { salt, hash } = hashPassword(password);

  // Security question is optional when an admin creates an account;
  // if provided, store it. If not, the user will be prompted on first login.
  let securityQuestion = null;
  let securityAnswerSalt = null;
  let securityAnswerHash = null;
  const sq = String(req.body.securityQuestion || '').trim();
  const sa = String(req.body.securityAnswer || '');
  if (sq && sa) {
    const { salt: aSalt, hash: aHash } = hashAnswer(sa);
    securityQuestion = sq;
    securityAnswerSalt = aSalt;
    securityAnswerHash = aHash;
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    salt,
    hash,
    securityQuestion,
    securityAnswerSalt,
    securityAnswerHash,
    role: req.body.role === 'admin' ? 'admin' : 'guest',
    points: 0,
    lastLoginDate: null,
    freeDrawClaimed: false,
    registeredIp: '',
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  save();
  res.json({ user: publicUser(user) });
});

router.put('/api/studio/accounts/:username', requireAdmin, (req, res) => {
  const user = findAccount(req.params.username);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  const body = req.body || {};

  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 6) {
      return res.status(400).json({ error: 'Password needs at least 6 characters.' });
    }
    const { salt, hash } = hashPassword(body.password);
    user.salt = salt;
    user.hash = hash;
    // Force re-login everywhere.
    for (const [token, session] of Object.entries(db.sessions)) {
      if (session && session.userId === user.id) delete db.sessions[token];
    }
  }

  if (body.points !== undefined) {
    const points = Number(body.points);
    if (!Number.isFinite(points) || points < 0) {
      return res.status(400).json({ error: 'Points must be zero or more.' });
    }
    user.points = Math.floor(points);
  }

  // Security question + answer. The answer is never returned, so the admin
  // can only overwrite it (and the question) by providing both fields.
  if (body.securityQuestion !== undefined || body.securityAnswer !== undefined) {
    const sq = String(body.securityQuestion || '').trim();
    const sa = String(body.securityAnswer || '');
    if (!sq || !sa) {
      return res.status(400).json({ error: 'Provide both a security question and its answer, or leave both blank.' });
    }
    const { salt, hash } = hashAnswer(sa);
    user.securityQuestion = sq;
    user.securityAnswerSalt = salt;
    user.securityAnswerHash = hash;
  }

  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'guest') {
      return res.status(400).json({ error: 'Unknown role.' });
    }
    if (user.id === req.user.id && body.role !== 'admin') {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }
    user.role = body.role;
  }

  save();
  res.json({ user: publicUser(user) });
});

router.delete('/api/studio/accounts/:username', requireAdmin, (req, res) => {
  const user = findAccount(req.params.username);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }

  db.users = db.users.filter((u) => u.id !== user.id);
  for (const [token, session] of Object.entries(db.sessions)) {
    if (session && session.userId === user.id) delete db.sessions[token];
  }
  db.draws = db.draws.filter((d) => d.userId !== user.id);
  db.pointsLogs = db.pointsLogs.filter((l) => l.userId !== user.id);
  for (const product of db.products) {
    for (const key of ['starredBy', 'likedBy', 'dislikedBy']) {
      if (!Array.isArray(product[key])) continue;
      const i = product[key].indexOf(user.id);
      if (i >= 0) product[key].splice(i, 1);
    }
  }
  save();
  res.json({ ok: true });
});

module.exports = router;
