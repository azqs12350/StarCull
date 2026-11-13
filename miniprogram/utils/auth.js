// utils/auth.js — Token / 用户信息本地缓存 & 登录态检查

const TOKEN_KEY = 'sc_token';
const USER_KEY = 'sc_user';

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token);
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
}

// 缓存用户信息，用于「我的」页首屏直接渲染，避免先闪未登录
function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch (e) {
    return null;
  }
}

function setUser(user) {
  try {
    if (user) wx.setStorageSync(USER_KEY, user);
    else wx.removeStorageSync(USER_KEY);
  } catch (e) {}
}

function clearUser() {
  try {
    wx.removeStorageSync(USER_KEY);
  } catch (e) {}
}

function isLoggedIn() {
  return !!getToken();
}

module.exports = {
  getToken,
  setToken,
  clearToken,
  getUser,
  setUser,
  clearUser,
  isLoggedIn
};
