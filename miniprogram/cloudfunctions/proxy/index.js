// cloudfunctions/proxy/index.js — 接口转发 + 七牛云图片自动转 base64
//
// 核心思路：
//   1. API 请求 → 云函数 → 转发到香港 VPS（不走白名单）
//   2. 图片 URL 如果是七牛云测试域名（HTTP）→ 云函数内部 fetch 七牛云 HTTP 图 → 转 base64 → 返回小程序
//   3. 小程序 <image src="data:image/jpeg;base64,..."> 直接渲染
//
// 为什么这样做？
//   七牛云测试域名只有 HTTP，小程序真机不允许 HTTP 图片。
//   但云函数的内部 HTTP 请求不走微信 download 域名白名单！
//   所以云函数可以随便请求 HTTP 图，转成 base64 后小程序就能显示。

const http = require('http');
const https = require('https');

const TARGET_BASE = 'http://45.64.75.15:4173';
const TIMEOUT_MS = 30000;
const QINIU_BASE = 'http://todngtla4.hb-bkt.clouddn.com';  // 七牛云测试域名

// 七牛云域名（服务器端 serializers 可能拼成这些）
const QINIU_HOSTS = [
  'qiniudn.com',
  'clouddn.com',
  'qbox.me',
  'qiniu.com'
];

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'];
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml'
};

// 判断是不是图片 URL 或相对路径
function isImageRef(val) {
  if (!val || typeof val !== 'string') return false;
  if (val.startsWith('data:') || val.startsWith('cloud://')) return false;
  // 相对路径：/uploads/xxx.jpg 或 uploads/xxx.jpg
  if (val.includes('/uploads/') && /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)$/i.test(val.trim())) return true;
  // 完整 URL（七牛云或其他）
  if (/^https?:\/\//i.test(val)) {
    for (const host of QINIU_HOSTS) if (val.includes(host)) return true;
    // 其他 http/https 图片也处理
    return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(val.split('?')[0]);
  }
  return false;
}

// 把任意图片引用 → 完整可拉取 URL
// - 相对路径 /uploads/xxx.jpg → 拼七牛云
// - 香港 VPS URL http://45.64.75.15:4173/uploads/xxx.jpg → 自动改七牛云
// - 其他 http(s) URL → 原样返回
function resolveImageUrl(ref) {
  if (ref.startsWith('/')) return QINIU_BASE + ref;
  if (/^https?:\/\//i.test(ref)) {
    // 香港 VPS 的 uploads → 改七牛云 CDN（更快）
    if (ref.includes('/uploads/')) {
      const m = ref.match(/\/uploads\/.*/);
      if (m) return QINIU_BASE + m[0];
    }
    return ref;
  }
  return QINIU_BASE + '/' + ref;
}

function buildUrl(path, query) {
  let url = TARGET_BASE + path;
  if (query && typeof query === 'object' && Object.keys(query).length > 0) {
    const qs = Object.keys(query)
      .filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '')
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
      .join('&');
    if (qs) url += (path.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

function doRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const isHttps = /^https:\/\//i.test(url);
    const lib = isHttps ? https : http;
    const u = new URL(url);
    const req = lib.request({
      method,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      timeout: TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        if (/^image\//i.test(contentType) || /^application\/octet/i.test(contentType)) {
          resolve({ statusCode: res.statusCode || 0, isImage: true, buffer: buf, contentType });
        } else {
          let parsed;
          try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) { parsed = buf.toString('utf8'); }
          resolve({ statusCode: res.statusCode || 0, isImage: false, body: parsed });
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Upstream timeout')); });
    req.on('error', (e) => { req.destroy(); reject(e); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function extractOpenid(event) {
  if (!event) return '';
  if (event.userInfo && event.userInfo.openId) return event.userInfo.openId;
  if (event.openid) return event.openid;
  if (event.OPENID) return event.OPENID;
  if (event.scfContext && event.scfContext.openid) return event.scfContext.openid;
  return '';
}

// ---------- 七牛云图片识别 + 转 base64 ----------

function isQiniuUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  const lower = url.toLowerCase();
  for (const host of QINIU_HOSTS) {
    if (lower.includes(host)) return true;
  }
  return false;
}

function imageExtFromUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  for (const ext of IMAGE_EXT) {
    if (pathname.endsWith(ext)) return ext;
  }
  return '.jpg';
}

// 单张原图超过这个体积就尝试压缩
const MAX_IMAGE_BYTES = 450 * 1024;
// 压缩后 base64 仍超过这个体积就跳过（云函数返回上限 1MB，给 JSON 留余量）
const MAX_DATA_URL_BYTES = 800 * 1024;

// sharp 为可选依赖：装了才能压缩超大图，没装则跳过（不影响其他图片）
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[proxy] sharp 未安装，超大图将被跳过');
}

// 七牛图片处理参数（测试域名通常不生效，仅作兜底尝试）
function compressQiniuUrl(url) {
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'imageView2/2/w/1200/format/jpg/q/80';
}

// 用 sharp 把图片压成宽 1000 的 jpg
async function compressWithSharp(buffer) {
  if (!sharp) return null;
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 78 })
      .toBuffer();
  } catch (e) {
    console.warn('[proxy] sharp 压缩失败:', e.message);
    return null;
  }
}

