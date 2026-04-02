'use strict';
const isRadioOrLineIn = require('./is-radio-or-line-in');

// Captures a snapshot of all zones so they can be restored after an announcement.
// Returns an array of preset objects sorted largest group first.
function saveAllZones(system) {
  const backupPresets = system.zones.map((zone) => {
    const coordinator = zone.coordinator;
    const state = coordinator.state;
    const preset = {
      players: [
        { roomName: coordinator.roomName, volume: state.volume }
      ],
      state: state.playbackState,
      uri: coordinator.avTransportUri,
      metadata: coordinator.avTransportUriMetadata,
      playMode: {
        repeat: state.playMode.repeat
      }
    };

    if (!isRadioOrLineIn(preset.uri)) {
      preset.trackNo = state.trackNo;
      preset.elapsedTime = state.elapsedTime;
    }

    zone.members.forEach((player) => {
      if (coordinator.uuid !== player.uuid) {
        preset.players.push({ roomName: player.roomName, volume: player.state.volume });
      }
    });

    return preset;
  });

  return backupPresets.sort((a, b) => {
    return a.players.length < b.players.length ? 1 : -1;
  });
}

module.exports = saveAllZones;
