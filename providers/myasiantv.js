// MyAsianTV — https://myasiantv.vc — Asian dramas, K-shows & movies (EN subs).
// Verified chain (2026-10-30):
//   /?s=<q>                            -> search: ul.box > li > a.mask[href] + data-original poster
//   /                                  -> home tabs: #latest-update #drama/#movie ul.box
//   /<drama-slug>/                      -> drama page: #drama-details h1, .drama-thumbnail img,
//                                          .synopsis p, .release-year; episodes in #all-episodes
//   /<drama-slug>-episode-<n>/          -> video-frame with data-litespeed-src =
//                                          https://kisskh.megaplay.su/kisskh/<id>
//   embed (GET with Referer = episode page)
//        -> <script id="player-payload" type="application/json"> { source, tracks[] }
// Domain churn note: ship with a domain override in source settings
// (__settings.myasiantv.domain). Falls back across known mirrors on failure.

function getInfo() {
  return { name: 'MyAsianTV', lang: 'en', baseUrl: _base(),
           logo: _base() + '/wp-content/uploads/2026/08/cropped-cropped-cropped-favicon-2-32x32-1-32x32-1-270x270.webp',
           type: 'movie', version: '1.0.0' };
}

var MATV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var MATV_DEFAULT = 'https://myasiantv.vc';
var MATV_MIRRORS = ['https://myasiantv.vc', 'https://myasiantv.rent',
                    'https://myasiantv.cv', 'https://myasiantv.com.bz'];

function _settings() {
  try { return (typeof __settings !== 'undefined' && __settings && __settings.myasiantv) || {}; }
  catch (e) { return {}; }
}

function _base() {
  var d = _settings().domain;
  if (typeof d === 'string' && /^[a-z0-9.\-]{3,60}$/i.test(d)) {
    var b = d.replace(/^(https?:\/\/)?/, '').replace(/\/+$/, '');
    return 'https://' + b;
  }
  return MATV_DEFAULT;
}

function _fail(msg) { return Promise.reject(new Error('MyAsianTV: ' + msg)); }

function _raceTimeout(promise, ms) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) { t = setTimeout(function () { resolve(null); }, ms); });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}

// Fetch with automatic mirror fallback: try configured domain first, then known
// mirrors, first success wins.
function _fetchPath(path, label, headers) {
  var bases = [ _base() ];
  for (var i = 0; i < MATV_MIRRORS.length; i++)
    if (MATV_MIRRORS[i] !== _base()) bases.push(MATV_MIRRORS[i]);
  var chain = Promise.reject(new Error('start'));
  bases.forEach(function (base) {
    chain = chain.then(null, function () {
      var p = fetch(base + path, {
        headers: _mergeHeaders({ 'User-Agent': MATV_UA, 'Referer': base + '/', 'Accept': 'text/html' }, headers)
      }).then(function (r) {
        if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 'none') + ' ' + label);
        return r.text();
      });
      return _raceTimeout(p, 12000).then(function (t) {
        if (t === null || t === undefined) throw new Error('timeout ' + label);
        return t;
      });
    });
  });
  return chain;
}

function _mergeHeaders(a, b) {
  var out = {}, k;
  for (k in a) out[k] = a[k];
  for (k in (b || {})) out[k] = b[k];
  return out;
}

