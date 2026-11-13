const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    thread: [],
    input: '',
    canSend: false,
    lang: 'zh'
  },

  onShow() {
    var lang = getApp().globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Message' : '留言' });
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    this.loadMessages();
  },

  async loadMessages() {
    try {
      const res = await api.getMessages();
      this.setData({ thread: res.thread || [] });
      await api.markMessagesRead();
    } catch (e) {}
  },

  onInput(e) {
    const val = e.detail.value;
    this.setData({
      input: val,
      canSend: !!(val && val.trim())
    });
  },

  async onSend() {
    if (!this.data.canSend) return;
    const content = this.data.input.trim();
    if (!content) return;
    try {
      const res = await api.sendMessage(content);
      var thread = this.data.thread.concat([res.message]);
      this.setData({ thread: thread, input: '', canSend: false });
    } catch (e) {}
  },

  scrollToBottom() {
    wx.createSelectorQuery().select('.msg-list').boundingClientRect((rect) => {
      if (rect) wx.pageScrollTo({ scrollTop: rect.height });
    }).exec();
  }
});
