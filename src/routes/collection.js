'use strict';
/* StarCull · 路由层：画廊收藏、点赞与点踩 */

const express = require('express');
const { db, save } = require('../db');
const { requireUser } = require('../security');
const { tryInteractionPoints } = require('../points');

const router = express.Router();

/* ---------- collection ---------- */

router.post('/api/products/:id/star', requireUser, (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Piece not found.' });

  if (!product.starredBy) product.starredBy = [];
  const index = product.starredBy.indexOf(req.user.id);
  if (index >= 0) product.starredBy.splice(index, 1);
  else product.starredBy.push(req.user.id);

  const bonus = tryInteractionPoints(req.user, 'star');
  save();

  res.json({ starred: index < 0, count: product.starredBy.length, bonusPoints: bonus, points: req.user.points });
});

function toggleVote(product, userId, type) {
  const mine = type === 'like' ? 'likedBy' : 'dislikedBy';
  const other = type === 'like' ? 'dislikedBy' : 'likedBy';
  if (!product[mine]) product[mine] = [];
  if (!product[other]) product[other] = [];

  const i = product[mine].indexOf(userId);
  let active;
  if (i >= 0) {
    product[mine].splice(i, 1);
    active = false;
  } else {
    product[mine].push(userId);
    active = true;
    const j = product[other].indexOf(userId);
    if (j >= 0) product[other].splice(j, 1);
  }
  return active;
}

router.post('/api/products/:id/like', requireUser, (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Piece not found.' });

  const liked = toggleVote(product, req.user.id, 'like');
  const bonus = tryInteractionPoints(req.user, 'like');
  save();
  res.json({
    liked,
    disliked: (product.dislikedBy || []).includes(req.user.id),
    likeCount: (product.likedBy || []).length,
    dislikeCount: (product.dislikedBy || []).length,
    bonusPoints: bonus,
    points: req.user.points
  });
});

router.post('/api/products/:id/dislike', requireUser, (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Piece not found.' });

  const disliked = toggleVote(product, req.user.id, 'dislike');
  const bonus = tryInteractionPoints(req.user, 'dislike');
  save();
  res.json({
    disliked,
    liked: (product.likedBy || []).includes(req.user.id),
    likeCount: (product.likedBy || []).length,
    dislikeCount: (product.dislikedBy || []).length,
    bonusPoints: bonus,
    points: req.user.points
  });
});

module.exports = router;
