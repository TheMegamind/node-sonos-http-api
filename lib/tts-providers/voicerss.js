'use strict';
const fs = require('fs');
const http = require('http');
const { getTTSCache, checkTTSCache, resolveTTSFile } = require('../helpers/tts-cache');
const settings = require('../../settings');

function voicerss(phrase, language) {
  if (!settings.voicerss) {
    return Promise.resolve();
  }

  if (!language) {
    language = 'en-gb';
  }

  // Use voicerss tts translation service to create a mp3 file
  // Option "c=MP3" added. Otherwise a WAV file is created that won't play on Sonos.
  const ttsRequestUrl = `http://api.voicerss.org/?key=${settings.voicerss}&f=22khz_16bit_mono&hl=${language}&src=${encodeURIComponent(phrase)}&c=MP3`;

  const { filepath, uri } = getTTSCache('voicerss', phrase, language);
  const cached = checkTTSCache(filepath, uri);
  if (cached) return cached;

  console.log(`announce file for phrase "${phrase}" does not seem to exist, downloading`);

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    http.get(ttsRequestUrl, (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        response.pipe(file);
        file.on('finish', () => {
          file.end();
          resolve(uri);
        });
      } else {
        reject(new Error(`Download from voicerss failed with status ${response.statusCode}, ${response.message}`));
      }
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  })
    .then(() => resolveTTSFile(filepath, uri));
}

module.exports = voicerss;
