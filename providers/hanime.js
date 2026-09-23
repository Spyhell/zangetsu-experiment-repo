var SOURCE_ID = (typeof __SOURCE_ID!== 'undefined' && __SOURCE_ID)? String(__SOURCE_ID): 'hanime';
// Hanime provider for the Zangetsu app.
// Site: https://hanime.tv
//
// How playback works (reverse-engineered 2026-09-24, verified live):
//   1. stime = floor(Date.now()/1000)
//   2. x-signature = hex( SHA256( stime + ",Xkdi29,https://hanime.tv,mn2," + stime ) )
//      (the fixed salts "Xkdi29" / "mn2" sit in the site's WASM signer; the
//       construction was recovered by tracing WASM linear memory)
//   3. token = base64url( JSON({ v:1, alg:"AES-256-GCM",
//        iv: base64url(12 random bytes),
//        tag: base64url(gcm tag), data: base64url(ciphertext) }) )
//      where ciphertext = AES-256-GCM(
//        key = SHA256("htv-insecure-handshake-v1"),
//        aad = "htv-insecure-v1",
//        plaintext = JSON({ timestamp_unix: stime,
//                           directive: "htv_player_handshake", slug: <video slug> }) )
//   4. POST https://auth.hanime.tv/api/v11/handshake  { token }
//      with headers x-signature-version: web2, x-signature, x-time.
//   5. The 200 response carries the stream list ONLY in the "x-token"
//      response header: base64url( JSON envelope ) whose data decrypts
//      (same key/aad) to { streams: [{ type:"hls", url:"/hls/<id>/<tok>",
//      label:"720p", width, height }] }.
// The response body is just {"status":"OK"} and carries no stream data,
// so getVideoSources needs response-header access on the fetch shim.
//
// Catalog/search uses the public guest index:
//   GET https://guest.freeanimehentai.net/api/v11/search_hvs
// Home/detail pages are server-rendered HTML and scraped directly.
// ES5 only.


var SITE = 'https://hanime.tv';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var INDEX_URL = 'https://guest.freeanimehentai.net/api/v11/search_hvs';
var HANDSHAKE_URL = 'https://auth.hanime.tv/api/v11/handshake';
var SIG_ORIGIN = 'https://hanime.tv';
var SIG_SALT_A = 'Xkdi29';
var SIG_SALT_B = 'mn2';
var TOKEN_KEY_LABEL = 'htv-insecure-handshake-v1';
var TOKEN_AAD = 'htv-insecure-v1';

/* ================= pure-JS SHA-256 ================= */
var _K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function _rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function _utf8Bytes(s) {
  var out = [], i, c, c2;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c < 0x80) { out.push(c); }
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++;
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else { out.push(0xef, 0xbf, 0xbd); }
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}
function _sha256Bytes(msg) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var ml = msg.length, i, j;
  var bitLenHi = Math.floor(ml / 0x20000000), bitLenLo = (ml << 3) >>> 0;
  msg = msg.concat([0x80]);
  while ((msg.length % 64) !== 56) { msg.push(0); }
  msg.push((bitLenHi >>> 24) & 0xff, (bitLenHi >>> 16) & 0xff, (bitLenHi >>> 8) & 0xff, bitLenHi & 0xff,
           (bitLenLo >>> 24) & 0xff, (bitLenLo >>> 16) & 0xff, (bitLenLo >>> 8) & 0xff, bitLenLo & 0xff);
  var w = new Array(64);
  for (i = 0; i < msg.length; i += 64) {
    for (j = 0; j < 16; j++) {
      w[j] = ((msg[i + j * 4] << 24) | (msg[i + j * 4 + 1] << 16) | (msg[i + j * 4 + 2] << 8) | msg[i + j * 4 + 3]) >>> 0;
    }
    for (j = 16; j < 64; j++) {
      var s0 = _rotr(w[j - 15], 7) ^ _rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      var s1 = _rotr(w[j - 2], 17) ^ _rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (j = 0; j < 64; j++) {
      var S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      var ch = (e & f) ^ ((~e) & g);
      var t1 = (h + S1 + ch + _K256[j] + w[j]) >>> 0;
      var S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = [];
  for (i = 0; i < 8; i++) { out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff); }
  return out;
}
function _bytesToHex(bytes) {
  var s = '', i;
  for (i = 0; i < bytes.length; i++) { s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); }
  return s;
}
function _sha256Hex(s) { return _bytesToHex(_sha256Bytes(_utf8Bytes(s))); }