// Strip LiteSpeed escaped newlines and decode a few entities for parsing.
function _clean(html) {
  var s = String(html || '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
  return s;
}

function _decodeEntities(s) {
  return String(s || '')
    .replace(/&#8220;|&#8221;/g, '"').replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8211;|&#8212;/g, '-').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function _slug(url) {
  var m = /myasiantv\.[a-z.]+\/([^/?#]+)\/?$/i.exec(url);
  return m ? m[1] : null;
}

// Parse `ul.box > li > a.mask` card lists. Drama detail may carry episode links;
// opts.epToDrama strips trailing '-episode-N' to the drama URL.
function _cards(html, opts) {
  var out = [], seen = {}, i, m;
  var re = /<a\s+class="mask"[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    var href = m[1], title = _decodeEntities(m[2] || '');
    var inner = m[3];
    var pm = /data-original="([^"]+)"/i.exec(inner) || /src="([^"]+)"/i.exec(inner);
    var cover = pm ? pm[1] : null;
    var h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(inner);
    if (h3) title = _decodeEntities(_stripTags(h3[1])) || title;
    var url = href;
    if (opts && opts.epToDrama) url = url.replace(/-episode-\d+\/?$/, '/');
    var slug = _slug(url);
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;
    out.push({ id: 'myasiantv-d-' + slug, title: title, url: 'myasiantv://d/' + slug,
               type: 'movie', cover: cover });
  }
  return out;
}

function _stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ''); }

function _slice(html, start, end) {
  var a = html.indexOf(start);
  if (a < 0) return '';
  var b = end ? html.indexOf(end, a + start.length) : html.length;
  if (b < 0) b = html.length;
  return html.substring(a, b);
}

function getHome(opts) {
  return _fetchPath('/', 'home', null).then(function (h) {
    var html = _clean(h);
    var tabs = [
      { title: 'Recent Dramas', id: 'id="drama"' },
      { title: 'Recent Movies', id: 'id="movie"' }
    ];
    var rows = [], t, seg, items;
    for (t = 0; t < tabs.length; t++) {
      seg = _slice(html, tabs[t].id, 'id="kshow"');
      items = _cards(seg, { epToDrama: true });
      if (items.length) rows.push({ title: tabs[t].title, items: items });
    }
    if (!rows.length) return _fail('home empty');
    return rows;
  }, function (e) { return _fail('home failed: ' + e.message); });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return _fail('empty query');
  return _fetchPath('/?s=' + encodeURIComponent(q), 'search', null).then(function (h) {
    var html = _clean(h);
    var seg = _slice(html, '<ul class="box"', '</ul>');
    var items = _cards(seg, {});
    if (!items.length) return _fail('no results');
    return items;
  }, function (e) { return _fail('search failed: ' + e.message); });
}

function _dramaSlug(url) {
  var m = /myasiantv:\/\/d\/([^/?#]+)/.exec(String(url || ''));
  return m ? m[1] : null;
}

function _detailPage(slug) {
  return _fetchPath('/' + slug + '/', 'detail ' + slug, null).then(function (h) {
    return _clean(h);
  });
}

function _parseDetail(slug, html) {
  var title = '', cover = null, desc = null, year = null, episodes = [];
  var m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (m) title = _decodeEntities(_stripTags(m[1]));
  var box = _slice(html, 'id="drama-details"', 'id="episode-list"');
  m = /data-original="([^"]+)"/i.exec(box) || /<img[^>]*src="([^"]+)"/i.exec(box);
  if (m) cover = m[1];
  m = /<div class="synopsis">[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(box);
  if (m) desc = _decodeEntities(_stripTags(m[1])).slice(0, 1200) || null;
  m = /class="release-year">[\s\S]*?>(\d{4})</i.exec(box);
  if (m) year = m[1];
  var seg = _slice(html, 'id="all-episodes"', null);
  var re = /<a\s+href=['"]([^'"]+?)['"][^>]*title=['"]([^'"]*)['"]/gi, li, em, n, seen = {};
  while ((li = re.exec(seg)) !== null) {
    var href = li[1];
    if (seen[href]) continue;
    seen[href] = 1;
    em = /-episode-(\d+)\/?$/.exec(href);
    if (!em) continue;
    n = parseInt(em[1], 10);
    episodes.push({ id: 'myasiantv-e-' + slug + '-ep' + n,
                    title: 'Episode ' + n, url: href, number: n });
  }
  episodes.sort(function (a, b) { return a.number - b.number; });
  if (!title) return null;
  return { id: 'myasiantv-d-' + slug, title: title, url: 'myasiantv://d/' + slug,
           type: 'movie', cover: cover, description: desc, year: year,
           episodes: episodes };
}

function getDetail(url, opts) {
  var slug = _dramaSlug(url);
  if (!slug) return _fail('bad detail url');
  return _detailPage(slug).then(function (html) {
    var d = _parseDetail(slug, html);
    if (!d) return _fail('detail empty');
    return d;
  }, function (e) { return _fail('detail failed: ' + e.message); });
}

function getEpisodes(url, opts) {
  var slug = _dramaSlug(url);
  if (!slug) return _fail('bad episodes url');
  return _detailPage(slug).then(function (html) {
    var d = _parseDetail(slug, html);
    if (!d || !d.episodes.length) return _fail('no episodes');
    return d.episodes;
  }, function (e) { return _fail('episodes failed: ' + e.message); });
}

// ── video sources ────────────────────────────────────────────────────────────
// The episode page lists server buttons (class="server-btn", data-src=...);
// some episodes use kisskh.megaplay.su embeds (player-payload JSON with the
// source URL), others use vidbasic.top embeds (AES-256-CBC stream URL hidden
// behind the obfuscated 3rdplayer page). Try every server in order.
function _serverUrls(html) {
  var h = _clean(html), out = [], seen = {}, m;
  var re = /data-src="(https?:\/\/[^"]+)"/gi;
  while ((m = re.exec(h)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
  }
  // Legacy fallback: the old single-iframe markup.
  var single = /data-litespeed-src="(https?:\/\/[^"]+)"/i.exec(h) ||
               /<(?:iframe|video)[^>]+src="(https?:\/\/[^"]+)"/i.exec(h);
  if (single && !seen[single[1]]) out.push(single[1]);
  return out;
}

