// AniKoto — anime source: anikotoapi.site JSON API + anikototv.to site search.
// MegaPlay AES-256-CBC crypto module, byte-verified (shared with AnimeSuge).

var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64encode(bin) {
  var out = '', i, a, b, c, n;
  for (i = 0; i < bin.length; i += 3) {
    a = bin.charCodeAt(i) & 0xff;
    b = (i + 1 < bin.length) ? (bin.charCodeAt(i + 1) & 0xff) : 0;
    c = (i + 2 < bin.length) ? (bin.charCodeAt(i + 2) & 0xff) : 0;
    n = (a << 16) | (b << 8) | c;
    out += _B64[(n >> 18) & 63] + _B64[(n >> 12) & 63]
      + ((i + 1 < bin.length) ? _B64[(n >> 6) & 63] : '=')
      + ((i + 2 < bin.length) ? _B64[n & 63] : '=');
  }
  return out;
}
function _b64decode(b64) {
  var clean = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  // base64url payloads (e.g. the player's `enc`) often strip the `=` padding.
  while (clean.length % 4 !== 0) clean += '=';
  var out = [], i, j;
  for (i = 0; i + 3 < clean.length + 1; i += 4) {
    var n = 0, pad = 0;
    for (j = 0; j < 4; j++) {
      var ch = clean.charAt(i + j);
      var v = (ch === '=') ? 0 : _B64.indexOf(ch);
      if (ch === '=') pad++;
      n = (n << 6) | (v < 0 ? 0 : v);
    }
    out.push((n >> 16) & 255);
    if (pad < 2) out.push((n >> 8) & 255);
    if (pad < 1) out.push(n & 255);
  }
  return out;
}

// ── VRF token for /ajax/episode/list/<id> ────────────────────────────────────
var _VRF_KEY = 'ysJhV6U27FVIjjuk';
var _VRF_SHIFTS = [-3, 3, -4, 2, -2, 5, 4, 5];
function _rc4(key, data) {
  var n = [], r = 0, u, i, t;
  for (i = 0; i < 256; i++) n[i] = i;
  for (u = 0; u < 256; u++) {
    r = (r + n[u] + key.charCodeAt(u % key.length)) % 256;
    t = n[u]; n[u] = n[r]; n[r] = t;
  }
  u = 0; r = 0;
  var out = [];
  for (i = 0; i < data.length; i++) {
    u = (u + 1) % 256; r = (r + n[u]) % 256;
    t = n[u]; n[u] = n[r]; n[r] = t;
    out.push(String.fromCharCode((data.charCodeAt(i) & 0xff) ^ n[(n[u] + n[r]) % 256]));
  }
  return out.join('');
}
function _rot13(s) {
  return String(s).replace(/[A-Za-z]/g, function (c) {
    var o = c.charCodeAt(0);
    if (o >= 65 && o <= 90) return String.fromCharCode(((o - 65 + 13) % 26) + 65);
    return String.fromCharCode(((o - 97 + 13) % 26) + 97);
  });
}
function _vrf(animeId) {
  var b1 = _b64encode(_rc4(_VRF_KEY, String(animeId)));
  var shifted = '', i;
  for (i = 0; i < b1.length; i++) {
    shifted += String.fromCharCode(b1.charCodeAt(i) + _VRF_SHIFTS[i % 8]);
  }
  return _rot13(_b64encode(shifted));
}

