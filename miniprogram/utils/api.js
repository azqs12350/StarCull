// utils/api.js — 简化版（七牛云 + 云函数 proxy）
//
// 图片存储：七牛云 Kodo 测试域名（HTTP）
//   server 端 serializers.absImage() → http://todngtla4.hb-bkt.clouddn.com/uploads/xxx.jpg
//   proxy 云函数自动检测七牛云 URL → 转 base64 data URL（绕开 HTTP 白名单）
//
// API 通道：云函数 proxy 优先 → 不行直连香港 VPS

const auth = require('./auth.js');

console.log('[api.js] LOADED v2026-11-13-incremental');

const BASE_URL = 'http://45.64.75.15:4173';

// 在途计数：低优先级图片预加载据此让路，避免抢占用户信息/抽奖/留言等请求
let activeRequests = 0;
let activeImageCalls = 0;

// ---------- 图片 URL 补全 ----------
function fullImgUrl(relPath) {
  if (!relPath) return '';
  if (/^https?:\/\//i.test(relPath) || relPath.startsWith('data:') || relPath.startsWith('cloud://')) {
    return relPath;
  }
  if (relPath.startsWith('/')) return BASE_URL + relPath;
  return relPath;
}

// 本地相对路径（非 http/data/cloud）→ 补全为服务器完整 URL
function isLocalImage(img) {
  return !!img && typeof img === 'string'
    && !/^https?:\/\//i.test(img) && !img.startsWith('data:') && !img.startsWith('cloud://');
}

function patchProductImage(product) {
  if (product && isLocalImage(product.image)) product.image = fullImgUrl(product.image);
  return product;
}

function patchProducts(products) {
  if (!products) return products;
  return products.map(patchProductImage);
}

function patchDraw(draw) {
  if (draw && draw.product) patchProductImage(draw.product);
  return draw;
}

// ---------- 检测云函数是否可用 ----------
function checkCloud() {
  return !!(wx.cloud && typeof wx.cloud.callFunction === 'function');
}

// ---------- 底层请求 ----------
// 走云函数 proxy 转发；仅当 wx.cloud 不可用时才直连
function request(method, path, data, retries) {
  if (retries === undefined) retries = 2;
  const useCloud = checkCloud();
  const transport = useCloud ? 'CLOUD' : 'DIRECT';
  console.log('[api] → ' + transport + ' ' + method + ' ' + path);
  const fn = useCloud ? callViaCloud : callDirect;
  activeRequests++;
  let released = false;
  const release = () => { if (!released) { released = true; activeRequests--; } };
  return fn(method, path, data).catch((err) => {
    console.warn('[api] ' + transport + ' FAILED:', err.message);
    if (retries > 1) {
      return new Promise(r => setTimeout(r, 500)).then(() => request(method, path, data, retries - 1));
    }
    throw err;
  }).then((v) => { release(); return v; }, (e) => { release(); throw e; });
}

function callViaCloud(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = {};
    const token = auth.getToken();
    if (token) header['Authorization'] = 'Bearer ' + token;

    const timer = setTimeout(() => reject(new Error('Cloud proxy timeout after 15s')), 15000);

    let cleanPath = path;
    let queryObj = {};
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) {
      cleanPath = path.substring(0, qIdx);
      const qs = path.substring(qIdx + 1);
      qs.split('&').forEach((p) => {
        if (!p) return;
        const eq = p.indexOf('=');
        if (eq >= 0) queryObj[decodeURIComponent(p.substring(0, eq))] = decodeURIComponent(p.substring(eq + 1));
      });
    }

    wx.cloud.callFunction({
      name: 'proxy',
      data: { method, path: cleanPath, query: queryObj, body: data || undefined, headers: header },
      success(res) {
        clearTimeout(timer);
        const result = res.result || {};
        console.log('[api] CLOUD ← ok=' + result.ok + ' status=' + (result.statusCode || '?') + ' error=' + (result.error || '(none)'));
        if (!result.ok) return reject(new Error(result.error || 'Proxy error'));
        const { statusCode, body } = result;
        if (statusCode === 401) {
          auth.clearToken();
          const pages = getCurrentPages();
          const curPage = pages[pages.length - 1];
          if (curPage && curPage.route !== 'pages/login/login') {
            wx.navigateTo({ url: '/pages/login/login' });
          }
          return reject(new Error((body && body.error) || 'Unauthorized'));
        }
        if (statusCode >= 200 && statusCode < 300) resolve(body);
        else reject(new Error((body && body.error) || ('Request failed (' + statusCode + ')')));
      },
      fail(err) {
        clearTimeout(timer);
        console.warn('[api] CLOUD fail:', err.errMsg);
        reject(new Error(err.errMsg || 'Cloud call failed'));
      }
    });
  });
}