/* ================= pure-JS AES-256 ================= */
var _SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var _RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
function _aes256ExpandKey(key) {
  var w = [], i, j, t;
  for (i = 0; i < 8; i++) { w.push((((key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3]) >>> 0)); }
  for (i = 8; i < 60; i++) {
    t = w[i - 1];
    if (i % 8 === 0) {
      t = (((( _SBOX[(t >> 16) & 0xff] << 24) | (_SBOX[(t >> 8) & 0xff] << 16) | (_SBOX[t & 0xff] << 8) | _SBOX[(t >> 24) & 0xff])) ^ (_RCON[i / 8 - 1] << 24)) >>> 0;
    } else if (i % 8 === 4) {
      t = (((_SBOX[(t >> 24) & 0xff] << 24) | (_SBOX[(t >> 16) & 0xff] << 16) | (_SBOX[(t >> 8) & 0xff] << 8) | _SBOX[t & 0xff])) >>> 0;
    }
    w.push(((w[i - 8] ^ t) >>> 0));
  }
  var rk = [];
  for (i = 0; i < 15; i++) {
    var b = [];
    for (j = 0; j < 4; j++) {
      var x = w[i * 4 + j] >>> 0;
      b.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff);
    }
    rk.push(b);
  }
  return rk;
}
function _xtime(a) { return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff; }
function _aesEncryptBlock(rk, inp) {
  var s = inp.slice(), i, r, c, k, t;
  function addRk(n) { for (var q = 0; q < 16; q++) { s[q] ^= rk[n][q]; } }
  addRk(0);
  for (r = 1; r < 14; r++) {
    for (i = 0; i < 16; i++) { s[i] = _SBOX[s[i]]; }
    t = s.slice();
    s[1] = t[5]; s[5] = t[9]; s[9] = t[13]; s[13] = t[1];
    s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
    s[3] = t[15]; s[7] = t[3]; s[11] = t[7]; s[15] = t[11];
    for (c = 0; c < 4; c++) {
      var a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
      var x0 = _xtime(a0), x1 = _xtime(a1), x2 = _xtime(a2), x3 = _xtime(a3);
      s[4 * c] = (x0 ^ x1 ^ a1 ^ a2 ^ a3) & 0xff;
      s[4 * c + 1] = (a0 ^ x1 ^ x2 ^ a2 ^ a3) & 0xff;
      s[4 * c + 2] = (a0 ^ a1 ^ x2 ^ x3 ^ a3) & 0xff;
      s[4 * c + 3] = (x0 ^ a0 ^ a1 ^ a2 ^ x3) & 0xff;
    }
    addRk(r);
  }
  for (i = 0; i < 16; i++) { s[i] = _SBOX[s[i]]; }
  t = s.slice();
  s[1] = t[5]; s[5] = t[9]; s[9] = t[13]; s[13] = t[1];
  s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
  s[3] = t[15]; s[7] = t[3]; s[11] = t[7]; s[15] = t[11];
  addRk(14);
  return s;
}
function _xor128(a, b) { var o = [], i; for (i = 0; i < 16; i++) { o.push(a[i] ^ b[i]); } return o; }
function _gcmMul(x, y) {
  var z = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  var v = x.slice(), i, j;
  for (i = 0; i < 128; i++) {
    if (y[i >> 3] & (0x80 >> (i & 7))) {
      for (j = 0; j < 16; j++) { z[j] ^= v[j]; }
    }
    var lsb = v[15] & 1;
    for (j = 15; j > 0; j--) { v[j] = ((v[j] >>> 1) | ((v[j - 1] & 1) << 7)) & 0xff; }
    v[0] = (v[0] >>> 1) & 0xff;
    if (lsb) { v[0] ^= 0xe1; }
  }
  return z;
}
function _u64be(n) {
  var hi = Math.floor(n / 0x100000000), lo = n >>> 0, o = [], k;
  for (k = 7; k >= 0; k--) { o.push(k >= 4 ? (hi >>> ((k - 4) * 8)) & 0xff : (lo >>> (k * 8)) & 0xff); }
  return o;
}
function _gcmHash(H, aad, ct) {
  var y = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], i, blk;
  function feed(data) {
    for (var p = 0; p < data.length; p += 16) {
      blk = data.slice(p, p + 16);
      while (blk.length < 16) { blk.push(0); }
      y = _gcmMul(_xor128(y, blk), H);
    }
  }
  feed(aad); feed(ct);
  y = _gcmMul(_xor128(y, _u64be(aad.length * 8).concat(_u64be(ct.length * 8))), H);
  return y;
}
function _inc32(b) {
  var o = b.slice(), c = 1, i;
  for (i = 15; i >= 12; i--) { var s = o[i] + c; o[i] = s & 0xff; c = s >> 8; }
  return o;
}
function _aesGcmEncrypt(key, iv12, aad, pt) {
  var rk = _aes256ExpandKey(key);
  var H = _aesEncryptBlock(rk, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  var J0 = iv12.concat([0, 0, 0, 1]);
  var ct = [], i, j, ctr = _inc32(J0), ks, n;
  for (i = 0; i < pt.length; i += 16) {
    ks = _aesEncryptBlock(rk, ctr);
    n = Math.min(16, pt.length - i);
    for (j = 0; j < n; j++) { ct.push(pt[i + j] ^ ks[j]); }
    ctr = _inc32(ctr);
  }
  var tag = _xor128(_gcmHash(H, aad, ct), _aesEncryptBlock(rk, J0));
  return { ct: ct, tag: tag };
}
function _aesGcmDecrypt(key, iv12, aad, ct, tag) {
  var rk = _aes256ExpandKey(key);
  var H = _aesEncryptBlock(rk, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  var J0 = iv12.concat([0, 0, 0, 1]);
  var expect = _xor128(_gcmHash(H, aad, ct), _aesEncryptBlock(rk, J0));
  var i, j, ok = true;
  for (i = 0; i < 16; i++) { if (expect[i] !== tag[i]) { ok = false; } }
  if (!ok) { return null; }
  var pt = [], ctr = _inc32(J0), ks, n;
  for (i = 0; i < ct.length; i += 16) {
    ks = _aesEncryptBlock(rk, ctr);
    n = Math.min(16, ct.length - i);
    for (j = 0; j < n; j++) { pt.push(ct[i + j] ^ ks[j]); }
    ctr = _inc32(ctr);
  }
  return pt;
}

/* ================= base64url ================= */
var _B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function _b64uEncode(bytes) {
  var s = '', i, b0, b1, b2;
  for (i = 0; i < bytes.length; i += 3) {
    b0 = bytes[i]; b1 = i + 1 < bytes.length ? bytes[i + 1] : 0; b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += _B64U.charAt(b0 >> 2) + _B64U.charAt(((b0 & 3) << 4) | (b1 >> 4));
    if (i + 1 < bytes.length) { s += _B64U.charAt(((b1 & 15) << 2) | (b2 >> 6)); }
    if (i + 2 < bytes.length) { s += _B64U.charAt(b2 & 63); }
  }
  return s;
}
function _b64uDecode(str) {
  var out = [], buf = 0, bits = 0, i, ch, v;
  str = String(str || '').replace(/=+$/, '');
  for (i = 0; i < str.length; i++) {
    ch = str.charAt(i);
    v = _B64U.indexOf(ch);
    if (v < 0) { continue; }
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); buf &= (1 << bits) - 1; }
  }
  return out;
}
function _bytesToStr(bytes) {
  var s = '', i;
  for (i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
  return decodeURIComponent(escape(s));
}

/* ================= generic helpers ================= */
function _decode(s) {
  s = String(s == null ? '' : s);
  s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
    try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; }
  });
  s = s.replace(/&#(\d+);/g, function (m, d) {
    try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; }
  });
  s = s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  return s;
}
function _text(html) {
  try { return _decode(htmlText(html)).replace(/\s+/g, ' ').trim(); }
  catch (e) { return _decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
}
function _abs(u) {
  u = String(u || '').trim();
  if (!u) { return null; }
  if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) { return u.split(' ').join('%20'); }
  if (u.indexOf('//') === 0) { return ('https:' + u).split(' ').join('%20'); }
  if (u.charAt(0) === '/') { return (SITE + u).split(' ').join('%20'); }
  return (SITE + '/' + u).split(' ').join('%20');
}
function _meta(html, prop) {
  var m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + prop + '"[^>]+content="([^"]+)"', 'i')) ||
    html.match(new RegExp('<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="' + prop + '"', 'i'));
  return m ? _decode(m[1]) : null;
}
function _get(url, ref) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  return fetch(url, { headers: h }).then(function (r) { return (r && r.body) || ''; }).catch(function () { return ''; });
}
// Read a response header tolerantly: the sandbox fetch may expose headers
// as r.headers (Headers-like with .get, or a plain object) or top-level.
function _respHeader(r, name) {
  if (!r) { return null; }
  var want = String(name).toLowerCase(), h = r.headers, k;
  if (h) {
    if (typeof h.get === 'function') {
      try { var v = h.get(name); if (v) { return v; } } catch (e) {}
      try { var v2 = h.get(want); if (v2) { return v2; } } catch (e2) {}
    } else {
      for (k in h) {
        if (h.hasOwnProperty(k) && String(k).toLowerCase() === want) { return h[k]; }
      }
    }
  }
  if (r[name]) { return r[name]; }
  return null;
}
function _item(id, title, url, cover) {
  return { id: id, title: title, url: url, cover: cover || null, type: 'anime', sourceId: SOURCE_ID };
}
function _slugFromUrl(url) {
  var m = String(url || '').match(/\/videos\/hentai\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}

/* ================= catalog index (search) ================= */
var _indexCache = null;
function _loadIndex() {
  if (_indexCache) { return Promise.resolve(_indexCache); }
  return _get(INDEX_URL, SITE + '/').then(function (body) {
    var data = null;
    try { data = JSON.parse(body).data; } catch (e) { data = null; }
    if (!data || !data.length) { throw new Error('hanime: empty search index'); }
    _indexCache = data;
    return data;
  });
}
function _indexItem(e) {
  var url = SITE + '/videos/hentai/' + e.slug;
  var cover = e.cover_url || e.poster_url || null;
  return _item(url, _decode(e.name || e.slug), url, cover);
}

/* ================= handshake / streams ================= */
function _handshakeToken(slug, stime) {
  var key = _sha256Bytes(_utf8Bytes(TOKEN_KEY_LABEL));
  var iv = [], i;
  for (i = 0; i < 12; i++) { iv.push(Math.floor(Math.random() * 256)); }
  var aad = _utf8Bytes(TOKEN_AAD);
  var pt = _utf8Bytes(JSON.stringify({ timestamp_unix: stime, directive: 'htv_player_handshake', slug: slug }));
  var enc = _aesGcmEncrypt(key, iv, aad, pt);
  var inner = JSON.stringify({ v: 1, alg: 'AES-256-GCM', iv: _b64uEncode(iv), tag: _b64uEncode(enc.tag), data: _b64uEncode(enc.ct) });
  return _b64uEncode(_utf8Bytes(inner));
}
function _decryptToken(xToken) {
  var env;
  try { env = JSON.parse(_bytesToStr(_b64uDecode(xToken))); } catch (e) { return null; }
  if (!env || env.v !== 1 || !env.iv || !env.tag || !env.data) { return null; }
  var key = _sha256Bytes(_utf8Bytes(TOKEN_KEY_LABEL));
  var aad = _utf8Bytes(TOKEN_AAD);
  var pt = _aesGcmDecrypt(key, _b64uDecode(env.iv), aad, _b64uDecode(env.data), _b64uDecode(env.tag));
  if (!pt) { return null; }
  try { return JSON.parse(_bytesToStr(pt)); } catch (e2) { return null; }
}

/* ================= provider API ================= */
function getInfo() {
  return Promise.resolve({
    id: SOURCE_ID, name: 'Hanime', language: 'en',
    baseUrl: SITE, type: 'anime', nsfw: true
  });
}

function search(query) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) { return Promise.resolve([]); }
  return _loadIndex().then(function (data) {
    var toks = q.split(/\s+/), out = [], scored = [], i, e, hay, score, t;
    for (i = 0; i < data.length; i++) {
      e = data[i];
      hay = String(e.name || '') + ' ' + String(e.search_titles || '');
      var hl = hay.toLowerCase();
      score = 0;
      for (t = 0; t < toks.length; t++) {
        if (hl.indexOf(toks[t]) !== -1) { score += toks[t].length; }
        else { score = -1; break; }
      }
      if (score > 0) { scored.push({ e: e, s: score + (String(e.name || '').toLowerCase().indexOf(q) === 0 ? 1000 : 0) }); }
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    for (i = 0; i < scored.length && i < 40; i++) { out.push(_indexItem(scored[i].e)); }
    return out;
  }).catch(function () { return []; });
}

