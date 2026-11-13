const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');
const auth = require('../../utils/auth.js');

// 首屏占位图：2x2 浅灰 PNG（页面 .grid-img 本身也有同色背景）
// 待转换的图先用它铺位，转换成功后按 index 替换，避免空屏或裂图
const PLACEHOLDER_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR42mP48OHNfxBmgDEAiEwPLVCOe4IAAAAASUVORK5CYII=';

Page({
  data: {
    products: [],
    categories: [],
    activeCategory: 'all',
    lang: 'zh',
    loading: true
  },

  onShow() {
    const app = getApp();
    var lang = app.globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: 'StarCull' });
    this.loadProducts();
  },

  onPullDownRefresh() {
    this.loadProducts().then(() => wx.stopPullDownRefresh());
  },

  noop() {},

  async loadProducts() {
    const runId = (this._loadRun = (this._loadRun || 0) + 1);

    try {
      if (!this.data.products.length) this.setData({ loading: true });
      const app = getApp();
      let rawProducts = null;

      console.log('[Gallery] loadProducts START globalData.products=', app.globalData.products?.length);

      // 优先用全局缓存的数据（不转图片，是 app.js bootstrapFromToken 存的原始数据）
      if (app.globalData.products && app.globalData.products.length) {
        rawProducts = app.globalData.products;
        console.log('[Gallery] USING CACHE products.length=', rawProducts.length);
      } else {
        console.log('[Gallery] CACHE EMPTY → tokenSession({ skipPatchImg: true })');
        const data = await api.tokenSession({ skipPatchImg: true });
        console.log('[Gallery] tokenSession returned products=', data.products?.length, 'user=', !!data.user);
        if (data.user) app.globalData.user = data.user;
        rawProducts = data.products;
      }

      console.log('[Gallery] final rawProducts.length=', rawProducts?.length, 'first img=', rawProducts?.[0]?.image?.substring(0, 60));

      const cats = this.buildCategories(rawProducts);
      this._rawProducts = rawProducts;

      // 构造首屏列表：已转换过的用缓存图，待转换的先用占位图，其余原样显示
      // 这样 setData 之后用户立刻能看到全部条目，而不是等图片转完
      // 缓存直接复用当前列表里已转好的 data URL，避免额外一份大对象常驻内存
      const canProxyImages = api.getTransport() === 'cloud';
      const cached = {};
      (this.data.products || []).forEach((p) => {
        if (p._src && typeof p.image === 'string' && p.image.indexOf('data:') === 0) {
          cached[p._src] = p.image;
        }
      });
      const patchUrls = [];
      const display = (rawProducts || []).map((p) => {
        const item = Object.assign({}, p);
        if (api.needsPatch(item.image)) {
          item._src = item.image;
          if (!canProxyImages) {
            // 直连模式无法转 base64，保留原始 URL 作为兜底
            console.log('[Gallery] direct mode, keep original image:', item.image.substring(0, 60));
          } else if (cached[item.image]) {
            item.image = cached[item.image];
          } else {
            item.image = PLACEHOLDER_IMG;
            patchUrls.push(item._src);
          }
        }
        return item;
      });

      this.setData({ categories: cats, products: display, loading: false });
      console.log('[Gallery] FIRST FRAME products=' + display.length + ', pending images=' + patchUrls.length);

      // 后台增量转换：不 await，首屏不受影响
      this._patchImages(Array.from(new Set(patchUrls)), display, runId);
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 后台逐批转换，每批完成只更新对应下标，不整表重绘
  _patchImages(urls, products, runId) {
    if (!urls.length) {
      console.log('[Gallery] no pending images');
      return;
    }

    const indexMap = {};
    products.forEach((p, i) => {
      if (!p._src) return;
      if (!indexMap[p._src]) indexMap[p._src] = [];
      indexMap[p._src].push(i);
    });

    api.patchImageUrls(urls, (map) => {
      if (runId !== this._loadRun) return;
      Object.keys(map).forEach((src) => {
        const dataUrl = map[src];
        const list = indexMap[src] || [];
        for (let k = 0; k < list.length; k++) {
          this.setData({ ['products[' + list[k] + '].image']: dataUrl });
        }
        console.log('[Gallery] image ready: index=' + list.join(',') + ' src=' + src.substring(0, 50));
      });
    }, () => runId !== this._loadRun).then((r) => {
      if (runId !== this._loadRun) return;
      const remain = this.data.products.filter((p) => p.image === PLACEHOLDER_IMG).length;
      console.log('[Gallery] image patch finished: ' + r.ok + '/' + r.total + ', placeholders left=' + remain);
    }).catch((e) => {
      console.warn('[Gallery] image patch error:', e.message);
    });
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
    this.setData({ activeCategory: id });
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
