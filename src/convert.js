'use strict';
/* StarCull · 图片转码层：统一转 JPG + 超大压缩 + 七牛旧格式清理
 *
 * 使用场景：
 *   1. 用户上传（media.saveUploadAsJpg）—— 落盘前转一次
 *   2. 服务器启动自检（runStartupConvert）—— 存量图片不同格式转一次
 *   3. 后台手动批量（admin /api/admin/convert-jpg）
 */

const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR, QINIU_DOMAIN, IMAGE_BASE_URL } = require('./config');
const { db, save } = require('./db');
const image = require('./image');
const sync = require('./sync');
const qiniu = require('./qiniu');
const { setScanLock } = require('./catalog');

// 可转码的扩展名（svg 矢量图、gif 动图不处理）
const CONVERT_EXT = new Set(['.png', '.webp', '.avif', '.jpeg', '.jpg']);

function walkImages(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkImages(abs, out); continue; }
    if (!entry.isFile()) continue;
    if (!CONVERT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    out.push({
      abs,
      name: entry.name,
      size: st.size,
      rel: '/uploads/' + path.relative(UPLOAD_DIR, abs).replace(/\\/g, '/')
    });
  }
}

// 是否需要的转：非 jpg，或者 jpg 但体积超目标
function needsConvert(f) {
  return path.extname(f.name).toLowerCase() !== '.jpg' || f.size > image.TARGET_BYTES;
}

// 扫描：返回全部图片和待转列表
function listPending() {
  const all = [];
  if (fs.existsSync(UPLOAD_DIR)) walkImages(UPLOAD_DIR, all);
  return { all, todo: all.filter(needsConvert) };
}

// 把 db 里指向旧路径的 image 改成新路径（兼容相对路径 / 七牛完整 URL）
function replaceImagePath(oldRel, newRel) {
  const candidates = new Set([oldRel]);
  if (QINIU_DOMAIN) candidates.add(QINIU_DOMAIN + oldRel);
  if (IMAGE_BASE_URL) candidates.add(IMAGE_BASE_URL + oldRel);

  let count = 0;
  const apply = (holder) => {
    if (holder && candidates.has(holder.image)) { holder.image = newRel; count++; }
  };
  db.products.forEach(apply);
  (db.draws || []).forEach((d) => apply(d.product));
  return count;
}

// 转换单张：转 JPG → 落盘 → 删原图 → 更新 db → 七牛换新删旧
async function convertOne(f) {
  const before = f.size;
  const src = fs.readFileSync(f.abs);
  const out = await image.toJpg(src);

  // 同名换 .jpg；若目标已存在且不是自己，加时间戳避免覆盖
  let targetAbs = path.join(path.dirname(f.abs), f.name.replace(/\.[^.]+$/, '.jpg'));
  if (targetAbs !== f.abs && fs.existsSync(targetAbs)) {
    targetAbs = path.join(
      path.dirname(f.abs),
      path.basename(f.name, path.extname(f.name)) + '-' + Date.now() + '.jpg'
    );
  }

  fs.writeFileSync(targetAbs, out.buffer);
  const newRel = '/uploads/' + path.relative(UPLOAD_DIR, targetAbs).replace(/\\/g, '/');

  if (targetAbs !== f.abs) fs.unlinkSync(f.abs);
  const matched = replaceImagePath(f.rel, newRel);

  // 七牛：先推新图，再删旧 key
  if (sync.isConfigured()) {
    try { await sync.pushFile(newRel); } catch { /* 忽略单张失败 */ }
    if (newRel !== f.rel) {
      try { await sync.deleteFile(f.rel); } catch { /* 忽略 */ }
    }
  }

  return {
    rel: f.rel,
    newRel,
    beforeKB: Math.round(before / 1024),
    afterKB: Math.round(out.buffer.length / 1024),
    compressed: out.compressed,
    dbUpdated: matched
  };
}

