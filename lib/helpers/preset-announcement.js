'use strict';
const logger = require('sonos-discovery/lib/helpers/logger');
const saveAllZones = require('./save-all-zones');

function announcePreset(system, uri, preset, duration) {
  let abortTimer;

  // Save all players
  const backupPresets = saveAllZones(system);

  const simplifiedPreset = {
    uri,
    players: preset.players,
    playMode: preset.playMode,
    pauseOthers: true,
    state: 'STOPPED'
  };

  function hasReachedCorrectTopology(zones) {
    return zones.some(group =>
    group.members.length === preset.players.length &&
    group.coordinator.roomName === preset.players[0].roomName);
  }

  const TOPOLOGY_TIMEOUT_MS = 10000;

  const oneGroupPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for preset group topology to form'));
    }, TOPOLOGY_TIMEOUT_MS);

    const onTopologyChanged = (topology) => {
      if (hasReachedCorrectTopology(topology)) {
        clearTimeout(timer);
        return resolve();
      }
      // Not one group yet, continue listening
      system.once('topology-change', onTopologyChanged);
    };

    system.once('topology-change', onTopologyChanged);
  });

  const restoreTimeout = duration + 2000;
  const coordinator = system.getPlayer(preset.players[0].roomName);
  return coordinator.pause()
    .then(() => system.applyPreset(simplifiedPreset))
    .catch(() => system.applyPreset(simplifiedPreset))
    .then(() => {
      if (hasReachedCorrectTopology(system.zones)) return;
      return oneGroupPromise;
    })
    .then(() => {
      coordinator.play();
      return new Promise((resolve) => {
        const transportChange = (state) => {
          logger.debug(`Player changed to state ${state.playbackState}`);
          if (state.playbackState === 'STOPPED') {
            return resolve();
          }

          coordinator.once('transport-state', transportChange);
        };
        setTimeout(() => {
          coordinator.once('transport-state', transportChange);
        }, duration / 2);
        logger.debug(`Setting restore timer for ${restoreTimeout} ms`);
        abortTimer = setTimeout(resolve, restoreTimeout);
      });
    })
    .then(() => {
      clearTimeout(abortTimer);
    })
    .then(() => {
      return backupPresets.reduce((promise, preset) => {
        logger.trace('Restoring preset', preset);
        return promise.then(() => system.applyPreset(preset));
      }, Promise.resolve());
    })
    .catch((err) => {
      logger.error(err.stack);
      throw err;
    });

}

module.exports = announcePreset;