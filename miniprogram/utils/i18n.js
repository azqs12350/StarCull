// utils/i18n.js — 极简双语支持
// 每个页面自己引入 setLang() / t()

const zh = {
  'app.name': 'StarCull',
  'tab.home': '画廊',
  'tab.draw': '抽奖',
  'tab.message': '留言',
  'tab.mine': '我的',

  'home.title': '作品',
  'home.all': '全部',

  'product.series': '系列',
  'product.note': '作品说明',
  'product.star': '收藏',
  'product.starred': '已收藏',
  'product.like': '喜欢',
  'product.dislike': '不感兴趣',
  'product.draw': '去抽奖',

  'draw.title': '抽奖',
  'draw.points': '积分',
  'draw.free': '免费抽一次',
  'draw.paid': '50 积分抽一次',
  'draw.rolling': '抽奖中...',
  'draw.youWin': '恭喜中奖！',
  'draw.noWin': '这次没中奖，再来一次？',
  'draw.upgrade': '300 积分升级画框',
  'draw.address': '填写收货地址',
  'draw.noPrize': '未中奖，不需要地址',

  'draw.status.pending': '未填写地址',
  'draw.status.preparing': '准备中（等待发货）',
  'draw.status.shipped': '已发货',
  'draw.status.done': '已完结',

  'shipping.name': '收件人',
  'shipping.phone': '电话',
  'shipping.email': '邮箱（可选）',
  'shipping.address1': '地址',
  'shipping.address2': '地址第二行（可选）',
  'shipping.city': '城市',
  'shipping.state': '省/州',
  'shipping.zip': '邮编',
  'shipping.country': '国家',
  'shipping.save': '保存地址',

  'mine.title': '个人中心',
  'mine.points': '积分',
  'mine.login': '登录 / 注册',
  'mine.logout': '退出登录',
  'mine.drawRecords': '抽奖记录',
  'mine.noDraws': '还没有抽奖记录',
  'mine.security': '安全问题',
  'mine.setSecurity': '设置安全问题',
  'mine.language': '语言',

  'login.title': '登录 StarCull',
  'login.register': '注册新账号',
  'login.username': '账号',
  'login.password': '密码',
  'login.btn': '登录',
  'login.registerBtn': '注册',
  'login.forgot': '忘记密码？',
  'login.toLogin': '已有账号？去登录',
  'login.toRegister': '没有账号？去注册',

  'login.securityQuestion': '安全问题',
  'login.securityAnswer': '答案',
  'login.securityAnswerHint': '⚠️ 这是找回密码的唯一渠道，请认真填写！',

  'recover.title': '找回密码',
  'recover.username': '你的账号',
  'recover.next': '下一步',
  'recover.answer': '安全问题答案',
  'recover.newPassword': '新密码（至少 6 位）',
  'recover.submit': '重置密码',

  'message.title': '留言',
  'message.placeholder': '输入你的消息...',
  'message.send': '发送',
  'message.noMessages': '还没有留言。有问题？发给工作室吧。'
};

const en = {
  'app.name': 'StarCull',
  'tab.home': 'Gallery',
  'tab.draw': 'Draw',
  'tab.message': 'Message',
  'tab.mine': 'Mine',

  'home.title': 'Works',
  'home.all': 'All',

  'product.series': 'Series',
  'product.note': 'About this piece',
  'product.star': 'Collect',
  'product.starred': 'Collected',
  'product.like': 'Like',
  'product.dislike': 'Not interested',
  'product.draw': 'Try your luck',

  'draw.title': 'Draw',
  'draw.points': 'Points',
  'draw.free': 'Free draw',
  'draw.paid': '50 points per draw',
  'draw.rolling': 'Drawing...',
  'draw.youWin': 'You won!',
  'draw.noWin': 'No prize this time. Try again?',
  'draw.upgrade': 'Upgrade to framed — 300 pts',
  'draw.address': 'Shipping address',
  'draw.noPrize': 'No prize — no address needed',

  'draw.status.pending': 'No address',
  'draw.status.preparing': 'Preparing',
  'draw.status.shipped': 'Shipped',
  'draw.status.done': 'Completed',

  'shipping.name': 'Recipient',
  'shipping.phone': 'Phone',
  'shipping.email': 'Email (optional)',
  'shipping.address1': 'Address',
  'shipping.address2': 'Address line 2 (optional)',
  'shipping.city': 'City',
  'shipping.state': 'State / Province',
  'shipping.zip': 'Postal code',
  'shipping.country': 'Country',
  'shipping.save': 'Save address',

  'mine.title': 'My Account',
  'mine.points': 'Points',
  'mine.login': 'Sign in / Register',
  'mine.logout': 'Sign out',
  'mine.drawRecords': 'Draw records',
  'mine.noDraws': 'No draws yet',
  'mine.security': 'Security question',
  'mine.setSecurity': 'Set security question',
  'mine.language': 'Language',

  'login.title': 'Sign in to StarCull',
  'login.register': 'Create a new account',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.btn': 'Sign in',
  'login.registerBtn': 'Register',
  'login.forgot': 'Forgot password?',
  'login.toLogin': 'Have an account? Sign in',
  'login.toRegister': "Don't have one? Register",

  'login.securityQuestion': 'Security question',
  'login.securityAnswer': 'Answer',
  'login.securityAnswerHint': '⚠️ This is your ONLY way to recover your password. Answer carefully!',

  'recover.title': 'Reset password',
  'recover.username': 'Your username',
  'recover.next': 'Next',
  'recover.answer': 'Answer your security question',
  'recover.newPassword': 'New password (min. 6 chars)',
  'recover.submit': 'Reset password',

  'message.title': 'Messages',
  'message.placeholder': 'Type a message...',
  'message.send': 'Send',
  'message.noMessages': 'No messages yet. Drop the studio a line!'
};

const dicts = { zh, en };

function t(key, lang) {
  const l = lang || getApp().globalData.language || 'zh';
  return (dicts[l] && dicts[l][key]) || dicts.zh[key] || key;
}

function label(textZh, textEn, lang) {
  // Handy for inline bilingual fields like product titles
  const l = lang || getApp().globalData.language || 'zh';
  if (l === 'en' && textEn) return textEn;
  return textZh || textEn || '';
}

module.exports = { t, label };
