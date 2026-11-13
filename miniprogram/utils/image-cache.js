// utils/image-cache.js — 全 App 共享的图片 base64 缓存
//
// 首页把作品图转换好后写入这里，抽奖页滚动时直接复用同一份缓存，
// 不再单独发起转换请求。按作品 id 索引，LRU 上限 60 张、30 分钟过期。

const IMG_CACHE_MAX = 60;
const IMG_CACHE_TTL = 30 * 60 * 1000;

const store = new Map(); // id -> { url, ts }

function prune() {
  const now = Date.now();
  const expired = [];
  store.forEach((entry, id) => {
    if (now - entry.ts > IMG_CACHE_TTL) expired.push(id);
  });
  for (let i = 0; i < expired.length; i++) store.delete(expired[i]);
}

function get(id) {
  if (!id) return '';
  const entry = store.get(id);
  if (!entry) return '';
  if (Date.now() - entry.ts > IMG_CACHE_TTL) {
    store.delete(id);
    return '';
  }
  // LRU：命中后移到队尾
  store.delete(id);
  store.set(id, entry);
  return entry.url;
}

function set(id, url) {
  if (!id || !url) return;
  if (store.has(id)) store.delete(id);
  store.set(id, { url: url, ts: Date.now() });
  while (store.size > IMG_CACHE_MAX) {
    store.delete(store.keys().next().value);
  }
}

// 返回当前全部可用的图片（已过期的不返回）
function values() {
  prune();
  const list = [];
  store.forEach((entry) => list.push(entry.url));
  return list;
}

function size() {
  prune();
  return store.size;
}

module.exports = {
  get: get,
  set: set,
  values: values,
  size: size
};