/**
 * 分批转换
 * @param {{limit?: number, dryRun?: boolean}} opts
 */
async function convertBatch(opts = {}) {
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 20));
  const dryRun = !!opts.dryRun;

  if (!image.available()) {
    const err = new Error('sharp 未安装，请先在服务器上执行: npm install sharp');
    err.code = 'SHARP_MISSING';
    throw err;
  }

  const { all, todo } = listPending();
  const batch = todo.slice(0, limit);

  if (dryRun) {
    return {
      total: all.length,
      needConvert: todo.length,
      dryRun: true,
      willProcess: batch.map((f) => ({ rel: f.rel, sizeKB: Math.round(f.size / 1024) }))
    };
  }

  const results = [];
  let converted = 0;

  setScanLock(true); // 转码期间暂停目录扫描，避免生成重复产品
  try {
    for (const f of batch) {
      try {
        results.push(await convertOne(f));
        converted++;
      } catch (e) {
        results.push({ rel: f.rel, error: e.message });
      }
    }
    save();
  } finally {
    setScanLock(false);
  }

  return {
    total: all.length,
    needConvert: todo.length,
    processed: converted,
    failed: results.filter((r) => r.error).length,
    remaining: Math.max(0, todo.length - batch.length),
    results
  };
}

/**
 * 七牛上还残留旧格式（png/webp/avif）时，若本地已有同名 .jpg，就删掉云端旧 key
 */
async function cleanupRemoteOldFormats() {
  if (!sync.isConfigured()) return { checked: 0, deleted: 0 };

  let files = [];
  try { files = await qiniu.listFiles('uploads/'); } catch { return { checked: 0, deleted: 0 }; }

  let deleted = 0;
  for (const f of files) {
    const ext = path.extname(f.key).toLowerCase();
    if (!CONVERT_EXT.has(ext) || ext === '.jpg') continue;

    const jpgKey = f.key.replace(/\.[^.]+$/, '.jpg');
    const localJpg = path.join(UPLOAD_DIR, jpgKey.replace(/^uploads\//, ''));
    if (!fs.existsSync(localJpg)) continue;

    try {
      await qiniu.deleteFile(f.key);
      deleted++;
    } catch { /* 忽略 */ }
  }
  return { checked: files.length, deleted };
}

/**
 * 服务器启动自检：把存量图片里非 JPG / 超大的转一遍，再清理七牛旧格式
 */
async function runStartupConvert() {
  if (!image.available()) {
    console.warn('[convert] sharp 未安装，跳过启动自检（npm install sharp 后重启即可）');
    return { skipped: true };
  }

  const { all, todo } = listPending();
  if (!todo.length) {
    console.log(`[convert] 启动自检：${all.length} 张图片都已是 JPG 且体积达标，无需转换`);
  } else {
    console.log(`[convert] 启动自检：共 ${all.length} 张，待转 ${todo.length} 张`);
  }

  let converted = 0;
  let failed = 0;
  let round = 0;

  while (todo.length || round === 0) {
    const pending = listPending();
    if (!pending.todo.length) break;

    round++;
    console.log(`[convert] 第 ${round} 轮：处理 ${Math.min(50, pending.todo.length)} 张（剩余 ${pending.todo.length}）`);

    const r = await convertBatch({ limit: 50 });
    converted += r.processed;
    failed += r.failed;

    // 本轮一张都没成功，避免死循环
    if (r.processed === 0) break;
  }

  const cleanup = await cleanupRemoteOldFormats().catch(() => ({ checked: 0, deleted: 0 }));
  console.log(`[convert] 启动自检完成：转码 ${converted} 张，失败 ${failed} 张，七牛清理旧格式 ${cleanup.deleted} 个`);

  return { converted, failed, remoteDeleted: cleanup.deleted };
}

module.exports = {
  CONVERT_EXT,
  listPending,
  convertBatch,
  convertOne,
  cleanupRemoteOldFormats,
  runStartupConvert
};
