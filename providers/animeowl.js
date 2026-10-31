// (site config + getInfo defined in the AnimeOwl section below)

// ── Pure-JS base64 decode (handles unpadded base64url `enc` blobs) ──────────
var _B64D = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64decode(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var out = [], i, c1, c2, c3, c4;
  for (i = 0; i + 3 < s.length; i += 4) {
    c1 = _B64D.indexOf(s.charAt(i)); c2 = _B64D.indexOf(s.charAt(i + 1));
    c3 = _B64D.indexOf(s.charAt(i + 2)); c4 = _B64D.indexOf(s.charAt(i + 3));
    out.push((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) out.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) out.push(((c3 & 3) << 6) | c4);
  }
  return out;
}

// ── Pure-JS AES-256-CBC decrypt (mirrors AnimeSuge's byte-verified tables) ──
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
var MEGA_AES_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_AES_IV = "W0;27ToaUpl_P%'c";
// getSourcesNew JSON -> { file, subtitles } (plain `file` or AES `enc`)
function _fileFromSources(j) {
  var s = j && j.sources;
  var file = s ? (s.file || (s[0] && s[0].file)) : null;
  if (file) return { file: file, tracks: j.tracks || [] };
  if (!j || !j.enc) return null;
  try {
    var ct = _b64decode(j.enc);
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes(MEGA_AES_KEY, 32), _padBytes(MEGA_AES_IV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return { file: o.file, tracks: j.tracks || [] };
    s = o.sources;
    var f2 = s ? (s.file || (s[0] && s[0].file)) : null;
    return f2 ? { file: f2, tracks: j.tracks || [] } : null;
  } catch (e) { return null; }
}

// AnimeOwl (animeowl.cv) — anime EN-sub source for Zangetsu.
// Catalog model: WP categories = series, WP posts = episodes.
// Chain: wp-json search -> series page -> posts?categories=<id> -> episode
// post page -> megaplay.buzz iframe (/stream/s-2/<realid>/sub)
// -> /stream/getSourcesNew?id=<realid> (X-Requested-With: XMLHttpRequest)
// -> AES-256-CBC `enc` -> master.m3u8 + caption tracks.
// The MegaPlay `enc` crypto is the same unpadded-base64 AES-CBC flow already
// cracked for AnimeSuge (pure-JS, ES5 — no WebCrypto/TextDecoder needed).
var SITE = 'https://animeowl.cv';
var MEGA = 'https://megaplay.buzz';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeOwl', lang: 'en', baseUrl: SITE,
    logo: 'https://animeowl.cv/wp-content/uploads/2026/10/f899139df5e1059396431415e770c6dd.jpg',
    type: 'anime', version: '1.0.0' };
}

// ── Network ───────────────────────────────────────────────────────────────
function _get(url, ref, xhr) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: h }).then(function (r) {
    return (r && r.body) || '';
  }).catch(function () { return ''; });
}
function _getJson(url, ref) {
  return _get(url, ref, true).then(function (b) {
    var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; } return j;
  }).catch(function () { return null; });
}
function _htmlUnesc(s) {
  return String(s || '').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-')
    .replace(/&#[0-9]+;/g, ' ');
}
function _itemFromBlock(a) {
  // a: full <a ...>...</a> inner capture groups passed via regex below
  return a;
}
// article.bs blocks: <a href=... title=... class="tip"> ... <img src=...>
function _parseArticles(html) {
  var items = [], m, re = /<article class="bs"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img src="([^"]+)"[\s\S]*?<\/article>/g;
  while ((m = re.exec(html))) {
    var href = m[1], title = _htmlUnesc(m[2]), cover = m[3];
    items.push({ id: 'animetsu:' + href, title: title, url: href, type: 'anime',
      cover: cover, dubBadge: 'SUB' });
  }
  return items;
}

function _epNumFromTitle(t) {
  var m = String(t || '').match(/Episode\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}
function _seriesItemFromSearch(r) {
  var title = _htmlUnesc(r.title || '');
  return { id: 'animeowl:' + r.url, title: title, url: r.url, type: 'anime',
    dubBadge: 'SUB' };
}

function getHome(opts) {
  return _getJson(SITE + '/wp-json/wp/v2/posts?per_page=24&_fields=id,slug,link,title')
    .then(function (posts) {
      if (!posts || !posts.length) throw new Error('AnimeOwl: no home posts');
      var items = [];
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i], title = _htmlUnesc(p.title && p.title.rendered);
        var n = _epNumFromTitle(title);
        items.push({ id: 'animeowl:' + p.link, title: title, url: p.link,
          type: 'anime', dubBadge: 'SUB' });
      }
      return [{ title: 'Latest Episodes', items: items }];
    });
}