async function fetchAsDataUrl(url) {
  try {
    const result = await doRequest('GET', url, { 'User-Agent': 'StarCull-Proxy' });
    if (!result.isImage) return null;

    let buffer = result.buffer;
    let contentType = result.contentType;
    const ext = imageExtFromUrl(url);

    // 超过阈值才压缩
    if (buffer.length > MAX_IMAGE_BYTES) {
      console.log('[proxy] 图片过大 ' + (buffer.length / 1024).toFixed(0) + 'KB → 尝试压缩');

      // 1) 七牛处理参数（支持的话最省事）
      if (isQiniuUrl(url)) {
        try {
          const retry = await doRequest('GET', compressQiniuUrl(url), { 'User-Agent': 'StarCull-Proxy' });
          if (retry.isImage && retry.buffer.length < buffer.length) {
            buffer = retry.buffer;
            contentType = retry.contentType;
          }
        } catch (e) {
          console.warn('[proxy] 七牛压缩失败:', e.message);
        }
      }

      // 2) 七牛不生效时用 sharp 本地压
      if (buffer.length > MAX_IMAGE_BYTES) {
        const out = await compressWithSharp(buffer);
        if (out && out.length < buffer.length) {
          buffer = out;
          contentType = 'image/jpeg';
        }
      }

      console.log('[proxy] 压缩后 ' + (buffer.length / 1024).toFixed(0) + 'KB');
    }

    const base64 = buffer.toString('base64');
    if (base64.length > MAX_DATA_URL_BYTES) {
      console.warn('[proxy] 压缩后仍超限，跳过:', url);
      return null;
    }

    const mime = contentType || MIME[ext] || 'image/jpeg';
    return 'data:' + mime + ';base64,' + base64;
  } catch (e) {
    console.error('[proxy] 图片拉取失败:', url, e.message);
    return null;
  }
}

// 第一遍：扫描出所有图片引用（相对路径 /uploads/xxx.jpg 或完整 URL）
function collectImageRefs(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectImageRefs(item, out);
  } else if (typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      if (isImageRef(val)) out.add(val);
      else collectImageRefs(val, out);
    }
  }
}

// 第二遍：并行拉图 → 替换
// limit: 最多转几张（防云函数 6MB 响应上限），null = 不限制
async function rewriteImages(obj, limit) {
  const refs = new Set();
  collectImageRefs(obj, refs);
  if (refs.size === 0) return obj;

  let refArray = Array.from(refs);
  if (limit && limit > 0 && refArray.length > limit) {
    console.log('[proxy] 发现 ' + refArray.length + ' 张 → 只转前 ' + limit + ' 张（防超限）');
    refArray = refArray.slice(0, limit);
  } else {
    console.log('[proxy] 发现 ' + refArray.length + ' 张图片 → 并行拉取');
  }

  const BATCH = 20;
  const map = {};
  for (let i = 0; i < refArray.length; i += BATCH) {
    const batch = refArray.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(ref => {
      const url = resolveImageUrl(ref);
      return fetchAsDataUrl(url);
    }));
    results.forEach((r, j) => {
      const origRef = batch[j];
      if (r.status === 'fulfilled' && r.value) {
        map[origRef] = r.value;
      } else {
        // 失败也保留原值（小程序 api.js 后台会补转）
        map[origRef] = origRef.startsWith('http') ? origRef : origRef;
      }
    });
  }

  function doReplace(o) {
    if (!o) return o;
    if (typeof o === 'string') return map[o] || o;
    if (Array.isArray(o)) return o.map(doReplace);
    if (typeof o === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k] = doReplace(v);
      return r;
    }
    return o;
  }
  return doReplace(obj);
}

// ---------- 主入口 ----------

exports.main = async (event) => {
  event = event || {};
  const openid = extractOpenid(event);

  // 批量图片模式：paths 是数组（相对路径或完整 URL，直接从七牛云拉）
  if (Array.isArray(event.paths)) {
    console.log('[proxy] BATCH IMAGES count=' + event.paths.length);
    const resolved = event.paths.map(p => resolveImageUrl(p));
    const results = {};
    const settled = await Promise.allSettled(resolved.map(url => fetchAsDataUrl(url)));
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) results[event.paths[i]] = r.value;
      else console.warn('[proxy] batchImages fail:', resolved[i]);
    });
    console.log('[proxy] BATCH done, success=' + Object.keys(results).length);
    return { ok: true, images: results };
  }

  const { method = 'GET', path = '/api/session', query, body, headers = {}, skipInjectOpenid = false, imageLimit } = event;

  // 主请求默认只带 2 张图（约 300KB，远低于云函数 1MB 返回上限）
  // 其余图片由小程序逐张调批量接口补全（一次一张，单张超限自动压缩）
  const limit = (typeof imageLimit === 'number') ? imageLimit : 2;

  const url = buildUrl(path, query);
  console.log('[proxy] ' + method + ' → ' + url + ' | openid=' + (openid || '(none)') + ' | imageLimit=' + limit);

  const reqHeaders = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'User-Agent': 'StarCull-CloudProxy/3.0',
    ...headers
  };
  if (openid && !skipInjectOpenid) reqHeaders['X-WX-OpenID'] = openid;

  try {
    const result = await doRequest(method, url, reqHeaders, body);

    // 图片请求：直接从香港 VPS 拉的 → 转 base64
    if (result.isImage) {
      const ext = imageExtFromUrl(path);
      const mime = MIME[ext] || 'image/jpeg';
      const base64 = result.buffer.toString('base64');
      return { ok: true, statusCode: result.statusCode, dataUrl: 'data:' + mime + ';base64,' + base64, openid };
    }

    // JSON 请求：只转前 limit 张图片，剩下的让小程序后台批量拉
    const rewrittenBody = await rewriteImages(result.body, limit);
    return { ok: true, statusCode: result.statusCode, body: rewrittenBody, openid };
  } catch (err) {
    console.error('[proxy] ERROR:', err && err.message);
    return { ok: false, statusCode: 0, error: err && err.message ? err.message : String(err), url };
  }
};
