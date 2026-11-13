'use strict';
/* StarCull · 配置层：端口、目录与业务常量 */

const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');

const PORT = Number(process.env.PORT) || 4173;
const ADMIN_USER = process.env.ADMIN_USER || 'studio';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'starcull2026';

const DATA_DIR = path.join(ROOT_DIR, 'data');

// 自动探测 uploads 目录：优先 data/uploads，没有的话找 public/art
function findUploadDir() {
  const candidates = [
    path.join(ROOT_DIR, 'data', 'uploads'),
    path.join(ROOT_DIR, 'uploads'),
    path.join(ROOT_DIR, 'public', 'uploads'),
    path.join(ROOT_DIR, 'public', 'art'),
  ];
  for (const d of candidates) {
    if (fs.existsSync(d)) {
      // 算一下有多少张图片
      let count = 0;
      function walk(dir) {
        fs.readdirSync(dir).forEach(n => {
          const f = path.join(dir, n);
          try {
            if (fs.statSync(f).isDirectory()) walk(f);
            else if (/\.(jpg|jpeg|png|webp|avif|gif|svg)$/i.test(n)) count++;
          } catch (e) {}
        });
      }
      walk(d);
      console.log(`[config] UPLOAD_DIR = ${d}  (${count} 张图片)`);
      return d;
    }
  }
  // 都没有，用默认的
  const def = candidates[0];
  console.log(`[config] 未找到 uploads 目录，使用默认: ${def}`);
  return def;
}

const UPLOAD_DIR = findUploadDir();
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// WeChat mini-program credentials for wx.login → openid exchange.
const WECHAT_APPID = process.env.WECHAT_APPID || '';
const WECHAT_SECRET = process.env.WECHAT_SECRET || '';

// ---------- 七牛云对象存储 Kodo ----------
// 密钥直接写死在这里，不用配环境变量、不用装 dotenv，直接 node server.js 就能跑
// （内部项目，暂时安全；如果以后要开源再换回环境变量）
const QINIU_ACCESS_KEY = process.env.QINIU_ACCESS_KEY || 'BAGZhJy2mZo89jEw3sk9YMPE3qozhDum5Y5_gJrD';
const QINIU_SECRET_KEY = process.env.QINIU_SECRET_KEY || '-8oWgq_MNZm4n4YxdCcZl_crzRLZq7hGOof3nwQH';
const QINIU_BUCKET     = process.env.QINIU_BUCKET     || 'starcull';
const QINIU_ZONE       = process.env.QINIU_ZONE       || 'z1';   // z1 = 华北-河北
// 七牛云测试域名只有 HTTP（30天回收），HTTPS 要付费版或自定义域名备案
// 这里直接用 http://，proxy 云函数内部会拉 http 图转 base64 返回小程序
const QINIU_DOMAIN     = (process.env.QINIU_DOMAIN     || 'http://todngtla4.hb-bkt.clouddn.com').replace(/\/$/, '');

// ---------- 图片 URL 基础配置 ----------
// 优先用七牛云 CDN 域名
const IMAGE_BASE_URL = (QINIU_DOMAIN || process.env.IMAGE_BASE_URL || '').replace(/\/$/, '');

// Max accounts allowed to register from the same public IP address.
const MAX_REG_PER_IP = Number(process.env.MAX_REG_PER_IP) || 2;

const SESSION_DAYS = 30;
const DAILY_LOGIN_POINTS = 20;
const PAID_DRAW_COST = 50;
const FRAMED_UPGRADE_COST = 300;
const INTERACTION_POINTS = 2;
const INTERACTION_CHANCE = 0.05;
const DAILY_INTERACTION_CAP = 20;
const INTERACTION_COOLDOWN_MS = 3000;

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  PORT,
  ADMIN_USER,
  ADMIN_PASSWORD,
  DATA_DIR,
  UPLOAD_DIR,
  DB_FILE,
  WECHAT_APPID,
  WECHAT_SECRET,
  MAX_REG_PER_IP,
  SESSION_DAYS,
  DAILY_LOGIN_POINTS,
  PAID_DRAW_COST,
  FRAMED_UPGRADE_COST,
  INTERACTION_POINTS,
  INTERACTION_CHANCE,
  DAILY_INTERACTION_CAP,
  INTERACTION_COOLDOWN_MS,
  // 图片 URL
  IMAGE_BASE_URL,
  // 七牛云
  QINIU_ACCESS_KEY,
  QINIU_SECRET_KEY,
  QINIU_BUCKET,
  QINIU_ZONE,
  QINIU_DOMAIN
};
