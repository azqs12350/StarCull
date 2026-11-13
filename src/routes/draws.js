'use strict';
/* StarCull · 路由层：抽奖、画框升级、收货信息维护（用户侧） */

const express = require('express');
const crypto = require('crypto');
const { PAID_DRAW_COST, FRAMED_UPGRADE_COST } = require('../config');
const { db, save } = require('../db');
const { requireUser, requireAdmin } = require('../security');
const { addPointsLog } = require('../points');
const { presentDraw } = require('../serializers');
const { syncFolderProducts, randomProduct } = require('../catalog');

const router = express.Router();

/* ========== 常量 ========== */

// 抽奖状态机：
//   pending    未提交地址
//   preparing  已提交地址、等待管理员开始制作
//   making     制作中（管理员已确认开始制作，用户不能再改地址）
//   shipped    管理员已发货、有快递单号
//   done       管理员标记完结（终态）
// 流转: pending → preparing → making → shipped → done
// 可回退: shipped → making / shipped → preparing / making → preparing
const USER_EDITABLE_STATUSES = new Set(['pending', 'preparing']); // 用户可提交/修改/取消的状态
const ADMIN_MAKING_STATUSES = new Set(['preparing']);             // admin 可从这些状态推进到 making

/* ========== 内部：状态流转辅助 ========== */

// 画框升级：扣分 + 改状态 + 记流水。调用点只在传入条件下调用。
function applyFramedUpgrade(user, draw, notEnoughMessage, logNote) {
  if ((user.points || 0) < FRAMED_UPGRADE_COST) return { ok: false, error: notEnoughMessage };

  user.points -= FRAMED_UPGRADE_COST;
  draw.framedUpgrade = true;
  draw.prizeType = 'framed';
  draw.pointsSpent += FRAMED_UPGRADE_COST;
  addPointsLog(user, 'upgrade', -FRAMED_UPGRADE_COST, logNote);
  return { ok: true, cost: FRAMED_UPGRADE_COST };
}

// 取消画框升级：退分 + 回到画布 + 记流水。未升级时返回 0。
function refundFramedUpgrade(user, draw, logNote) {
  if (!draw.framedUpgrade) return 0;

  user.points += FRAMED_UPGRADE_COST;
  draw.framedUpgrade = false;
  draw.prizeType = 'canvas';
  draw.pointsSpent = Math.max(0, draw.pointsSpent - FRAMED_UPGRADE_COST);
  addPointsLog(user, 'refund', FRAMED_UPGRADE_COST, logNote);
  return FRAMED_UPGRADE_COST;
}

// 清空收货信息并退回 pending；DELETE shipping 与 POST cancel 共用。
function clearShipping(req, res, lockedError, refundNote) {
  const draw = db.draws.find((d) => d.id === req.params.id && d.userId === req.user.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (!USER_EDITABLE_STATUSES.has(draw.status)) {
    return res.status(400).json({ error: lockedError });
  }

  const refunded = refundFramedUpgrade(req.user, draw, refundNote);
  draw.shipping = null;
  draw.status = 'pending';
  save();

  res.json({ draw: presentDraw(draw, req.user), points: req.user.points, refunded });
}

/* ========== 抽奖 ========== */

router.post('/api/draw', requireUser, (req, res) => {
  syncFolderProducts();

  if (db.products.length === 0) {
    return res.status(409).json({ error: 'The collection is empty.' });
  }

  const registeredAt = new Date(req.user.createdAt).getTime();
  const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
  const hasFreeDraw = !req.user.freeDrawClaimed && registeredAt <= threeDaysAgo;

  let pointsSpent = 0;
  let prizeType;
  let product = null;

  if (hasFreeDraw) {
    req.user.freeDrawClaimed = true;
  } else {
    if ((req.user.points || 0) < PAID_DRAW_COST) {
      return res.status(403).json({ error: `Not enough points. A draw costs ${PAID_DRAW_COST} points.` });
    }
    req.user.points -= PAID_DRAW_COST;
    pointsSpent = PAID_DRAW_COST;
    addPointsLog(req.user, 'draw', -PAID_DRAW_COST, 'Paid draw entry');
  }

  const clampPct = (v, dflt) => Math.min(100, Math.max(0, Number.isFinite(+v) ? +v : dflt));
  const winRate = clampPct(db.settings.winRate, 50);
  const framedRate = clampPct(db.settings.framedRate, 10);

  if (Math.random() * 100 < winRate) {
    prizeType = Math.random() * 100 < framedRate ? 'framed' : 'canvas';
    product = randomProduct(req.user);
  } else {
    prizeType = 'none';
  }

  const draw = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    productId: product ? product.id : null,
    code: prizeType !== 'none' ? 'SC-' + crypto.randomBytes(3).toString('hex').toUpperCase() : null,
    createdAt: new Date().toISOString(),
    prizeType,
    shipping: null,
    framedUpgrade: false,
    pointsSpent,
    status: 'pending',
    isFree: hasFreeDraw
  };
  db.draws.push(draw);
  save();

  res.json({ draw: presentDraw(draw, req.user), points: req.user.points });
});