function callDirect(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    const token = auth.getToken();
    if (token) header['Authorization'] = 'Bearer ' + token;

    const timer = setTimeout(() => reject(new Error('DIRECT timeout after 15s')), 15000);
    const fullUrl = BASE_URL + path;
    console.log('[api] DIRECT → ' + method + ' ' + fullUrl);

    wx.request({
      method, url: fullUrl, data, header, timeout: 15000,
      success(res) {
        clearTimeout(timer);
        console.log('[api] DIRECT ← status=' + res.statusCode);
        if (res.statusCode === 401) {
          auth.clearToken();
          const pages = getCurrentPages();
          const curPage = pages[pages.length - 1];
          if (curPage && curPage.route !== 'pages/login/login') {
            wx.navigateTo({ url: '/pages/login/login' });
          }
          return reject(new Error((res.data && res.data.error) || 'Unauthorized'));
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.error) || ('Request failed (' + res.statusCode + ')')));
      },
      fail(err) {
        clearTimeout(timer);
        console.warn('[api] DIRECT fail:', err.errMsg);
        reject(new Error(err.errMsg || 'Network error'));
      }
    });
  });
}

// ---------- HTTP method shortcuts ----------
function get(p, q) {
  let url = p;
  if (q && typeof q === 'object') {
    const qs = Object.keys(q).filter(k => q[k] !== undefined && q[k] !== null && q[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
    if (qs) url += (p.includes('?') ? '&' : '?') + qs;
  }
  return request('GET', url);
}
const post = (p, d) => request('POST',   p, d);
const put  = (p, d) => request('PUT',    p, d);

// ========== Auth ==========
function login(username, password) { return post('/api/login', { username, password }); }
function register(username, password, securityQuestion, securityAnswer) {
  return post('/api/register', { username, password, securityQuestion, securityAnswer });
}
function logout() { return post('/api/logout', {}); }
function tokenSession(opts) {
  opts = opts || {};
  const skipPatchImg = !!opts.skipPatchImg;
  return get('/api/token-session').then((data) => {
    if (!skipPatchImg) {
      if (data.products) data.products = patchProducts(data.products);
      if (data.draw) data.draw = patchDraw(data.draw);
    }
    return data;
  });
}
function securityQuestions() { return get('/api/security-questions'); }
function setSecurityQuestion(q, a) { return put('/api/user/security-question', { securityQuestion: q, securityAnswer: a }); }
function recoverQuestion(username) { return get('/api/recover/question', { username }); }
function recoverPassword(username, answer, newPassword) { return post('/api/recover/password', { username, answer, newPassword }); }

// ========== WeChat login ==========
function wechatLogin(code) { return post('/api/wechat-login', code ? { code } : {}); }
function bindWechat(code) { return post('/api/wechat-bind', code ? { code } : {}); }
function unbindWechat() { return post('/api/wechat-unbind', {}); }

// ========== Collection ==========
function starProduct(id) { return post('/api/products/' + id + '/star'); }
function likeProduct(id) { return post('/api/products/' + id + '/like'); }
function dislikeProduct(id) { return post('/api/products/' + id + '/dislike'); }

// ========== Draws ==========
function draw() {
  return post('/api/draw', {}).then((data) => { if (data.draw) data.draw = patchDraw(data.draw); return data; });
}
function upgradeDraw(id) { return post('/api/draw/' + id + '/upgrade', {}); }
function cancelUpgrade(id) { return post('/api/draw/' + id + '/cancel-upgrade', {}); }
function getDraws() {
  return get('/api/draws').then((data) => {
    if (data.draws) data.draws = data.draws.map(d => patchDraw(d));
    return data;
  });
}
function submitShipping(id, shipping) { return post('/api/draw/' + id + '/shipping', shipping); }
function updateShipping(id, shipping) { return put('/api/draw/' + id + '/shipping', shipping); }

// ========== Messages ==========
function getMessages() { return get('/api/messages'); }
function sendMessage(content) { return post('/api/messages', { content }); }
function markMessagesRead() { return put('/api/messages/read', {}); }

// ========== Debug ==========
function getTransport() { return checkCloud() ? 'cloud' : 'direct'; }

// ====================================================================
// 图片 → 后台异步调 proxy batchImages 批量转 base64
// token-session 时 proxy 云函数只转前 2 张（防云函数返回体积超限）
// 剩下的图片由页面按需调用 patchImageUrls，每批 2 张、最多 3 批并发
// 每批返回后立即回调页面，页面按 index 逐张 setData
// ====================================================================

// 需要 patch 的：不是 data:/cloud://，且是 http(s) URL 或 /uploads/ 相对路径
function needsPatch(img) {
  if (!img || typeof img !== 'string') return false;
  if (img.startsWith('data:') || img.startsWith('cloud://')) return false;
  if (img.startsWith('/uploads/')) return true;
  return /^https?:\/\//i.test(img);
}

// 单批 2 张：单张 base64 最大约 470KB，2 张仍在云函数 1MB 返回上限内
// 3 个 worker 并发 → 最多约 6 张同时在途，比逐张串行快数倍
const PATCH_BATCH_SIZE = 2;
const PATCH_CONCURRENCY = 3;

// 批量转换图片 URL。每批成功就回调 onBatch({ 原URL: dataURL })，
// 页面可据此只更新对应下标的图片。失败批次会逐张重试一次，仍失败则跳过，
// 不影响其余图片和页面渲染。shouldStop 用于页面刷新后中止旧任务。
function patchImageUrls(urls, onBatch, shouldStop) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return Promise.resolve({ total: 0, ok: 0 });
  if (!checkCloud()) {
    console.warn('[api] patchImageUrls: cloud unavailable, keep original images');
    return Promise.resolve({ total: list.length, ok: 0, skipped: true });
  }

  let next = 0;
  let okCount = 0;

  async function convertBatch(batch) {
    activeImageCalls++;
    try {
      const res = await callCloudBatchImages(batch);
      const images = (res && res.images) || {};
      const keys = Object.keys(images);
      if (keys.length) {
        okCount += keys.length;
        if (onBatch) onBatch(images, batch);
      }
    } catch (e) {
      console.warn('[api] batchImages failed (' + batch.length + '): ' + e.message + ' -> retry one by one');
      for (const url of batch) {
        try {
          const res = await callCloudBatchImages([url]);
          if (res && res.images && res.images[url]) {
            okCount += 1;
            if (onBatch) onBatch({ [url]: res.images[url] }, [url]);
          }
        } catch (e2) {
          console.warn('[api] image failed, keep placeholder: ' + url + ' (' + e2.message + ')');
        }
      }
    } finally {
      activeImageCalls--;
    }
  }

  async function worker() {
    while (true) {
      if (shouldStop && shouldStop()) return;
      const start = next;
      next += PATCH_BATCH_SIZE;
      if (start >= list.length) return;
      await convertBatch(list.slice(start, start + PATCH_BATCH_SIZE));
    }
  }

  const workers = [];
  for (let i = 0; i < PATCH_CONCURRENCY; i++) workers.push(worker());
  return Promise.all(workers).then(() => {
    console.log('[api] patchImageUrls done: ' + okCount + '/' + list.length);
    return { total: list.length, ok: okCount };
  });
}

// 低优先级图片预加载：单并发、每批之间留间隔，有普通请求在途时先让路。
// 只用于首页后台暖缓存，不参与首屏渲染；shouldStop 可随时中止。
const PREFETCH_GAP_MS = 250;

function prefetchImageUrls(urls, onBatch, shouldStop) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return Promise.resolve({ total: 0, ok: 0 });
  if (!checkCloud()) return Promise.resolve({ total: list.length, ok: 0, skipped: true });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let next = 0;
  let okCount = 0;

  async function waitIdle() {
    while (activeRequests > 0 || activeImageCalls > 0) {
      if (shouldStop && shouldStop()) return false;
      await sleep(200);
    }
    return true;
  }

  async function worker() {
    while (true) {
      if (shouldStop && shouldStop()) return;
      if (!(await waitIdle())) return;
      if (shouldStop && shouldStop()) return;

      const start = next;
      next += PATCH_BATCH_SIZE;
      if (start >= list.length) return;
      const batch = list.slice(start, start + PATCH_BATCH_SIZE);

      try {
        activeImageCalls++;
        const res = await callCloudBatchImages(batch);
        const images = (res && res.images) || {};
        const keys = Object.keys(images);
        if (keys.length) {
          okCount += keys.length;
          if (onBatch) onBatch(images, batch);
        }
      } catch (e) {
        console.warn('[api] prefetch batch failed (' + batch.length + '): ' + e.message);
      } finally {
        activeImageCalls--;
      }
      await sleep(PREFETCH_GAP_MS);
    }
  }

  return worker().then(() => {
    console.log('[api] prefetchImageUrls done: ' + okCount + '/' + list.length);
    return { total: list.length, ok: okCount };
  });
}