function search(query, page, opts) {
  return _getJson(SITE + '/wp-json/wp/v2/search?search=' + encodeURIComponent(query || '') + '&per_page=20')
    .then(function (rs) {
      var items = [];
      if (rs) for (var i = 0; i < rs.length; i++) {
        // series entries are type 'post' with /anime/<slug>/ urls
        if (rs[i] && /\/anime\//.test(rs[i].url || '')) items.push(_seriesItemFromSearch(rs[i]));
      }
      return items;
    });
}

// episode post URL -> its series (category) URL
function _seriesUrlFromEpisode(url) {
  return _getJson(SITE + '/wp-json/wp/v2/posts?slug=' + encodeURIComponent(_slugFromUrl(url)) + '&_fields=categories')
    .then(function (posts) {
      if (!posts || !posts.length || !posts[0].categories || !posts[0].categories.length)
        throw new Error('AnimeOwl: no category for episode');
      var catId = posts[0].categories[0];
      return _getJson(SITE + '/wp-json/wp/v2/categories/' + catId + '?_fields=link,name,slug')
        .then(function (cat) {
          if (!cat || !cat.link) throw new Error('AnimeOwl: category fetch failed');
          return { link: cat.link, name: _htmlUnesc(cat.name), id: catId };
        });
    });
}
function _slugFromUrl(url) {
  var m = String(url || '').match(/\/([^\/]+)\/?$/);
  return m ? m[1] : '';
}

function _seriesDetail(seriesUrl, seriesName, catId) {
  return _get(seriesUrl).then(function (html) {
    if (!html) throw new Error('AnimeOwl: series page fetch failed');
    var c = html.match(/<meta property="og:image" content="([^"]+)"/);
    var d = html.match(/<meta property="og:description" content="([^"]+)"/);
    var t = html.match(/<meta property="og:title" content="([^"]+)"/);
    var title = _htmlUnesc(t ? t[1] : seriesName || '').replace(/\s*[–\-|].*$/, '').trim();
    return _getJson(SITE + '/wp-json/wp/v2/posts?categories=' + catId +
      '&per_page=100&orderby=date&order=asc&_fields=slug,link,title')
      .then(function (posts) {
        var eps = [];
        if (posts) for (var i = 0; i < posts.length; i++) {
          var p = posts[i], pt = _htmlUnesc(p.title && p.title.rendered);
          var n = _epNumFromTitle(pt);
          if (n == null) continue;
          eps.push({ id: 'animeowl:ep:' + n + ':' + p.link, title: 'Episode ' + n,
            url: p.link, number: n });
        }
        eps.sort(function (a, b) { return a.number - b.number; });
        return { id: 'animeowl:' + seriesUrl, title: title || seriesUrl, url: seriesUrl,
          type: 'anime', cover: c ? c[1] : null,
          description: _htmlUnesc(d ? d[1] : null), episodes: eps };
      });
  });
}

function getDetail(url, opts) {
  if (/\/anime\//.test(url)) {
    // series URL -> resolve the category id via categories?slug=
    var slug = _slugFromUrl(url);
    return _getJson(SITE + '/wp-json/wp/v2/categories?slug=' + encodeURIComponent(slug) + '&_fields=id,link,name')
      .then(function (cats) {
        if (!cats || !cats.length) throw new Error('AnimeOwl: series not found');
        return _seriesDetail(cats[0].link, _htmlUnesc(cats[0].name), cats[0].id);
      });
  }
  return _seriesUrlFromEpisode(url).then(function (s) {
    return _seriesDetail(s.link, s.name, s.id);
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  return _get(episodeUrl).then(function (html) {
    if (!html) throw new Error('AnimeOwl: episode page fetch failed');
    var m = html.match(/<iframe[^>]+src="([^"]*megaplay[^"]*)"/);
    if (!m) throw new Error('AnimeOwl: no megaplay iframe on episode page');
    var id = (m[1].match(/\/stream\/s-\d+\/([^\/\?#]+)/) || [])[1];
    if (!id) throw new Error('AnimeOwl: no stream id in iframe url');
    return _getJson(MEGA + '/stream/getSourcesNew?id=' + encodeURIComponent(id), m[1])
      .then(function (j) {
        if (!j) throw new Error('AnimeOwl: getSourcesNew failed');
        var r = _fileFromSources(j);
        if (!r || !r.file) throw new Error('AnimeOwl: no stream file resolved');
        var subs = [];
        var tr = r.tracks || [];
        for (var i = 0; i < tr.length; i++) {
          if (tr[i] && tr[i].file && /caption/i.test(tr[i].kind || '')) {
            subs.push({ url: tr[i].file, lang: 'en', label: tr[i].label || 'English' });
          }
        }
        return [{ url: r.file, quality: 'Auto', container: 'hls', label: 'AnimeOwl',
          headers: { Referer: MEGA + '/', 'User-Agent': UA },
          subtitles: subs, kind: 'sub' }];
      });
  });
}
