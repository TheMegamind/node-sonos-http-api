'use strict';
const Fuse = require('fuse.js');
const fs = require('fs');
const path = require('path');
const settings = require('../../settings');
const logger = require('sonos-discovery/lib/helpers/logger');
const shuffle = require('../helpers/shuffle');

const libraryPath = path.join(settings.cacheDir, 'library.json');
const randomQueueLimit = (settings.library && settings.library.randomQueueLimit !== undefined)
  ? settings.library.randomQueueLimit : 50;

let musicLibrary = null;
const currentLibVersion = 1.4;
let fuzzyTracks = null;
let fuzzyAlbums = null;
let isLoading = false;

const libraryDef = {
  country: '',
  search: { album: '', song: '', station: '' },
  metastart: { album: 'S:', song: 'S:', station: '' },
  parent: { album: 'A:ALBUMARTIST/', song: 'A:ALBUMARTIST/', station: '' },
  object: { album: 'item.audioItem.musicTrack', song: 'item.audioItem.musicTrack', station: '' },
  token: 'RINCON_AssociatedZPUDN',

  service:      setService,
  term:         getSearchTerm,
  tracks:       loadTracks,
  nolib:        libIsEmpty,
  read:         readLibrary,
  load:         loadLibrarySearch,
  searchlib:    searchLibrary,
  empty:        isEmpty,
  metadata:     getMetadata,
  urimeta:      getURIandMetadata,
  headers:      getTokenHeaders,
  authenticate: authenticateService
};

function getTokenHeaders() { return null; }
function authenticateService() { return Promise.resolve(); }
function setService() {}

function getSearchTerm(type, term, artist, album, track) {
  let newTerm = artist;
  if (newTerm !== '' && (artist !== '' || track !== '')) {
    newTerm += ' ';
  }
  newTerm += (type === 'album') ? album : track;
  return newTerm;
}

function getMetadata(type, id, name) {
  const token = libraryDef.token;
  const parentUri = libraryDef.parent[type] + name;
  const objectType = libraryDef.object[type];

  return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
          xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
          <item id="${id}" parentID="${parentUri}" restricted="true"><dc:title></dc:title><upnp:class>object.${objectType}</upnp:class>
          <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${token}</desc></item></DIDL-Lite>`;
}

function getURIandMetadata(type, resList) {
  return { uri: resList[0].uri, metadata: resList[0].metadata };
}

function loadTracks(type, tracksJson) {
  const tracks = { count: 0, isArtist: false, queueTracks: [] };

  if (tracksJson.length > 0) {
    const albumName = tracksJson[0].item.albumName;

    tracks.queueTracks = tracksJson.reduce((tracksArray, track) => {
      if (tracks.count >= randomQueueLimit) return tracksArray;

      let skip = false;
      if (type === 'song') {
        skip = tracksArray.some(t => t.trackName === track.item.trackName);
      } else {
        skip = (track.item.albumName !== albumName);
      }

      if (!skip) {
        tracksArray.push({
          trackName:        track.item.trackName,
          artistName:       track.item.artistName,
          albumTrackNumber: track.item.albumTrackNumber,
          uri:              track.item.uri,
          metadata:         track.item.metadata
        });
        tracks.count++;
      }
      return tracksArray;
    }, []);
  }

  if (type === 'album') {
    tracks.queueTracks.sort((a, b) => {
      if (a.artistName !== b.artistName) {
        return a.artistName > b.artistName ? 1 : -1;
      }
      return a.albumTrackNumber - b.albumTrackNumber;
    });
  }

  return tracks;
}

function libIsEmpty() { return (musicLibrary === null); }

function loadFuse(items, fuzzyKeys) {
  return Promise.resolve(new Fuse(items, { keys: fuzzyKeys, threshold: 0.2, maxPatternLength: 100, ignoreLocation: true }));
}

function isFinished(chunk) {
  return chunk.startIndex + chunk.numberReturned >= chunk.totalMatches;
}

function loadLibrary(player) {
  if (isLoading) {
    return Promise.resolve('Loading');
  }
  logger.info('Loading Library');
  isLoading = true;

  const library = {
    version: currentLibVersion,
    tracks: { items: [], startIndex: 0, numberReturned: 0, totalMatches: 1 }
  };

  const result = library.tracks;

  const getChunk = (chunk) => {
    chunk.items.forEach((item) => {
      if (item.uri !== undefined && item.artist !== undefined && item.album !== undefined) {
        const metadataID = libraryDef.metastart['song'] + item.uri.substring(item.uri.indexOf(':') + 1);
        const metadata = getMetadata('song', metadataID, encodeURIComponent(item.artist) + '/' + encodeURIComponent(item.album));
        result.items.push({
          artistTrackSearch: item.artist + ' ' + item.title,
          artistAlbumSearch: item.artist + ' ' + item.album,
          trackName:         item.title,
          artistName:        item.artist,
          albumName:         item.album,
          albumTrackNumber:  item.albumTrackNumber,
          uri:               item.uri,
          metadata
        });
      }
    });

    result.numberReturned += chunk.numberReturned;
    result.totalMatches = chunk.totalMatches;
    logger.info(`Tracks returned: ${result.numberReturned}, Total matches: ${result.totalMatches}`);

    if (isFinished(chunk)) {
      return new Promise((resolve, reject) => {
        fs.writeFile(libraryPath, JSON.stringify(library), (err) => {
          isLoading = false;
          if (err) {
            logger.error('Error saving library cache:', err);
            return reject(err);
          }
          return resolve(library);
        });
      });
    }

    // Recursive promise chain
    return player.browse('A:TRACKS', chunk.startIndex + chunk.numberReturned, 0)
      .then(getChunk);
  };

  return Promise.resolve(result)
    .then(getChunk)
    .catch((err) => {
      logger.error('Error when recursively trying to load library using browse()', err);
    });
}

function loadLibrarySearch(player, load) {
  if (load || musicLibrary === null) {
    return loadLibrary(player)
      .then((result) => { musicLibrary = result; })
      .then(() => loadFuse(musicLibrary.tracks.items, ['artistTrackSearch', 'artistName', 'trackName']))
      .then((result) => { fuzzyTracks = result; })
      .then(() => loadFuse(musicLibrary.tracks.items, ['artistAlbumSearch', 'albumName', 'artistName']))
      .then((result) => {
        fuzzyAlbums = result;
        return 'Library and search loaded';
      });
  }

  return loadFuse(musicLibrary.tracks.items, ['artistTrackSearch', 'artistName', 'trackName'])
    .then((result) => { fuzzyTracks = result; })
    .then(() => loadFuse(musicLibrary.tracks.items, ['artistAlbumSearch', 'albumName', 'artistName']))
    .then((result) => {
      fuzzyAlbums = result;
      return 'Library search loaded';
    });
}

function searchLibrary(type, term) {
  term = decodeURIComponent(term);
  if (type === 'album') {
    return fuzzyAlbums.search(term);
  }
  return shuffle(fuzzyTracks.search(term)).slice(0, randomQueueLimit);
}

function isEmpty(type, resList) {
  return (resList.length === 0);
}

function handleLibrary(err, data) {
  if (!err) {
    musicLibrary = JSON.parse(data);
    if (musicLibrary.version === undefined || musicLibrary.version < currentLibVersion) {
      musicLibrary = null; // Ignore if older format
    }
    if (musicLibrary !== null) {
      loadLibrarySearch(null, false);
    }
  }
}

function readLibrary() {
  fs.readFile(libraryPath, handleLibrary);
}

module.exports = libraryDef;
