'use strict';
/* StarCull · 路由层：注册 / 登录 / 会话 / 安全问题 / 找回密码 */

const express = require('express');
const crypto = require('crypto');
const { DAILY_LOGIN_POINTS, MAX_REG_PER_IP } = require('../config');
const { code2session } = require('../wechat');
const { db, save } = require('../db');
const { todayStr, clientIp } = require('../utils');
const {
  SECURITY_QUESTIONS,
  validCredentials,
  validSecurity,
  hashPassword,
  hashAnswer,
  verifyPassword,
  verifyAnswer,
  parseCookies,
  parseBearerToken,
  lookupSession,
  revokeToken,
  getUser,
  requireUser,
  setSession,
  createApiToken,
  publicUser
} = require('../security');
const { addPointsLog, hasDailyLoginLog } = require('../points');
const { presentProduct, drawFor } = require('../serializers');
const { syncFolderProducts } = require('../catalog');

const router = express.Router();

router.post('/api/register', (req, res) => {
  syncFolderProducts();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const securityQuestion = String(req.body.securityQuestion || '').trim();
  const securityAnswer = String(req.body.securityAnswer || '');
  const problem = validCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });
  const secProblem = validSecurity(securityQuestion, securityAnswer);
  if (secProblem) return res.status(400).json({ error: secProblem });

  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'That account name is already taken.' });
  }

  const ip = clientIp(req);
  const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '']);
  if (ip && !LOCAL_IPS.has(ip)) {
    const existing = db.users.filter((u) => u.registeredIp === ip).length;
    if (existing >= MAX_REG_PER_IP) {
      return res.status(409).json({
        error: 'This network has reached the registration limit (' + MAX_REG_PER_IP + ' accounts).'
      });
    }
  }

  const { salt, hash } = hashPassword(password);
  const { salt: aSalt, hash: aHash } = hashAnswer(securityAnswer);
  const user = {
    id: crypto.randomUUID(),
    username,
    salt,
    hash,
    securityQuestion,
    securityAnswerSalt: aSalt,
    securityAnswerHash: aHash,
    role: 'guest',
    points: 0,
    lastLoginDate: todayStr(),
    freeDrawClaimed: false,
    registeredIp: ip,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  save();

  // New users also get the daily login bonus on registration
  let dailyBonus = 0;
  const today = todayStr();
  if (!hasDailyLoginLog(user.id, today)) {
    user.points = (user.points || 0) + DAILY_LOGIN_POINTS;
    dailyBonus = DAILY_LOGIN_POINTS;
    addPointsLog(user, 'daily_login', DAILY_LOGIN_POINTS, 'Daily login bonus');
    save();
  }

  setSession(user, res);
  const apiToken = createApiToken(user);
  res.json({
    user: publicUser(user),
    products: db.products.map((p) => presentProduct(p, user)),
    draw: null,
    dailyBonus,
    token: apiToken
  });
});

router.post('/api/login', (req, res) => {
  syncFolderProducts();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ error: 'Account or password is incorrect.' });
  }

  let dailyBonus = 0;
  const today = todayStr();
  if (!hasDailyLoginLog(user.id, today)) {
    user.points = (user.points || 0) + DAILY_LOGIN_POINTS;
    dailyBonus = DAILY_LOGIN_POINTS;
    addPointsLog(user, 'daily_login', DAILY_LOGIN_POINTS, 'Daily login bonus');
  }

  setSession(user, res);
  const apiToken = createApiToken(user);
  res.json({
    user: publicUser(user),
    products: db.products.map((p) => presentProduct(p, user)),
    draw: drawFor(user),
    dailyBonus,
    token: apiToken
  });
});

