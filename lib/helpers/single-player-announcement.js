'use strict';
const logger = require('sonos-discovery/lib/helpers/logger');
const isRadioOrLineIn = require('../helpers/is-radio-or-line-in');

// Per-player queue of backup presets for concurrent announcement handling.
// Using a module-level Map is intentional — it tracks in-flight announcements
// across concurrent calls on the same player so restore logic can safely
// skip intermediate restores when multiple sayare queued.
// The Map is cleaned up after each player's queue drains to zero.
const playerQueues = new Map();

function getQueue(roomName) {
  if (!playerQueues.has(roomName)) {
    playerQueues.set(roomName, []);
  }
  return playerQueues.get(roomName);
}

function releaseQueue(roomName) {
  // Clean up the Map entry once the queue is empty to avoid unbounded growth
  if (playerQueues.has(roomName) && playerQueues.get(roomName).length === 0) {
    playerQueues.delete(roomName);
  }
}

function singlePlayerAnnouncement(player, uri, volume, duration) {
  // Create backup preset to restore this player
  const state = player.state;
  const system = player.system;
  const roomName = player.roomName;

  const backupPreset = {
    players: [
      { roomName, volume: state.volume }
    ]
  };

  if (player.coordinator.uuid === player.uuid) {
    // This player is coordinator — remember which group it was part of
    const group = system.zones.find(zone => zone.coordinator.uuid === player.coordinator.uuid);
    if (group.members.length > 1) {
      logger.debug('Think its coordinator, will find uri later');
      backupPreset.group = group.id;
    } else {
      // Was stand-alone, so keep full state
      backupPreset.state = state.playbackState;
      backupPreset.uri = player.avTransportUri;
      backupPreset.metadata = player.avTransportUriMetadata;
      backupPreset.playMode = {
        repeat: state.playMode.repeat
      };

      if (!isRadioOrLineIn(backupPreset.uri)) {
        backupPreset.trackNo = state.trackNo;
        backupPreset.elapsedTime = state.elapsedTime;
      }
    }
  } else {
    // Was grouped — use group URI directly
    backupPreset.uri = `x-rincon:${player.coordinator.uuid}`;
  }

  logger.debug('backup state was', backupPreset);

  const ttsPreset = {
    players: [{ roomName, volume }],
    playMode: { repeat: false },
    uri
  };

  // Push this announcement's backup onto the player's queue.
  // If another announcement is already playing on this player, the queue
  // will have >1 entry; the intermediate restore is skipped and the last
  // announcement in the queue is responsible for the final restore.
  const queue = getQueue(roomName);
  queue.unshift(backupPreset);
  logger.debug('backup presets array', queue);

  const prepareBackupPreset = () => {
    const currentQueue = getQueue(roomName);

    if (currentQueue.length > 1) {
      // Another announcement is queued behind this one — skip restore,
      // just remove our entry and let the next one handle it
      currentQueue.shift();
      logger.debug('more than 1 backup presets during prepare', currentQueue);
      releaseQueue(roomName);
      return Promise.resolve();
    }

    if (currentQueue.length < 1) {
      releaseQueue(roomName);
      return Promise.resolve();
    }

    const relevantBackupPreset = currentQueue[0];
    logger.debug('exactly 1 preset left', relevantBackupPreset);

    if (relevantBackupPreset.group) {
      const zone = system.zones.find(z => z.id === relevantBackupPreset.group);
      if (zone) {
        relevantBackupPreset.uri = `x-rincon:${zone.uuid}`;
      }
    }

    logger.debug('applying preset', relevantBackupPreset);
    return system.applyPreset(relevantBackupPreset)
      .then(() => {
        currentQueue.shift();
        logger.debug('after backup preset applied', currentQueue);
        releaseQueue(roomName);
      });
  };

  let abortTimer;
  let timer;
  const restoreTimeout = duration + 2000;

  return system.applyPreset(ttsPreset)
    .then(() => {
      return new Promise((resolve) => {
        const transportChange = (state) => {
          logger.debug(`Player changed to state ${state.playbackState}`);
          if (state.playbackState === 'STOPPED') {
            return resolve();
          }
          player.once('transport-state', transportChange);
        };
        setTimeout(() => {
          player.once('transport-state', transportChange);
        }, duration / 2);

        logger.debug(`Setting restore timer for ${restoreTimeout} ms`);
        timer = Date.now();
        abortTimer = setTimeout(resolve, restoreTimeout);
      });
    })
    .then(() => {
      const elapsed = Date.now() - timer;
      logger.debug(`${elapsed} elapsed with ${restoreTimeout - elapsed} to spare`);
      clearTimeout(abortTimer);
    })
    .then(prepareBackupPreset)
    .catch((err) => {
      logger.error(err);
      return prepareBackupPreset()
        .then(() => {
          throw err;
        });
    });
}

module.exports = singlePlayerAnnouncement;
