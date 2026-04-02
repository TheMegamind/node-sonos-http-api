'use strict';
const ElevenLabs = require('elevenlabs-node');
const { getTTSCache, checkTTSCache, resolveTTSFile } = require('../helpers/tts-cache');
const settings = require('../../settings');
const logger = require('sonos-discovery/lib/helpers/logger');

const DEFAULT_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.5,
  speakerBoost: true,
  style: 1,
  modelId: 'eleven_multilingual_v2'
};

// Provider developed based on structure from aws-polly.js.
// In this tts provider the language argument from the URI is used to inject a custom voiceId.
function eleven(phrase, voiceId) {
  if (!settings.elevenlabs) {
    return Promise.resolve();
  }

  const synthesizeParameters = Object.assign({}, DEFAULT_SETTINGS, { textInput: phrase }, settings.elevenlabs.config);

  if (voiceId) {
    synthesizeParameters.voiceId = voiceId;
  }

  if (!synthesizeParameters.voiceId) {
    logger.error('ElevenLabs: Voice ID not found in settings.elevenlabs.config or in request URL');
    return Promise.resolve();
  }

  const { filepath, uri } = getTTSCache('elevenlabs', phrase, synthesizeParameters.voiceId);
  const cached = checkTTSCache(filepath, uri);
  if (cached) return cached;

  logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);

  synthesizeParameters.fileName = filepath;

  const voice = new ElevenLabs({ apiKey: settings.elevenlabs.auth.apiKey });

  return voice.textToSpeech(synthesizeParameters)
    .then(() => {
      logger.info('ElevenLabs TTS generated new audio file.');
      return resolveTTSFile(filepath, uri);
    });
}

module.exports = eleven;