// ── MegaPlay AES-256-CBC (sandbox bridges CTR only) ──────────────────────────
// Byte-for-byte match of megaplay's player decrypt against a live getSourcesNew
// `enc` -> {"file":"...master.m3u8"}. Tables/ops mirror providers/hdhub4u.js.
var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){
  var Nk=key.length/4,Nr=Nk+6,w=[],i;
  for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);
  var rcon=1;
  for(i=Nk;i<4*(Nr+1);i++){
    var t=w[i-1].slice();
    if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}
    else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}
    w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);
  }
  return {w:w,Nr:Nr};
}
function _invCipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}
  function ishift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}
  function imix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}
  ark(Nr);
  for(var round=Nr-1;round>=1;round--){ishift();isub();ark(round);imix();}
  ishift();isub();ark(0);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _aesCbcDecrypt(ct,key,iv){
  var ks=_keyExp(key),out=[],prev=iv.slice(),off,i;
  for(off=0;off+16<=ct.length;off+=16){
    var block=ct.slice(off,off+16),dec=_invCipher(block,ks);
    for(i=0;i<16;i++)out.push(dec[i]^prev[i]);
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>0&&pad<=16)out=out.slice(0,out.length-pad);
  return out;
}
function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
// MegaPlay/VidWish player defaults: plain sources.file when present, else
// AES-CBC-decrypt `enc` -> { file }.
var MEGA_AES_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_AES_IV = "W0;27ToaUpl_P%'c";
function _fileFromSources(j) {
  var s = j && j.sources;
  var file = s ? (s.file || (s[0] && s[0].file)) : null;
  if (file) return file;
  if (!j || !j.enc) return null;
  try {
    var ct = _b64decode(j.enc);
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes(MEGA_AES_KEY, 32), _padBytes(MEGA_AES_IV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}

// ── AniKoto provider ────────────────────────────────────────────────────────
// Chain (server-side, no login):
//   GET  anikototv.to/search?keyword=<q> -> cards: /watch/<slug>/ep-1, poster,
//                                          sub/dub episode counts, type
//   GET  anikototv.to/watch/<slug>/ep-1  -> data-id="<numeric anime id>"
//   GET  anikotoapi.site/series/<id>     -> anime metadata + episodes[]
//                                          (episode_embed_id, embed_url.sub/dub)
//   GET  <megaplay embed url>            -> data-id (player file id)
//   GET  megaplay.buzz/stream/getSourcesNew?id=<fileId>&type=<sub|dub>
//        -> { tracks, enc } -> AES-CBC decrypt enc -> { file: master.m3u8 }
// Home:  anikotoapi.site/recent-anime (2 pages).
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'anikoto';

var API = 'https://anikotoapi.site';
var SITE = 'https://anikototv.to';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AniKoto', lang: 'en', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

// ── Network ─────────────────────────────────────────────────────────────────
function _raceTimeout(p, ms, what) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('AniKoto: timed out (' + (what || 'request') + ')')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url, ref, xhr) {
  var h = { 'User-Agent': UA, 'Accept': 'text/html,application/json',
            'Referer': ref || SITE + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return _raceTimeout(fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('AniKoto: HTTP ' + r.status + ' for ' + url);
    return r.text();
  }), 15000, url);
}

function _getJson(url, ref, xhr) {
  return _get(url, ref, xhr).then(function (t) { return JSON.parse(t); });
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

// ── Search: site search page cards ─────────────────────────────────────────
function _searchCards(html) {
  var out = [], seen = {};
  // <a class="name d-title" href=".../watch/<slug>/ep-1" data-jp="...">Title</a>
  // with a sibling <img ... alt="Title"> poster in the same card.
  var re = /<a[^>]+class="name d-title"[^>]*href="([^"]+\/watch\/([a-z0-9-]+)\/ep-\d+)"[^>]*>([^<]{1,120})<\/a>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[2];
    if (seen[slug]) continue;
    seen[slug] = 1;
    var title = _trim(m[3]);
    var card = html.slice(Math.max(0, m.index - 1200), m.index);
    var im = /<img[^>]+src="([^"]+)"[^>]*alt="[^"]*"/.exec(card)
      || /<img[^>]+src="([^"]+)"/.exec(card);
    var dub = /ep-status dub"><span>\s*(\d+)/.exec(card);
    out.push({
      id: 'anikoto:watch:' + slug,
      title: title || slug,
      url: 'anikoto://watch/' + slug,
      type: 'anime',
      cover: im ? im[1] : null,
      dubBadge: (dub && parseInt(dub[1], 10) > 0) ? 'SUB DUB' : 'SUB'
    });
  }
  return out;
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/search?keyword=' + encodeURIComponent(q))
    .then(_searchCards)
    .then(function (items) { return items.slice(0, 24); })
    .catch(function () { return []; });
}

