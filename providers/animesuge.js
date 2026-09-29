// AnimeSuge — anime source for the Zangetsu provider repo (animesuge.cz).
//
// Chain:
//   /filter?keyword=                    -> anime cards (slug in /anime/<slug>)
//   /anime/<slug>                       -> anime id (data-id) + metadata
//   /ajax/episode/list/<id>?vrf=<token> -> episodes (data-ids blob, sub/dub flags)
//   /ajax/server/list?servers=<ids>     -> server list (Vidstream/HD/VidPlay/...)
//   /ajax/server?get=<link-id>          -> { url: <player embed> }
//   <embed>/stream/getSourcesNew?id=..  -> AES-CBC `enc` -> { file: master.m3u8 }
//
// The VRF token: RC4(key 'ysJhV6U27FVIjjuk') -> base64 -> per-char shifts
// [-3,+3,-4,+2,-2,+5,+4,+5] -> base64 -> ROT13. Pure JS below, no builtins.
// MegaPlay/VidWish `enc`: AES-256-CBC, key 'i?LMTAx0Q6,:}50U' zero-padded to
// 32 bytes, IV "W0;27ToaUpl_P%'c" — pure-JS CBC, byte-verified against a live
// `enc` blob (2026-09-27).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animesuge';

var SITE = 'https://animesuge.cz';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
// Embed hosts that hand back a plain m3u8 (via getSources or getSourcesNew).
var PLAYER_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?(?:vidtube\.[a-z]+|megaplay\.[a-z]+|vidwish\.[a-z]+)/i;

function getInfo() {
  return { name: 'AnimeSuge', lang: 'en', baseUrl: SITE,
    logo: SITE + '/animesuge/images/favicon.png', type: 'anime', version: '1.0.3' };
}

// ── Pure-JS base64 (encode + decode). Self-contained: the app injects no
// base64 helper and the harness shim doesn't define one either. ──────────────
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

// ── Network ─────────────────────────────────────────────────────────────────
// GET a page as text. `xhr` sets the ajax header the /ajax routes expect.
function _get(url, ref, xhr) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: h })
    .then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}
// The site's /ajax routes wrap their payload in { status, result }. `result`
// is an HTML string (episode/server lists, home widgets) or an object
// (server?get).
function _ajax(path) {
  return _get(SITE + path, SITE + '/', true).then(function (b) {
    var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; } return j;
  }).catch(function () { return null; });
}