// 兼容旧调用：原地替换 products[].image，全部完成后 resolve
function patchProductsImgInPlace(products) {
  if (!products || !products.length) return Promise.resolve(products);
  const urls = new Set();
  for (const p of products) {
    if (needsPatch(p.image)) urls.add(p.image);
  }
  if (!urls.size) return Promise.resolve(products);

  return patchImageUrls(Array.from(urls), (map) => {
    for (const p of products) {
      if (map[p.image]) p.image = map[p.image];
    }
  }).then(() => products);
}

function patchDrawImgInPlace(draw) {
  if (!draw) return Promise.resolve(draw);
  const list = draw.product ? [draw.product] : [];
  return patchProductsImgInPlace(list).then(() => draw);
}

function callCloudBatchImages(urls) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('batchImages timeout')), 20000);
    wx.cloud.callFunction({
      name: 'proxy',
      data: { paths: urls },
      success(res) {
        clearTimeout(timer);
        const result = res.result || {};
        if (result.ok) resolve(result);
        else reject(new Error(result.error || 'batchImages failed'));
      },
      fail(err) { clearTimeout(timer); reject(new Error(err.errMsg || 'cloud call failed')); }
    });
  });
}

// ====================================================================
module.exports = {
  BASE_URL,
  needsPatch,
  fullImgUrl,
  patchProducts,
  patchDraw,
  patchImageUrls,
  prefetchImageUrls,
  patchProductsImgInPlace,
  patchDrawImgInPlace,
  login, register, logout,
  tokenSession,
  securityQuestions, setSecurityQuestion,
  recoverQuestion, recoverPassword,
  wechatLogin, bindWechat, unbindWechat,
  starProduct, likeProduct, dislikeProduct,
  draw, upgradeDraw, cancelUpgrade, getDraws,
  submitShipping, updateShipping,
  getMessages, sendMessage, markMessagesRead,
  getTransport
};
