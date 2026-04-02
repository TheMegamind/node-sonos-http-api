'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fileDuration = require('./file-duration');
const settings = require('../../settings');

// Builds a provider-specific cache filename and checks if it already exists.
// If cached, resolves with { uri, duration } immediately.
// If not cached, resolves with null so the caller can download and then call
// resolveTTSFile(filepath, expectedUri) to get the final result.
function getTTSCache(provider, phrase, discriminator) {
  const phraseHash = crypto.createHash('sha1').update(phrase).digest('hex');
  const filename = `${provider}-${phraseHash}-${discriminator}.mp3`;
  const filepath = path.resolve(settings.webroot, 'tts', filename);
  const uri = `/tts/${filename}`;

  return { filepath, uri };
}

// After a TTS file has been written to disk, call this to get the standard
// { duration, uri } result object.
function resolveTTSFile(filepath, uri) {
  return fileDuration(filepath)
    .then((duration) => ({ duration, uri }));
}

// Check whether a TTS file is already cached. Returns a Promise that resolves
// with { duration, uri } if cached, or null if not.
function checkTTSCache(filepath, uri) {
  try {
    fs.accessSync(filepath, fs.R_OK);
    return resolveTTSFile(filepath, uri);
  } catch (err) {
    return null;
  }
}

module.exports = { getTTSCache, checkTTSCache, resolveTTSFile };