// ── Home: recent anime via the keyless JSON API ─────────────────────────────
function _apiItem(a) {
  return {
    id: 'anikoto:series:' + a.id,
    title: _trim(a.title) || String(a.id),
    url: 'anikoto://series/' + a.id,
    type: 'anime',
    cover: a.poster || null,
    dubBadge: undefined
  };
}

function _recentPage(pg) {
  return _getJson(API + '/recent-anime?page=' + pg + '&per_page=20')
    .then(function (j) {
      var data = (j && j.data) || [];
      return data.map(_apiItem);
    }).catch(function () { return []; });
}

function getHome(opts) {
  return Promise.all([_recentPage(1), _recentPage(2)]).then(function (pages) {
    var rows = [];
    if (pages[0].length) rows.push({ title: 'Recently Added', items: pages[0] });
    if (pages[1].length) rows.push({ title: 'More Recently Added', items: pages[1] });
    return rows;
  });
}

// ── Detail: watch slug -> numeric id -> API series ──────────────────────────
function _seriesIdFromWatch(slug) {
  return _get(SITE + '/watch/' + slug + '/ep-1').then(function (html) {
    var m = html.match(/data-id="(\d+)"/);
    if (!m) throw new Error('AniKoto: no anime id for ' + slug);
    return m[1];
  });
}

function _seriesDetail(id) {
  return _getJson(API + '/series/' + id).then(function (j) {
    var d = (j && j.data) || {};
    var a = d.anime || {};
    var eps = d.episodes || [];
    var out = {
      id: 'anikoto:series:' + (a.id || id),
      title: _trim(a.title) || String(id),
      url: 'anikoto://series/' + (a.id || id),
      type: 'anime',
      cover: a.poster || null,
      description: _trim(a.description || ''),
      _animeId: String(a.id || id)
    };
    out.episodes = eps.map(function (e, i) {
      var num = parseInt(e.number, 10);
      if (isNaN(num) || num < 1) num = i + 1;
      return {
        id: 'anikoto:ep:' + (a.id || id) + ':' + num,
        number: num,
        title: _trim(e.title) || ('Episode ' + num),
        url: 'anikoto://ep/' + (a.id || id) + '/' + num,
        _embed: e.embed_url || null
      };
    });
    return out;
  });
}

