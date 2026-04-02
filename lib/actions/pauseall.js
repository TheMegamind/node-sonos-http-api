'use strict';
const logger = require('sonos-discovery/lib/helpers/logger');

let pausedPlayers = [];

function pauseAll(player, values) {
  logger.debug('pausing all players');

  if (values[0] && values[0] > 0) {
    logger.debug('in', values[0], 'minutes');
    setTimeout(() => doPauseAll(player.system), values[0] * 1000 * 60);
    return Promise.resolve();
  }

  return doPauseAll(player.system);
}

function resumeAll(player, values) {
  logger.debug('resuming all players');

  if (values[0] && values[0] > 0) {
    logger.debug('in', values[0], 'minutes');
    setTimeout(() => doResumeAll(player.system), values[0] * 1000 * 60);
    return Promise.resolve();
  }

  return doResumeAll(player.system);
}

function doPauseAll(system) {
  if (pausedPlayers.length > 0) {
    logger.warn('pauseall called while already paused — previous pause state will be overwritten');
  }

  pausedPlayers = [];
  const promises = system.zones
    .filter(zone => zone.coordinator.state.playbackState === 'PLAYING')
    .map(zone => {
      pausedPlayers.push(zone.uuid);
      return system.getPlayerByUUID(zone.uuid).pause();
    });

  return Promise.all(promises);
}

function doResumeAll(system) {
  const promises = pausedPlayers.map(uuid => {
    const player = system.getPlayerByUUID(uuid);
    return player.play();
  });

  // Clear the pause state to prevent a second resumeall from causing issues
  pausedPlayers = [];

  return Promise.all(promises);
}

module.exports = function (api) {
  api.registerAction('pauseall', pauseAll);
  api.registerAction('resumeall', resumeAll);
};