function _parseCards(html) {
  var cards = [], re = /<a[^>]*href="(\/videos\/hentai\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi, m, inner;
  var seen = {};
  while ((m = re.exec(html)) !== null) {
    inner = m[2];
    if (seen[m[1]]) { continue; }
    seen[m[1]] = 1;
    var img = inner.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
    var alt = inner.match(/alt="([^"]*)"/i);
    var title = alt ? _decode(alt[1]) : m[1].split('/').pop().replace(/-/g, ' ');
    cards.push(_item(SITE + m[1], title, SITE + m[1], img ? img[1] : null));
  }
  return cards;
}

function getHome() {
  return _get(SITE + '/', SITE + '/').then(function (html) {
    if (!html) { return []; }
    var rows = [];
    var heads = [], re = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, m;
    while ((m = re.exec(html)) !== null) { heads.push({ t: _text(m[1]), i: m.index }); }
    var want = ['recent uploads', 'new releases', 'trending', 'random'];
    var k, h, start, end, sec, cards;
    for (k = 0; k < heads.length; k++) {
      h = heads[k].t.toLowerCase();
      var hit = false, w;
      for (w = 0; w < want.length; w++) { if (h.indexOf(want[w]) !== -1) { hit = true; break; } }
      if (!hit) { continue; }
      start = heads[k].i;
      end = (k + 1 < heads.length) ? heads[k + 1].i : html.length;
      sec = html.slice(start, end);
      cards = _parseCards(sec);
      if (cards.length) { rows.push({ title: heads[k].t, items: cards.slice(0, 24) }); }
    }
    if (!rows.length) {
      var all = _parseCards(html);
      if (all.length) { rows.push({ title: 'Trending', items: all.slice(0, 24) }); }
    }
    return rows;
  }).catch(function () { return []; });
}