function getDetail(url, opts) {
  var m = /^anikoto:\/\/(?:watch\/([a-z0-9-]+)|series\/(\d+))/.exec(String(url || ''));
  if (!m) return Promise.reject(new Error('AniKoto: bad url'));
  if (m[2]) return _seriesDetail(m[2]);
  return _seriesIdFromWatch(m[1]).then(_seriesDetail);
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Streams: megaplay embed -> getSourcesNew -> AES -> HLS ──────────────────
function _expandQualities(masterUrl, ref, kind, subs, tag) {
  return _get(masterUrl, ref).then(function (text) {
    var base = masterUrl.replace(/[^\/]*$/, '');
    var out = [], seen = {};
    var re = /#EXT-X-STREAM-INF:([^\n]*)\n([^\n]+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var attrs = m[1], uri = _trim(m[2]);
      if (/^\s*#/.test(uri)) continue;
      if (!/^https?:\/\//i.test(uri)) uri = base + uri;
      var key = uri.split('?')[0];
      if (seen[key]) continue;
      seen[key] = 1;
      var rm = /RESOLUTION=\d+x(\d+)/i.exec(attrs);
      var e = { url: uri, label: 'AniKoto' + (tag ? ' [' + tag + ']' : ''),
                container: 'hls',
                headers: { 'User-Agent': UA, 'Referer': ref || 'https://megaplay.buzz/' } };
      if (kind) e.kind = kind;
      if (subs && subs.length) e.subtitles = subs;
      if (rm) e.quality = rm[1] + 'p';
      out.push(e);
    }
    out.sort(function (a, b) {
      return parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10);
    });
    var auto = { url: masterUrl, label: 'AniKoto · Auto', container: 'hls', quality: 'Auto',
                 headers: { 'User-Agent': UA, 'Referer': ref || 'https://megaplay.buzz/' } };
    if (kind) auto.kind = kind;
    if (subs && subs.length) auto.subtitles = subs;
    return [auto].concat(out);
  }).catch(function () {
    var e = { url: masterUrl, label: 'AniKoto · Auto', container: 'hls',
              headers: { 'User-Agent': UA, 'Referer': ref || 'https://megaplay.buzz/' } };
    if (kind) e.kind = kind;
    if (subs && subs.length) e.subtitles = subs;
    return [e];
  });
}

// "English" -> "en", "Arabic (Saudi Arabia)" -> "ar", ...
var _LANGS = { english: 'en', arabic: 'ar', spanish: 'es', french: 'fr',
  german: 'de', portuguese: 'pt', italian: 'it', russian: 'ru', hindi: 'hi',
  japanese: 'ja', korean: 'ko', chinese: 'zh', turkish: 'tr', indonesian: 'id',
  malay: 'ms', thai: 'th', vietnamese: 'vi', dutch: 'nl', polish: 'pl' };
function _langOf(label) {
  var w = _trim(label).toLowerCase().split(/[^a-z]+/)[0];
  return _LANGS[w] || w || 'und';
}

function _extractMegaPlay(embedUrl, kind) {
  var base = (String(embedUrl).match(/^(https?:\/\/[^/]+)/) || [])[1] || 'https://megaplay.buzz';
  var type = (String(embedUrl).match(/\/(sub|dub)\/?(?:[?#]|$)/i) || [])[1] || kind || 'sub';
  return _get(embedUrl, SITE + '/').then(function (html) {
    var dataId = (html.match(/data-id="(\d+)"/) || [])[1];
    if (!dataId) throw new Error('AniKoto: no embed id');
    return _getJson(base + '/stream/getSourcesNew?id=' + dataId + '&type=' + type,
                    embedUrl, true);
  }).then(function (j) {
    var file = _fileFromSources(j);
    if (!file) throw new Error('AniKoto: no stream file');
    var subs = [], tracks = (j && j.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t || !t.file) continue;
      if (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles') continue;
      var label = _trim(t.label) || 'Subtitle';
      subs.push({ url: t.file, lang: _langOf(label), label: label });
    }
    return _expandQualities(file, embedUrl, kind, subs, 'MegaPlay');
  });
}

function getVideoSources(episodeUrl) {
  var m = /^anikoto:\/\/ep\/(\d+)\/(\d+)/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('AniKoto: bad episode url'));
  var animeId = m[1], num = parseInt(m[2], 10);
  return _seriesDetail(animeId).then(function (d) {
    var eps = d.episodes || [], ep = null, i;
    for (i = 0; i < eps.length; i++) {
      if (eps[i].number === num) { ep = eps[i]; break; }
    }
    if (!ep) throw new Error('AniKoto: episode not found');
    var emb = ep._embed || {};
    var jobs = [];
    if (emb.sub) jobs.push(_extractMegaPlay(emb.sub, 'sub'));
    if (emb.dub) jobs.push(_extractMegaPlay(emb.dub, 'dub'));
    if (!jobs.length) throw new Error('AniKoto: no embeds for this episode');
    return Promise.all(jobs.map(function (p) {
      return p.catch(function () { return []; });
    })).then(function (lists) {
      var out = [];
      for (var k = 0; k < lists.length; k++) out = out.concat(lists[k]);
      return out;
    });
  });
}
