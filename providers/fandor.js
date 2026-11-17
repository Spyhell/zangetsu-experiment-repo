// Fandor — Asian dramas + movies source for the Zangetsu provider repo.
//
// Chain (all verified live from this VM, 2026-11-15):
//   Home/search/detail/episodes/play all run through the site's own Next.js
//   proxy: GET https://www.fandor.com/api/get with headers
//     cauth:  md5("Cinedigm-India-Cineverse")  (constant, hardcoded below)
//     mp-tag: CryptoJS-AES-encrypt(target metax URL, "d0e5a4cf1b791825734aadfe874b3ccf")
//   The proxy returns {data:{type:"Buffer",data:[...]}} — AES-256-CTR,
//   key = first 32 chars of base64(sha256("e85c33e2d7333ad30dce716633d3b775")),
//   IV = first 16 bytes. Decrypt -> metax JSON.
//   Metax endpoints (guest, no login): sfuzzy search, details, seriesfeed,
//   media (play URL). Only subscriber_type "free" titles are listed —
//   "paid"/"registered" titles answer err_code 1002 (subscription needed)
//   on the media call, so they are filtered out of search/home/episodes.
//   Free titles return a bare HLS master (up to 1080p, subs burned in,
//   segments byte-verified MPEG-TS) — no token, no DRM.
// Crypto below is pure JS (MD5 + AES-256), byte-verified against the live
// proxy (mp-tag accepted, CTR decrypt == node crypto, search "love" -> 49).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'fandor';

var SITE = 'https://www.fandor.com';
var PROXY = SITE + '/api/get';
var METAX = 'https://metax.api.matchpoint.tv/metax/6.0/c_fandor';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
// md5("Cinedigm-India-Cineverse") — the site's appTag, constant.
var CAUTH = 'df6f31c636eaeea9e755aeb2b2d03f23';
// CryptoJS passphrase for the mp-tag header.
var MP_KEY = 'd0e5a4cf1b791825734aadfe874b3ccf';
// First 32 chars of base64(sha256("e85c33e2d7333ad30dce716633d3b775")) —
// the AES-256-CTR key for proxy responses (ASCII bytes).
var RESP_KEY = 'sHh7yiLK70KI+VmsGESkz5TeSVxtbciN';

function getInfo() {
  return { name: 'Fandor', lang: 'en', baseUrl: SITE,
    logo: SITE + '/logo.png', type: 'movie', version: '1.0.0' };
}

// ── Pure-JS MD5 (RFC 1321) ──────────────────────────────────────────────────
function _md5cycle(x, k) {
  var a = x[0], b = x[1], c = x[2], d = x[3];
  function ff(a, b, c, d, x, s, t) { a = (a + ((b & c) | (~b & d)) + x + t) | 0; return ((a << s) | (a >>> (32 - s))) + b | 0; }
  function gg(a, b, c, d, x, s, t) { a = (a + ((b & d) | (c & ~d)) + x + t) | 0; return ((a << s) | (a >>> (32 - s))) + b | 0; }
  function hh(a, b, c, d, x, s, t) { a = (a + (b ^ c ^ d) + x + t) | 0; return ((a << s) | (a >>> (32 - s))) + b | 0; }
  function ii(a, b, c, d, x, s, t) { a = (a + (c ^ (b | ~d)) + x + t) | 0; return ((a << s) | (a >>> (32 - s))) + b | 0; }
  a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
  a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
  a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
  a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
  x[0] = (x[0] + a) | 0; x[1] = (x[1] + b) | 0; x[2] = (x[2] + c) | 0; x[3] = (x[3] + d) | 0;
}
function _md5(binStr) {
  var bytes = [], i, j;
  for (i = 0; i < binStr.length; i++) bytes.push(binStr.charCodeAt(i) & 0xff);
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (i = 0; i < 8; i++) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  var state = [1732584193, -271733879, -1732584194, 271733878];
  for (i = 0; i < bytes.length; i += 64) {
    var w = [];
    for (j = 0; j < 16; j++) w[j] = bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24);
    _md5cycle(state, w);
  }
  var out = [];
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) out.push((state[i] >>> (j * 8)) & 0xff);
  return out;
}