/* ========== 画框升级 ========== */

router.post('/api/draw/:id/upgrade', requireUser, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id && d.userId === req.user.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.prizeType !== 'canvas') return res.status(400).json({ error: 'Only a canvas can be upgraded.' });
  if (draw.framedUpgrade) return res.status(409).json({ error: 'Already upgraded to a framed piece.' });

  const upgraded = applyFramedUpgrade(
    req.user,
    draw,
    `Not enough points. Upgrading costs ${FRAMED_UPGRADE_COST} points.`,
    'Framed upgrade'
  );
  if (!upgraded.ok) return res.status(403).json({ error: upgraded.error });

  save();

  res.json({ draw: presentDraw(draw, req.user), points: req.user.points });
});

/* ---------- 内部：地址校验 ---------- */

function validateAddress(body) {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const address1 = String(body.address1 || '').trim();
  const address2 = String(body.address2 || '').trim();
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  const zip = String(body.zip || '').trim();
  const country = String(body.country || '').trim();
  const isChina = country === 'China' || country === '中国' || country.toLowerCase() === 'cn';
  const missing = [];
  if (!name) missing.push('name');
  if (!phone) missing.push('phone');
  if (!address1) missing.push('address1');
  if (!city) missing.push('city');
  if (!country) missing.push('country');
  if (!isChina) {
    if (!state) missing.push('state');
    if (!zip) missing.push('zip');
  }
  if (missing.length) {
    return {
      ok: false,
      error: isChina
        ? 'Please fill in name, phone, address, city and country. Province and postal code are optional for China.'
        : 'Please complete all required shipping fields.'
    };
  }
  return { ok: true, value: { name, phone, email, address1, address2, city, state, zip, country } };
}

/* ========== 用户：首次提交地址 ========== */

router.post('/api/draw/:id/shipping', requireUser, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id && d.userId === req.user.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.prizeType === 'none') return res.status(400).json({ error: 'There is no prize to ship.' });
  // 已发货或已完结：不允许用户再提交
  if (!USER_EDITABLE_STATUSES.has(draw.status)) {
    return res.status(409).json({ error: 'Shipping details are locked. Contact the studio to make changes.' });
  }

  const v = validateAddress(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });

  const upgradeToFramed = !!(req.body && req.body.upgradeToFramed);
  let extraCost = 0;
  if (upgradeToFramed && draw.prizeType === 'canvas' && !draw.framedUpgrade) {
    const upgraded = applyFramedUpgrade(
      req.user,
      draw,
      `Not enough points to upgrade. Upgrading costs ${FRAMED_UPGRADE_COST} points.`,
      'Framed upgrade on shipping'
    );
    if (!upgraded.ok) return res.status(403).json({ error: upgraded.error });
    extraCost = upgraded.cost;
  }

  draw.shipping = v.value;
  draw.status = 'preparing';
  draw.pointsSpent += extraCost;
  save();

  res.json({ draw: presentDraw(draw, req.user), points: req.user.points });
});

/* ========== 用户：更新地址 ========== */

router.put('/api/draw/:id/shipping', requireUser, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id && d.userId === req.user.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.prizeType === 'none') return res.status(400).json({ error: 'There is no prize to ship.' });
  if (!USER_EDITABLE_STATUSES.has(draw.status)) {
    return res.status(409).json({ error: 'Shipping details are locked. Contact the studio to make changes.' });
  }

  const v = validateAddress(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });

  const upgradeToFramed = !!(req.body && req.body.upgradeToFramed);
  let extraCost = 0;
  if (upgradeToFramed && draw.prizeType === 'canvas' && !draw.framedUpgrade) {
    const upgraded = applyFramedUpgrade(
      req.user,
      draw,
      `Not enough points to upgrade. Upgrading costs ${FRAMED_UPGRADE_COST} points.`,
      'Framed upgrade on shipping update'
    );
    if (!upgraded.ok) return res.status(403).json({ error: upgraded.error });
    extraCost = upgraded.cost;
  }

  // 保留已由管理员写入的 courier / tracking 字段
  const prev = draw.shipping || {};
  draw.shipping = {
    ...v.value,
    courierPlatform: prev.courierPlatform || '',
    courierCustom: prev.courierCustom || '',
    trackingNumber: prev.trackingNumber || '',
    shippedAt: prev.shippedAt || '',
    completedAt: prev.completedAt || ''
  };
  draw.status = 'preparing';
  draw.pointsSpent += extraCost;
  save();

  res.json({ draw: presentDraw(draw, req.user), points: req.user.points });
});

/* ========== 用户：取消地址（退回 pending） ========== */

router.delete('/api/draw/:id/shipping', requireUser, (req, res) => {
  clearShipping(
    req,
    res,
    'Shipping details are locked and cannot be removed.',
    'Shipping deleted, upgrade refunded'
  );
});