function _payload(html) {
  var h = _clean(html);
  var m = /<script[^>]*id="player-payload"[^>]*>([\s\S]*?)<\/script>/i.exec(h);
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/\\n/g, '\n')); }
  catch (e) { return null; }
}

// ── pure-JS AES-256-CBC (same byte-verified implementation as kisskh.js) ─────
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
var _B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64decode(b64){
  var clean=String(b64||'').replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/=]/g,'');
  while(clean.length%4!==0)clean+='=';
  var out=[],i,j;
  for(i=0;i+3<clean.length+1;i+=4){
    var n=0,pad=0;
    for(j=0;j<4;j++){var ch=clean.charAt(i+j);var v=(ch==='=')?0:_B64.indexOf(ch);if(ch==='=')pad++;n=(n<<6)|(v<0?0:v);}
    out.push((n>>16)&255);if(pad<2)out.push((n>>8)&255);if(pad<1)out.push(n&255);
  }
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
function _strToBytes(s){var out=[],i;for(i=0;i<s.length;i++)out.push(s.charCodeAt(i)&0xff);return out;}
// vidbasic player constants (from the 3rdplayer page JS, verified 2026-10-30)
var _VB_KEY='9458829337'+'5053432799'+'2224455212'+'89';
var _VB_IV='5259228356'+'829423';
function _vbDecrypt(enc){
  try{
    var ct=_b64decode(enc);
    if(!ct.length||ct.length%16!==0)return null;
    var pt=_bytesToStr(_aesCbcDecrypt(ct,_strToBytes(_VB_KEY),_strToBytes(_VB_IV))).trim();
    return pt?pt:null;
  }catch(e){return null;}
}

function _subLang(label) {
  var l = _decodeEntities(label).toLowerCase().replace(/[^a-z]/g, '');
  return l || 'sub';
}

