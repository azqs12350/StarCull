'use strict';
/* StarCull · 同步层：香港 uploads → 七牛云 Kodo 对象存储
 *
 * 配置环境变量：QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET / QINIU_ZONE / QINIU_DOMAIN
 */

const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('./config');
const qiniu = require('./qiniu');

function isConfigured() { return qiniu.isConfigured(); }

// ---------- 日志工具 ----------
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ts() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function log(msg) { console.log(`[${ts()}] ${msg}`); }

/**
 * 把本地文件推到七牛云
 */
async function pushFile(relPath) {
  if (!qiniu.isConfigured() || !relPath || !relPath.startsWith('/')) return null;

  let localFile = path.resolve(UPLOAD_DIR, relPath.replace(/^\/uploads\//, ''));
  if (!fs.existsSync(localFile) && relPath.startsWith('/art/')) {
    localFile = path.resolve(__dirname, '..', 'public', relPath.replace(/^\//, ''));
  }
  if (!fs.existsSync(localFile)) { console.warn(`[sync] 本地不存在，跳过: ${relPath}`); return null; }

  const key = relPath.replace(/^\//, '');
  const start = Date.now();
  try {
    const { url } = await qiniu.uploadFile(localFile, key);
    log(`[上传] ✓ ${key}  (${(Date.now() - start)}ms)`);
    return url;
  } catch (e) {
    log(`[上传] ✗ ${key}  失败: ${e.message}`);
    return null;
  }
}

/**
 * 从七牛云删除文件
 */
async function deleteFile(relPathOrUrl) {
  if (!qiniu.isConfigured() || !relPathOrUrl) return;

  let key = relPathOrUrl;
  if (/^https?:\/\//i.test(relPathOrUrl)) {
    const m = relPathOrUrl.match(/^https?:\/\/[^\/]+(\/.*)?$/i);
    key = (m && m[1] ? m[1] : '/').replace(/^\//, '');
  } else {
    key = relPathOrUrl.replace(/^\//, '');
  }

  try {
    await qiniu.deleteFile(key);
    log(`[删除] ✓ ${key}`);
  } catch (e) {
    log(`[删除] ✗ ${key}  失败: ${e.message}`);
  }
}

/**
 * 批量回填：确保 db.json 里所有相对路径都在七牛云上有文件
 */
async function backfillAllImages(products) {
  const items = products || [];
  const tasks = items.map(p => p.image).filter(img => img && img.startsWith('/'));
  if (!tasks.length) { log('[回填] 无需处理'); return { ok: 0, fail: 0 }; }

  log(`[回填] 开始: ${tasks.length} 张待校验`);
  const startAll = Date.now();
  let ok = 0, fail = 0, push = 0;

  for (let i = 0; i < tasks.length; i++) {
    const relPath = tasks[i];
    const key = relPath.replace(/^\//, '');
    try {
      const exists = await qiniu.fileExists(key).catch(() => false);
      if (exists) { ok++; continue; }
      const url = await pushFile(relPath);
      if (url) { ok++; push++; } else { fail++; }
    } catch (e) { fail++; }
    // 每 10 张打印进度
    if ((i + 1) % 10 === 0) {
      log(`[回填] 进度: ${i + 1}/${tasks.length}  已推送 ${push}  失败 ${fail}`);
    }
  }

  const sec = ((Date.now() - startAll) / 1000).toFixed(1);
  log(`[回填] 完成: 成功 ${ok}  新推送 ${push}  失败 ${fail}  用时 ${sec}s`);
  return { ok, fail };
}

/**
 * 增量同步：本地有但七牛上没有 → 推送；七牛上有但本地没有 → 删除
 */
async function diffAndSync() {
  const SEP = '────────────────────────────────────────';
  log(SEP);
  log('★ 七牛云同步开始');

  if (!qiniu.isConfigured()) {
    log('✗ 七牛云未配置，跳过');
    log(SEP);
    return { local: 0, cloud: 0, pushed: 0, deleted: 0 };
  }

  // 1. 扫描本地
  const localFiles = [];
  function walk(dir, prefix) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (e) { return; }
    for (const name of entries) {
      const full = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(full); } catch (e) { continue; }
      if (stat.isDirectory()) walk(full, prefix + name + '/');
      else if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'].includes(path.extname(name).toLowerCase())) {
        localFiles.push({
          relPath: '/' + prefix + name,
          key: prefix + name,
          localFull: full,
          size: stat.size
        });
      }
    }
  }
  if (fs.existsSync(UPLOAD_DIR)) walk(UPLOAD_DIR, 'uploads/');

  // 2. 拉七牛云
  let cloudFiles = [];
  try { cloudFiles = await qiniu.listFiles('uploads/'); }
  catch (e) { log(`✗ list七牛失败: ${e.message}`); log(SEP); return { local: localFiles.length, cloud: 0, pushed: 0, deleted: 0 }; }

  const localKeys = new Set(localFiles.map(f => f.key));
  const cloudKeys = new Set(cloudFiles.map(f => f.key));

  // 3. 算差异
  const toPush = localFiles.filter(f => !cloudKeys.has(f.key));    // 本地有，七牛没有 → 推
  const toDelete = cloudFiles.filter(f => !localKeys.has(f.key)); // 七牛有，本地没有 → 删

  // 本地文件总大小
  const totalKB = (localFiles.reduce((s, f) => s + (f.size || 0), 0) / 1024).toFixed(1);
  const avgKB = localFiles.length ? (totalKB / localFiles.length).toFixed(1) : 0;

  log(`📊 盘点: 本地 ${localFiles.length} 张 (${totalKB}KB, 平均 ${avgKB}KB) | 七牛 ${cloudFiles.length} 张`);
  log(`📋 增量: 待推送 ${toPush.length} | 待清理 ${toDelete.length}`);

  if (toPush.length === 0 && toDelete.length === 0) {
    log('✅ 已是最新，无需同步');
    log(SEP);
    return { local: localFiles.length, cloud: cloudFiles.length, pushed: 0, deleted: 0 };
  }

  const startAll = Date.now();

  // 4. 推送
  if (toPush.length > 0) {
    const etaSec = Math.ceil(toPush.length * 0.8); // 粗略估计：每张 ~0.8s（含 300ms 限速）
    log(`🚀 开始推送 ${toPush.length} 张，预计 ${etaSec}s`);

    let pushed = 0, failed = 0;
    for (let i = 0; i < toPush.length; i++) {
      const f = toPush[i];
      const start = Date.now();
      try {
        await qiniu.uploadFile(f.localFull, f.key);
        pushed++;
        log(`  [${i + 1}/${toPush.length}] ✓ ${f.key}  ${((Date.now() - start) / 1000).toFixed(1)}s`);
      } catch (e) {
        failed++;
        log(`  [${i + 1}/${toPush.length}] ✗ ${f.key}  失败: ${e.message}`);
      }
      // 限速
      await new Promise(r => setTimeout(r, 300));
    }

    const sec = ((Date.now() - startAll) / 1000).toFixed(1);
    log(`📤 推送完成: 成功 ${pushed}  失败 ${failed}  用时 ${sec}s`);
  }

  // 5. 清理（七牛上有但本地没有的旧文件）
  if (toDelete.length > 0) {
    log(`🗑️  清理七牛云上的孤儿文件 ${toDelete.length} 张`);
    let deleted = 0;
    for (const f of toDelete) {
      try { await qiniu.deleteFile(f.key); deleted++; }
      catch (e) { /* 忽略 */ }
      log(`  [-] ${f.key}`);
    }
    log(`📥 清理完成: 删除 ${deleted}/${toDelete.length}`);
  }

  const totalSec = ((Date.now() - startAll) / 1000).toFixed(1);
  log(`★ 同步结束  推送 ${toPush.length}  清理 ${toDelete.length}  总用时 ${totalSec}s`);
  log(SEP);

  return {
    local: localFiles.length,
    cloud: cloudFiles.length,
    pushed: toPush.length,
    deleted: toDelete.length
  };
}

module.exports = { pushFile, deleteFile, backfillAllImages, diffAndSync, isConfigured };
