const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    product: null,
    id: '',
    lang: 'zh',
    requireLogin: false
  },

  onLoad(options) {
    const id = options.id;
    this.setData({ id, lang: getApp().globalData.language });
    this.findProduct(id);
  },

  onShow() {
    // 刷新一次状态（比如收藏状态可能变了）
    var lang = getApp().globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Detail' : '作品详情' });
    if (this.data.id) this.findProduct(this.data.id);
  },

  findProduct(id) {
    const app = getApp();
    const list = app.globalData.products;
    let p = list.find((x) => x.id === id);
    if (p) {
      this.setData({ product: p });
      return;
    }
    // 本地没有，请求一次
    api.tokenSession().then((data) => {
      app.globalData.products = data.products;
      const found = data.products.find((x) => x.id === id);
      this.setData({ product: found || null });
    }).catch(() => {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  async onStar() {
    if (!auth.isLoggedIn()) return this.needLogin();
    try {
      const res = await api.starProduct(this.data.id);
      this.updateField('starred', res.starred);
      this.updateField('count', res.count);
      wx.showToast({ title: res.starred ? '已收藏' : '已取消', icon: 'none' });
    } catch (e) {}
  },

  async onLike() {
    if (!auth.isLoggedIn()) return this.needLogin();
    try {
      const res = await api.likeProduct(this.data.id);
      this.setData({
        'product.liked': res.liked,
        'product.disliked': res.disliked,
        'product.likeCount': res.likeCount,
        'product.dislikeCount': res.dislikeCount
      });
    } catch (e) {}
  },

  async onDislike() {
    if (!auth.isLoggedIn()) return this.needLogin();
    try {
      const res = await api.dislikeProduct(this.data.id);
      this.setData({
        'product.liked': res.liked,
        'product.disliked': res.disliked,
        'product.likeCount': res.likeCount,
        'product.dislikeCount': res.dislikeCount
      });
    } catch (e) {}
  },

  updateField(key, val) {
    this.setData({ ['product.' + key]: val });
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

  goDraw() {
    wx.switchTab({ url: '/pages/draw/draw' });
  }
});