function getVideoSources(episodeUrl) {
  var epUrl = String(episodeUrl || '');
  if (!/^https?:\/\//i.test(epUrl)) return _fail('bad episode url');
  var epPath = epUrl.replace(/^https?:\/\/[^\/]+/i, '');
  var epSlug = epUrl.replace(/\/$/, '').split('/').pop();
  return _fetchPath(epPath, 'episode ' + epSlug, null).then(function (h) {
    var servers = _serverUrls(h);
    if (!servers.length) return _fail('no player embed');
    var chain = Promise.reject(new Error('start'));
    servers.forEach(function (embed) {
      chain = chain.then(null, function () { return _tryServer(embed, epUrl); });
    });
    return chain.then(null, function () { return _fail('all servers failed'); });
  }, function (e) { return _fail('episode failed: ' + e.message); });
}

// Resolve one embed URL to a VideoSource. Megaplay embeds carry a
// player-payload JSON; vidbasic embeds need the AES-encrypted 3rdplayer key.
function _tryServer(embed, epUrl) {
  var host = embed.replace(/^https?:\/\/([^\/]+).*/i, '$1').toLowerCase();
  var isMega = host.indexOf('megaplay') >= 0;
  var p = fetch(embed, {
    headers: { 'User-Agent': MATV_UA, 'Referer': epUrl,
               'Origin': _base(), 'Accept': 'text/html' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 'none') + ' embed');
    return r.text();
  });
  return _raceTimeout(p, 15000).then(function (t) {
    if (t === null || t === undefined) throw new Error('timeout embed');
    if (isMega) return _megaSource(t, embed);
    return _vidbasicSource(t, embed, epUrl);
  });
}

function _megaSource(html, embed) {
  var payload = _payload(html);
  if (!payload || !payload.source || /^https?:\/\//i.test(payload.source) === false)
    throw new Error('no source in embed payload');
  var src = payload.source;
  return [{ url: src, label: 'MyAsianTV [MegaPlay]',
            container: /\.m3u8(\?|$)/i.test(src) ? 'hls' : 'mp4',
            headers: { 'Referer': embed, 'User-Agent': MATV_UA } }];
}

function _vidbasicSource(html, embed, epUrl) {
  var h = _clean(html);
  var m = /<iframe[^>]+id="embedvideo"[^>]+src="([^"]+)"/i.exec(h) ||
          /<iframe[^>]+src="([^"]*3rdplayer[^"]*)"/i.exec(h);
  if (!m) throw new Error('no 3rdplayer iframe');
  var base = embed.replace(/^https?:\/\/([^\/]+).*/i, '$1');
  var player = /^https?:\/\//i.test(m[1]) ? m[1] : 'https://' + base + m[1];
  var p = fetch(player, {
    headers: { 'User-Agent': MATV_UA, 'Referer': embed, 'Accept': 'text/html' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 'none') + ' 3rdplayer');
    return r.text();
  });
  return _raceTimeout(p, 15000).then(function (t) {
    if (t === null || t === undefined) throw new Error('timeout 3rdplayer');
    var ch = _clean(t);
    var dv = /data-name="crypto"[^>]*data-value="([^"]+)"/i.exec(ch) ||
             /data-value="([^"]+)"[^>]*data-name="crypto"/i.exec(ch);
    var enc = dv ? dv[1] : null;
    if (!enc) {
      // fallback: take the key= query param from the player URL
      var q = /[?&]key=([^&]+)/i.exec(player);
      if (q) enc = decodeURIComponent(q[1].replace(/\+/g, ' '));
    }
    if (!enc) throw new Error('no crypto data');
    var src = _vbDecrypt(enc);
    if (!src || !/^https?:\/\//i.test(src)) throw new Error('stream decrypt failed');
    var out = { url: src, label: 'MyAsianTV [VidBasic]',
                container: /\.m3u8(\?|$)/i.test(src) ? 'hls' : 'mp4',
                headers: { 'Referer': player, 'User-Agent': MATV_UA } };
    var sq = /[?&]sub=([^&]+)/i.exec(player);
    if (sq) {
      var subUrl = _vbDecrypt(decodeURIComponent(sq[1].replace(/\+/g, ' ')));
      if (subUrl && /^https?:\/\//i.test(subUrl))
        out.subtitles = [{ url: subUrl, lang: 'english', label: 'English' }];
    }
    return [out];
  });
}
