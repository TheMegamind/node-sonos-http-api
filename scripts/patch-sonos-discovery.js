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

// ─── Patch 3: Retry + verify logic for groupWithCoordinator ──────────────────
// groupWithCoordinator() used a plain serial reduce with no error handling.
// If any single setAVTransport call timed out, that player was silently left
// ungrouped with no retry. Fix: add per-join retry (500ms delay), then a
// verification pass after all joins that re-attempts any stragglers.

if (!fs.existsSync(applyPresetPath)) {
  console.log('patch-sonos-discovery: applyPreset.js not found, skipping patch 3');
} else {
  let src = fs.readFileSync(applyPresetPath, 'utf8');

  if (src.includes('joinPlayerToCoordinator')) {
    console.log('patch-sonos-discovery: patch 3 (grouping retry) already applied, skipping');
  } else {
    const oldGroupWith = `function groupWithCoordinator(players) {
  let initialPromise = Promise.resolve();
  let coordinator = players[0];
  let groupingUri = \`x-rincon:\${coordinator.uuid}\`;

  // Skip first player since it is coordinator
  return players.slice(1)
    .reduce((promise, player) => {

      if (player.avTransportUri === groupingUri) {
        logger.debug(\`skipping grouping for \${player.roomName} because it is already grouped with coordinator\`);
        return promise;
      }

      logger.debug(\`adding \${player.roomName} to coordinator \${coordinator.roomName}\`);
      return promise.then(() => player.setAVTransport(groupingUri));
    }, initialPromise);
}`;

    const newGroupWith = `// Join a single player to a coordinator, with one automatic retry on failure.
function joinPlayerToCoordinator(player, groupingUri, retryDelayMs) {
  return player.setAVTransport(groupingUri)
    .catch((err) => {
      logger.warn(\`grouping failed for \${player.roomName}, retrying in \${retryDelayMs}ms: \${err.message}\`);
      return new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        .then(() => player.setAVTransport(groupingUri))
        .catch((err2) => logger.warn(\`grouping retry failed for \${player.roomName}: \${err2.message}\`));
    });
}

function groupWithCoordinator(players) {
  const coordinator = players[0];
  const groupingUri = \`x-rincon:\${coordinator.uuid}\`;
  const RETRY_DELAY_MS = 500;

  // Join players serially — Sonos rejects concurrent join requests to the
  // same coordinator. Each join gets one automatic retry on failure.
  const joinPromise = players.slice(1).reduce((promise, player) => {
    if (player.avTransportUri === groupingUri) {
      logger.debug(\`skipping grouping for \${player.roomName} because it is already grouped with coordinator\`);
      return promise;
    }

    logger.debug(\`adding \${player.roomName} to coordinator \${coordinator.roomName}\`);
    return promise.then(() => joinPlayerToCoordinator(player, groupingUri, RETRY_DELAY_MS));
  }, Promise.resolve());

  // After all joins, do a verification pass — retry any player that still
  // isn't showing the correct grouping URI.
  return joinPromise.then(() => {
    const stragglers = players.slice(1).filter((player) => {
      return player.avTransportUri !== groupingUri;
    });

    if (stragglers.length === 0) return Promise.resolve();

    logger.warn(\`\${stragglers.length} player(s) not yet grouped after initial pass, retrying: \${stragglers.map(p => p.roomName).join(', ')}\`);

    return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      .then(() => stragglers.reduce((promise, player) => {
        return promise.then(() => joinPlayerToCoordinator(player, groupingUri, RETRY_DELAY_MS));
      }, Promise.resolve()));
  });
}`;

    if (!src.includes(oldGroupWith)) {
      console.log('patch-sonos-discovery: patch 3 source pattern not found — may already be modified');
    } else {
      src = src.replace(oldGroupWith, newGroupWith);
      fs.writeFileSync(applyPresetPath, src, 'utf8');
      console.log('patch-sonos-discovery: patch 3 (grouping retry) applied successfully');
    }
  }
}

// ─── Patch 4: Guard against undefined coordinator in Player.js ───────────────
// During rapid grouping, volume-change notifications can arrive while a player's
// coordinator reference is transiently undefined (mid-topology-update).
// _this.coordinator.recalculateGroupVolume() throws, logging an unhandled ERROR.
// Fix: add a null guard so the call is skipped rather than crashing.

const playerPath = path.join(baseDir, 'models', 'Player.js');

if (!fs.existsSync(playerPath)) {
  console.log('patch-sonos-discovery: Player.js not found, skipping patch 4');
} else {
  let src = fs.readFileSync(playerPath, 'utf8');

  if (src.includes('if (_this.coordinator) _this.coordinator.recalculateGroupVolume')) {
    console.log('patch-sonos-discovery: patch 4 (coordinator null guard) already applied, skipping');
  } else if (!src.includes('_this.coordinator.recalculateGroupVolume()')) {
    console.log('patch-sonos-discovery: patch 4 source pattern not found — may already be modified');
  } else {
    src = src.replace(
      '      _this.coordinator.recalculateGroupVolume();',
      '      if (_this.coordinator) _this.coordinator.recalculateGroupVolume();'
    );
    fs.writeFileSync(playerPath, src, 'utf8');
    console.log('patch-sonos-discovery: patch 4 (coordinator null guard) applied successfully');
  }
}