// ── Byte/string helpers ─────────────────────────────────────────────────────
function _strToBytes(s) {
  var out = [], i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c < 0xd800 || c >= 0xe000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { i++; c = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff)); out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}
function _bytesToBin(bytes) { var s = '', i; for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff); return s; }
function _bytesToStr(b) {
  var s = '', i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xE0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xF0) s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else { var cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f); cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
  }
  return s;
}
var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64encodeBytes(bytes) {
  var out = '', i, a, b, c, n;
  for (i = 0; i < bytes.length; i += 3) {
    a = bytes[i] & 0xff; b = (i + 1 < bytes.length) ? (bytes[i + 1] & 0xff) : 0; c = (i + 2 < bytes.length) ? (bytes[i + 2] & 0xff) : 0;
    n = (a << 16) | (b << 8) | c;
    out += _B64[(n >> 18) & 63] + _B64[(n >> 12) & 63] + ((i + 1 < bytes.length) ? _B64[(n >> 6) & 63] : '=') + ((i + 2 < bytes.length) ? _B64[n & 63] : '=');
  }
  return out;
}

// ── AES-256 (encrypt block; tables mirror animesuge.js) ─────────────────────
var _SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
function _xtime(a) { a <<= 1; if (a & 0x100) a ^= 0x11b; return a & 0xff; }
function _gmul(a, b) { var p = 0; for (var i = 0; i < 8; i++) { if (b & 1) p ^= a; var hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p & 0xff; }
function _keyExp(key) {
  var Nk = key.length / 4, Nr = Nk + 6, w = [], i;
  for (i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
  var rcon = 1;
  for (i = Nk; i < 4 * (Nr + 1); i++) {
    var t = w[i - 1].slice();
    if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]]; t = [_SBOX[t[0]], _SBOX[t[1]], _SBOX[t[2]], _SBOX[t[3]]]; t[0] ^= rcon; rcon = _xtime(rcon); }
    else if (Nk > 6 && i % Nk === 4) { t = [_SBOX[t[0]], _SBOX[t[1]], _SBOX[t[2]], _SBOX[t[3]]]; }
    w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]);
  }
  return { w: w, Nr: Nr };
}
function _cipher(inb, ks) {
  var w = ks.w, Nr = ks.Nr, s = [[], [], [], []], r, c, i;
  for (i = 0; i < 16; i++) s[i % 4][(i / 4) | 0] = inb[i];
  function ark(round) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= w[round * 4 + c][r]; }
  function sub() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _SBOX[s[r][c]]; }
  function shift() { for (r = 1; r < 4; r++) { var row = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = row[(c + r) % 4]; } }
  function mix() { for (c = 0; c < 4; c++) { var a0 = s[0][c], a1 = s[1][c], a2 = s[2][c], a3 = s[3][c];
    s[0][c] = _gmul(a0, 2) ^ _gmul(a1, 3) ^ a2 ^ a3;
    s[1][c] = a0 ^ _gmul(a1, 2) ^ _gmul(a2, 3) ^ a3;
    s[2][c] = a0 ^ a1 ^ _gmul(a2, 2) ^ _gmul(a3, 3);
    s[3][c] = _gmul(a0, 3) ^ a1 ^ a2 ^ _gmul(a3, 2); } }
  ark(0);
  for (var round = 1; round < Nr; round++) { sub(); shift(); mix(); ark(round); }
  sub(); shift(); ark(Nr);
  var out = []; for (i = 0; i < 16; i++) out[i] = s[i % 4][(i / 4) | 0]; return out;
}
function _aesCbcEncrypt(pt, key, iv) {
  var ks = _keyExp(key), out = [], prev = iv.slice(), off, i;
  for (off = 0; off < pt.length; off += 16) {
    var block = [];
    for (i = 0; i < 16; i++) block.push((pt[off + i] || 0) ^ prev[i]);
    var enc = _cipher(block, ks);
    for (i = 0; i < 16; i++) out.push(enc[i]);
    prev = enc;
  }
  return out;
}
function _aesCtrDecrypt(ct, key, iv) {
  var ks = _keyExp(key), out = [], ctr = iv.slice(), off, i, j;
  for (off = 0; off < ct.length; off += 16) {
    var ksBlock = _cipher(ctr, ks);
    for (i = 0; i < 16 && off + i < ct.length; i++) out.push(ct[off + i] ^ ksBlock[i]);
    for (j = 15; j >= 0; j--) { ctr[j] = (ctr[j] + 1) & 0xff; if (ctr[j] !== 0) break; }
  }
  return out;
}

