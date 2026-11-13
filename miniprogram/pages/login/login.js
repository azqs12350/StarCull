const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    mode: 'login', // 'login' | 'register' | 'recover-question' | 'recover-reset'
    lang: 'zh',

    // login
    loginUsername: '',
    loginPassword: '',

    // register
    regUsername: '',
    regPassword: '',
    regSecQ: '',
    regSecA: '',
    questions: [],

    // recover
    recUsername: '',
    recQuestion: '',
    recAnswer: '',
    recNewPassword: '',

    // 提交中：禁止重复点击，按钮显示 loading
    submitting: false
  },

  onLoad() {
    var lang = getApp().globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Sign in' : '登录' });
    if (auth.isLoggedIn()) {
      wx.switchTab({ url: '/pages/mine/mine' });
    }
    this.loadQuestions();
  },

  async loadQuestions() {
    try {
      const res = await api.securityQuestions();
      this.setData({ questions: res.questions });
    } catch (e) {}
  },

  setMode(e) {
    if (this.data.submitting) return;
    // 微信 bindtap 传事件对象，从 dataset 拿 data-mode 的值
    const mode = e.currentTarget.dataset.mode;
    console.log('[login] setMode →', mode);
    this.setData({ mode });
  },

  // ---------- Login ----------

  onLoginUsername(e) { this.setData({ loginUsername: e.detail.value }); },
  onLoginPassword(e) { this.setData({ loginPassword: e.detail.value }); },

  async doLogin() {
    if (this.data.submitting) return;
    if (!this.data.loginUsername.trim() || !this.data.loginPassword) {
      wx.showToast({ title: this.data.lang === 'zh' ? '请填写完整' : 'Fill all fields', icon: 'none' });
      return;
    }

    const lang = this.data.lang;
    this.setData({ submitting: true });
    try {
      const res = await api.login(this.data.loginUsername.trim(), this.data.loginPassword);
      // 立即落 token + 用户缓存 + 全局态，页面随后直接读缓存
      getApp().setAuth(res.user, res.products, res.draw, res.token);
      wx.showToast({
        title: lang === 'zh' ? '登录成功' : 'Welcome back',
        icon: 'success',
        duration: 1500
      });
      // 成功后保持 submitting，直到切页，避免切页前重复提交
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 500);
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({
        title: (e && e.message) || (lang === 'zh' ? '登录失败，请重试' : 'Sign-in failed'),
        icon: 'none',
        duration: 2500
      });
    }
  },

  // ---------- WeChat one-tap login ----------

  doWechatLogin() {
    if (this.data.submitting) return;
    const lang = this.data.lang;
    this.setData({ submitting: true });
    wx.login({
      success: async (wxRes) => {
        if (!wxRes.code) {
          this.setData({ submitting: false });
          wx.showToast({ title: lang === 'zh' ? '获取微信登录凭证失败' : 'Failed to get WeChat code', icon: 'none' });
          return;
        }
        try {
          const res = await api.wechatLogin(wxRes.code);
          getApp().setAuth(res.user, res.products, res.draw, res.token);

          const welcome = res.isNew
            ? (lang === 'zh' ? '欢迎，微信用户！' : 'Welcome, WeChat user!')
            : (lang === 'zh' ? '登录成功' : 'Welcome back');
          wx.showToast({ title: welcome, icon: 'success', duration: 1500 });
          setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 500);
        } catch (e) {
          this.setData({ submitting: false });
          wx.showToast({
            title: (e && e.message) || (lang === 'zh' ? '微信登录失败，请重试' : 'WeChat sign-in failed'),
            icon: 'none',
            duration: 2500
          });
        }
      },
      fail: () => {
        this.setData({ submitting: false });
        wx.showToast({ title: lang === 'zh' ? '微信登录调用失败' : 'wx.login failed', icon: 'none' });
      }
    });
  },

  // ---------- Register ----------

  onRegUsername(e) { this.setData({ regUsername: e.detail.value }); },
  onRegPassword(e) { this.setData({ regPassword: e.detail.value }); },
  onRegSecQChange(e) {
    const idx = Number(e.detail.value);
    const q = this.data.questions[idx];
    if (q) this.setData({ regSecQ: q.id + '' });
  },
  onRegSecQInput(e) { this.setData({ regSecQ: e.detail.value }); },
  onRegSecA(e) { this.setData({ regSecA: e.detail.value }); },

  async doRegister() {
    if (this.data.submitting) return;
    var regUsername = this.data.regUsername;
    var regPassword = this.data.regPassword;
    var regSecQ = this.data.regSecQ;
    var regSecA = this.data.regSecA;
    if (!regUsername.trim() || !regPassword || !regSecQ || !regSecA.trim()) {
      wx.showToast({ title: this.data.lang === 'zh' ? '请填写完整所有字段' : 'Fill all fields', icon: 'none' });
      return;
    }

    const lang = this.data.lang;
    this.setData({ submitting: true });
    try {
      const res = await api.register(regUsername.trim(), regPassword, regSecQ.trim(), regSecA);
      getApp().setAuth(res.user, res.products, res.draw, res.token);
      wx.showToast({
        title: lang === 'zh' ? '注册成功！' : 'Welcome!',
        icon: 'success',
        duration: 1500
      });
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 500);
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({
        title: (e && e.message) || (lang === 'zh' ? '注册失败，请重试' : 'Registration failed'),
        icon: 'none',
        duration: 2500
      });
    }
  },

  // ---------- Recover ----------

  onRecUsername(e) { this.setData({ recUsername: e.detail.value }); },
  onRecAnswer(e) { this.setData({ recAnswer: e.detail.value }); },
  onRecNewPassword(e) { this.setData({ recNewPassword: e.detail.value }); },

  async doRecoverNext() {
    const username = this.data.recUsername.trim();
    if (!username) {
      wx.showToast({ title: this.data.lang === 'zh' ? '请输入账号' : 'Enter username', icon: 'none' });
      return;
    }
    try {
      wx.showLoading();
      const res = await api.recoverQuestion(username);
      wx.hideLoading();
      this.setData({
        recQuestion: res.question,
        mode: 'recover-reset'
      });
    } catch (e) { wx.hideLoading(); }
  },

  async doRecoverReset() {
    var recUsername = this.data.recUsername;
    var recAnswer = this.data.recAnswer;
    var recNewPassword = this.data.recNewPassword;
    if (!recAnswer.trim() || !recNewPassword) {
      wx.showToast({ title: this.data.lang === 'zh' ? '请填写完整' : 'Fill all fields', icon: 'none' });
      return;
    }
    if (recNewPassword.length < 6) {
      wx.showToast({ title: this.data.lang === 'zh' ? '密码至少 6 位' : 'Min 6 chars', icon: 'none' });
      return;
    }
    try {
      wx.showLoading();
      await api.recoverPassword(recUsername.trim(), recAnswer, recNewPassword);
      wx.hideLoading();
      wx.showToast({
        title: this.data.lang === 'zh' ? '密码已重置，请登录' : 'Password reset. Sign in.',
        icon: 'success'
      });
      this.setData({ mode: 'login' });
    } catch (e) { wx.hideLoading(); }
  }
});
