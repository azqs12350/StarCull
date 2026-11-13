const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');
const auth = require('../../utils/auth.js');

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
    try {
      this.setData({ loading: true });
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

      // 先只 setData categories（标签栏能立刻出来），**不 setData products**
      // 避免 image 组件看到相对路径 /uploads/xxx.webp → 渲染层报 Failed to load
      this.setData({ categories: cats });

      // 先转前 12 张 data URL → 转完一起 setData products
      // 这样渲染层第一次看到的就是 data: URL，不会触发 Failed to load
      await this._patchInBatchesAndShow(rawProducts);
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 一张图一个请求（云函数每次只转一张，避免返回体积超 1MB）
  // 3 个并发 worker 加速，每转好一张只 setData 对应的 image 字段
  async _patchInBatchesAndShow(products) {
    console.log('[Gallery] _patchOneByOne START products.length=', products?.length);

    // 先把已有数据渲染出来（proxy 主请求已带的前 2 张是 data URL，其余是相对路径）
    this.setData({ products: products.slice() });

    const CONCURRENCY = 3;
    let next = 0;

    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= products.length) return;
        if (!api.needsPatch(products[i].image)) continue;
        try {
          await api.patchProductsImgInPlace([products[i]]);
          this.setData({ ['products[' + i + '].image']: products[i].image });
        } catch (e) {
          console.warn('[Gallery] patch image ' + i + ' failed:', e.message);
        }
      }
    };

    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);
    console.log('[Gallery] all images patched');
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
