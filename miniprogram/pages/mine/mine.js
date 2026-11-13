const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    user: null,
    points: 0,
    lang: 'zh',
    hasSecurityQuestion: false,
    securityQuestions: [],
    showSecurityForm: false,
    secQ: '',
    secQText: '',
    secA: '',
    editingPassword: false,
    oldPassword: '',
    newPassword: '',
    loadingUser: false,
    sessionError: false
  },

  onShow() {
    const app = getApp();
    var lang = app.globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Mine' : '我的' });

    if (!auth.isLoggedIn()) {
      this.setData({ user: null, loadingUser: false, sessionError: false });
      return;
    }

    // 先用全局/本地缓存的用户信息立即渲染，避免先闪「未登录」
    const cached = app.globalData.user || auth.getUser();
    if (cached) {
      this.setData({
        user: cached,
        points: cached.points || 0,
        hasSecurityQuestion: !!cached.hasSecurityQuestion,
        loadingUser: false,
        sessionError: false
      });
    } else {
      this.setData({ loadingUser: true, sessionError: false });
    }

    // 后台校验 session：成功则刷新，401 才切回未登录，网络异常保留缓存
    this.loadUser();
  },

  async loadUser() {
    const token = auth.getToken();
    try {
      const data = await api.tokenSession();
      // 请求期间登录态变化（重新登录/登出）则丢弃旧响应
      if (auth.getToken() !== token) return;
      const app = getApp();
      app.globalData.user = data.user;
      auth.setUser(data.user);
      this.setData({
        user: data.user,
        points: data.user ? data.user.points : 0,
        hasSecurityQuestion: data.user ? data.user.hasSecurityQuestion : false,
        loadingUser: false,
        sessionError: false
      });
    } catch (e) {
      const app = getApp();
      // api.js 遇到 401 会清 token；token 还在说明是网络/超时问题
      if (!auth.isLoggedIn()) {
        app.globalData.user = null;
        this.setData({ user: null, loadingUser: false, sessionError: false });
        return;
      }

      const cached = app.globalData.user || auth.getUser();
      if (cached) {
        this.setData({
          user: cached,
          points: cached.points || 0,
          hasSecurityQuestion: !!cached.hasSecurityQuestion,
          loadingUser: false,
          sessionError: false
        });
      } else {
        this.setData({ loadingUser: false, sessionError: true });
      }
      console.warn('[mine] session check failed, keep cached state:', e.message);
    }
  },

  onRetrySession() {
    this.setData({ loadingUser: true, sessionError: false });
    this.loadUser();
  },

  switchLang() {
    const app = getApp();
    const next = app.globalData.language === 'zh' ? 'en' : 'zh';
    app.setLang(next);
    this.setData({ lang: next });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  async onLogout() {
    wx.showModal({
      title: this.data.lang === 'zh' ? '确认退出？' : 'Sign out?',
      success: async (r) => {
        if (!r.confirm) return;
        try { await api.logout(); } catch (e) {}
        auth.clearToken();
        getApp().clearAuth();
        this.setData({ user: null });
        wx.showToast({ title: this.data.lang === 'zh' ? '已退出' : 'Signed out', icon: 'none' });
      }
    });
  },

  async openSecurityForm() {
    try {
      const res = await api.securityQuestions();
      var questions = res.questions || [];
      var curId = this.data.user.securityQuestion || '';
      var curQ = null;
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].id === curId) { curQ = questions[i]; break; }
      }
      this.setData({
        showSecurityForm: true,
        securityQuestions: questions,
        secQ: curId,
        secQText: curQ ? (this.data.lang === 'zh' ? curQ.zh : curQ.en) : '',
        secA: ''
      });
    } catch (e) {}
  },

  noop() {
    // 空函数，仅用于 catchtap 阻止事件冒泡
  },

  closeSecurityForm() {
    this.setData({ showSecurityForm: false });
  },

  onSecQChange(e) {
    var idx = Number(e.detail.value);
    var q = this.data.securityQuestions[idx];
    if (!q) return;
    this.setData({
      secQ: q.id,
      secQText: this.data.lang === 'zh' ? q.zh : q.en
    });
  },

  onSecAInput(e) {
    this.setData({ secA: e.detail.value });
  },

  async saveSecurity() {
    if (!this.data.secQ || !this.data.secA.trim()) {
      wx.showToast({ title: '请填写完整', icon: 'none' });
      return;
    }
    try {
      await api.setSecurityQuestion(this.data.secQ, this.data.secA);
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showSecurityForm: false });
      this.loadUser();
    } catch (e) {}
  },

  // ---------- WeChat bind / unbind ----------

  doBindWechat() {
    const lang = this.data.lang;
    wx.login({
      success: async (wxRes) => {
        if (!wxRes.code) {
          wx.showToast({ title: lang === 'zh' ? '获取微信凭证失败' : 'Failed to get code', icon: 'none' });
          return;
        }
        try {
          wx.showLoading();
          const data = await api.bindWechat(wxRes.code);
          wx.hideLoading();
          wx.showToast({
            title: lang === 'zh' ? '绑定成功' : 'Bound!',
            icon: 'success'
          });
          getApp().globalData.user = data.user;
          auth.setUser(data.user);
          this.setData({ user: data.user });
        } catch (e) { wx.hideLoading(); }
      },
      fail: () => {
        wx.showToast({ title: lang === 'zh' ? '微信调用失败' : 'wx.login failed', icon: 'none' });
      }
    });
  },

  doUnbindWechat() {
    const lang = this.data.lang;
    wx.showModal({
      title: lang === 'zh' ? '解绑微信？' : 'Unbind WeChat?',
      content: lang === 'zh'
        ? '解绑后你将无法用微信一键登录此账号。'
        : 'After unbinding, you will no longer be able to sign in with WeChat.',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          wx.showLoading();
          const data = await api.unbindWechat();
          wx.hideLoading();
          wx.showToast({ title: lang === 'zh' ? '已解绑' : 'Unbound', icon: 'success' });
          getApp().globalData.user = data.user;
          auth.setUser(data.user);
          this.setData({ user: data.user });
        } catch (e) { wx.hideLoading(); }
      }
    });
  }
});
