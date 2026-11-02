// GoGoAnime — anime source for the Zangetsu provider repo.
//
// Chain (all verified live 2026-11-02):
//   /search.html?keyword=        -> <li> cards (/category/<slug>, poster)
//   /                            -> Recent releases (/<slug>-episode-<n>)
//   /category/<slug>             -> metadata (.anime_info_body_bg) + episodes
//   /<slug>-episode-<n>          -> data-video embeds (hd-1/hd-2, sub/dub)
//   newplayer.php                -> <iframe> megaplay.buzz/stream/<id>/<cut>
//   /stream/getSourcesNew?id=..  -> AES-CBC `enc` -> { file: master.m3u8 }
// Dubs are separate `-dub` entries, same as the site.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'gogoanime';

var _DOMAINS = ['https://www.gogoanime.is'];
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'GoGoAnime', lang: 'en', baseUrl: _DOMAINS[0],
    logo: _DOMAINS[0] + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function getSettings() {
  return [
    { key: 'domain', label: 'Site domain', type: 'select', def: 'auto',
      options: [
        { value: 'auto', label: 'Auto (recommended)' },
        { value: 'https://www.gogoanime.is', label: 'gogoanime.is' },
        { value: 'custom', label: 'Custom domain (set below)' } ] },
    { key: 'customDomain', label: 'Custom domain (https://..., used when Domain = Custom)',
      type: 'text', def: '' }
  ];
}
function _cfg(k, d) {
  try {
    var s = (typeof __settings !== 'undefined' && __settings)
      ? (__settings[SOURCE_ID] || {}) : {};
    var v = s[k];
    return (v === undefined || v === null || v === '') ? d : v;
  } catch (e) { return d; }
}
function _normBase(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
function _base() {
  var d = _cfg('domain', 'auto');
  if (d === 'custom') return _normBase(_cfg('customDomain', '')) || _DOMAINS[0];
  if (d && d !== 'auto') return _normBase(d) || _DOMAINS[0];
  return _DOMAINS[0];
}

function _get(url, ref, xhr) {
  var h = { 'User-Agent': UA, 'Referer': ref || _base() + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('GoGoAnime: HTTP ' + r.status);
    return r.body || '';
  }).catch(function (e) {
    throw new Error('GoGoAnime: ' + (e && e.message ? e.message : 'fetch failed'));
  });
}
function _abs(href, base) {
  href = String(href || '');
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href.charAt(0) === '/' && base) return base.replace(/\/+$/, '') + href;
  return href;
}
function _dec(s) {
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function _kindOfSlug(slug) {
  return /-dub$/i.test(String(slug || '')) ? 'dub' : 'sub';
}
// url shapes: gogoanime://cat/<slug> | gogoanime://ep/<slug>/<n>/<kind>
function _parseUrl(url) {
  var m = String(url || '').match(/^gogoanime:\/\/cat\/([^/?#]+)/);
  if (m) return { t: 'cat', slug: m[1], kind: _kindOfSlug(m[1]) };
  m = String(url || '').match(/^gogoanime:\/\/ep\/([^/?#]+)\/(\d+)(?:\/(sub|dub))?/);
  if (m) return { t: 'ep', slug: m[1], n: parseInt(m[2], 10), kind: m[3] || _kindOfSlug(m[1]) };
  return null;
}
function _catUrl(slug) { return 'gogoanime://cat/' + slug; }
function _epUrl(slug, n, kind) { return 'gogoanime://ep/' + slug + '/' + n + '/' + kind; }
function _item(id, title, cover, kind) {
  var it = { id: id, title: _dec(title), url: id, type: 'anime' };
  if (cover) it.cover = _abs(cover, _base());
  if (kind === 'dub') it.dubBadge = 'DUB';
  else if (kind === 'sub') it.dubBadge = 'SUB';
  return it;
}
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
}function _raceTimeout(promise, ms, expired) {
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
// ── search / home ───────────────────────────────────────────────────────────
function _parseSearch(html) {
  var out = [], seen = {}, m;
  var re = /<li>([\s\S]*?)<\/li>/g;
  while ((m = re.exec(html)) !== null) {
    var li = m[1];
    var a = li.match(/<a[^>]*href="(\/category\/([^"?#]+))"[^>]*title="([^"]*)"/)
      || li.match(/<a[^>]*href="(\/category\/([^"?#]+))"/);
    if (!a) continue;
    var slug = a[2];
    if (seen[slug]) continue; seen[slug] = 1;
    var img = li.match(/<img[^>]*src="([^"]+)"/);
    var title = (a[3] || '').trim() || slug;
    out.push(_item(_catUrl(slug), title, img ? img[1] : null, _kindOfSlug(slug)));
  }
  return out;
}
function search(query, page, opts) {
  var d = _base();
  return _get(d + '/search.html?keyword=' + encodeURIComponent(query), d + '/')
    .then(_parseSearch);
}
function getHome(opts) {
  var d = _base();
  return _get(d + '/', d + '/').then(function (html) {
    var out = [], seen = {}, m;
    var re = /<a[^>]*href="(\/([^"?#\/]+)-episode-(\d+))"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = re.exec(html)) !== null) {
      var slug = m[2], n = parseInt(m[3], 10);
      var key = slug + '/' + n;
      if (seen[key]) continue; seen[key] = 1;
      var title = m[4].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || slug;
      out.push(_item(_epUrl(slug, n, _kindOfSlug(slug)),
        title + ' — Ep ' + n, null, _kindOfSlug(slug)));
    }
    return [{ title: 'Recent Releases', items: out.slice(0, 40) }];
  });
}

// ── detail / episodes ───────────────────────────────────────────────────────
function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('GoGoAnime: bad url'));
  var slug = p.slug, kind = p.kind, d = _base();
  return _get(d + '/category/' + slug, d + '/').then(function (html) {
    var info = html.match(/<div class="anime_info_body_bg">([\s\S]*?)<\/div>\s*<\/div>/) || [];
    var body = info[1] || html;
    var title = ((body.match(/<h1>([^<]*)<\/h1>/) || [])[1] || slug).trim();
    var img = (body.match(/<img[^>]*src="([^"]+)"/) || [])[1] || null;
    var desc = null;
    var dm = body.match(/Plot Summary:\s*<\/span>\s*([^<]*)/);
    if (dm) desc = _dec(dm[1].trim());
    var year = null;
    var ym = body.match(/Released:\s*<\/span>\s*(\d{4})/) || html.match(/>(\d{4})</);
    if (ym) year = ym[1];
    return { id: _catUrl(slug), title: _dec(title), url: _catUrl(slug),
      type: 'anime', cover: img ? _abs(img, d) : null,
      description: desc, year: year ? String(year) : null };
  });
}
function getEpisodes(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('GoGoAnime: bad url'));
  var slug = p.slug, kind = p.kind, d = _base();
  return _get(d + '/category/' + slug, d + '/').then(function (html) {
    var out = [], seen = {};
    // Episode list: <a href="/<slug>-episode-<n>"> or ajax-loaded #episode_page
    var re = new RegExp('<a[^>]*href="/(' +
      slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')-episode-(\\d+)"', 'g'), m;
    while ((m = re.exec(html)) !== null) {
      var n = parseInt(m[2], 10);
      if (seen[n]) continue; seen[n] = 1;
      out.push({ id: _epUrl(slug, n, kind), title: 'Episode ' + n,
        url: _epUrl(slug, n, kind), number: n });
    }
    if (!out.length) {
      // Movie-style single entry pages: the "episode" is the title itself.
      out.push({ id: _epUrl(slug, 1, kind), title: 'Movie', url: _epUrl(slug, 1, kind), number: 1 });
    }
    out.sort(function (a, b) { return a.number - b.number; });
    return out;
  });
}

// ── video sources ──────────────────────────────────────────────────────────
function _cutOf(embed) {
  var m = String(embed || '').match(/\/stream\/[a-z0-9-]+\/\d+\/(sub|dub)/i);
  return m ? m[1].toLowerCase() : null;
}
function _embedSources(embedUrl, kind) {
  // newplayer.php -> <iframe> player-host/stream/<id>/<cut> -> data-id
  return _get(embedUrl, _base() + '/').then(function (phtml) {
    var f = phtml.match(/<iframe[^>]+src="([^"]+)"/i);
    if (!f) throw new Error('GoGoAnime: no player iframe');
    var playerUrl = _dec(f[1]);
    var m = playerUrl.match(/^(https?:\/\/[^/]+)/);
    var base = m ? m[1] : 'https://megaplay.buzz';
    var cut = _cutOf(playerUrl) || _cutOf(embedUrl) || kind;
    return _get(playerUrl, embedUrl).then(function (mhtml) {
      var dataId = (mhtml.match(/data-id="(\d+)"/) || [])[1];
      if (!dataId) throw new Error('GoGoAnime: no embed id');
      return fetch(base + '/stream/getSourcesNew?id=' + dataId + '&type=' + cut, {
        headers: { 'User-Agent': UA, 'Referer': playerUrl,
          'X-Requested-With': 'XMLHttpRequest' }
      }).then(function (r) {
        var j; try { j = JSON.parse(r.body || 'null'); }
        catch (e) { throw new Error('GoGoAnime: bad getSources'); }
        return { j: j, cut: cut, base: base };
      });
    });
  });
}
function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p || p.t !== 'ep') return Promise.reject(new Error('GoGoAnime: bad episode url'));
  var slug = p.slug, kind = p.kind, d = _base();
  var epPage = d + '/' + slug + '-episode-' + p.n;
  return _get(epPage, d + '/').then(function (html) {
    var embeds = [], seen = {}, m;
    var re = /data-video="([^"]+)"/g;
    while ((m = re.exec(html)) !== null) {
      var u = _dec(m[1]);
      if (!/^https?:\/\//i.test(u) || seen[u]) continue;
      seen[u] = 1;
      embeds.push(u);
    }
    if (!embeds.length) throw new Error('GoGoAnime: no video embeds');
    var jobs = embeds.slice(0, 4).map(function (eu) {
      return _embedSources(eu, kind).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (rs) {
      var out = [], si;
      for (si = 0; si < rs.length; si++) {
        var r = rs[si];
        if (!r) continue;
        var file = _fileFromSources(r.j);
        if (!file) continue;
        var subs = [], tracks = (r.j && r.j.tracks) || [], i, t;
        for (i = 0; i < tracks.length; i++) {
          t = tracks[i];
          if (!t || !t.file) continue;
          if (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles') continue;
          subs.push({ url: t.file, lang: t.label || 'Sub', label: t.label || 'Sub' });
        }
        var hdrs = { 'User-Agent': UA, 'Referer': r.base + '/', 'Origin': r.base };
        var tag = 'GoGoAnime ' + (r.cut === 'dub' ? 'DUB' : 'SUB');
        var parts = _expandQualities(file, hdrs, r.cut, subs, tag);
        out.push(parts);
      }
      return Promise.all(out).then(function (lists) {
        var flat = [], i, j;
        for (i = 0; i < lists.length; i++)
          for (j = 0; j < lists[i].length; j++) flat.push(lists[i][j]);
        if (!flat.length) throw new Error('GoGoAnime: no playable streams');
        return flat;
      });
    });
  });
}
