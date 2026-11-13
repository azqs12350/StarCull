'use strict';
/* StarCull · 七牛云 Kodo 对象存储封装
 *
 * 永久免费 10GB，国内速度最快，公开读 + HTTPS 永久链接。
 *
 * 环境变量：
 *   QINIU_ACCESS_KEY  = 你的 AccessKey
 *   QINIU_SECRET_KEY  = 你的 SecretKey
 *   QINIU_BUCKET      = 空间名称
 *   QINIU_ZONE        = z0(华东) / z1(华北) / z2(华南) / as0(香港)
 *   QINIU_DOMAIN      = https://cdn-xxx.qiniudn.com（空间设置里的 CDN 域名）
 */

const qiniu = require('qiniu');
const fs = require('fs');
const path = require('path');
const {
  QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET, QINIU_ZONE, QINIU_DOMAIN,
  UPLOAD_DIR
} = require('./config');

let _bucketManager = null;
let _formUploader = null;
let _uploadConfig = null;

// 本地索引文件：记录已上传到七牛的 key（避开 listPrefixV2 兼容性问题）
const INDEX_FILE = path.resolve(__dirname, '..', 'data', 'qiniu-index.json');

function loadLocalIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return { keys: [] };
}

function saveLocalIndex(index) {
  try {
    const dir = path.dirname(INDEX_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  } catch (e) { console.warn('[七牛] saveLocalIndex failed:', e.message); }
}

const ZONE_MAP = {
  z0: qiniu.zone.Zone_z0,     // 华东-浙江（默认）
  z1: qiniu.zone.Zone_z1,     // 华北-河北
  z2: qiniu.zone.Zone_z2,     // 华南-广东
  na0: qiniu.zone.Zone_na0,   // 亚太-新加坡
  as0: qiniu.zone.Zone_as0,   // 亚太-香港
  'cn-east-1': qiniu.zone.Zone_z0,
  'cn-north-1': qiniu.zone.Zone_z1,
  'cn-south-1': qiniu.zone.Zone_z2
};

function getZone() {
  return ZONE_MAP[QINIU_ZONE] || qiniu.zone.Zone_z0;
}

async function detectCorrectZone() {
  const allZones = [
    ['z0', qiniu.zone.Zone_z0],
    ['z1', qiniu.zone.Zone_z1],
    ['z2', qiniu.zone.Zone_z2],
    ['na0', qiniu.zone.Zone_na0],
    ['as0', qiniu.zone.Zone_as0],
  ];

  console.log('\n========== 七牛云 zone 自动探测 ==========');
  console.log(`AK=${QINIU_ACCESS_KEY.substring(0, 6)}... BUCKET=${QINIU_BUCKET}`);
  for (const [name, zone] of allZones) {
    try {
      const cfg = new qiniu.conf.Config();
      cfg.zone = zone;
      const bm = new qiniu.rs.BucketManager(getMac(), cfg);
      const result = await new Promise((resolve) => {
        bm.listPrefixV2(QINIU_BUCKET, { limit: 3 }, (err, body, info) => {
          resolve({ err, body, info });
        });
      });
      const sc = result.info ? result.info.statusCode : 0;
      const items = (result.body && result.body.items) || [];
      if (sc === 200) {
        console.log(`  zone=${name} ✓ status=200 items=${items.length}`);
        if (items.length > 0) {
          console.log(`    样例: ${items.slice(0, 2).map(i => i.key).join(', ')}`);
        }
      } else {
        console.log(`  zone=${name} ✗ status=${sc} err=${result.err ? result.err.message : '-'}`);
      }
    } catch (e) {
      console.log(`  zone=${name} ✗ ${e.message}`);
    }
  }
  console.log('=========================================\n');
}

function isConfigured() {
  return !!(QINIU_ACCESS_KEY && QINIU_SECRET_KEY && QINIU_BUCKET);
}

function getMac() {
  return new qiniu.auth.digest.Mac(QINIU_ACCESS_KEY, QINIU_SECRET_KEY);
}

function getBucketManager() {
  if (!isConfigured()) return null;
  if (!_bucketManager) {
    _bucketManager = new qiniu.rs.BucketManager(getMac(), getUploadConfig());
  }
  return _bucketManager;
}

function getUploadConfig() {
  if (!_uploadConfig) {
    _uploadConfig = new qiniu.conf.Config();
    _uploadConfig.zone = getZone();
  }
  return _uploadConfig;
}

function getFormUploader() {
  if (!_formUploader) {
    _formUploader = new qiniu.form_up.FormUploader(getUploadConfig());
  }
  return _formUploader;
}

function makeUploadToken(key) {
  const scope = key ? `${QINIU_BUCKET}:${key}` : QINIU_BUCKET;
  const putPolicy = new qiniu.rs.PutPolicy({ scope });
  return putPolicy.uploadToken(getMac());
}

function makePublicUrl(key) {
  if (!QINIU_DOMAIN) return key;
  // 七牛云 bucket 设了公开读，直接 CDN 域名 + key 就是永久 HTTPS 链接
  return `${QINIU_DOMAIN}/${key}`;
}

/**
 * 上传本地文件到七牛云
 */
async function uploadFile(localPath, qiniuKey) {
  if (!isConfigured()) throw new Error('七牛云未配置');
  if (!fs.existsSync(localPath)) throw new Error('本地文件不存在: ' + localPath);

  const uploadToken = makeUploadToken(qiniuKey);
  const putExtra = new qiniu.form_up.PutExtra();
  putExtra.mimeType = guessMime(qiniuKey);

  return new Promise((resolve, reject) => {
    getFormUploader().putFile(uploadToken, qiniuKey, localPath, putExtra, (err, respBody, respInfo) => {
      if (err) return reject(err);
      if (respInfo.statusCode === 200) {
        const url = makePublicUrl(qiniuKey);
        console.log(`[七牛] UPLOAD ${qiniuKey} → ${url}`);
        // 写入本地索引（避开 listPrefixV2 不兼容问题）
        const idx = loadLocalIndex();
        if (!idx.keys.includes(qiniuKey)) { idx.keys.push(qiniuKey); saveLocalIndex(idx); }
        resolve({ key: qiniuKey, url });
      } else {
        reject(new Error(`七牛上传失败 ${respInfo.statusCode}: ${JSON.stringify(respBody)}`));
      }
    });
  });
}

/**
 * 上传 Buffer 到七牛云
 */
async function uploadBuffer(buf, qiniuKey, contentType) {
  if (!isConfigured()) throw new Error('七牛云未配置');

  const uploadToken = makeUploadToken(qiniuKey);
  const putExtra = new qiniu.form_up.PutExtra();
  putExtra.mimeType = contentType || guessMime(qiniuKey);

  return new Promise((resolve, reject) => {
    getFormUploader().put(uploadToken, qiniuKey, buf, putExtra, (err, respBody, respInfo) => {
      if (err) return reject(err);
      if (respInfo.statusCode === 200) {
        const url = makePublicUrl(qiniuKey);
        console.log(`[七牛] UPLOAD-BUFFER ${qiniuKey} (${buf.length} bytes) → ${url}`);
        resolve({ key: qiniuKey, url });
      } else {
        reject(new Error(`七牛上传失败 ${respInfo.statusCode}: ${JSON.stringify(respBody)}`));
      }
    });
  });
}

/**
 * 从七牛云删除文件
 */
async function deleteFile(qiniuKey) {
  if (!isConfigured()) throw new Error('七牛云未配置');

  return new Promise((resolve, reject) => {
    getBucketManager().delete(QINIU_BUCKET, qiniuKey, (err, respBody, respInfo) => {
      if (err) return reject(err);
      if (respInfo.statusCode === 200) {
        console.log(`[七牛] DELETE ${qiniuKey}`);
        resolve();
      } else {
        reject(new Error(`七牛删除失败 ${respInfo.statusCode}: ${JSON.stringify(respBody)}`));
      }
    });
  });
}

/**
 * 列出七牛云指定前缀下的所有文件
 */
async function listFiles(prefix) {
  if (!isConfigured()) throw new Error('七牛云未配置');

  // 优先读本地索引（避开 listPrefixV2 兼容性问题）
  const idx = loadLocalIndex();
  if (idx.keys && idx.keys.length > 0) {
    let keys = idx.keys;
    if (prefix) keys = keys.filter(k => k.startsWith(prefix));
    const files = keys.map(key => ({
      key,
      url: makePublicUrl(key),
      size: 0,
      hash: '',
      lastModified: null
    }));
    console.log(`[七牛] listFiles("${prefix}") → ${files.length} 个 [本地索引] | 总索引 ${idx.keys.length} 条`);
    return files;
  }

  // 本地索引为空才去 listPrefixV2（首次启动）
  const files = [];
  let marker = '';
  do {
    const res = await new Promise((resolve, reject) => {
      getBucketManager().listPrefixV2(QINIU_BUCKET, { prefix: prefix || '', marker, limit: 1000 }, (err, respBody, respInfo) => {
        if (err) return reject(err);
        if (respInfo.statusCode === 200) resolve(respBody);
        else reject(new Error(`listFiles 失败 ${respInfo.statusCode}: ${JSON.stringify(respBody).slice(0, 200)}`));
      });
    });
    for (const item of (res.items || [])) {
      files.push({
        key: item.key,
        url: makePublicUrl(item.key),
        size: item.fsize,
        hash: item.hash,
        lastModified: item.putTime ? new Date(Number(item.putTime) / 10000).toISOString() : null
      });
    }
    marker = res.marker || '';
  } while (marker);

  // 把 list 结果写入本地索引
  if (!prefix && files.length > 0) {
    saveLocalIndex({ keys: files.map(f => f.key) });
    console.log(`[七牛] listPrefixV2 成功，${files.length} 条已写入本地索引`);
  }

  console.log(`[七牛] listFiles("${prefix}") → ${files.length} 个 [API调用] | zone=${QINIU_ZONE}`);
  return files;
}

/**
 * 检查七牛云上是否存在某个文件
 */
async function fileExists(qiniuKey) {
  if (!isConfigured()) return false;
  try {
    await new Promise((resolve, reject) => {
      getBucketManager().stat(QINIU_BUCKET, qiniuKey, (err, respBody, respInfo) => {
        if (err) return reject(err);
        if (respInfo.statusCode === 200) resolve(respBody);
        else reject(new Error('not found'));
      });
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 把香港 VPS /uploads 目录全量推到七牛云
 */
async function migrateLocalUploads() {
  if (!isConfigured()) {
    console.warn('[七牛] 未配置，跳过迁移');
    return { total: 0, uploaded: 0, skipped: 0, errors: 0 };
  }

  const cloudFiles = await listFiles('uploads/').catch(() => []);
  const cloudKeys = new Set(cloudFiles.map(f => f.key));

  const localFiles = [];
  function walk(dir, prefix) {
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      const full = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(full); } catch (e) { continue; }
      if (stat.isDirectory()) walk(full, prefix + name + '/');
      else if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'].includes(path.extname(name).toLowerCase())) {
        localFiles.push({
          relPath: '/' + prefix + name,
          qiniuKey: prefix + name,
          localFull: full
        });
      }
    }
  }
  if (fs.existsSync(UPLOAD_DIR)) walk(UPLOAD_DIR, 'uploads/');

  let uploaded = 0, skipped = 0, errors = 0;
  console.log(`[七牛] 本地 ${localFiles.length} 张，七牛已有 ${cloudKeys.size} 张`);

  for (const f of localFiles) {
    if (cloudKeys.has(f.qiniuKey)) { skipped++; continue; }
    try {
      await uploadFile(f.localFull, f.qiniuKey);
      uploaded++;
    } catch (e) {
      console.error(`[七牛] 迁移失败 ${f.qiniuKey}:`, e.message);
      errors++;
    }
  }

  console.log(`[七牛] 迁移完成: 上传 ${uploaded}, 跳过 ${skipped}, 失败 ${errors}`);
  return { total: localFiles.length, uploaded, skipped, errors };
}

function guessMime(key) {
  const ext = path.extname(key).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.avif': 'image/avif', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.bmp': 'image/bmp'
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  isConfigured,
  uploadFile,
  uploadBuffer,
  deleteFile,
  listFiles,
  fileExists,
  migrateLocalUploads,
  guessMime,
  makePublicUrl,
  detectCorrectZone,
  getBucketManager   // 暴露给 rebuild-index 用
};
