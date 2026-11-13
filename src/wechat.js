'use strict';
/* StarCull · 微信层：jscode2session 用 code 换 openid / unionid / session_key */

const https = require('https');
const { WECHAT_APPID, WECHAT_SECRET } = require('./config');

/**
 * 用小程序端 wx.login() 返回的 code，向微信服务器换取 openid / session_key。
 * 返回 { openid, session_key, unionid }（unionid 可能为空）或抛出带 errmsg 的 Error。
 */
function code2session(code) {
  return new Promise((resolve, reject) => {
    if (!WECHAT_APPID || !WECHAT_SECRET) {
      const err = new Error('WeChat is not configured on the server.');
      err.code = 'WECHAT_NOT_CONFIGURED';
      return reject(err);
    }
    if (!code || typeof code !== 'string') {
      return reject(new Error('Missing code from wx.login().'));
    }

    const url = 'https://api.weixin.qq.com/sns/jscode2session'
      + '?appid=' + encodeURIComponent(WECHAT_APPID)
      + '&secret=' + encodeURIComponent(WECHAT_SECRET)
      + '&js_code=' + encodeURIComponent(code)
      + '&grant_type=authorization_code';

    https.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.errcode) {
            const err = new Error(data.errmsg || 'WeChat jscode2session failed.');
            err.code = 'WECHAT_' + data.errcode;
            return reject(err);
          }
          if (!data.openid) {
            return reject(new Error('WeChat returned no openid.'));
          }
          resolve({
            openid: data.openid,
            session_key: data.session_key,
            unionid: data.unionid || ''
          });
        } catch (e) {
          reject(new Error('Failed to parse WeChat response.'));
        }
      });
    }).on('error', (e) => reject(e));
  });
}

module.exports = { code2session };
