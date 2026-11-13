'use strict';
/*
 * StarCull 本地同步工具
 *
 * 一条命令把服务器数据拉回本地：
 *   db.json      → <dataDir>/db.json        （覆盖前自动备份）
 *   uploads 图片 → <dataDir>/uploads/...    （增量：大小 + sha256 一致则跳过）
 *
 * 服务端接口（均为现有接口，未做任何后端修改）：
 *   GET  /api/admin/export-db      → db.json 原始文件（需 x-admin-token）
 *   GET  /api/admin/list-uploads   → 图片相对路径清单（需 x-admin-token）
 *   HEAD /uploads/<相对路径>        → 单张图片大小（静态资源，无需 token）
 *   GET  /uploads/<相对路径>        → 图片本体
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const config = require('./config');

class SyncError extends Error {}

/* ---------- 命令行 ---------- */

function usage() {
  console.log([
    '用法: node sync.js [选项]',
    '',
    '选项:',
    '  --out <目录>   临时覆盖输出数据目录（默认取配置里的 dataDir）',
    '  --dry-run      只比对与统计，不写入任何文件',
    '  -h, --help     显示帮助',
    '',
    '配置: tools/local-sync/config.local.json（可选，已在 .gitignore 中）',
    '环境变量: STARCULL_SYNC_SERVER / STARCULL_ADMIN_TOKEN /',
    '          STARCULL_SYNC_DATA_DIR / STARCULL_SYNC_BACKUP_DIR'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = { dryRun: false, help: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--out') {
      args.out = argv[++i];
      if (!args.out) throw new SyncError('--out 后面需要跟目录路径');
    } else if (a.indexOf('--out=') === 0) {
      args.out = a.slice('--out='.length);
    } else {
      throw new SyncError('未知参数：' + a + '（用 --help 查看用法）');
    }
  }
  return args;
}

/* ---------- 小工具 ---------- */

function formatBytes(n) {
  if (n == null || isNaN(n)) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function stamp() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + p(d.getMilliseconds(), 3);
}

function countOf(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function describeNetworkError(err, url, timeoutMs) {
  const code = err && ((err.cause && err.cause.code) || err.code);
  if (err && err.name === 'AbortError') return '请求超时（' + timeoutMs + ' ms）：' + url;
  if (code === 'ECONNREFUSED') {
    return '无法连接服务器（连接被拒绝）：' + url + '\n  请确认服务已启动、地址和端口正确。';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return '无法解析服务器地址：' + url;
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return '连接服务器超时：' + url;
  }
  return '网络请求失败：' + url + '\n  ' + (err && err.message ? err.message : String(err));
}

function hashCode(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function uploadUrl(baseUrl, rel) {
  return baseUrl + '/uploads/' + rel.split('/').map(encodeURIComponent).join('/');
}

function safeTarget(uploadDir, rel) {
  if (!rel || rel.indexOf('..') >= 0 || path.isAbsolute(rel)) {
    throw new SyncError('服务器返回了非法文件路径：' + rel);
  }
  const abs = path.resolve(uploadDir, rel);
  const root = path.resolve(uploadDir);
  if (abs !== root && abs.toLowerCase().indexOf((root + path.sep).toLowerCase()) !== 0) {
    throw new SyncError('图片路径越界：' + rel);
  }
  return abs;
}

async function runPool(items, limit, worker) {
  let next = 0;
  const size = Math.min(limit, items.length);
  const runners = [];
  for (let i = 0; i < size; i++) {
    runners.push((async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
}

/* ---------- HTTP ---------- */

async function fetchWithTimeout(cfg, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    return await fetch(url, Object.assign({ redirect: 'follow' }, init, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function adminFetch(cfg, pathname) {
  const url = cfg.serverUrl + pathname;
  let res;
  try {
    res = await fetchWithTimeout(cfg, url, { headers: { 'x-admin-token': cfg.adminToken } });
  } catch (e) {
    throw new SyncError(describeNetworkError(e, url, cfg.timeoutMs));
  }
  if (res.status === 401) {
    throw new SyncError('鉴权失败（401）：admin token 无效。\n  请检查 tools/local-sync/config.local.json 的 adminToken 或环境变量 STARCULL_ADMIN_TOKEN。');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SyncError('请求失败（HTTP ' + res.status + '）：' + pathname +
      (text ? '\n  ' + text.slice(0, 300) : ''));
  }
  return res;
}

async function fetchDb(cfg) {
  const res = await adminFetch(cfg, '/api/admin/export-db');
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new SyncError('读取服务器返回的 db 数据失败：' + e.message);
  }
  let data;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new SyncError('服务器返回的 db.json 不是合法 JSON（可能被截断），已放弃写入。\n  ' + e.message);
  }
  return { buf: buf, data: data, size: buf.length, mtime: res.headers.get('x-db-mtime') };
}

async function fetchUploadList(cfg) {
  const res = await adminFetch(cfg, '/api/admin/list-uploads');
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new SyncError('uploads 清单不是合法 JSON：' + e.message);
  }
  const files = Array.isArray(data && data.files) ? data.files.filter((f) => typeof f === 'string' && f) : [];
  return { files: files, totalBytes: Number(data && data.totalBytes) || null };
}

async function headRemoteSize(cfg, rel) {
  const url = uploadUrl(cfg.serverUrl, rel);
  let res;
  try {
    res = await fetchWithTimeout(cfg, url, { method: 'HEAD' });
  } catch (e) {
    throw new SyncError(describeNetworkError(e, url, cfg.timeoutMs));
  }
  if (!res.ok) return null;
  const len = res.headers.get('content-length');
  if (len == null || len === '') return null;
  const n = Number(len);
  return isNaN(n) ? null : n;
}

/* ---------- 图片 ---------- */

async function backupImage(cfg, rel, target) {
  let exists = true;
  try {
    await fsp.access(target);
  } catch (e) {
    exists = false;
  }
  if (!exists) return;
  const dest = path.join(cfg.backupDir, 'images', stamp(), rel);
  try {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(target, dest);
  } catch (e) {
    throw new SyncError('备份将被覆盖的图片失败，已跳过该文件：' + rel + '\n  ' + e.message);
  }
}

async function downloadFile(cfg, rel) {
  const url = uploadUrl(cfg.serverUrl, rel);
  const target = safeTarget(cfg.uploadDir, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });

  let res;
  try {
    res = await fetchWithTimeout(cfg, url, {});
  } catch (e) {
    throw new SyncError(describeNetworkError(e, url, cfg.timeoutMs));
  }
  if (!res.ok) throw new SyncError('下载失败（HTTP ' + res.status + '）：' + rel);
  if (!res.body) throw new SyncError('下载失败（响应为空）：' + rel);

  const expected = Number(res.headers.get('content-length') || 0);
  const tmp = target + '.part-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let handle = null;

  try {
    handle = await fsp.open(tmp, 'w');
    for await (const chunk of Readable.fromWeb(res.body)) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      await handle.write(buf);
      hash.update(buf);
      bytes += buf.length;
    }
    await handle.close();
    handle = null;

    if (expected && bytes !== expected) {
      throw new SyncError('下载不完整（' + bytes + '/' + expected + ' 字节）：' + rel);
    }
    if (cfg.backupImages) await backupImage(cfg, rel, target);
    await fsp.rename(tmp, target);
    return { size: bytes, sha256: hash.digest('hex') };
  } catch (e) {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(tmp).catch(() => {});
    if (e instanceof SyncError) throw e;
    throw new SyncError('写入图片失败（磁盘空间/权限？）：' + rel + '\n  ' + e.message);
  }
}

async function downloadWithRetry(cfg, rel) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await downloadFile(cfg, rel);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

// 返回 { status: 'skip' | 'download', size }
async function syncOne(cfg, rel, manifest, localSizes) {
  const localSize = localSizes.has(rel) ? localSizes.get(rel) : null;
  let remoteSize = null;

  if (localSize != null) {
    remoteSize = await headRemoteSize(cfg, rel);
    if (remoteSize != null && remoteSize === localSize) {
      const prev = manifest[rel];
      if (!prev || prev.size !== localSize || !prev.sha256) {
        // 首次见到这个本地文件：大小一致就先记账，避免重复下载
        const h = await hashCode(path.join(cfg.uploadDir, rel));
        manifest[rel] = { size: localSize, sha256: h };
        return { status: 'skip', size: localSize };
      }
      const h = await hashCode(path.join(cfg.uploadDir, rel));
      if (h === prev.sha256) return { status: 'skip', size: localSize };
    }
  }

  if (cfg.dryRun) {
    if (remoteSize == null) remoteSize = await headRemoteSize(cfg, rel);
    return { status: 'download', size: remoteSize };
  }

  const meta = await downloadWithRetry(cfg, rel);
  manifest[rel] = meta;
  return { status: 'download', size: meta.size };
}

/* ---------- 本地文件 ---------- */

async function listLocalFiles(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(abs);
      } else if (ent.isFile()) {
        const st = await fsp.stat(abs);
        map.set(path.relative(dir, abs).split(path.sep).join('/'), st.size);
      }
    }
  }
  await walk(dir);
  return map;
}

async function readManifest(cfg) {
  try {
    const raw = await fsp.readFile(cfg.manifestFile, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function writeManifest(cfg, manifest, remoteFiles) {
  const keep = {};
  for (const rel of remoteFiles) {
    if (manifest[rel]) keep[rel] = manifest[rel];
  }
  const tmp = cfg.manifestFile + '.tmp-' + process.pid;
  try {
    await fsp.mkdir(cfg.backupDir, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(keep, null, 2));
    await fsp.rename(tmp, cfg.manifestFile);
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    console.warn('⚠ 写入同步清单失败（不影响本次拉取）：' + e.message);
  }
}

/* ---------- db.json ---------- */

async function backupDb(cfg) {
  await fsp.mkdir(cfg.backupDir, { recursive: true });
  const dest = path.join(cfg.backupDir, 'db-' + stamp() + '.json');
  try {
    await fsp.copyFile(cfg.dbFile, dest);
  } catch (e) {
    throw new SyncError('备份现有 db.json 失败，已中止覆盖（原文件未改动）：\n  ' + e.message);
  }
  return dest;
}

async function pruneBackups(cfg) {
  if (!cfg.keepDbBackups) return;
  let names;
  try {
    names = (await fsp.readdir(cfg.backupDir)).filter((n) => /^db-\d{8}-\d{6}\d{3}\.json$/.test(n));
  } catch (e) {
    names = [];
  }
  names.sort().reverse();
  for (const name of names.slice(cfg.keepDbBackups)) {
    await fsp.unlink(path.join(cfg.backupDir, name)).catch(() => {});
  }

  // 可选的图片备份目录也按份数清理
  if (!cfg.backupImages) return;
  const imagesDir = path.join(cfg.backupDir, 'images');
  let dirs;
  try {
    dirs = (await fsp.readdir(imagesDir)).filter((n) => /^\d{8}-\d{9}$/.test(n));
  } catch (e) {
    return;
  }
  dirs.sort().reverse();
  for (const name of dirs.slice(cfg.keepDbBackups)) {
    await fsp.rm(path.join(imagesDir, name), { recursive: true, force: true }).catch(() => {});
  }
}

async function replaceDb(cfg, buf) {
  const target = cfg.dbFile;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp-' + process.pid + '-' + Date.now();
  try {
    // 先写同目录临时文件，再 rename，避免中途失败留下半截 db.json
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    throw new SyncError('写入 db.json 失败（磁盘空间/权限？），原文件未改动：\n  ' + e.message);
  }
}

/* ---------- 主流程 ---------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const cfg = config.load(args);
  if (!cfg.adminToken) {
    throw new SyncError([
      '未配置 admin token，无法拉取 /api/admin/*。',
      '  方式一：在 tools/local-sync/config.local.json 写入',
      '          { "adminToken": "<服务器 admin token>" }',
      '  方式二：设置环境变量 STARCULL_ADMIN_TOKEN',
      '  （config.local.json 已被 .gitignore 忽略，不会入库）'
    ].join('\n'));
  }

  const startedAt = Date.now();
  console.log('StarCull 本地同步' + (args.dryRun ? '（dry-run：只读，不写入）' : ''));
  console.log('  服务器  ' + cfg.serverUrl);
  console.log('  数据目录 ' + cfg.dataDir);
  console.log('  备份目录 ' + cfg.backupDir);

  console.log('\n[1/3] 拉取数据库…');
  const db = await fetchDb(cfg);
  console.log('  db.json ' + formatBytes(db.size) + ' · ' +
    'products ' + countOf(db.data.products) +
    ' · users ' + countOf(db.data.users) +
    ' · draws ' + countOf(db.data.draws) +
    ' · messages ' + countOf(db.data.messages));

  console.log('\n[2/3] 获取图片清单…');
  const uploads = await fetchUploadList(cfg);
  console.log('  服务器图片 ' + uploads.files.length + ' 张 · 共 ' +
    (uploads.totalBytes != null ? formatBytes(uploads.totalBytes) : '未知大小'));

  console.log('\n[3/3] 比对并下载…');
  const manifest = await readManifest(cfg);
  const localSizes = await listLocalFiles(cfg.uploadDir);
  const results = { download: [], skip: [], failed: [] };
  let done = 0;
  const total = uploads.files.length;
  const progressEvery = total > 20 ? Math.ceil(total / 10) : 0;

  await runPool(uploads.files, cfg.concurrency, async (rel) => {
    try {
      const r = await syncOne(cfg, rel, manifest, localSizes);
      results[r.status].push(rel);
      if (r.status === 'download') {
        console.log('  ↓ ' + rel + ' (' + formatBytes(r.size) + ')');
      }
    } catch (e) {
      results.failed.push({ rel: rel, error: e.message });
      console.error('  ✗ ' + rel + ' — ' + e.message);
    } finally {
      done++;
      if (progressEvery && done % progressEvery === 0 && done < total) {
        console.log('  进度 ' + done + '/' + total);
      }
    }
  });

  const remoteSet = new Set(uploads.files);
  const extras = [];
  for (const rel of localSizes.keys()) {
    if (!remoteSet.has(rel)) extras.push(rel);
  }

  if (!cfg.dryRun) {
    await writeManifest(cfg, manifest, uploads.files);
  }

  let backupPath = null;
  let dbWritten = false;
  if (args.dryRun) {
    console.log('\n（dry-run）将覆盖 db.json → ' + cfg.dbFile);
  } else if (results.failed.length) {
    console.warn('\n⚠ 有 ' + results.failed.length + ' 张图片失败，本次不覆盖 db.json，' +
      '避免数据库引用到本地缺失的图片。修复后重跑即可。');
  } else {
    if (fs.existsSync(cfg.dbFile)) {
      backupPath = await backupDb(cfg);
    }
    await replaceDb(cfg, db.buf);
    dbWritten = true;
    await pruneBackups(cfg);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('\n' + (results.failed.length ? '✗ 同步未全部成功' : '✓ 同步完成') + '（' + elapsed + 's）');
  console.log('  db.json      ' + formatBytes(db.size) +
    (dbWritten ? ' → 已覆盖 ' + cfg.dbFile : ' → 未覆盖（保留原文件）'));
  if (backupPath) console.log('  覆盖前备份   ' + backupPath);
  else if (!args.dryRun && dbWritten) console.log('  覆盖前备份   （本地原本没有 db.json，未生成备份）');
  console.log('  图片         总计 ' + total +
    ' · 下载 ' + results.download.length +
    ' · 跳过 ' + results.skip.length +
    ' · 失败 ' + results.failed.length);
  if (extras.length) {
    console.log('  本地多出     ' + extras.length + ' 个文件（默认不删除）：' +
      extras.slice(0, 5).join(', ') + (extras.length > 5 ? ' …' : ''));
  } else if (localSizes.size) {
    console.log('  本地多出     0 个文件');
  }
  if (results.failed.length) {
    console.log('  失败明细（前 5 个）：');
    results.failed.slice(0, 5).forEach((f) => console.log('    - ' + f.rel + '：' + f.error.split('\n')[0]));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('\n✗ ' + (e instanceof SyncError ? e.message : ('同步失败：' + (e && e.stack ? e.stack : e))));
  process.exit(1);
});