// A minimal but complete detail object: getDetail never rejects, so the
// detail screen always has something to render even if the page fetch fails.
function _baseDetail(pageUrl, slug) {
  var name = slug ? slug.replace(/-/g, ' ') : 'Unknown';
  var ep = { id: pageUrl, number: 1, title: name, url: pageUrl };
  return {
    id: pageUrl, title: name, url: pageUrl, cover: null,
    description: '', genres: [], studios: [], type: 'anime',
    sourceId: SOURCE_ID, episodes: [ep], subCount: 1, dubCount: 0
  };
}
// Cloudflare-cleared fetch: the Zangetsu runtime routes
// fetch(url, { browser: true }) through its native WebView CF solver.
function _getCf(url, ref) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/' }, browser: true })
    .then(function (r) { return (r && r.body) || ''; })
    .catch(function () { return ''; });
}

function getDetail(url) {
  var pageUrl = String(url || '');
  var slug = _slugFromUrl(pageUrl);
  if (!slug) { return Promise.resolve(_baseDetail(pageUrl, null)); }
  pageUrl = SITE + '/videos/hentai/' + slug;
  return _get(pageUrl, SITE + '/').then(function (html) {
    // Plain fetch came back empty (possible Cloudflare block on-device):
    // retry through the CF-cleared lane before giving up.
    if (!html) { return _getCf(pageUrl, SITE + '/'); }
    return html;
  }).then(function (html) {
    if (!html) { return _baseDetail(pageUrl, slug); }
    var rawTitle = _meta(html, 'og:title') || '';
    var title = rawTitle.replace(/\s*-\s*hanime\.tv\s*$/i, '').replace(/^Watch\s+/i, '').replace(/\s+Hentai\s+Video\s+in\s+\d+p\s+HD\s*$/i, '').trim() || slug.replace(/-/g, ' ');
    var cover = _abs(_meta(html, 'og:image'));
    var description = _meta(html, 'description');
    var tags = [], tm = html.match(/<a[^>]*href="\/browse\/tags\/([a-z0-9-]+)"[^>]*>([^<]*)<\/a>/gi), tg;
    if (tm) {
      for (var i = 0; i < tm.length; i++) {
        tg = tm[i].match(/>([^<]*)<\/a>/);
        if (tg && tags.indexOf(_decode(tg[1])) === -1) { tags.push(_decode(tg[1])); }
      }
    }
    var brand = null, bm = html.match(/<a[^>]*href="\/browse\/brands\/[a-z0-9-]+"[^>]*>([^<]*)<\/a>/i);
    if (bm) { brand = _decode(bm[1]); }
    var ep = { id: pageUrl, number: 1, title: title, url: pageUrl };
    return {
      id: pageUrl, title: title, url: pageUrl, cover: cover,
      description: description || '', genres: tags, studios: [],
      type: 'anime', sourceId: SOURCE_ID,
      brand: brand, episodes: [ep], subCount: 1, dubCount: 0
    };
  }).catch(function () { return _baseDetail(pageUrl, slug); });
}