function _slugFromAnime(href) {
  var m = String(href || '').match(/\/anime\/([^/"?#]+)/);
  return m ? m[1] : null;
}

// ── Cards (search results, home widgets) ────────────────────────────────────
function _cards(html) {
  var out = [], seen = {};
  var chunks = String(html || '').split('<div class="item">');
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i];
    var href = (c.match(/href="([^"]*\/anime\/[^"]+)"/) || [])[1];
    var slug = _slugFromAnime(href);
    if (!slug || seen[slug]) continue;
    var title = (c.match(/data-jp="([^"]+)"/) || [])[1]
      || (c.match(/<div class="name">\s*<a[^>]*>([^<]+)<\/a>/) || [])[1];
    if (!title) continue;
    var poster = (c.match(/<img[^>]+data-src="([^"]+)"/) || c.match(/<img[^>]+src="([^"]+)"/) || [])[1];
    var hasSub = /<span class="sub">/.test(c), hasDub = /<span class="dub">/.test(c);
    seen[slug] = 1;
    out.push({ id: slug, title: htmlText(title).trim(), url: slug,
      cover: poster || null, type: 'anime', sourceId: SOURCE_ID,
      dubBadge: (hasSub && hasDub) ? 'SUB DUB' : (hasDub ? 'DUB' : 'SUB') });
  }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/filter?keyword=' + encodeURIComponent(q) + '&page=' + (page || 1);
  return _get(url, SITE + '/').then(function (html) {
    return _cards(html);
  }).catch(function () { return []; });
}

// ── Home: / slider spotlight + ajax widgets (latest / trending / dubbed) ─────
function _spotlight(html) {
  var out = [], seen = {};
  var seg = html, si = html.indexOf('id="slider"');
  if (si >= 0) seg = html.substring(si, si + 40000);
  var re = /<a\b([^>]*class="swiper-slide"[^>]*)>/g, m;
  while ((m = re.exec(seg)) !== null) {
    var a = m[1];
    var slug = _slugFromAnime((a.match(/href="([^"]+)"/) || [])[1]);
    if (!slug || seen[slug]) continue;
    var title = (a.match(/title="([^"]+)"/) || [])[1];
    if (!title) continue;
    var img = (a.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/) || [])[1];
    seen[slug] = 1;
    out.push({ id: slug, title: htmlText(title).trim(), url: slug,
      cover: img || null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function getHome(opts) {
  var rows = [];
  return _get(SITE + '/', SITE + '/').then(function (html) {
    var spot = _spotlight(html);
    if (spot.length) rows.push({ title: 'Spotlight', items: spot });
    var widgets = [
      ['/ajax/home/widget/trending', 'Trending'],
      ['/ajax/home/widget/updated-all', 'Latest Episodes'],
      ['/ajax/home/widget/updated-dub', 'Latest Dubbed']
    ];
    var chain = Promise.resolve();
    widgets.forEach(function (w) {
      chain = chain.then(function () {
        return _ajax(w[0]).then(function (j) {
          var items = _cards(j && typeof j.result === 'string' ? j.result : '');
          if (items.length) rows.push({ title: w[1], items: items });
        }).catch(function () {});
      });
    });
    return chain.then(function () { return rows; });
  }).catch(function () { return rows; });
}

// ── Detail + episodes ───────────────────────────────────────────────────────
function _metaList(html, label) {
  var out = [];
  var i = html.indexOf('>' + label + '</div>');
  if (i < 0) return out;
  var seg = html.substring(i, i + 3000);
  var end = seg.indexOf('</span>');
  if (end > 0) seg = seg.substring(0, end);
  var re = /<a[^>]*>([^<]+)<\/a>/g, m;
  while ((m = re.exec(seg)) !== null && out.length < 10) {
    var t = htmlText(m[1]).trim();
    if (t) out.push(t);
  }
  return out;
}
// data-num can be a label like "Full"; data-slug (or the anchor text) carries
// the real episode number.
function _episodes(lhtml, cat) {
  var out = [];
  var re = /<a\b([^>]*\bdata-ids="([^"]+)"[^>]*)>([^<]*)/g, m;
  while ((m = re.exec(lhtml)) !== null) {
    var attrs = m[1], serverIds = m[2], inner = (m[3] || '').trim();
    var sub = /data-sub="1"/.test(attrs), dub = /data-dub="1"/.test(attrs);
    if (!sub && !dub) continue;
    var num = parseInt((attrs.match(/data-slug="(\d+)"/) || [])[1] || '', 10);
    if (!(num >= 1)) num = parseInt(inner, 10);
    if (!(num >= 1)) num = parseInt((attrs.match(/data-num="(\d+)"/) || [])[1] || '', 10);
    if (!(num >= 1)) num = out.length + 1;
    var etitle = htmlText((attrs.match(/title="([^"]*)"/) || [])[1] || '').trim();
    var initCat = (cat === 'dub' && dub) || (cat === 'sub' && !sub && dub) ? 'dub' : 'sub';
    out.push({ id: initCat + ':' + num, number: num,
      title: etitle || ('Episode ' + num),
      url: 'animesuge://' + initCat + '/' + encodeURIComponent(serverIds)
        + '/' + (sub ? '1' : '0') + (dub ? '1' : '0') + '/' + num });
  }
  return out;
}
function getDetail(url, opts) {
  var slug = String(url || '');
  return _get(SITE + '/anime/' + encodeURIComponent(slug), SITE + '/').then(function (html) {
    var animeId = (html.match(/data-id="(\d+)"/) || [])[1];
    var title = htmlText((html.match(/<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').trim()
      || slug;
    var poster = (html.match(/og:image"\s+content="([^"]+)"/) || [])[1] || null;
    var desc = (html.match(/class="full cts-block"[^>]*>\s*<div>([\s\S]*?)<\/div>/) || [])[1]
      || (html.match(/class="short cts-block"[^>]*>\s*<div>([\s\S]*?)<\/div>/) || [])[1] || '';
    var year = null;
    var ym = html.match(/itemprop="dateCreated">\s*([^<]+)</);
    if (ym) { var yy = ym[1].match(/(19|20)\d{2}/); year = yy ? yy[0] : null; }
    var statusRaw = htmlText((html.match(/>Status:<\/div>\s*<span>\s*<a[^>]*>([^<]+)<\/a>/) || [])[1] || '')
      .trim().toLowerCase();
    var status = statusRaw.indexOf('finish') >= 0 ? 'completed'
      : statusRaw.indexOf('airing') >= 0 ? 'ongoing' : 'unknown';
    var base = { id: slug, title: title, url: slug, cover: poster,
      description: htmlText(desc).trim(), status: status,
      genres: _metaList(html, 'Genre:'), studios: _metaList(html, 'Studios:'),
      type: 'anime', sourceId: SOURCE_ID, episodes: [], year: year,
      subCount: 0, dubCount: 0 };
    var sm = html.match(/<span class="sub">[\s\S]*?(\d+)\s*<\/span>/);
    var dm = html.match(/<span class="dub">[\s\S]*?(\d+)\s*<\/span>/);
    if (sm) base.subCount = parseInt(sm[1], 10);
    if (dm) base.dubCount = parseInt(dm[1], 10);
    if (!animeId) return base;
    return _ajax('/ajax/episode/list/' + animeId + '?vrf=' + _vrf(animeId)).then(function (j) {
      var lhtml = (j && typeof j.result === 'string') ? j.result : '';
      base.episodes = _episodes(lhtml, (opts && opts.category === 'dub') ? 'dub' : 'sub');
      return base;
    }).catch(function () { return base; });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// ── Streams: server_ids -> server list -> server?get -> embed getSources(New) ─
function _parseServers(lhtml) {
  var servers = [];
  var blocks = String(lhtml || '').split('data-type="');
  for (var b = 1; b < blocks.length; b++) {
    var type = (blocks[b].match(/^(\w+)"/) || [])[1] || '';
    var rest = blocks[b];
    var re = /data-link-id="([^"]+)"/g, m;
    while ((m = re.exec(rest)) !== null) {
      var after = rest.substring(m.index, m.index + 800);
      var name = (after.match(/<span>([^<]*)<\/span>/) || [])[1] || '';
      servers.push({ type: type, linkId: m[1], name: name.trim() });
    }
  }
  return servers;
}
// Vidstream (plain file) first, then the MegaPlay-family hosts whose `enc`
// decrypts with the player's own AES key.
function _srvRank(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('vidstream') >= 0) return 0;
  if (n.indexOf('hd') >= 0) return 1;
  if (n.indexOf('vidplay') >= 0) return 2;
  if (n.indexOf('vidwish') >= 0) return 3;
  if (n.indexOf('vidcloud') >= 0) return 4;
  return 5;
}
function getVideoSources(episodeUrl) {
  var raw = String(episodeUrl || '').replace('animesuge://', '');
  var parts = raw.split('/');
  var cat = parts[0] === 'dub' ? 'dub' : 'sub';
  var serverIds = parts[1] ? decodeURIComponent(parts[1]) : '';
  if (!serverIds) return Promise.reject(new Error('AnimeSuge: no server ids'));
  return _ajax('/ajax/server/list?servers=' + encodeURIComponent(serverIds)).then(function (j) {
    var lhtml = (j && typeof j.result === 'string') ? j.result : '';
    var servers = _parseServers(lhtml);
    var want = [];
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i];
      var ok = (cat === 'dub') ? (s.type === 'dub') : (s.type === 'sub' || s.type === 'hsub');
      if (ok) want.push(s);
    }
    if (!want.length) want = servers;
    want.sort(function (a, b) { return _srvRank(a.name) - _srvRank(b.name); });
    // List streams from EVERY working server, tagged by server name — the way
    // AnimeX v1.0.1 fixed its own flakiness. A dead default server no longer
    // kills the whole list; the user just picks another server's entry.
    var jobs = want.map(function (srv) { return _resolveServer(srv, cat); });
    return Promise.all(jobs).then(function (lists) {
      var out = [], seen = {};
      lists.forEach(function (l) {
        (l || []).forEach(function (v) {
          if (!v || !v.url || seen[v.url]) return;
          seen[v.url] = 1; out.push(v);
        });
      });
      if (!out.length) return Promise.reject(new Error('AnimeSuge: no playable server'));
      return out;
    });
  });
}
// Resolve servers in preference order; take the first that yields a known
// embed host, then extract its m3u8. Anything else throws and we fall through
// to the next server.
function _tryServers(list, i, cat) {
  if (i >= list.length) return Promise.reject(new Error('AnimeSuge: no playable server'));
  return _ajax('/ajax/server?get=' + encodeURIComponent(list[i].linkId)).then(function (j) {
    var url = j && j.result && j.result.url;
    if (url && PLAYER_RE.test(url)) return _extractPlayer(url, cat);
    return _tryServers(list, i + 1, cat);
  }).catch(function () { return _tryServers(list, i + 1, cat); });
}
// Resolve one server to its stream entries, tagged with the server name.
// Never rejects: a dead server just contributes nothing.
function _resolveServer(srv, cat) {
  var tag = String((srv && srv.name) || 'server').trim() || 'server';
  var p = _ajax('/ajax/server?get=' + encodeURIComponent(srv.linkId)).then(function (j) {
    var url = j && j.result && j.result.url;
    if (!url || !PLAYER_RE.test(url)) return [];
    return _extractPlayer(url, cat, tag);
  });
  p = p.catch(function () { return []; });
  // A hanging embed host must never stall the whole list.
  return _raceTimeout(p, 15000, []);
}
// The sub/hsub/dub cut an embed URL was issued for.
function _cutOf(embed) {
  return (String(embed || '').match(/\/(sub|hsub|dub)\/?(?:[?#]|$)/i) || [])[1] || null;
}
// Embed page -> data-id -> getSources(New) (m3u8 + subtitle tracks).
function _extractPlayer(embed, cat, tag) {
  var base = (String(embed).match(/^(https?:\/\/[^/]+)/) || [])[1] || 'https://megaplay.buzz';
  // Sources are keyed by the embed's data-id — the audio comes from `type`, so
  // carry over the cut this embed was issued for or a dub request comes back
  // with the sub stream.
  var type = _cutOf(embed) || cat;
  return _get(embed, SITE + '/').then(function (mhtml) {
    var dataId = (mhtml.match(/data-id="(\d+)"/) || [])[1];
    if (!dataId) throw new Error('AnimeSuge: no embed id');
    var path = /(?:megaplay|vidwish)\./i.test(base) ? '/stream/getSourcesNew' : '/stream/getSources';
    return fetch(base + path + '?id=' + dataId + '&type=' + type, {
      headers: { 'User-Agent': UA, 'Referer': embed, 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) {
      var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { throw new Error('AnimeSuge: bad getSources'); }
      var file = _fileFromSources(j);
      if (!file) throw new Error('AnimeSuge: no stream file');
      var subs = [];
      var tracks = (j && j.tracks) || [];
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        if (!t || !t.file) continue;
        if (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles') continue;
        subs.push({ url: t.file, lang: t.label || 'Sub', label: t.label || 'Sub',
          format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt', 'default': !!t['default'] });
      }
      var hdrs = { 'User-Agent': UA, 'Referer': base + '/', 'Origin': base };
      return _expandQualities(file, hdrs, cat, subs, tag);
    });
  });
}
// Expand a master.m3u8 into one stream entry per quality variant so the app's
// quality/download picker shows real options (1080p/720p/...) instead of a
// single "auto". The master stays first as "Auto" (current playback default);
// anything failing falls back to that lone entry.
// Race a promise against a timer so a hanging host can never stall the
// stream list forever. If the runtime has no timers, returns the promise
// unchanged.
function _raceTimeout(promise, ms, expired) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) {
    t = setTimeout(function () { resolve(expired); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}
function _expandQualities(masterUrl, hdrs, cat, subs, tag) {
  // Tag every entry with its server (e.g. [Vidstream]) so the user can tell
  // which server each stream came from and try another if one is flaky.
  var suffix = tag ? ' [' + tag + ']' : '';
  function autoEntry(ct) {
    return { url: masterUrl, quality: 'Auto', label: 'Auto' + suffix,
      container: ct, headers: hdrs,
      kind: cat, audioLang: cat === 'dub' ? 'en' : 'ja', subtitles: subs };
  }
  if (!/\.m3u8(\?|$)/i.test(String(masterUrl))) {
    return Promise.resolve([autoEntry('mp4')]);
  }
  var bodyP = fetch(masterUrl, { headers: { 'User-Agent': UA, 'Referer': hdrs.Referer } })
    .then(function (r) { return String((r && r.body) || ''); });
  bodyP.catch(function () {}); // late failures after a timeout must stay silent
  return _raceTimeout(bodyP, 5000, '').then(function (body) {
      if (body.indexOf('#EXT-X-STREAM-INF') === -1) return [autoEntry('hls')];
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
        var bw = m[1].match(/BANDWIDTH=(\d+)/i);
        vars.push({ url: url, h: hm ? parseInt(hm[1], 10) : 0, bw: bw ? parseInt(bw[1], 10) : 0 });
      }
      if (!vars.length) return [autoEntry('hls')];
      vars.sort(function (a, b) { return (b.h - a.h) || (b.bw - a.bw); });
      var out = [autoEntry('hls')], i, v;
      for (i = 0; i < vars.length; i++) {
        v = vars[i];
        out.push({ url: v.url, quality: v.h ? (v.h + 'p') : 'Auto',
          label: (v.h ? (v.h + 'p') : 'Auto') + suffix,
          container: 'hls', headers: hdrs,
          kind: cat, audioLang: cat === 'dub' ? 'en' : 'ja', subtitles: subs });
      }
      return out;
    })
    .catch(function () { return [autoEntry('hls')]; });
}
