#!/usr/bin/env node
'use strict';
// Patches sonos-discovery after npm install to fix two Node 20+ compatibility issues.
// Both patches are idempotent and safe to run repeatedly.

const fs = require('fs');
const path = require('path');
const baseDir = path.join(__dirname, '..', 'node_modules', 'sonos-discovery', 'lib');

// ─── Patch 1: Disable HTTP keep-alive in request.js ──────────────────────────
// Sonos players don't support keep-alive. Node 20+ enables it by default,
// causing subsequent requests over reused sockets to time out.
// Equivalent to the fix in jishi/node-sonos-discovery v1.8.0.

const requestPath = path.join(baseDir, 'helpers', 'request.js');

if (!fs.existsSync(requestPath)) {
  console.log('patch-sonos-discovery: request.js not found, skipping patch 1');
} else {
  let src = fs.readFileSync(requestPath, 'utf8');

  if (src.includes('keepAlive: false')) {
    console.log('patch-sonos-discovery: patch 1 (keep-alive) already applied, skipping');
  } else {
    src = src.replace(
      `'use strict';\nconst http = require('http');\nconst https = require('https');\nconst url = require('url');`,
      `'use strict';\nconst http = require('http');\nconst https = require('https');\nconst url = require('url');\n\n// Disable keep-alive: Sonos players close connections after each response.\n// Node 20+ keep-alive default causes socket reuse timeouts on these devices.\nconst httpAgent  = new http.Agent({ keepAlive: false });\nconst httpsAgent = new https.Agent({ keepAlive: false });`
    );

    src = src.replace(
      `    let requestOptions = {\n      method: options.method || 'GET',\n      path: uri.path,\n      host: uri.hostname,\n      port: uri.port * 1 || defaultPort\n    };`,
      `    let requestOptions = {\n      method: options.method || 'GET',\n      path: uri.path,\n      host: uri.hostname,\n      port: uri.port * 1 || defaultPort,\n      agent: uri.protocol === 'https:' ? httpsAgent : httpAgent\n    };`
    );

    fs.writeFileSync(requestPath, src, 'utf8');
    console.log('patch-sonos-discovery: patch 1 (keep-alive) applied successfully');
  }
}

// ─── Patch 2: Parallel volume setting in applyPreset.js ──────────────────────
// setVolume() used a serial reduce chain — 5 players = 5 sequential round-trips.
// On Node 20+ with tighter socket handling, one slow player times out the chain.
// Fix: run all volume/mute changes in parallel with Promise.all, with individual
// per-player catch so a single slow player doesn't abort the entire preset.

const applyPresetPath = path.join(baseDir, 'prototypes', 'SonosSystem', 'applyPreset.js');

if (!fs.existsSync(applyPresetPath)) {
  console.log('patch-sonos-discovery: applyPreset.js not found, skipping patch 2');
} else {
  let src = fs.readFileSync(applyPresetPath, 'utf8');

  if (src.includes('Promise.all(promises)')) {
    console.log('patch-sonos-discovery: patch 2 (parallel volume) already applied, skipping');
  } else {
    const oldSetVolume = `function setVolume(system, playerPresets) {
  let initialPromise = Promise.resolve();

  return playerPresets.reduce((promise, playerInfo) => {
    let player = system.getPlayer(playerInfo.roomName);
    if (!player) {
      return promise;
    }

    return promise.then(() => {
      if (playerInfo.hasOwnProperty('volume')) {
        logger.debug(\`setting volume \${playerInfo.volume} on \${player.roomName}\`);
        return player.setVolume(playerInfo.volume);
      }
    })
      .then(() => {
        if (playerInfo.hasOwnProperty('mute')) {
          logger.debug(\`setting mute state \${playerInfo.mute} on \${player.roomName}\`);
          const muteFunc = playerInfo.mute ? player.mute.bind(player) : player.unMute.bind(player);
          return muteFunc();
        }
      });
  }, initialPromise);
}`;

    const newSetVolume = `function setVolume(system, playerPresets) {
  // Run volume/mute changes in parallel — they are independent per player.
  // A single slow player will no longer block or time out the entire preset.
  const promises = playerPresets.map((playerInfo) => {
    const player = system.getPlayer(playerInfo.roomName);
    if (!player) return Promise.resolve();

    let promise = Promise.resolve();

    if (playerInfo.hasOwnProperty('volume')) {
      logger.debug(\`setting volume \${playerInfo.volume} on \${player.roomName}\`);
      promise = promise.then(() => player.setVolume(playerInfo.volume))
        .catch((err) => logger.warn(\`setVolume failed for \${player.roomName}: \${err.message}\`));
    }

    if (playerInfo.hasOwnProperty('mute')) {
      logger.debug(\`setting mute state \${playerInfo.mute} on \${player.roomName}\`);
      const muteFunc = playerInfo.mute ? player.mute.bind(player) : player.unMute.bind(player);
      promise = promise.then(() => muteFunc())
        .catch((err) => logger.warn(\`setMute failed for \${player.roomName}: \${err.message}\`));
    }

    return promise;
  });

  return Promise.all(promises);
}`;

    if (!src.includes(oldSetVolume)) {
      console.log('patch-sonos-discovery: patch 2 source pattern not found — may already be modified');
    } else {
      src = src.replace(oldSetVolume, newSetVolume);
      fs.writeFileSync(applyPresetPath, src, 'utf8');
      console.log('patch-sonos-discovery: patch 2 (parallel volume) applied successfully');
    }
  }
}
