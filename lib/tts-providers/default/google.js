'use strict';
const fs = require('fs');
const http = require('http');
const { getTTSCache, checkTTSCache, resolveTTSFile } = require('../../helpers/tts-cache');
const settings = require('../../../settings');
const logger = require('sonos-discovery/lib/helpers/logger');

function google(phrase, language) {
  if (!language) {
    language = 'en';
  }

  const { filepath, uri } = getTTSCache('google', phrase, language);
  const cached = checkTTSCache(filepath, uri);
  if (cached) return cached;

  logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);

  // Use Google TTS translation service to create a mp3 file
  const options = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36' },
    host: 'translate.google.com',
    path: '/translate_tts?client=tw-ob&tl=' + language + '&q=' + encodeURIComponent(phrase)
  };

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    http.request(options, (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        response.pipe(file);
        file.on('finish', () => {
          file.end();
          resolve(uri);
        });
      } else {
        reject(new Error(`Download from google TTS failed with status ${response.statusCode}, ${response.message}`));
      }
    }).on('error', (err) => {
      reject(err);
    }).end();
  })
    .then(() => resolveTTSFile(filepath, uri));
}

module.exports = google;
