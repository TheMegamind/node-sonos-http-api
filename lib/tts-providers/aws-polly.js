'use strict';
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const fileDuration = require('../helpers/file-duration');
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

  // Construct a filesystem neutral filename
  const dynamicParameters = { Text: phrase };
  const synthesizeParameters = Object.assign({}, DEFAULT_SETTINGS, dynamicParameters);
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

  const phraseHash = crypto.createHash('sha1').update(phrase).digest('hex');
  const filename = `polly-${phraseHash}-${synthesizeParameters.VoiceId}.mp3`;
  const filepath = path.resolve(settings.webroot, 'tts', filename);

  const expectedUri = `/tts/${filename}`;
  try {
    fs.accessSync(filepath, fs.R_OK);
    return fileDuration(filepath)
      .then((duration) => {
        return {
          duration,
          uri: expectedUri
        };
      });
  } catch (err) {
    logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);
  }

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
      // v3 returns AudioStream as a web ReadableStream; collect chunks into a Buffer
      return new Promise((resolve, reject) => {
        const chunks = [];
        data.AudioStream.on('data', (chunk) => chunks.push(chunk));
        data.AudioStream.on('end', () => resolve(Buffer.concat(chunks)));
        data.AudioStream.on('error', reject);
      });
    })
    .then((audioBuffer) => {
      fs.writeFileSync(filepath, audioBuffer);
      return fileDuration(filepath);
    })
    .then((duration) => {
      return {
        duration,
        uri: expectedUri
      };
    });
}

module.exports = polly;
