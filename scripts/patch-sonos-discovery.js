#!/usr/bin/env node
'use strict';
// Patches sonos-discovery's request.js to disable HTTP keep-alive.
// Sonos players don't support keep-alive; Node 20+ enables it by default,
// causing subsequent requests over reused sockets to time out.
// This patch is equivalent to the v1.8.0 fix that was never published to npm.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'sonos-discovery', 'lib', 'helpers', 'request.js');

if (!fs.existsSync(target)) {
  console.log('patch-sonos-discovery: target file not found, skipping');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');

// Idempotent — don't patch twice
if (src.includes('keepAlive: false')) {
  console.log('patch-sonos-discovery: already patched, skipping');
  process.exit(0);
}

// Insert agent declarations after the require statements
src = src.replace(
  `'use strict';\nconst http = require('http');\nconst https = require('https');\nconst url = require('url');`,
  `'use strict';\nconst http = require('http');\nconst https = require('https');\nconst url = require('url');\n\n// Disable keep-alive: Sonos players close connections after each response.\n// Node 20+ keep-alive default causes socket reuse timeouts on these devices.\nconst httpAgent  = new http.Agent({ keepAlive: false });\nconst httpsAgent = new https.Agent({ keepAlive: false });`
);

// Add agent to requestOptions
src = src.replace(
  `    let requestOptions = {\n      method: options.method || 'GET',\n      path: uri.path,\n      host: uri.hostname,\n      port: uri.port * 1 || defaultPort\n    };`,
  `    let requestOptions = {\n      method: options.method || 'GET',\n      path: uri.path,\n      host: uri.hostname,\n      port: uri.port * 1 || defaultPort,\n      agent: uri.protocol === 'https:' ? httpsAgent : httpAgent\n    };`
);

fs.writeFileSync(target, src, 'utf8');
console.log('patch-sonos-discovery: keep-alive fix applied successfully');
