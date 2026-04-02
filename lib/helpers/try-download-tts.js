'use strict';
const path = require('path');
const requireDir = require('sonos-discovery/lib/helpers/require-dir');
const providers = [];

requireDir(path.join(__dirname, '../tts-providers'), (provider) => {
  providers.push(provider);
});

providers.push(require('../tts-providers/default/google'));

function tryDownloadTTS(phrase, language) {
  let result;
  return providers.reduce((promise, provider) => {
    return promise.then(() => {
      if (result) return result;
      return provider(phrase, language)
        .then((_result) => {
          result = _result;
          return result;
        });
      });
  }, Promise.resolve())
  .then((result) => {
    if (!result) {
      return Promise.reject(new Error('No TTS provider returned a result. Check that a TTS provider is configured in settings.json.'));
    }
    return result;
  });
}

module.exports = tryDownloadTTS;