router.post('/api/logout', (req, res) => {
  // Support both cookie-based and Bearer-token-based logout.
  const cookieToken = parseCookies(req.headers.cookie).sc_sid;
  if (cookieToken) { delete db.sessions[cookieToken]; }
  const bearerToken = parseBearerToken(req);
  if (bearerToken) { delete db.sessions[bearerToken]; }
  if (cookieToken || bearerToken) save();
  res.setHeader('Set-Cookie', 'sc_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

/* ---------- token-based session refresh (mini-program) ---------- */

// Same shape as GET /api/session but read only from Authorization header.
// The mini-program calls this on launch to bootstrap user + products + latest draw.
router.get('/api/token-session', (req, res) => {
  syncFolderProducts();
  const bearerToken = parseBearerToken(req);
  const session = lookupSession(bearerToken);
  const user = session ? (db.users.find((u) => u.id === session.userId) || null) : null;
  res.json({
    user: user ? publicUser(user) : null,
    products: db.products.map((p) => presentProduct(p, user)),
    draw: user ? drawFor(user) : null
  });
});

router.get('/api/session', (req, res) => {
  syncFolderProducts();
  const user = getUser(req);
  res.json({
    user: user ? publicUser(user) : null,
    products: db.products.map((p) => presentProduct(p, user)),
    draw: user ? drawFor(user) : null
  });
});

/* ---------- security question & password recovery ---------- */

router.get('/api/security-questions', (req, res) => {
  res.json({ questions: SECURITY_QUESTIONS });
});

// Let a signed-in user set (or change) their security question + answer.
// Used for older accounts that registered before this feature existed.
router.put('/api/user/security-question', requireUser, (req, res) => {
  const question = String(req.body.securityQuestion || '').trim();
  const answer = String(req.body.securityAnswer || '');
  const secProblem = validSecurity(question, answer);
  if (secProblem) return res.status(400).json({ error: secProblem });

  const { salt, hash } = hashAnswer(answer);
  req.user.securityQuestion = question;
  req.user.securityAnswerSalt = salt;
  req.user.securityAnswerHash = hash;
  save();
  res.json({ user: publicUser(req.user) });
});

// Step 1 of recovery: given a username, return the user's security question (no answer).
router.get('/api/recover/question', (req, res) => {
  const username = String(req.query.username || '').trim();
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.securityQuestion || !user.securityAnswerHash) {
    return res.status(409).json({ error: 'This account has no security question set. Please contact the studio.' });
  }
  res.json({ question: user.securityQuestion });
});

// Step 2 of recovery: verify the answer, then reset the password.
router.post('/api/recover/password', (req, res) => {
  const username = String(req.body.username || '').trim();
  const answer = String(req.body.answer || '');
  const newPassword = String(req.body.newPassword || '');

  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.securityQuestion || !user.securityAnswerHash) {
    return res.status(409).json({ error: 'This account has no security question set. Please contact the studio.' });
  }
  if (!verifyAnswer(answer, user)) {
    return res.status(401).json({ error: 'The security answer is incorrect.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password needs at least 6 characters.' });
  }

  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.hash = hash;
  // Force re-login everywhere after a password reset.
  for (const [token, session] of Object.entries(db.sessions)) {
    if (session && session.userId === user.id) delete db.sessions[token];
  }
  save();
  res.json({ ok: true });
});

/* ---------- WeChat one-tap login (wx.login + openid) ---------- */

// 从云函数 proxy 透传的 header 里拿 openid（不用 code，更安全可靠）
function extractOpenid(req) {
  const h = req.headers['x-wx-openid'] || req.headers['X-WX-OpenID'] || '';
  return String(h).trim() || null;
}

// POST /api/wechat-login
// 两种模式自动识别：
//   模式 A（云函数代理，推荐）：header 带 X-WX-OpenID → 直接用，不走 jscode2session
//   模式 B（老兼容）：body 带 { code } → 服务器自己调 jscode2session 换 openid
router.post('/api/wechat-login', async (req, res) => {
  try {
    let openid = extractOpenid(req);
    let unionid = '';

    if (!openid) {
      // 老模式：前端 wx.login → code → 服务器换 openid
      const code = String(req.body.code || '').trim();
      if (!code) {
        return res.status(400).json({
          error: 'No openid from cloud proxy and no code in body. '
               + 'Call from mini-program via cloud function proxy, or pass { code }.'
        });
      }
      const r = await code2session(code);
      openid = r.openid;
      unionid = r.unionid || '';
    }

    // 1) openid 已绑某个用户 → 直接登录
    let user = db.users.find((u) => u.openid === openid);

    // 2) 同 unionid 可能绑了另一个用户（openid 优先）
    if (!user && unionid) {
      user = db.users.find((u) => u.unionid === unionid);
      if (user) {
        user.openid = openid;
        if (unionid) user.unionid = unionid;
        save();
      }
    }

    let isNew = false;

    if (!user) {
      // 3) 创建一个纯微信账号，username 留空，没有密码
      const ip = clientIp(req);
      const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '']);
      if (ip && !LOCAL_IPS.has(ip)) {
        const existing = db.users.filter((u) => u.registeredIp === ip).length;
        if (existing >= MAX_REG_PER_IP) {
          return res.status(409).json({
            error: 'This network has reached the registration limit (' + MAX_REG_PER_IP + ' accounts).'
          });
        }
      }

      user = {
        id: crypto.randomUUID(),
        username: '',
        openid,
        unionid: unionid || '',
        role: 'guest',
        points: 0,
        lastLoginDate: todayStr(),
        freeDrawClaimed: false,
        registeredIp: ip,
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      save();
      isNew = true;
    }

    // 每日登录积分
    let dailyBonus = 0;
    const today = todayStr();
    if (!hasDailyLoginLog(user.id, today)) {
      user.points = (user.points || 0) + DAILY_LOGIN_POINTS;
      dailyBonus = DAILY_LOGIN_POINTS;
      addPointsLog(user, 'daily_login', DAILY_LOGIN_POINTS, 'Daily login bonus');
      save();
    }

    setSession(user, res);
    const apiToken = createApiToken(user);

    res.json({
      user: publicUser(user),
      products: db.products.map((p) => presentProduct(p, user)),
      draw: drawFor(user),
      dailyBonus,
      token: apiToken,
      isNew
    });
  } catch (err) {
    if (err.code === 'WECHAT_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'WeChat login is not enabled on this server. '
             + 'Admin must set WECHAT_APPID and WECHAT_SECRET (only needed for direct code mode).'
      });
    }
    res.status(400).json({ error: err.message || 'WeChat login failed.' });
  }
});

