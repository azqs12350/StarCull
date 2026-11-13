// app.js — 小程序全局入口
const auth = require('./utils/auth.js');
const api = require('./utils/api.js');

App({
  globalData: {
    user: null,
    products: [],
    latestDraw: null,
    language: 'zh', // 'zh' | 'en'
    loaded: false,
    cloudReady: false
  },

  onLaunch() {
    // ---------- 云开发初始化 ----------
    // 在微信开发者工具里开通云开发后，会生成一个云环境 ID。
    // 把 "your-env-id" 替换成你自己的（开发者工具 → 云开发面板 → 环境 ID）。
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: 'star-d7ggu0y923dc5002d',
          traceUser: true
        });
        this.globalData.cloudReady = true;
      } catch (e) {
        console.warn('[cloud] init failed:', e.message);
      }
    } else {
      console.warn('[cloud] wx.cloud not available (基础库过低?)');
    }

    // 恢复用户语言偏好
    const saved = wx.getStorageSync('sc_lang');
    if (saved) {
      this.globalData.language = saved;
    }
    // 立即把 tabBar 切成正确语言
    this.applyTabBar(this.globalData.language);

    // 尝试用已有 token 恢复会话
    const token = auth.getToken();
    if (token) {
      // 先用本地缓存的用户信息填充全局态，「我的」页首屏可直接渲染
      const cachedUser = auth.getUser();
      if (cachedUser) this.globalData.user = cachedUser;
      this.bootstrapFromToken();
    }
  },

  bootstrapFromToken() {
    const token = auth.getToken();
    // 只拿产品数据存 globalData，**跳过图片转换**（那是 Gallery 页的事）
    // 登录/注册/抽奖记录页面也不依赖这些图片
    api.tokenSession({ skipPatchImg: true }).then((data) => {
      // token 已变化（期间重新登录/登出），丢弃旧响应
      if (auth.getToken() !== token) return;
      this.globalData.user = data.user;
      this.globalData.products = data.products;
      this.globalData.latestDraw = data.draw;
      this.globalData.loaded = true;
      auth.setUser(data.user);
    }).catch(() => {
      const current = auth.getToken();
      if (current !== token) {
        // 401 已清 token：清掉用户缓存；若是重新登录则什么都不做
        if (!current) {
          auth.clearUser();
          this.globalData.user = null;
        }
        this.globalData.loaded = true;
        return;
      }
      // 网络超时：保留本地缓存的登录态，避免闪回未登录
      this.globalData.loaded = true;
    });
  },

  // 登录/注册成功后调用
  setAuth(user, products, draw, token) {
    auth.setToken(token);
    auth.setUser(user);
    this.globalData.user = user;
    this.globalData.products = products;
    this.globalData.latestDraw = draw;
    this.globalData.loaded = true;
  },

  // 登出时调用
  clearAuth() {
    auth.clearToken();
    auth.clearUser();
    this.globalData.user = null;
    this.globalData.products = [];
    this.globalData.latestDraw = null;
  },

  setLang(lang) {
    this.globalData.language = lang;
    wx.setStorageSync('sc_lang', lang);
    this.applyTabBar(lang);
  },

  applyTabBar(lang) {
    var tabs = [
      { index: 0, zh: '画廊', en: 'Gallery' },
      { index: 1, zh: '抽奖', en: 'Draw' },
      { index: 2, zh: '留言', en: 'Message' },
      { index: 3, zh: '我的', en: 'Mine' }
    ];
    var self = this;
    tabs.forEach(function(t) {
      wx.setTabBarItem({
        index: t.index,
        text: lang === 'en' ? t.en : t.zh
      });
    });
  }
});