/* ========== 用户：抽奖内取消（旧接口，保留语义） ========== */

router.post('/api/draw/:id/cancel', requireUser, (req, res) => {
  clearShipping(
    req,
    res,
    'Shipping details are locked and cannot be cancelled.',
    'Shipping cancelled, upgrade refunded'
  );
});

/* ========== 用户：取消升级（单独退还积分，保留地址） ========== */

router.post('/api/draw/:id/cancel-upgrade', requireUser, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id && d.userId === req.user.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (!draw.framedUpgrade) return res.status(400).json({ error: 'This draw has not been upgraded.' });
  if (!USER_EDITABLE_STATUSES.has(draw.status)) {
    return res.status(409).json({ error: 'Cannot cancel upgrade — the piece is already being made or shipped.' });
  }

  const refunded = refundFramedUpgrade(req.user, draw, 'Upgrade cancelled');
  save();

  res.json({ draw: presentDraw(draw, req.user), points: req.user.points, refunded });
});

/* ========== 用户：列表 ========== */

router.get('/api/draws', requireUser, (req, res) => {
  const draws = db.draws
    .filter((d) => d.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((d) => presentDraw(d, req.user));
  res.json({ draws, points: req.user.points });
});

/* ========== 管理员：开始制作（preparing → making） ========== */

router.post('/api/draw/:id/make', requireAdmin, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.prizeType === 'none') return res.status(400).json({ error: 'No prize.' });
  if (!draw.shipping) return res.status(400).json({ error: 'User has not submitted an address yet.' });
  if (draw.status === 'done') return res.status(400).json({ error: 'Already completed.' });
  if (draw.status === 'making') return res.status(400).json({ error: 'Already in making.' });
  if (!ADMIN_MAKING_STATUSES.has(draw.status)) {
    return res.status(409).json({ error: 'Can only start making from preparing status.' });
  }

  draw.status = 'making';
  draw.makingAt = new Date().toISOString();
  save();

  res.json({ ok: true, draw });
});

/* ========== 管理员：标记发货 ========== */

router.post('/api/draw/:id/ship', requireAdmin, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.prizeType === 'none') return res.status(400).json({ error: 'There is no prize to ship.' });
  if (!draw.shipping) return res.status(400).json({ error: 'User has not submitted an address yet.' });
  if (draw.status === 'done') return res.status(400).json({ error: 'This draw is already completed.' });

  const body = req.body || {};
  const courierPlatform = String(body.courierPlatform || '').trim();
  const courierCustom = String(body.courierCustom || '').trim();
  const trackingNumber = String(body.trackingNumber || '').trim();

  if (!courierPlatform) return res.status(400).json({ error: 'Please select a courier.' });
  if (courierPlatform === 'OTHER' && !courierCustom) {
    return res.status(400).json({ error: 'Please enter the courier name for "Other".' });
  }
  if (!trackingNumber) return res.status(400).json({ error: 'Please enter the tracking number.' });

  draw.shipping.courierPlatform = courierPlatform;
  draw.shipping.courierCustom = courierCustom;
  draw.shipping.trackingNumber = trackingNumber;
  draw.shipping.shippedAt = new Date().toISOString();
  draw.status = 'shipped';
  save();

  res.json({ ok: true, draw });
});

/* ========== 管理员：撤回发货（回到 making 或 preparing） ========== */

router.post('/api/draw/:id/unship', requireAdmin, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.status !== 'shipped') return res.status(400).json({ error: 'Only a shipped draw can be reverted.' });
  if (!draw.shipping) return res.status(400).json({ error: 'No shipping object.' });

  draw.shipping.courierPlatform = '';
  draw.shipping.courierCustom = '';
  draw.shipping.trackingNumber = '';
  draw.shipping.shippedAt = '';
  draw.status = draw.makingAt ? 'making' : 'preparing';
  save();

  res.json({ ok: true, draw });
});

/* ========== 管理员：撤回制作（making → preparing） ========== */

router.post('/api/draw/:id/unmake', requireAdmin, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.status !== 'making') return res.status(400).json({ error: 'Only a making draw can be reverted.' });

  draw.status = 'preparing';
  draw.makingAt = '';
  save();

  res.json({ ok: true, draw });
});

/* ========== 管理员：标记完结 ========== */

router.post('/api/draw/:id/complete', requireAdmin, (req, res) => {
  const draw = db.draws.find((d) => d.id === req.params.id);
  if (!draw) return res.status(404).json({ error: 'Draw not found.' });
  if (draw.status === 'done') return res.status(400).json({ error: 'Already completed.' });
  if (draw.status !== 'shipped') return res.status(400).json({ error: 'Mark the draw as shipped before completing it.' });

  if (draw.shipping) draw.shipping.completedAt = new Date().toISOString();
  draw.status = 'done';
  save();

  res.json({ ok: true, draw });
});

module.exports = router;
