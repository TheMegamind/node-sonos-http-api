'use strict';

const got = require('got');
const settings = require('../../settings');

let clientId = '';
let clientSecret = '';

if (settings.spotify) {
  clientId = settings.spotify.clientId;
  clientSecret = settings.spotify.clientSecret;
}

let clientToken = null;

const spotifyDef = {
  country:   '&market=',
  search: {
    album:    'https://api.spotify.com/v1/search?type=album&limit=1&q=album:',
    song:     'https://api.spotify.com/v1/search?type=track&limit=50&q=',
    station:  'https://api.spotify.com/v1/search?type=artist&limit=1&q=',
    playlist: 'https://api.spotify.com/v1/search?type=playlist&q='
  },
  metastart: {
    album:    '0004206cspotify%3aalbum%3a',
    song:     '00032020spotify%3atrack%3a',
    station:  '000c206cspotify:artistRadio%3a',
    playlist: '0004206cspotify%3aplaylist%3a'
  },
  parent: {
    album:    '00020000album:',
    song:     '00020000track:',
    station:  '00052064spotify%3aartist%3a',
    playlist: '00020000playlist:'
  },
  object: {
    album:    'container.album.musicAlbum',
    song:     'item.audioItem.musicTrack',
    station:  'item.audioItem.audioBroadcast.#artistRadio',
    playlist: 'container.playlistContainer'
  },

  service:      setService,
  term:         getSearchTerm,
  tracks:       loadTracks,
  empty:        isEmpty,
  metadata:     getMetadata,
  urimeta:      getURIandMetadata,
  headers:      getTokenHeaders,
  authenticate: authenticateService
};

const toBase64 = (string) => Buffer.from(string).toString('base64');

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const mapResponse = (response) => ({
  accessToken: response.access_token,
  tokenType:   response.token_type,
  expiresIn:   response.expires_in
});

const getHeaders = () => {
  if (!clientId || !clientSecret) {
    throw new Error('You are missing spotify clientId and secret in settings.json! Please read the README for instructions on how to generate and add them');
  }
  const authString = `${clientId}:${clientSecret}`;
  return {
    Authorization: `Basic ${toBase64(authString)}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
};

const auth = () => {
  const headers = getHeaders();
  return got.post(SPOTIFY_TOKEN_URL, {
    headers,
    form: { grant_type: 'client_credentials' },
    responseType: 'json'
  })
    .then((response) => mapResponse(response.body))
    .catch(() => {
      throw new Error(`Unable to authenticate Spotify with client id: ${clientId}`);
    });
};

function getTokenHeaders() {
  if (clientToken === null) return null;
  return { Authorization: `Bearer ${clientToken}` };
}

// Avoid the explicit Promise constructor anti-pattern: just chain directly off auth()
function authenticateService() {
  return auth().then((response) => {
    clientToken = response.accessToken;
  });
}

let sid = '';
let serviceType = '';
let accountId = '';
let accountSN = '';
let country = '';

function setService(player, p_accountId, p_accountSN, p_country) {
  sid         = player.system.getServiceId('Spotify');
  serviceType = player.system.getServiceType('Spotify');
  accountId   = p_accountId;
  accountSN   = 14; // GACALD: Hack to fix Spotify p_accountSN
  country     = p_country;
}

function getServiceToken() {
  return `SA_RINCON${serviceType}_X_#Svc${serviceType}-0-Token`;
}

function getURI(type, id) {
  if (type === 'album')    return `x-rincon-cpcontainer:0004206c${id}`;
  if (type === 'song')     return `x-sonos-spotify:spotify%3atrack%3a${id}?sid=${sid}&flags=8224&sn=${accountSN}`;
  if (type === 'station')  return `x-sonosapi-radio:spotify%3aartistRadio%3a${id}?sid=${sid}&flags=8300&sn=${accountSN}`;
  if (type === 'playlist') return `x-rincon-cpcontainer:0006206c${id}`;
}

function getSearchTerm(type, term, artist, album, track) {
  let newTerm = '';
  if (album !== '')  newTerm = album + ' ';
  if (artist !== '') newTerm += 'artist:' + artist + (track !== '' ? ' ' : '');
  if (track !== '')  newTerm += 'track:' + track;
  return encodeURIComponent(newTerm);
}

function getMetadata(type, id, name, title) {
  const token      = getServiceToken();
  const parentUri  = spotifyDef.parent[type] + name;
  const objectType = spotifyDef.object[type];

  if (type !== 'station') title = '';

  return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
          xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
          <item id="${id}" parentID="${parentUri}" restricted="true"><dc:title>${title}</dc:title><upnp:class>object.${objectType}</upnp:class>
          <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${token}</desc></item></DIDL-Lite>`;
}

function getURIandMetadata(type, resList) {
  let items = [];
  if (type === 'album')    items = resList.albums.items;
  else if (type === 'station')  items = resList.artists.items;
  else if (type === 'playlist') items = resList.playlists.items;

  const Id         = items[0].id;
  const Title      = items[0].name + (type === 'station' ? ' Radio' : '');
  const Name       = Title.toLowerCase().replace(' radio', '').replace('radio ', '');
  const MetadataID = spotifyDef.metastart[type] + encodeURIComponent(Id);

  return {
    metadata: getMetadata(type, MetadataID, (type === 'album' || type === 'playlist') ? Title.toLowerCase() : Id, Title),
    uri:      getURI(type, encodeURIComponent(type === 'station' ? items[0].id : items[0].uri))
  };
}

function loadTracks(type, tracksJson) {
  const tracks = { count: 0, isArtist: false, queueTracks: [] };

  if (tracksJson.tracks.items.length > 0) {
    tracks.queueTracks = tracksJson.tracks.items.reduce((tracksArray, track) => {
      if (track.available_markets !== null && track.available_markets.indexOf(country) === -1) {
        return tracksArray;
      }
      const isDuplicate = tracksArray.some(t => t.trackName === track.name);
      if (!isDuplicate) {
        const metadataID = spotifyDef.metastart['song'] + encodeURIComponent(track.id);
        tracksArray.push({
          trackName:  track.name,
          artistName: track.artists.length > 0 ? track.artists[0].name : '',
          uri:        getURI('song', encodeURIComponent(track.id)),
          metadata:   getMetadata('song', metadataID, track.id, track.name)
        });
        tracks.count++;
      }
      return tracksArray;
    }, []);
  }

  return tracks;
}

function isEmpty(type, resList) {
  if (type === 'album')    return resList.albums.items.length === 0;
  if (type === 'song')     return resList.tracks.items.length === 0;
  if (type === 'station')  return resList.artists.items.length === 0;
  if (type === 'playlist') return resList.playlists.items.length === 0;
  return true;
}

module.exports = spotifyDef;