// ── CryptoJS passphrase mode (mp-tag) ───────────────────────────────────────
function _evpBytesToKey(pass, salt) {
  var out = [], prev = [], d;
  while (out.length < 48) {
    var inp = _bytesToBin(prev) + _bytesToBin(_strToBytes(pass)) + _bytesToBin(salt);
    d = _md5(inp);
    prev = d;
    out = out.concat(d);
  }
  return { key: out.slice(0, 32), iv: out.slice(32, 48) };
}
function _cryptoJsEncrypt(plain, pass) {
  var salt = [], i;
  for (i = 0; i < 8; i++) salt.push(Math.floor(Math.random() * 256));
  var dk = _evpBytesToKey(pass, salt);
  var pt = _strToBytes(plain);
  var pad = 16 - (pt.length % 16);
  for (i = 0; i < pad; i++) pt.push(pad);
  var ct = _aesCbcEncrypt(pt, dk.key, dk.iv);
  var blob = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f].concat(salt, ct);
  return _b64encodeBytes(blob);
}
function _respKeyBytes() {
  var out = [], i;
  for (i = 0; i < RESP_KEY.length; i++) out.push(RESP_KEY.charCodeAt(i) & 0xff);
  return out;
}

// ── Proxy: metax URL -> decrypted JSON ───────────────────────────────────────
function _proxyOnce(targetUrl) {
  var tag;
  try { tag = _cryptoJsEncrypt(targetUrl, MP_KEY); }
  catch (e) { return Promise.reject(new Error('Fandor: encrypt failed')); }
  return fetch(PROXY, { headers: { 'User-Agent': UA, 'Content-Type': 'application/json',
    // 2026-11-16: the /api/get edge closes keep-alive sockets after a
    // response; Node's undici reuses the dead socket ("other side closed")
    // on the 2nd/3rd proxy call. Forcing a fresh connection per call fixes
    // it in Node (same fix as the midnightpulp/screambox clones); the app's
    // fetch bridge ignores/accepts it harmlessly.
    'Connection': 'close',
    cauth: CAUTH, 'mp-tag': tag } })
    .then(function (r) { return r.body || ''; })
    .then(function (body) {
      var j;
      try { j = JSON.parse(body); } catch (e) { throw new Error('Fandor: bad proxy reply'); }
      var arr = j && j.data && j.data.data;
      if (!arr || arr.length <= 16) throw new Error('Fandor: empty proxy reply');
      var iv = arr.slice(0, 16), ct = arr.slice(16);
      var pt = _aesCtrDecrypt(ct, _respKeyBytes(), iv);
      var text = _bytesToStr(pt);
      try { return JSON.parse(text); } catch (e) { throw new Error('Fandor: bad payload'); }
    });
}


function _proxy(targetUrl) {
  // 2026-11-17: undici intermittently dies against the /api/get edge
  // ("other side closed") while curl returns 200. Retry up to 3 times;
  // a single dead-socket failure is not a broken source.
  var attempt = 0;
  function go() {
    attempt++;
    return _proxyOnce(targetUrl).catch(function (e) {
      if (attempt < 3) return go();
      throw e;
    });
  }
  return go();
}

