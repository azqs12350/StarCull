'use strict';
/* StarCull · 安全层：密码哈希、安全问题、会话与鉴权中间件 */

const crypto = require('crypto');
const { SESSION_DAYS } = require('./config');
const { db, save } = require('./db');
const { parseCookies } = require('./utils');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Normalize a security-question answer for comparison: trim, collapse spaces, lowercase.
function normalizeAnswer(answer) {
  return String(answer || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashAnswer(answer) {
  return hashPassword(normalizeAnswer(answer));
}

function verifyAnswer(answer, user) {
  if (!user || !user.securityAnswerSalt || !user.securityAnswerHash) return false;
  const { hash } = hashPassword(normalizeAnswer(answer), user.securityAnswerSalt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.securityAnswerHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 20 security questions the user can pick from (bilingual).
const SECURITY_QUESTIONS = [
  { id: 1,  zh: '你的出生地是哪里？',               en: 'Where were you born?' },
  { id: 2,  zh: '你母亲的娘家姓是什么？',           en: "What is your mother's maiden name?" },
  { id: 3,  zh: '你小学的名字是什么？',             en: 'What was the name of your elementary school?' },
  { id: 4,  zh: '你的第一只宠物叫什么名字？',       en: 'What was the name of your first pet?' },
  { id: 5,  zh: '你最喜欢的书是什么？',             en: 'What is your favorite book?' },
  { id: 6,  zh: '你父亲的名字是什么？',             en: "What is your father's first name?" },
  { id: 7,  zh: '你最喜欢的颜色是什么？',           en: 'What is your favorite color?' },
  { id: 8,  zh: '你的生日是几月几日？',             en: 'What is your birthday (month and day)?' },
  { id: 9,  zh: '你最要好的童年朋友叫什么？',       en: 'What was the name of your best childhood friend?' },
  { id: 10, zh: '你第一辆车的品牌和型号是什么？',   en: 'What was the make and model of your first car?' },
  { id: 11, zh: '你最喜欢的电影是什么？',           en: 'What is your favorite movie?' },
  { id: 12, zh: '你的第一份工作是什么？',           en: 'What was your first job?' },
  { id: 13, zh: '你最喜欢的食物是什么？',           en: 'What is your favorite food?' },
  { id: 14, zh: '你高中的吉祥物是什么？',           en: 'What was your high school mascot?' },
  { id: 15, zh: '你最喜欢的运动是什么？',           en: 'What is your favorite sport?' },
  { id: 16, zh: '你祖母的名字是什么？',             en: "What was your grandmother's first name?" },
  { id: 17, zh: '你最喜欢的歌曲是什么？',           en: 'What is your favorite song?' },
  { id: 18, zh: '你第一次坐飞机去的是哪里？',       en: 'Where did you go on your first airplane flight?' },
  { id: 19, zh: '你最喜欢的动物是什么？',           en: 'What is your favorite animal?' },
  { id: 20, zh: '你梦想中的度假目的地是哪里？',     en: 'What is your dream vacation destination?' }
];

/* ---------- Bearer token (for WeChat mini-program / API clients) ---------- */

// Generate an API token for non-cookie clients. The token IS the session key
// inside db.sessions — same storage, same expiry logic, no extra table needed.
function createApiToken(user) {
  const token = crypto.randomBytes(32).toString('hex'); // 64 hex chars — stronger than cookie token
  db.sessions[token] = { userId: user.id, createdAt: Date.now(), api: true };
  save();
  return token;
}

function parseBearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth || typeof auth !== 'string') return null;
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1].trim() || null;
}

function lookupSession(token) {
  if (!token) return null;
  const session = db.sessions[token];
  if (!session) return null;
  if (session.createdAt < Date.now() - SESSION_DAYS * 24 * 3600 * 1000) {
    delete db.sessions[token];
    save();
    return null;
  }
  return session;
}

function revokeToken(token) {
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    save();
    return true;
  }
  return false;
}

/* ---------- getUser: cookie-first, Bearer fallback ---------- */

function getUser(req) {
  // 1) Try cookie (browser)
  const cookieToken = parseCookies(req.headers.cookie).sc_sid;
  let session = lookupSession(cookieToken);
  if (session) {
    req._sessionToken = cookieToken;
    return db.users.find((u) => u.id === session.userId) || null;
  }
  // 2) Try Bearer (mini-program / API)
  const bearerToken = parseBearerToken(req);
  session = lookupSession(bearerToken);
  if (session) {
    req._sessionToken = bearerToken;
    return db.users.find((u) => u.id === session.userId) || null;
  }
  return null;
}

function requireUser(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Studio access only.' });
    next();
  });
}

function setSession(user, res) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: user.id, createdAt: Date.now() };
  save();
  res.setHeader(
    'Set-Cookie',
    `sc_sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}`
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username || null,
    role: user.role,
    points: user.points || 0,
    freeDrawClaimed: !!user.freeDrawClaimed,
    createdAt: user.createdAt,
    hasSecurityQuestion: !!(user.securityQuestion && user.securityAnswerHash),
    // 不暴露 openid 原值，只告诉前端是否已绑定微信
    wechatBound: !!(user.openid && user.openid.length > 0)
  };
}

function validCredentials(username, password) {
  if (!/^[a-zA-Z0-9_.\- ]{2,24}$/.test(username)) return 'Use 2–24 letters, numbers, dots or dashes.';
  if (typeof password !== 'string' || password.length < 6) return 'Password needs at least 6 characters.';
  return null;
}

function validSecurity(question, answer) {
  if (!question || !String(question).trim()) return 'Pick a security question.';
  if (!answer || !normalizeAnswer(answer)) return 'Answer the security question.';
  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  normalizeAnswer,
  hashAnswer,
  verifyAnswer,
  SECURITY_QUESTIONS,
  parseCookies,
  getUser,
  requireUser,
  requireAdmin,
  setSession,
  publicUser,
  validCredentials,
  validSecurity,
  // Token helpers (for WeChat mini-program / API clients)
  createApiToken,
  parseBearerToken,
  lookupSession,
  revokeToken
};
