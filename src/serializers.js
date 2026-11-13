'use strict';
/* StarCull · 序列化层：产品 / 抽奖记录的对外结构 */

const { db } = require('./db');

function absImage(relPath) {
  if (!relPath) return '';
  // Already absolute (http/https/data:/cloud://) — leave untouched.
  if (/^https?:\/\//i.test(relPath) || relPath.startsWith('data:') || relPath.startsWith('cloud://')) return relPath;
  // 只返回相对路径，让云函数 proxy 从七牛云拉图转 base64
  return relPath.startsWith('/') ? relPath : '/' + relPath;
}

function presentProduct(product, user) {
  const likedBy = product.likedBy || [];
  const dislikedBy = product.dislikedBy || [];
  return {
    id: product.id,
    titleZh: product.titleZh || '',
    titleEn: product.titleEn || '',
    seriesZh: product.seriesZh || '',
    seriesEn: product.seriesEn || '',
    noteZh: product.noteZh || '',
    noteEn: product.noteEn || '',
    image: absImage(product.image),
    count: (product.starredBy || []).length,
    starred: user ? (product.starredBy || []).includes(user.id) : false,
    likeCount: likedBy.length,
    dislikeCount: dislikedBy.length,
    liked: user ? likedBy.includes(user.id) : false,
    disliked: user ? dislikedBy.includes(user.id) : false
  };
}

function presentDraw(draw, user) {
  if (!draw) return null;
  const product = db.products.find((p) => p.id === draw.productId);
  return {
    id: draw.id,
    code: draw.code,
    createdAt: draw.createdAt,
    prizeType: draw.prizeType,
    product: product ? presentProduct(product, user) : null,
    shipping: draw.shipping || null,
    framedUpgrade: !!draw.framedUpgrade,
    status: draw.status || 'pending',
    pointsSpent: draw.pointsSpent || 0,
    isFree: !!draw.isFree
  };
}

function drawFor(user) {
  const draws = db.draws
    .filter((d) => d.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!draws.length) return null;
  return presentDraw(draws[0], user);
}

module.exports = { presentProduct, presentDraw, drawFor };