// ── Items ───────────────────────────────────────────────────────────────────
function _img(it) {
  if (!it) return null;
  var ti = it.title_image;
  if (ti && typeof ti === 'object' && ti.url) return ti.url;
  if (typeof ti === 'string' && ti) return ti;
  if (typeof it.thumbnail === 'string' && it.thumbnail) return it.thumbnail;
  if (typeof it.thumb_land === 'string' && it.thumb_land) return it.thumb_land;
  return null;
}
function _year(it) {
  var y = it && it.pub_year;
  if (y === undefined || y === null || y === '') return null;
  return String(y);
}
function _item(it) {
  if (!it || !it.id || !it.title) return null;
  return { id: String(it.id), title: htmlText(it.title).trim(),
    url: 'fandor://' + String(it.id), cover: _img(it),
    type: 'movie', sourceId: SOURCE_ID, year: _year(it) };
}
function _freeItems(list) {
  var out = [], i, it;
  for (i = 0; i < (list || []).length; i++) {
    it = list[i];
    if (!it || it.subscriber_type !== 'free') continue;
    var m = _item(it);
    if (m) out.push(m);
  }
  return out;
}
function _searchUrl(q, skip) {
  return METAX + '/feed/filter/v2/sfuzzy?device=web&live=true&search='
    + encodeURIComponent(q) + '&skip=' + skip + '&limit=50&size=max&jth=280&jtw=380&jloc=us';
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var skip = ((page || 1) - 1) * 50;
  return _proxy(_searchUrl(q, skip)).then(function (j) {
    return _freeItems(j && j.result);
  }).catch(function () { return []; });
}
function getHome(opts) {
  var rows = [];
  var jobs = [
    ['Trending Now', 'the'],
    ['Romance', 'love'],
    ['Action', 'action']
  ].map(function (w) {
    return _proxy(_searchUrl(w[1], 0)).then(function (j) {
      var items = _freeItems(j && j.result).slice(0, 20);
      if (items.length) rows.push({ title: w[0], items: items });
    }).catch(function () {});
  });
  return Promise.all(jobs).then(function () { return rows; });
}

