const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');

const PAID_DRAW_COST = 50;
const FRAMED_UPGRADE_COST = 300;

Page({
  data: {
    user: null,
    products: [],
    draws: [],
    points: 0,
    rolling: false,
    rollFrame: 0,
    rollFrames: [],
    showAddress: false,
    editingAddress: false,
    prizeResult: null,  // 最近一次抽奖结果
    lang: 'zh',
    noneCount: 0,
    noneEmoji: '💪',
    noneText: '再接再厉',

    // 国家列表（双语）
    countryOptions: [
      { zh: '中国', en: 'China' },
      { zh: '美国', en: 'USA' },
      { zh: '英国', en: 'UK' }
    ],
    // 地址表单
    addr: {
      name: '', phone: '', email: '',
      address1: '', address2: '',
      city: '', state: '', zip: '', country: '中国'
    },
    courierPlatforms: [
      { code: 'SF',   zh: '顺丰速运',   en: 'SF Express' },
      { code: 'YTO',  zh: '圆通速递',   en: 'YTO Express' },
      { code: 'ZTO',  zh: '中通快递',   en: 'ZTO Express' },
      { code: 'STO',  zh: '申通快递',   en: 'STO Express' },
      { code: 'YD',   zh: '韵达快递',   en: 'Yunda' },
      { code: 'JD',   zh: '京东物流',   en: 'JD Logistics' },
      { code: 'EMS',  zh: '中国邮政EMS', en: 'EMS' },
      { code: 'DHL',  zh: 'DHL',        en: 'DHL' },
      { code: 'FEDEX',zh: 'FedEx',      en: 'FedEx' },
      { code: 'UPS',  zh: 'UPS',        en: 'UPS' },
      { code: 'OTHER',zh: '其他',       en: 'Other' }
    ]
  },

  onShow() {
    const app = getApp();
    var lang = app.globalData.language;
    this.setData({ lang: lang });
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Draw' : '抽奖' });

    if (!auth.isLoggedIn()) {
      wx.showModal({
        title: '需要登录',
        content: '请先登录或注册后参与抽奖',
        confirmText: '去登录',
        showCancel: false,
        success: () => {
          wx.navigateTo({ url: '/pages/login/login' });
        }
      });
      return;
    }
    this.loadData();
  },

  async loadData() {
    try {
      const session = await api.tokenSession();
      const drawsData = await api.getDraws();
      const app = getApp();
      app.globalData.user = session.user;
      app.globalData.products = session.products;
      app.globalData.latestDraw = session.draw;

      var drawsList = drawsData.draws || [];
      var noneList = [];
      for (var k = 0; k < drawsList.length; k++) {
        if (drawsList[k].prizeType === 'none') noneList.push(drawsList[k]);
      }
      var noneCount = noneList.length;
      var comforts = [
        { emoji: '💪', zh: '差一点就中了，再来！', en: 'So close! Try again!' },
        { emoji: '🌱', zh: '下次好运肯定轮到你', en: 'Luck is coming next time' },
        { emoji: '🎯', zh: '命中率在攒了，别急', en: 'Your luck is building up' },
        { emoji: '✨', zh: '耐心是中奖的秘诀', en: 'Patience is the key' },
        { emoji: '🍀', zh: '下一次就是你！', en: 'Next one is yours!' },
        { emoji: '🌈', zh: '风雨之后见彩虹', en: 'After the storm comes the rainbow' }
      ];
      var comfort = comforts[Math.floor(Math.random() * comforts.length)];
      var lang = this.data.lang;

      this.setData({
        user: session.user,
        products: session.products,
        draws: drawsList,
        points: drawsData.points != null ? drawsData.points : (session.user ? session.user.points : 0),
        noneCount: noneCount,
        noneEmoji: comfort.emoji,
        noneText: lang === 'en' ? comfort.en : comfort.zh
      });

    } catch (e) {
      // token 可能失效，跳登录
    }
  },

  openAddrFromRecord(e) {
    var id = e.currentTarget.dataset.id;
    var item = null;
    for (var i = 0; i < this.data.draws.length; i++) {
      if (this.data.draws[i].id === id) { item = this.data.draws[i]; break; }
    }
    if (!item) return;
    if (item.status !== 'pending' && item.status !== 'preparing') {
      wx.showToast({ title: this.data.lang === 'zh' ? '状态不可修改' : 'Cannot edit at this stage', icon: 'none' });
      return;
    }
    var self = this;
    var initAddr = { name: '', phone: '', email: '', address1: '', address2: '', city: '', state: '', zip: '', country: '' };
    if (item.shipping) {
      initAddr = Object.assign({}, initAddr, item.shipping);
    }
    this.setData({
      prizeResult: item,
      showAddress: true,
      editingAddress: !!item.shipping,
      addr: initAddr
    });
  },

  canFreeDraw() {
    if (!this.data.user) return false;
    return !this.data.user.freeDrawClaimed;
  },

  async onDraw() {
    if (this.data.rolling) return;
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    const free = this.canFreeDraw();
    if (!free && this.data.points < PAID_DRAW_COST) {
      wx.showToast({ title: '积分不足，需要 ' + PAID_DRAW_COST, icon: 'none' });
      return;
    }

    await this.startRolling();

    try {
      const result = await api.draw();
      this.stopRolling(result.draw);
    } catch (e) {
      this.stopRolling(null);
    }
  },

  // 抽奖动画：快速轮播产品图
  startRolling() {
    return new Promise((resolve) => {
      const products = this.data.products;
      if (!products.length) { resolve(); return; }

      this.setData({ rolling: true, rollFrame: 0, rollFrames: products });
      let frame = 0;
      const totalFrames = 18;
      const tick = () => {
        frame++;
        if (frame >= totalFrames) {
          this.setData({ rolling: false });
          resolve();
          return;
        }
        const speed = 40 + frame * 18; // 逐渐变慢
        this.setData({ rollFrame: frame % products.length });
        setTimeout(tick, speed);
      };
      tick();
    });
  },

  stopRolling(drawResult) {
    this.setData({ rolling: false });
    this.loadData();

    if (!drawResult) return;

    if (drawResult.prizeType === 'none') {
      var cute = [
        '🎁 奖励偷偷溜走了～下次一定！',
        '🍀 差一点点就中啦，再来！',
        '✨ 好运正在路上，别急～',
        '🌈 命中注定的礼物还在等你',
        '💪 蓄力中！下一发就是王炸'
      ];
      wx.showToast({
        title: cute[Math.floor(Math.random() * cute.length)],
        icon: 'none',
        duration: 2200
      });
    } else {
      wx.showToast({ title: '🎉 中奖啦！去填地址吧～', icon: 'success', duration: 2200 });
    }
  },

  // ---------- 地址表单 ----------

  onAddrInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['addr.' + field]: e.detail.value });
  },

  onCountryChange(e) {
    const list = ['中国', '美国', '英国'];
    const idx = Number(e.detail.value);
    this.setData({ 'addr.country': list[idx] });
  },

  async saveAddress() {
    const a = this.data.addr;
    const isChina = a.country === 'China' || a.country === '中国' || String(a.country || '').toLowerCase() === 'cn';
    const missing = [];
    if (!a.name.trim()) missing.push('收件人');
    if (!a.phone.trim()) missing.push('电话');
    if (!a.address1.trim()) missing.push('地址');
    if (!a.city.trim()) missing.push('城市');
    if (!a.country.trim()) missing.push('国家');
    if (!isChina) {
      if (!a.state.trim()) missing.push('省/州');
      if (!a.zip.trim()) missing.push('邮编');
    }
    if (missing.length) {
      wx.showToast({ title: '请填写：' + missing.join('、'), icon: 'none' });
      return;
    }

    try {
      let res;
      if (this.data.editingAddress && this.data.prizeResult) {
        res = await api.updateShipping(this.data.prizeResult.id, a);
      } else if (this.data.prizeResult) {
        res = await api.submitShipping(this.data.prizeResult.id, a);
      }

      wx.showToast({ title: '地址已保存', icon: 'success' });
      this.setData({ showAddress: false });
      this.loadData();
    } catch (e) {}
  },

  async onUpgrade() {
    if (!this.data.prizeResult || !this.data.prizeResult.id) return;
    if (this.data.points < FRAMED_UPGRADE_COST) {
      wx.showToast({ title: '积分不足，需要 ' + FRAMED_UPGRADE_COST, icon: 'none' });
      return;
    }
    try {
      wx.showLoading({ title: '升级中...' });
      const res = await api.upgradeDraw(this.data.prizeResult.id);
      wx.hideLoading();
      wx.showToast({ title: '已升级为画框', icon: 'success' });
      this.loadData();
    } catch (e) { wx.hideLoading(); }
  },

  // ---------- 展示帮助 ----------
  statusText(status) {
    const map = {
      pending: '待填写地址',
      preparing: '准备中 · 等待发货',
      shipped: '已发货',
      done: '已完结'
    };
    return map[status] || status;
  },

  prizeText(type) {
    return { canvas: '画布', framed: '画框', none: '未中奖' }[type] || type;
  },

  closeAddress() {
    this.setData({ showAddress: false });
  },

  noop() {},

  // 从剪贴板粘贴并智能解析地址
  pasteAddress() {
    var self = this;
    wx.getClipboardData({
      success: function(res) {
        var text = (res.data || '').trim();
        if (!text) {
          wx.showToast({ title: '剪贴板是空的', icon: 'none' });
          return;
        }
        var parsed = self.parseAddress(text);
        var merged = Object.assign({}, self.data.addr, parsed);
        self.setData({ addr: merged });
        wx.showToast({ title: '已自动填入，检查一下', icon: 'none', duration: 2000 });
      },
      fail: function() {
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
      }
    });
  },

  // 智能解析地址文本
  parseAddress(text) {
    var result = { name: '', phone: '', address1: '', address2: '', city: '', state: '', zip: '', country: '中国' };

    // 常见中国省份
    var provinces = ['北京','天津','上海','重庆','河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆','香港','澳门'];

    // 去掉常见标签前缀
    text = text.replace(/(收件人|收货人|姓名|联系人|电话|手机|联系方式|地址|收货地址|省|市|区|邮编|邮政编码|详细地址)[:：]?\s*/g, '');

    // 按换行、逗号、分号、空格拆分
    var parts = text.split(/[\n,;，；\t]+/).map(function(s) { return s.trim(); }).filter(Boolean);

    // 第一步：提取手机号
    var phoneRe = /1[3-9]\d{9}/;
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(phoneRe);
      if (m) {
        result.phone = m[0];
        parts[i] = parts[i].replace(phoneRe, '').trim();
        if (!parts[i]) parts.splice(i, 1);
        break;
      }
    }

    // 第二步：提取邮编（6位数字）
    var zipRe = /\b\d{6}\b/;
    for (var j = 0; j < parts.length; j++) {
      var z = parts[j].match(zipRe);
      if (z) {
        result.zip = z[0];
        parts[j] = parts[j].replace(zipRe, '').trim();
        if (!parts[j]) parts.splice(j, 1);
        break;
      }
    }

    // 第三步：找省份
    var foundProvinceIdx = -1;
    for (var k = 0; k < parts.length; k++) {
      for (var p = 0; p < provinces.length; p++) {
        if (parts[k].indexOf(provinces[p]) === 0) {
          result.state = provinces[p];
          // 尝试从同一部分提取城市
          var rest = parts[k].substring(provinces[p].length).replace(/^省|^市|^自治区/g, '');
          // 去掉"市辖区"之类
          rest = rest.replace(/市辖区$/, '');
          if (rest) {
            // 找到第一个"市"或"地区"结束
            var cityEnd = rest.search(/市|地区|自治州|盟/);
            if (cityEnd > 0) {
              result.city = rest.substring(0, cityEnd + 1);
            } else if (rest.length <= 8) {
              result.city = rest;
            }
          }
          foundProvinceIdx = k;
          break;
        }
      }
      if (foundProvinceIdx >= 0) break;
    }

    // 如果没找到省份，尝试在整个文本里匹配
    if (foundProvinceIdx < 0) {
      for (var p2 = 0; p2 < provinces.length; p2++) {
        if (text.indexOf(provinces[p2]) >= 0) {
          result.state = provinces[p2];
          break;
        }
      }
    }

    // 第四步：剩余部分分配
    // 假设格式：[姓名] [省市区 + 详细地址]
    if (parts.length >= 1) {
      // 第一部分可能是姓名（2-4字，不含路/街/号/市/省/区）
      var first = parts[0];
      var isNameLike = /^[\u4e00-\u9fa5]{2,4}$/.test(first) && !/路|街|号|市|省|区|县|镇|乡|村/.test(first);
      if (isNameLike && !result.name) {
        result.name = first;
        parts.shift();
      } else if (first.length <= 6 && !/\d/.test(first) && !/路|街|号|市|省|区|县/.test(first)) {
        result.name = first;
        parts.shift();
      }
    }

    // 剩下的拼成详细地址
    if (parts.length) {
      var addrStr = parts.join(' ');
      // 去掉已识别的省市，剩下的放 address1
      if (result.state) addrStr = addrStr.replace(result.state, '');
      if (result.city) addrStr = addrStr.replace(result.city, '');
      addrStr = addrStr.replace(/\s+/g, ' ').trim();
      // 分割区和详细地址
      var distMatch = addrStr.match(/([\u4e00-\u9fa5]+区|[\u4e00-\u9fa5]+县|[\u4e00-\u9fa5]+镇)/);
      if (distMatch) {
        result.address1 = distMatch[0];
        var restAddr = addrStr.substring(distMatch.index + distMatch[0].length).trim();
        if (restAddr) result.address2 = restAddr;
      } else {
        result.address1 = addrStr;
      }
    }

    return result;
  },

  async onCancelUpgrade(e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    var isZh = this.data.lang === 'zh';
    wx.showModal({
      title: isZh ? '确认取消升级？' : 'Cancel upgrade?',
      content: isZh ? '将返还 300 积分，作品变回画布版本。' : 'Refunds 300 points. Piece becomes canvas.',
      confirmText: isZh ? '确认取消' : 'Confirm',
      success: async function(r) {
        if (!r.confirm) return;
        try {
          await api.cancelUpgrade(id);
          wx.showToast({ title: isZh ? '已取消，积分已返还' : 'Cancelled, points refunded', icon: 'success' });
          self.loadData();
        } catch (err) {}
      }
    });
  }
});
