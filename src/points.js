'use strict';
/* StarCull · 积分层：每日登录与互动奖励规则 */

const crypto = require('crypto');
const {
  INTERACTION_COOLDOWN_MS,
  DAILY_INTERACTION_CAP,
  INTERACTION_CHANCE,
  INTERACTION_POINTS
} = require('./config');
const { db } = require('./db');
const { todayStr } = require('./utils');

function addPointsLog(user, type, points, note = '') {
  const log = {
    id: crypto.randomUUID(),
    userId: user.id,
    type,
    points,
    note,
    date: todayStr(),
    createdAt: new Date().toISOString()
  };
  db.pointsLogs.push(log);
  return log;
}

function hasDailyLoginLog(userId, date) {
  return db.pointsLogs.some((l) => l.userId === userId && l.type === 'daily_login' && l.date === date);
}

function dailyInteractionPoints(userId, date) {
  return db.pointsLogs
    .filter((l) => l.userId === userId && l.type === 'interaction' && l.date === date)
    .reduce((sum, l) => sum + (l.points > 0 ? l.points : 0), 0);
}

function lastInteractionAt(userId) {
  const logs = db.pointsLogs
    .filter((l) => l.userId === userId && l.type === 'interaction')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return logs.length ? new Date(logs[0].createdAt).getTime() : 0;
}

function tryInteractionPoints(user, action) {
  const now = Date.now();
  // Anti-farm: cooldown between interactions
  if (now - lastInteractionAt(user.id) < INTERACTION_COOLDOWN_MS) return 0;
  // Daily cap
  if (dailyInteractionPoints(user.id, todayStr()) >= DAILY_INTERACTION_CAP) return 0;
  // 5% chance
  if (Math.random() >= INTERACTION_CHANCE) return 0;

  user.points = (user.points || 0) + INTERACTION_POINTS;
  addPointsLog(user, 'interaction', INTERACTION_POINTS, `Bonus from ${action}`);
  return INTERACTION_POINTS;
}

module.exports = {
  addPointsLog,
  hasDailyLoginLog,
  dailyInteractionPoints,
  lastInteractionAt,
  tryInteractionPoints
};