// POST /api/wechat-bind   (需要 Bearer Token)
// 同 wechat-login：优先从 header 拿 openid，没有才用 body.code
router.post('/api/wechat-bind', requireUser, async (req, res) => {
  try {
    if (req.user.openid) {
      return res.status(409).json({ error: 'This account is already bound to WeChat.' });
    }

    let openid = extractOpenid(req);
    let unionid = '';

    if (!openid) {
      const code = String(req.body.code || '').trim();
      if (!code) {
        return res.status(400).json({
          error: 'No openid from cloud proxy and no code in body.'
        });
      }
      const r = await code2session(code);
      openid = r.openid;
      unionid = r.unionid || '';
    }

    const occupied = db.users.find((u) => u.openid === openid);
    if (occupied) {
      return res.status(409).json({
        error: 'This WeChat account is already bound to another StarCull account.'
      });
    }

    req.user.openid = openid;
    if (unionid) req.user.unionid = unionid;
    save();

    res.json({ user: publicUser(req.user) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Bind failed.' });
  }
});

// POST /api/wechat-unbind   (需要 Bearer Token)
// 解绑微信 openid。如果这个账号没有 username（就是纯微信创建的），拒绝解绑——
// 否则解绑后这个账号就彻底没法登录了（既没微信也没密码）。
router.post('/api/wechat-unbind', requireUser, (req, res) => {
  const u = req.user;
  if (!u.openid) {
    return res.status(400).json({ error: 'This account is not bound to WeChat.' });
  }
  if (!u.username) {
    return res.status(409).json({
      error: 'Cannot unbind — this account was created via WeChat only and has no password login. '
           + 'Set a username/password first.'
    });
  }
  delete u.openid;
  if (u.unionid) delete u.unionid;
  save();
  res.json({ user: publicUser(u) });
});

module.exports = router;
