const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');
const imageCache = require('../../utils/image-cache.js');

const PAID_DRAW_COST = 50;
const FRAMED_UPGRADE_COST = 300;

// 抽奖记录本地缓存：按用户隔离，30 分钟过期，最多存 30 条
const DRAW_CACHE_KEY = 'sc_draw_cache_v1';
const DRAW_CACHE_TTL = 30 * 60 * 1000;
const DRAW_CACHE_LIMIT = 30;

// 后台刷新提示的延迟：请求在此时间内完成就不显示，避免提示一闪而过
const REFRESH_HINT_DELAY = 250;

// 抽奖滚动：固定约 6 秒，帧间隔从 40ms 逐步拉长到 280ms（先快后慢）
const ROLL_DURATION_MS = 6000;
const ROLL_MIN_DELAY = 40;
const ROLL_MAX_DELAY = 280;

Page({
  data: {
    user: null,
    products: [],
    draws: [],
    points: 0,
    rolling: false,
    drawing: false,
    refreshing: false,
    loading: true,
    loadError: false,
    needLogin: false,
    rollImage: '',
    showAddress: false,
    editingAddress: false,
    previewVisible: false,
    previewImage: '',
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
      this.setData({ needLogin: true, loading: false, loadError: false, refreshing: false });
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

    // 先用本地缓存的用户 / 抽奖记录铺满界面，再后台刷新
    const cachedUser = app.globalData.user || auth.getUser();
    const cached = this._readDrawCache(cachedUser);

    const patch = {
      needLogin: false,
      loadError: false,
      refreshing: false,
      user: cachedUser || null,
      points: cached && cached.points != null ? cached.points : (cachedUser ? cachedUser.points || 0 : 0),
      draws: cached ? cached.draws || [] : [],
      loading: !cached
    };
    if (cached) {
      patch.noneCount = cached.noneCount || 0;
      patch.noneEmoji = cached.noneEmoji || '💪';
      patch.noneText = cached.noneText || (lang === 'en' ? 'Try again!' : '再接再厉');
    }
    this.setData(patch);

    this.loadData();
  },

  async loadData(force) {
    if (this._loadingData) {
      if (force) this._reloadQueued = true;
      return;
    }
    this._loadingData = true;
    this._scheduleRefreshHint();

    try {
      // 两个请求并行，缩短数据到达时间
      const [session, drawsData] = await Promise.all([api.tokenSession(), api.getDraws()]);
      const app = getApp();
      app.globalData.user = session.user;
      app.globalData.products = session.products;
      app.globalData.latestDraw = session.draw;
      auth.setUser(session.user);

      var drawsList = drawsData.draws || [];
      var noneCount = 0;
      for (var k = 0; k < drawsList.length; k++) {
        if (drawsList[k].prizeType === 'none') noneCount++;
      }

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
      var points = drawsData.points != null ? drawsData.points : (session.user ? session.user.points : 0);

      this.setData({
        user: session.user,
        products: session.products,
        draws: drawsList,
        points: points,
        noneCount: noneCount,
        noneEmoji: comfort.emoji,
        noneText: lang === 'en' ? comfort.en : comfort.zh,
        loading: false,
        loadError: false
      });

      this._writeDrawCache(session.user, drawsList, points, noneCount, comfort, lang);
    } catch (e) {
      console.warn('[draw] loadData failed:', e.message);
      if (this.data.draws && this.data.draws.length) {
        this.setData({ loading: false });
        wx.showToast({
          title: this.data.lang === 'zh' ? '刷新失败，显示上次数据' : 'Refresh failed, showing cached data',
          icon: 'none'
        });
      } else {
        this.setData({ loading: false, loadError: true });
      }
    } finally {
      this._loadingData = false;
      this._clearRefreshHint();
      if (this.data.refreshing) this.setData({ refreshing: false });
      if (this._reloadQueued) {
        this._reloadQueued = false;
        this.loadData();
      }
    }
  },

  // 请求超过 REFRESH_HINT_DELAY 才显示「数据更新中」，避免快速请求导致提示闪烁。
  // 首屏无缓存时已有骨架屏，不叠加刷新提示。
  _scheduleRefreshHint() {
    this._clearRefreshHint();
    if (this.data.loading) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      if (this._loadingData) this.setData({ refreshing: true });
    }, REFRESH_HINT_DELAY);
  },

  _clearRefreshHint() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  },

  retryLoad() {
    this.setData({ loading: true, loadError: false });
    this.loadData();
  },

  _userKey(user) {
    if (!user) return '';
    return String(user.id || user.username || '');
  },

  _readDrawCache(user) {
    if (!user) return null;
    try {
      const c = wx.getStorageSync(DRAW_CACHE_KEY);
      if (!c || !c.draws || c.userKey !== this._userKey(user)) return null;
      if (Date.now() - c.ts > DRAW_CACHE_TTL) return null;
      return c;
    } catch (e) {
      return null;
    }
  },

  _writeDrawCache(user, draws, points, noneCount, comfort, lang) {
    if (!user) return;
    try {
      wx.setStorageSync(DRAW_CACHE_KEY, {
        userKey: this._userKey(user),
        ts: Date.now(),
        draws: draws.slice(0, DRAW_CACHE_LIMIT),
        points: points,
        noneCount: noneCount,
        noneEmoji: comfort.emoji,
        noneText: lang === 'en' ? comfort.en : comfort.zh
      });
    } catch (e) {
      console.warn('[draw] cache write failed:', e.message);
    }
  },

  openAddrFromRecord(e) {
    var id = e.currentTarget.dataset.id;
    var item = null;
    for (var i = 0; i < this.data.draws.length; i++) {
      if (this.data.draws[i].id === id) { item = this.data.draws[i]; break; }
    }
    this._showAddressFor(item);
  },

  // 点击中奖作品图：原地放大预览（不跳页，关闭后仍在结果页）
  onPrizeImageTap() {
    this.showPrizePreview();
  },

  showPrizePreview() {
    var p = this.data.prizeResult && this.data.prizeResult.product;
    var src = p && p.image;
    if (!src) return;
    this.setData({ previewVisible: true, previewImage: src });
  },

  closePrizePreview() {
    if (!this.data.previewVisible) return;
    this.setData({ previewVisible: false, previewImage: '' });
  },

  onHide() {
    // 切走时收起放大层，回来仍停留在结果界面
    if (this.data.previewVisible) this.setData({ previewVisible: false });
  },

  // 点击中奖结果图以外的区域：填收货地址
  openAddrFromResult() {
    if (this.data.rolling || this.data.drawing) return;
    this._showAddressFor(this.data.prizeResult);
  },

  _showAddressFor(item) {
    if (!item) return;
    if (item.status && item.status !== 'pending' && item.status !== 'preparing') {
      wx.showToast({ title: this.data.lang === 'zh' ? '状态不可修改' : 'Cannot edit at this stage', icon: 'none' });
      return;
    }
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
    if (this.data.rolling || this.data.drawing) return;
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    const free = this.canFreeDraw();
    if (!free && this.data.points < PAID_DRAW_COST) {
      wx.showToast({ title: '积分不足，需要 ' + PAID_DRAW_COST, icon: 'none' });
      return;
    }

    // 点击即进入 pending，按钮立即禁用并显示「抽奖中…」
    this.setData({ drawing: true });

    try {
      // 抽奖请求与滚动并行：点击后立即请求，滚动固定跑满 6 秒
      this._rollCanStop = false;
      this._pendingPrizeImage = '';
      const drawPromise = api.draw();
      const imageReady = drawPromise.then((r) => {
        if (r && r.draw && r.draw.product && r.draw.product.image) {
          return this._prepareResultImage(r.draw.id, r.draw.product.id, r.draw.product.image).then((url) => {
            if (url) this._pendingPrizeImage = url;
          });
        }
        return null;
      }).catch(() => null).then(() => {
        this._rollCanStop = true;
      });

      // 兜底：6 秒后若结果图仍未就绪，最多再等 2 秒就按现有方式收尾
      setTimeout(() => { this._rollCanStop = true; }, ROLL_DURATION_MS + 2000);

      await this.startRolling();
      const result = await drawPromise;
      await Promise.race([imageReady, new Promise((r) => setTimeout(r, 1500))]);
      this.stopRolling(result.draw, result.points, free);
    } catch (e) {
      this.stopRolling(null);
      wx.showToast({
        title: this.data.lang === 'zh' ? '抽奖失败，请重试' : 'Draw failed, please retry',
        icon: 'none'
      });
    } finally {
      this.setData({ drawing: false });
    }
  },

  // ---------- 滚动图片：直接复用首页共享缓存 ----------

  // 缓存里有多少用多少，不额外补拉、不按数量截断
  _rollFramesFromCache() {
    const urls = imageCache.values();
    const frames = [];
    const seen = new Set();
    for (let i = 0; i < urls.length; i++) {
      if (!urls[i] || seen.has(urls[i])) continue;
      seen.add(urls[i]);
      frames.push({ image: urls[i] });
    }
    return frames;
  },

  // 抽奖动画：固定跑满 6 秒，先快后慢，最后一帧落到中奖图（若已就绪）
  async startRolling() {
    const frames = this._rollFramesFromCache();
    if (!frames.length) {
      console.log('[draw] shared image cache empty, skip rolling');
      return;
    }

    return new Promise((resolve) => {
      const startAt = Date.now();
      let frame = 0;
      this.setData({ rolling: true, rollImage: frames[0].image });

      const tick = () => {
        const elapsed = Date.now() - startAt;
        if (elapsed >= ROLL_DURATION_MS && this._rollCanStop !== false) {
          const winnerImage = this._pendingPrizeImage || '';
          const patch = { rolling: false };
          if (winnerImage) patch.rollImage = winnerImage;
          this.setData(patch);
          resolve();
          return;
        }

        frame++;
        const idx = frame % frames.length;
        this.setData({ rollImage: frames[idx].image });

        const progress = Math.min(elapsed / ROLL_DURATION_MS, 1);
        const delay = Math.round(ROLL_MIN_DELAY + (ROLL_MAX_DELAY - ROLL_MIN_DELAY) * progress * progress);
        const remaining = Math.max(ROLL_DURATION_MS - elapsed, 0);
        setTimeout(tick, Math.max(16, Math.min(delay, remaining || delay)));
      };
      tick();
    });
  },

  stopRolling(drawResult, points, free) {
    const patch = { rolling: false };
    // 用抽奖接口返回值立即更新积分，不等 loadData 回来
    if (points != null) {
      patch.points = points;
      patch['user.points'] = points;
    }
    if (free && drawResult && this.data.user) {
      patch['user.freeDrawClaimed'] = true;
    }

    // 结果图：优先用已预取的 base64；没有就先用最后一帧顶上，转换完再替换，避免灰块
    var result = null;
    if (drawResult && drawResult.prizeType !== 'none' && drawResult.product) {
      var rawImage = drawResult.product.image || '';
      var ready = rawImage.indexOf('data:') === 0 ? rawImage : imageCache.get(drawResult.product.id);
      result = Object.assign({}, drawResult, {
        product: Object.assign({}, drawResult.product, {
          image: ready || this.data.rollImage || rawImage
        })
      });
      patch.prizeResult = result;
      // 结果图已就绪：锁定后自动放大展示（原地浮层，不离开结果页）
      if (ready) {
        patch.previewVisible = true;
        patch.previewImage = ready;
      }
    } else if (drawResult && drawResult.prizeType === 'none') {
      patch.prizeResult = null;
    }

    this.setData(patch);
    if (result) this._prepareResultImage(result.id, drawResult.product.id, drawResult.product.image);
    this.loadData(true);

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

  // 结果图补齐：优先命中首页共享缓存；没有才为这一张图补一次转换
  // 返回 Promise，滚动动画可等它就绪后再停
  _prepareResultImage(prizeId, productId, rawImage) {
    if (!rawImage) return Promise.resolve('');
    if (rawImage.indexOf('data:') === 0) {
      if (productId) imageCache.set(productId, rawImage);
      return Promise.resolve(rawImage);
    }
    if (!api.needsPatch(rawImage)) return Promise.resolve(rawImage);

    var cached = imageCache.get(productId);
    if (cached) {
      this._applyResultImage(prizeId, cached);
      return Promise.resolve(cached);
    }
    return api.patchImageUrls([rawImage], (map) => {
      var url = map[rawImage];
      if (!url) return;
      if (productId) imageCache.set(productId, url);
      this._applyResultImage(prizeId, url);
    }).then(() => imageCache.get(productId) || '').catch((e) => {
      console.warn('[draw] result image failed:', e.message);
      return '';
    });
  },

  _applyResultImage(prizeId, url) {
    if (!this.data.prizeResult || this.data.prizeResult.id !== prizeId) return;
    var patch = { 'prizeResult.product.image': url };
    if (this.data.previewVisible) patch.previewImage = url;
    this.setData(patch);
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
      this.loadData(true);
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
      this.loadData(true);
    } catch (e) { wx.hideLoading(); }
  },

  // ---------- 展示帮助 ----------
  statusText(status) {
    const map = {
      pending: '待填写地址',
      preparing: '准备中 · 等待发货',
      making: '制作中',
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
          self.loadData(true);
        } catch (err) {}
      }
    });
  }
});
