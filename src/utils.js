'use strict';
/* StarCull · 通用工具：日期、客户端 IP、Cookie、文件名 */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function autoTitle(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const trailing = base.match(/(\d+)\s*$/);
  if (trailing) return 'No. ' + trailing[1];
  return base.replace(/[_-]+/g, ' ').trim() || base;
}

// Make a series name safe to use as a sub-folder of data/uploads.
function sanitizeFolderName(name) {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 60)
    .trim();
  if (!clean || clean === '.' || clean === '..') return '';
  return clean;
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

module.exports = { todayStr, clientIp, autoTitle, sanitizeFolderName, parseCookies };
