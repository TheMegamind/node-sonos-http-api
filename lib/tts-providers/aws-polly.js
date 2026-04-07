'use strict';
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { getTTSCache, checkTTSCache, resolveTTSFile } = require('../helpers/tts-cache');
const settings = require('../../settings');
const logger = require('sonos-discovery/lib/helpers/logger');

const DEFAULT_SETTINGS = {
  OutputFormat: 'mp3',
  VoiceId: 'Joanna',
  TextType: 'text'
};

function polly(phrase, voiceName) {
  if (!settings.aws) {
    return Promise.resolve();
  }

  const synthesizeParameters = Object.assign({}, DEFAULT_SETTINGS, { Text: phrase });
  if (settings.aws.name) {
    synthesizeParameters.VoiceId = settings.aws.name;
  }
  if (voiceName) {
    synthesizeParameters.VoiceId = voiceName;
  }
  if (synthesizeParameters.VoiceId.endsWith('Neural')) {
    synthesizeParameters.Engine = 'neural';
    synthesizeParameters.VoiceId = synthesizeParameters.VoiceId.slice(0, -6);
  }

  const { filepath, uri } = getTTSCache('polly', phrase, synthesizeParameters.VoiceId);
  const cached = checkTTSCache(filepath, uri);
  if (cached) return cached;

  logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);

  // v3 SDK: build client config from settings.aws.credentials.
  // accessKeyId/secretAccessKey must be nested under 'credentials'; region is top-level.
  const { region, accessKeyId, secretAccessKey } = settings.aws.credentials || {};
  const clientConfig = {};
  if (region) clientConfig.region = region;
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }
  const client = new PollyClient(clientConfig);

  return client.send(new SynthesizeSpeechCommand(synthesizeParameters))
    .then((data) => {
      // v3 returns AudioStream as a Node.js Readable; collect chunks into a Buffer
      return new Promise((resolve, reject) => {
        const chunks = [];
        data.AudioStream.on('data', (chunk) => chunks.push(chunk));
        data.AudioStream.on('end', () => resolve(Buffer.concat(chunks)));
        data.AudioStream.on('error', reject);
      });
    })
    .then((audioBuffer) => {
      require('fs').writeFileSync(filepath, audioBuffer);
      return resolveTTSFile(filepath, uri);
    });
}

module.exports = polly;
