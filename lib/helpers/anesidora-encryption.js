'use strict';
// Pure-JS Blowfish implementation via blowfish-node, replacing the original
// OpenSSL-based implementation which broke on Node 18+ (OpenSSL 3 dropped bf-ecb).
const Blowfish = require('blowfish-node');

exports.decrypt = function(password, ciphered) {
  const bf = new Blowfish(password, Blowfish.MODE.ECB, Blowfish.PADDING.NULL);
  const decrypted = bf.decode(Buffer.from(ciphered, 'hex'), Blowfish.TYPE.UINT8_ARRAY);
  return Buffer.from(decrypted);
};

exports.encrypt = function(password, plain) {
  const bf = new Blowfish(password, Blowfish.MODE.ECB, Blowfish.PADDING.NULL);
  const encrypted = bf.encode(plain);
  return Buffer.from(encrypted);
};
