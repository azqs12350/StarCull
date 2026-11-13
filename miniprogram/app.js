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
      this.bootstrapFromToken();
    }
  },

  bootstrapFromToken() {
    // 只拿产品数据存 globalData，**跳过图片转换**（那是 Gallery 页的事）
    // 登录/注册/抽奖记录页面也不依赖这些图片
    api.tokenSession({ skipPatchImg: true }).then((data) => {
      this.globalData.user = data.user;
      this.globalData.products = data.products;
      this.globalData.latestDraw = data.draw;
      this.globalData.loaded = true;
    }).catch(() => {
      // Token 失效，清掉
      auth.clearToken();
      this.globalData.loaded = true;
    });
  },

  // 登录/注册成功后调用
  setAuth(user, products, draw, token) {
    auth.setToken(token);
    this.globalData.user = user;
    this.globalData.products = products;
    this.globalData.latestDraw = draw;
  },

  // 登出时调用
  clearAuth() {
    auth.clearToken();
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
