'use strict';
const { execFile } = require('child_process');
const { getTTSCache, checkTTSCache, resolveTTSFile } = require('../helpers/tts-cache');
const settings = require('../../settings');
const logger = require('sonos-discovery/lib/helpers/logger');

function macSay(phrase, voice) {
  if (!settings.macSay) {
    return Promise.resolve();
  }

  const selectedRate = settings.macSay.rate || 'default';
  const selectedVoice = voice || settings.macSay.voice;

  // Use rate and voice as discriminator so different settings get separate cache files
  const discriminator = `${selectedRate}-${selectedVoice || 'default'}`;
  const { filepath, uri } = getTTSCache('macSay', phrase, discriminator);
  // mac-os generates .m4a, not .mp3 — override the extension from tts-cache
  const m4aFilepath = filepath.replace(/\.mp3$/, '.m4a');
  const m4aUri = uri.replace(/\.mp3$/, '.m4a');

  const cached = checkTTSCache(m4aFilepath, m4aUri);
  if (cached) return cached;

  logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);

  // Build args array for execFile to avoid shell injection
  // For more information on the "say" command, type "man say" in Terminal
  const args = [];
  if (selectedVoice) { args.push('-v', selectedVoice); }
  if (selectedRate && selectedRate !== 'default') { args.push('-r', String(selectedRate)); }
  args.push(phrase, '-o', m4aFilepath);

  return new Promise((resolve, reject) => {
    execFile('say', args, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(m4aUri);
      }
    });
  })
    .then(() => resolveTTSFile(m4aFilepath, m4aUri));
}

module.exports = macSay;
