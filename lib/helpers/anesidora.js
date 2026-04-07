'use strict';
// Vendored from dlom/anesidora@1.2.1 — replaced `request` with `got` (v11),
// removed `underscore` dependency, replaced deprecated new Buffer() calls,
// replaced OpenSSL Blowfish (dropped in Node 18+) with blowfish-node (pure JS).
var got = require('got');
var encryption = require('./anesidora-encryption');

var Anesidora = (function() {
  var Anesidora = function(username, password, partnerInfo) {
    if (partnerInfo == null) {
      partnerInfo = {
        'username': 'android',
        'password': 'AC7IBG09A3DTSYM4R41UJWL07VLN8JI7',
        'deviceModel': 'android-generic',
        'decryptPassword': 'R=U!LH$O2B#',
        'encryptPassword': '6#26FRL$ZWD'
      };
    }
    this.username = username;
    this.password = password;
    this.partnerInfo = Object.assign({}, partnerInfo, { 'version': '5' });
    this.authData = null;
  };

  Anesidora.ENDPOINT = '://tuner.pandora.com/services/json/';
  var endpoint = function(secure) {
    return (secure ? 'https' : 'http') + Anesidora.ENDPOINT;
  };

  var seconds = function() {
    return Date.now() / 1000 | 0;
  };

  // Omit specified keys from an object (replaces _.omit)
  var omit = function(obj, keys) {
    var result = Object.assign({}, obj);
    keys.forEach(function(key) { delete result[key]; });
    return result;
  };

  var pandoraPost = function(url, qs, body) {
    return got.post(url, {
      searchParams: qs,
      body: body,
    }).then(function(res) {
      var parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
      if (parsed.stat === 'fail') {
        throw new Error(parsed.message + ' [' + parsed.code + ']');
      } else if (parsed.stat === 'ok') {
        return parsed.result;
      } else {
        throw new Error('Unknown error');
      }
    });
  };

  var decryptSyncTime = function(password, ciphered) {
    return parseInt(encryption.decrypt(password, ciphered).toString('utf8', 4, 14), 10);
  };

  var partnerLogin = function(partnerInfo) {
    return pandoraPost(
      endpoint(true),
      { method: 'auth.partnerLogin' },
      JSON.stringify(omit(partnerInfo, ['decryptPassword', 'encryptPassword']))
    ).then(function(result) {
      result.syncTimeOffset = decryptSyncTime(partnerInfo.decryptPassword, result.syncTime) - seconds();
      return result;
    });
  };

  var userLogin = function(encryptPassword, partnerData, username, password) {
    return pandoraPost(
      endpoint(true),
      {
        method: 'auth.userLogin',
        auth_token: partnerData.partnerAuthToken,
        partner_id: partnerData.partnerId
      },
      encryption.encrypt(encryptPassword, JSON.stringify({
        'loginType': 'user',
        'username': username,
        'password': password,
        'partnerAuthToken': partnerData.partnerAuthToken,
        'syncTime': partnerData.syncTimeOffset + seconds()
      })).toString('hex').toLowerCase()
    );
  };

  // Promisified login — also exposes legacy callback form for pandora.js compatibility
  Anesidora.prototype.login = function(callback) {
    var that = this;
    var promise = partnerLogin(that.partnerInfo)
      .then(function(partner) {
        return userLogin(that.partnerInfo.encryptPassword, partner, that.username, that.password)
          .then(function(user) {
            that.authData = {
              'userAuthToken': user.userAuthToken,
              'partnerId': partner.partnerId,
              'userId': user.userId,
              'syncTimeOffset': partner.syncTimeOffset
            };
          });
      });

    if (typeof callback === 'function') {
      promise.then(function() { callback(null); }).catch(callback);
    }
    return promise;
  };

  // Promisified request — also exposes legacy callback form for pandora.js compatibility
  Anesidora.prototype.request = function(method, data, callback) {
    var that = this;
    if (typeof data === 'function' && callback == null) {
      callback = data;
      data = {};
    }

    if (that.authData == null) {
      var err = new Error('Not authenticated with Pandora (call login() before request())');
      if (typeof callback === 'function') return callback(err);
      return Promise.reject(err);
    }

    var secure = (method === 'station.getPlaylist');
    var body = Object.assign({}, data, {
      'userAuthToken': that.authData.userAuthToken,
      'syncTime': that.authData.syncTimeOffset + seconds()
    });
    var encryptedBody = encryption.encrypt(
      that.partnerInfo.encryptPassword,
      JSON.stringify(body)
    ).toString('hex').toLowerCase();

    if (method === 'test.checkLicensing') encryptedBody = null;

    var promise = pandoraPost(
      endpoint(secure),
      {
        method: method,
        auth_token: that.authData.userAuthToken,
        partner_id: that.authData.partnerId,
        user_id: that.authData.userId
      },
      encryptedBody
    );

    if (typeof callback === 'function') {
      promise.then(function(result) { callback(null, result); }).catch(callback);
    }
    return promise;
  };

  return Anesidora;
})();

module.exports = Anesidora;