// ── Detail + episodes ───────────────────────────────────────────────────────
function _assetId(url) {
  var m = String(url || '').match(/fandor:\/\/(?:ep\/)?([0-9a-f]{20,})/i);
  return m ? m[1] : null;
}
function _detailUrl(id) {
  return METAX + '/details/' + id
    + '?device=web&subid=&subCust=&jth=500&jtw=1280&subtype=&jloc=us';
}
function _episodesUrl(id) {
  return METAX + '/seriesfeed/json/' + id + '?subCust=&subid=&partner=&jloc=us';
}
function _genres(d) {
  var out = [], g = d && d.genres, i;
  if (typeof g === 'string' && g) return [g];
  if (g && g.length) {
    for (i = 0; i < g.length; i++) {
      if (typeof g[i] === 'string') out.push(g[i]);
      else if (g[i] && g[i].name) out.push(g[i].name);
    }
  }
  return out;
}
function getDetail(url, opts) {
  var id = _assetId(url);
  if (!id) return Promise.reject(new Error('Fandor: bad url'));
  return _proxy(_detailUrl(id)).then(function (d) {
    if (!d || !d.id) throw new Error('Fandor: no detail');
    var desc = d.description || d.small_description || '';
    var base = { id: String(d.id), title: htmlText(d.title || '').trim() || String(d.id),
      url: 'fandor://' + String(d.id),
      cover: (typeof d.thumbnail === 'string' && d.thumbnail)
        || (typeof d.thumb_land === 'string' && d.thumb_land) || _img(d),
      description: htmlText(desc).trim(), type: 'movie', sourceId: SOURCE_ID,
      year: _year(d), genres: _genres(d), episodes: [],
      status: (d.type === 'episodic') ? 'ongoing' : 'completed' };
    if (d.type !== 'episodic') {
      base.episodes = [{ id: String(d.id), number: 1,
        title: base.title, url: 'fandor://ep/' + String(d.id) }];
      return base;
    }
    return _proxy(_episodesUrl(id)).then(function (seasons) {
      var eps = [], s, e, i, k;
      for (s = 0; s < (seasons || []).length; s++) {
        var list = seasons[s].episodes || [];
        for (k = 0; k < list.length; k++) {
          e = list[k];
          if (!e || !e.id || e.subscriber_type !== 'free') continue;
          var num = parseInt(e.episode, 10);
          if (!(num >= 1)) num = eps.length + 1;
          eps.push({ id: String(e.id), number: num,
            title: htmlText(e.title || ('Episode ' + num)).trim(),
            url: 'fandor://ep/' + String(e.id),
            thumbnail: _img(e) });
        }
      }
      // Episodes arrive newest-first in some feeds; keep ascending order.
      eps.sort(function (a, b) { return a.number - b.number; });
      // Re-number defensively if the feed repeats numbers.
      for (i = 0; i < eps.length; i++) { if (!(eps[i].number >= 1)) eps[i].number = i + 1; }
      base.episodes = eps;
      return base;
    }).catch(function () { base.episodes = []; return base; });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Streams ─────────────────────────────────────────────────────────────────
function _playUrl(id) {
  return METAX + '/media/' + id + '?jloc=us';
}
function _expandQualities(masterUrl) {
  function autoEntry() {
    return [{ url: masterUrl, quality: 'Auto', label: 'Auto',
      container: 'hls', kind: 'sub' }];
  }
  if (!/\.m3u8(\?|$)/i.test(String(masterUrl))) {
    return Promise.resolve([{ url: masterUrl, quality: 'Auto', label: 'Auto',
      container: 'mp4', kind: 'sub' }]);
  }
  function _fetchMaster() {
    return fetch(masterUrl, { headers: { 'User-Agent': UA, 'Connection': 'close' } })
      .then(function (r) { return String((r && r.body) || ''); })
      .catch(function () { return ''; });
  }
  var bodyP = _fetchMaster().then(function (b) {
    return b ? b : _fetchMaster();
  });
  return bodyP.then(function (body) {
    if (body.indexOf('#EXT-X-STREAM-INF') === -1) return autoEntry();
    var base = String(masterUrl).replace(/[^/]*(\?.*)?$/, '');
    var origin = (String(masterUrl).match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
    var re = /#EXT-X-STREAM-INF:([^\r\n]*)\r?\n([^\r\n]+)/g, m;
    var vars = [], seen = {};
    while ((m = re.exec(body)) !== null) {
      var uri = m[2].trim();
      if (!uri || uri.charAt(0) === '#') continue;
      var url = uri;
      if (!/^https?:\/\//i.test(uri)) url = (uri.charAt(0) === '/') ? origin + uri : base + uri;
      if (seen[url]) continue; seen[url] = 1;
      var hm = m[1].match(/RESOLUTION=\d+x(\d+)/i);
      vars.push({ url: url, h: hm ? parseInt(hm[1], 10) : 0 });
    }
    if (!vars.length) return autoEntry();
    vars.sort(function (a, b) { return b.h - a.h; });
    var out = autoEntry(), i, v;
    for (i = 0; i < vars.length; i++) {
      v = vars[i];
      out.push({ url: v.url, quality: v.h ? (v.h + 'p') : 'Auto',
        label: v.h ? (v.h + 'p') : 'Auto', container: 'hls', kind: 'sub' });
    }
    return out;
  }).catch(function () { return autoEntry(); });
}
function getVideoSources(episodeUrl) {
  var id = _assetId(episodeUrl);
  if (!id) return Promise.reject(new Error('Fandor: bad episode url'));
  return _proxy(_playUrl(id)).then(function (j) {
    if (!j) throw new Error('Fandor: no stream');
    if (j.err_code) {
      throw new Error('Fandor: ' + (j.err_msg || 'title needs a subscription'));
    }
    var master = j.url;
    if (!master || !/^https?:\/\//i.test(master)) {
      throw new Error('Fandor: no playable stream');
    }
    return _expandQualities(master);
  });
}