function getEpisodes(detailUrl) {
  return getDetail(detailUrl).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var epUrl = String(episodeUrl || '');
  var slug = _slugFromUrl(epUrl);
  if (!slug) { return Promise.reject(new Error('hanime: bad episode url')); }
  var pageUrl = SITE + '/videos/hentai/' + slug;
  var stime = Math.floor(Date.now() / 1000);
  var sig = _sha256Hex(stime + ',' + SIG_SALT_A + ',' + SIG_ORIGIN + ',' + SIG_SALT_B + ',' + stime);
  var token;
  try { token = _handshakeToken(slug, stime); }
  catch (e) { return Promise.reject(new Error('hanime: failed to build handshake token')); }
  var headers = {
    'User-Agent': UA,
    'Origin': SITE,
    'Referer': pageUrl,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-signature-version': 'web2',
    'x-signature': sig,
    'x-time': String(stime)
  };
  return fetch(HANDSHAKE_URL, { method: 'POST', headers: headers, body: JSON.stringify({ token: token }) })
    .then(function (r) {
      var xToken = _respHeader(r, 'x-token');
      if (!xToken) { throw new Error('hanime: handshake returned no x-token (status ' + (r && r.status) + ')'); }
      var manifest = _decryptToken(xToken);
      // The manifest shape varies: { streams: [{url,...}] } or
      // { sources: [{src, kind:"normal"|"promotion", ...}] }. Skip promos.
      var list = (manifest && (manifest.streams || manifest.sources)) || [];
      if (!list.length) { throw new Error('hanime: could not decrypt stream manifest'); }
      var out = [], i, s, u;
      for (i = 0; i < list.length; i++) {
        s = list[i];
        if (s.kind === 'promotion' || s.kind === 'preroll') { continue; }
        u = _abs(s.url || s.src);
        if (!u) { continue; }
        var ctype = String(s.type || '').toLowerCase();
        out.push({
          url: u,
          quality: s.label || ((s.height ? s.height + 'p' : 'Auto')),
          container: (ctype.indexOf('hls') !== -1 || ctype.indexOf('mpegurl') !== -1 || ctype.indexOf('m3u8') !== -1) ? 'hls' : 'unknown',
          headers: { 'User-Agent': UA, 'Referer': pageUrl, 'Origin': SITE },
          kind: 'sub', audioLang: 'ja', subtitles: []
        });
      }
      if (!out.length) { throw new Error('hanime: no streams in manifest'); }
      return out;
    })
    .catch(function (e) {
      if (e && e.message && e.message.indexOf('hanime:') === 0) { throw e; }
      throw new Error('hanime: handshake failed (' + (e && e.message ? e.message : e) + ')');
    });
}
