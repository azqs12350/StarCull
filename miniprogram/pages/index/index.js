const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');
const auth = require('../../utils/auth.js');

// 首屏占位图：2x2 浅灰 PNG（页面 .grid-img 本身也有同色背景）
// 待转换的图先用它铺位，转换成功后按 index 替换，避免空屏或裂图
const PLACEHOLDER_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR42mP48OHNfxBmgDEAiEwPLVCOe4IAAAAASUVORK5CYII=';

const PAGE_SIZE = 10;              // 首屏 / 每次触底加载 10 条
const IMG_CACHE_MAX = 60;          // 图片缓存最多 60 张，防止无限膨胀
const IMG_CACHE_TTL = 30 * 60 * 1000; // 30 分钟过期
const CACHE_APPLY_CHUNK = 3;       // 缓存图分 3 张一组 setData，避免单次超过 1MB

Page({
  data: {
    products: [],
    categories: [],
    activeCategory: 'all',
    lang: 'zh',
    loading: true,
    loadingMore: false,
    noMore: false
  },

  onShow() {
    const app = getApp();
    var lang = app.globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: 'StarCull' });

    if (!this._imgCache) this._imgCache = new Map();
    if (!this._patchChain) this._patchChain = Promise.resolve();

    // 数据引用没变化就保留当前分页、滚动位置和已加载图片，不重复请求
    if (this._rawRef && app.globalData.products === this._rawRef && this.data.products.length) {
      return;
    }
    this.loadProducts();
  },

  onPullDownRefresh() {
    this.loadProducts({ force: true }).then(() => wx.stopPullDownRefresh());
  },

  // 触底加载下一批
  onReachBottom() {
    this.loadMore();
  },

  noop() {},

  async loadProducts(opts) {
    const force = !!(opts && opts.force);
    const token = this._nextViewToken();
    this._patchChain = Promise.resolve();

    try {
      if (!this.data.products.length) this.setData({ loading: true });
      const app = getApp();
      let rawProducts = null;

      console.log('[Gallery] loadProducts START globalData.products=', app.globalData.products?.length);

      // 优先用全局缓存的数据（不转图片，是 app.js bootstrapFromToken 存的原始数据）
      if (!force && app.globalData.products && app.globalData.products.length) {
        rawProducts = app.globalData.products;
        console.log('[Gallery] USING CACHE products.length=', rawProducts.length);
      } else {
        console.log('[Gallery] FETCH tokenSession({ skipPatchImg: true })');
        const data = await api.tokenSession({ skipPatchImg: true });
        if (token !== this._viewToken) return;
        console.log('[Gallery] tokenSession returned products=', data.products?.length, 'user=', !!data.user);
        if (data.user) app.globalData.user = data.user;
        if (data.products) app.globalData.products = data.products;
        if (data.draw !== undefined) app.globalData.latestDraw = data.draw;
        rawProducts = data.products;
      }

      if (!rawProducts) rawProducts = [];
      this._rawRef = rawProducts;
      this._allProducts = rawProducts;
      this._canProxyImages = api.getTransport() === 'cloud';

      const cats = this.buildCategories(rawProducts);
      let active = this.data.activeCategory;
      if (active !== 'all' && !cats.some((c) => c.id === active)) active = 'all';

      const categoryList = active === 'all'
        ? rawProducts
        : rawProducts.filter((p) => (p.seriesZh || p.seriesEn) === active);
      this._categoryProducts = categoryList;

      const nextKey = active + '|' + categoryList.map((p) => p.id).join(',');
      const sameList = nextKey === this._categoryKey;
      this._categoryKey = nextKey;

      // 列表没变就保留已加载条数；变了或首次加载则回到前 10 条
      let count = sameList ? Math.max(this._loadedCount || PAGE_SIZE, PAGE_SIZE) : PAGE_SIZE;
      count = Math.min(count, categoryList.length);
      this._loadedCount = count;

      const items = categoryList.slice(0, count).map((p) => this._displayItem(p));

      this.setData({
        activeCategory: active,
        categories: cats,
        products: items,
        loading: false,
        loadingMore: false,
        noMore: count >= categoryList.length
      });
      console.log('[Gallery] FIRST FRAME category=' + active + ' products=' + items.length + '/' + categoryList.length);

      this._startImages(items, 0, token);
    } catch (e) {
      console.warn('[Gallery] loadProducts failed:', e.message);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (token === this._viewToken) this.setData({ loading: false });
    }
  },

  _nextViewToken() {
    this._viewToken = (this._viewToken || 0) + 1;
    return this._viewToken;
  },

  // 触底再取 10 条，按 index 追加，不整表重发
  loadMore() {
    if (this.data.loading || this._loadMoreLock) return;

    const list = this._categoryProducts || [];
    if (this._loadedCount >= list.length) {
      if (!this.data.noMore) this.setData({ noMore: true });
      return;
    }

    this._loadMoreLock = true;
    const token = this._viewToken;
    const start = this._loadedCount;
    const nextRaw = list.slice(start, start + PAGE_SIZE);
    if (!nextRaw.length) {
      this._loadMoreLock = false;
      this.setData({ noMore: true });
      return;
    }

    const items = nextRaw.map((p) => this._displayItem(p));
    const patch = { loadingMore: true };
    items.forEach((item, i) => {
      patch['products[' + (start + i) + ']'] = item;
    });

    this._loadedCount = start + items.length;
    const noMore = this._loadedCount >= list.length;
    patch.noMore = noMore;
    this.setData(patch);

    this._startImages(items, start, token);
    this._loadMoreLock = false;

    // 给“加载中”一个可见窗口，同时避免连续触底时状态来回跳
    setTimeout(() => {
      if (token !== this._viewToken) return;
      this.setData({ loadingMore: false, noMore: noMore });
    }, 300);

    console.log('[Gallery] loadMore +' + items.length + ' → ' + this._loadedCount + '/' + list.length);
  },

  // 生成展示项：待转换的图先用占位图，避免</image>加载裂图
  _displayItem(p) {
    const item = Object.assign({}, p);
    if (this._canProxyImages && api.needsPatch(item.image)) {
      item._src = item.image;
      item.image = PLACEHOLDER_IMG;
    }
    return item;
  },

  // 对一组展示项：先套缓存，再排队转换缺失的图
  _startImages(items, startIndex, token) {
    if (!this._canProxyImages) return;

    const cached = [];
    const pending = new Set();
    const srcMap = {};

    items.forEach((item, i) => {
      if (!item._src) return;
      const cachedUrl = this._cacheGet(item.id);
      if (cachedUrl) {
        cached.push({ index: startIndex + i, url: cachedUrl });
        return;
      }
      pending.add(item._src);
      if (!srcMap[item._src]) srcMap[item._src] = [];
      srcMap[item._src].push({ index: startIndex + i, id: item.id });
    });

    this._applyCached(cached, token);

    if (pending.size) {
      this._queuePatch(Array.from(pending), srcMap, token);
    }
  },

  // 缓存命中：分小组按 index 更新，避免一次性塞入大量 base64
  _applyCached(cached, token) {
    for (let i = 0; i < cached.length; i += CACHE_APPLY_CHUNK) {
      if (token !== this._viewToken) return;
      const patch = {};
      const end = Math.min(i + CACHE_APPLY_CHUNK, cached.length);
      for (let j = i; j < end; j++) {
        patch['products[' + cached[j].index + '].image'] = cached[j].url;
      }
      this.setData(patch);
    }
  },

  // 串行排队调用云函数转换，避免快速触底时并发暴涨
  _queuePatch(urls, srcMap, token) {
    this._patchChain = this._patchChain.then(() => {
      if (token !== this._viewToken) return null;
      return api.patchImageUrls(urls, (map) => {
        if (token !== this._viewToken) return;
        const patch = {};
        let changed = false;
        Object.keys(map).forEach((src) => {
          const dataUrl = map[src];
          const entries = srcMap[src] || [];
          for (let i = 0; i < entries.length; i++) {
            patch['products[' + entries[i].index + '].image'] = dataUrl;
            this._cacheSet(entries[i].id, dataUrl);
            changed = true;
          }
          console.log('[Gallery] image ready: index=' + entries.map((e) => e.index).join(',') + ' src=' + src.substring(0, 50));
        });
        if (changed) this.setData(patch);
      }, () => token !== this._viewToken);
    }).catch((e) => {
      console.warn('[Gallery] image patch error:', e.message);
    });
  },

  _cacheGet(id) {
    if (!id || !this._imgCache) return null;
    const entry = this._imgCache.get(id);
    if (!entry) return null;
    if (Date.now() - entry.ts > IMG_CACHE_TTL) {
      this._imgCache.delete(id);
      return null;
    }
    // LRU：命中后移到队尾
    this._imgCache.delete(id);
    this._imgCache.set(id, entry);
    return entry.url;
  },

  _cacheSet(id, url) {
    if (!id || !url) return;
    if (!this._imgCache) this._imgCache = new Map();
    if (this._imgCache.has(id)) this._imgCache.delete(id);
    this._imgCache.set(id, { url: url, ts: Date.now() });
    while (this._imgCache.size > IMG_CACHE_MAX) {
      const oldest = this._imgCache.keys().next().value;
      this._imgCache.delete(oldest);
    }
  },

  buildCategories(products) {
    var names = [];
    var seen = {};
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var zh = p.seriesZh || '';
      var en = p.seriesEn || '';
      var key = zh || en;
      if (key && !seen[key]) {
        seen[key] = true;
        names.push({ id: key, zh: zh || en, en: en || zh });
      }
    }
    var list = [{ id: 'all', zh: '全部', en: 'All' }];
    for (var j = 0; j < names.length; j++) {
      list.push(names[j]);
    }
    return list;
  },

  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCategory) return;

    // 切换分类：终止上一轮的图片任务，重置为该分类的前 10 条
    const token = this._nextViewToken();
    this._patchChain = Promise.resolve();

    const all = this._allProducts || [];
    const list = id === 'all'
      ? all
      : all.filter((p) => (p.seriesZh || p.seriesEn) === id);

    this._categoryProducts = list;
    this._categoryKey = id + '|' + list.map((p) => p.id).join(',');
    this._loadedCount = Math.min(PAGE_SIZE, list.length);

    const items = list.slice(0, this._loadedCount).map((p) => this._displayItem(p));

    this.setData({
      activeCategory: id,
      products: items,
      loadingMore: false,
      noMore: this._loadedCount >= list.length
    });

    this._startImages(items, 0, token);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    console.log('[Gallery] category=' + id + ' reset to ' + items.length + '/' + list.length);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/product/product?id=' + id });
  },

  switchLang() {
    const app = getApp();
    const next = app.globalData.language === 'zh' ? 'en' : 'zh';
    app.setLang(next);
    this.setData({ lang: next });
  },

  filterProducts() {
    var products = this.data.products;
    var activeCategory = this.data.activeCategory;
    if (activeCategory === 'all') return products;
    return products.filter(function (p) {
      return (p.seriesZh || p.seriesEn) === activeCategory;
    });
  },

  findProductIndex(id) {
    var list = this.data.products;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return i;
    }
    return -1;
  },

  needLogin() {
    wx.showModal({
      title: '需要登录',
      content: '登录后才能收藏和点赞，现在去登录？',
      confirmText: '去登录',
      success: (r) => {
        if (r.confirm) wx.navigateTo({ url: '/pages/login/login' });
      }
    });
  },

  async onStar(e) {
    if (!auth.isLoggedIn()) return this.needLogin();
    var id = e.currentTarget.dataset.id;
    var idx = this.findProductIndex(id);
    if (idx < 0) return;
    try {
      var res = await api.starProduct(id);
      this.setData({
        ['products[' + idx + '].starred']: res.starred,
        ['products[' + idx + '].count']: res.count
      });
    } catch (err) {}
  },

  async onLike(e) {
    if (!auth.isLoggedIn()) return this.needLogin();
    var id = e.currentTarget.dataset.id;
    var idx = this.findProductIndex(id);
    if (idx < 0) return;
    try {
      var res = await api.likeProduct(id);
      this.setData({
        ['products[' + idx + '].liked']: res.liked,
        ['products[' + idx + '].disliked']: res.disliked,
        ['products[' + idx + '].likeCount']: res.likeCount,
        ['products[' + idx + '].dislikeCount']: res.dislikeCount
      });
    } catch (err) {}
  },

  async onDislike(e) {
    if (!auth.isLoggedIn()) return this.needLogin();
    var id = e.currentTarget.dataset.id;
    var idx = this.findProductIndex(id);
    if (idx < 0) return;
    try {
      var res = await api.dislikeProduct(id);
      this.setData({
        ['products[' + idx + '].liked']: res.liked,
        ['products[' + idx + '].disliked']: res.disliked,
        ['products[' + idx + '].likeCount']: res.likeCount,
        ['products[' + idx + '].dislikeCount']: res.dislikeCount
      });
    } catch (err) {}
  }
});
