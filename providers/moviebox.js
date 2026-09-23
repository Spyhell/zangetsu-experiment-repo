var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'moviebox';

/*
 * MovieBox provider for Zangetsu.
 *
 * Uses the MovieBox V3 mobile JSON API (api3..api6.aoneroom.com,
 * /wefeed-mobile-bff/subject-api/*). Every request is signed with HMAC-MD5
 * (pure-JS implementation below, no platform crypto needed).
 *
 * Endpoints:
 *   POST /wefeed-mobile-bff/subject-api/search/v2   {keyword,page,perPage}
 *   GET  /wefeed-mobile-bff/tab-operating?page=1&tabId=<id>&version=1
 *   GET  /wefeed-mobile-bff/subject-api/play-info?subjectId=&se=&ep=
 *   GET  /wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=
 *   GET  /wefeed-mobile-bff/subject-api/season-info?subjectId=  (often 407;
 *        falls back to probing play-info for the episode list)
 *
 * Episode URL scheme: moviebox:episode:<subjectId>:<season>:<episode>
 * Detail URL scheme:  moviebox:subject:<subjectId>
 */

var MB_HOSTS = [
  'https://api3.aoneroom.com',
  'https://api4.aoneroom.com',
  'https://api5.aoneroom.com',
  'https://api6.aoneroom.com'
];
var MB_HMAC_KEY_B64 = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';
var MB_APP_ID = '302770f8bb6543ce8bdff585943a1eca';
var MB_APP_KEY = 'a9d263ae575d4f5d94eab086a150c67e';
var MB_UA = 'MovieBoxPro/16.2.1 (Android 12; Pixel 6)';
var MB_SITE = 'https://moviebox.ph';
var MB_HOST_IDX = 0;
var MB_CACHE = {}; /* subjectId -> raw search item */

/* ------------------------------------------------------------------ */
/* crypto: md5 / hmac-md5 / base64, pure ES5                            */
/* ------------------------------------------------------------------ */

function mb_utf8Bytes(str) {
  var bytes = [], i, c, c2, cp;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                   0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

function mb_md5_raw(input) {
  var bytes = input.slice();
  var origBitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  var lo = origBitLen >>> 0, hi = Math.floor(origBitLen / 4294967296), i;
  for (i = 0; i < 4; i++) { bytes.push(lo & 0xff); lo >>>= 8; }
  for (i = 0; i < 4; i++) { bytes.push(hi & 0xff); hi >>>= 8; }

  var s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
           5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
           4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
           6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var K = [];
  for (i = 0; i < 64; i++) K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  var M, A, B, C, D, F, g, j, tmp;

  for (var off = 0; off < bytes.length; off += 64) {
    M = [];
    for (j = 0; j < 16; j++) {
      M.push((bytes[off + j * 4] | (bytes[off + j * 4 + 1] << 8) |
              (bytes[off + j * 4 + 2] << 16) | (bytes[off + j * 4 + 3] << 24)) | 0);
    }
    A = a0; B = b0; C = c0; D = d0;
    for (i = 0; i < 64; i++) {
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      tmp = D; D = C; C = B;
      F = (F + A + K[i] + M[g]) | 0;
      B = (B + (((F << s[i]) | (F >>> (32 - s[i]))) | 0)) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  var out = [], w;
  var words = [a0, b0, c0, d0];
  for (i = 0; i < 4; i++) {
    w = words[i];
    out.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff);
  }
  return out;
}

function mb_bytesToHex(bytes) {
  var h = '0123456789abcdef', s = '';
  for (var i = 0; i < bytes.length; i++) s += h[(bytes[i] >> 4) & 15] + h[bytes[i] & 15];
  return s;
}

function mb_md5_hex(str) {
  return mb_bytesToHex(mb_md5_raw(mb_utf8Bytes(str)));
}

function mb_hmac_md5_raw(keyBytes, msgBytes) {
  var k = keyBytes.slice(0), i;
  if (k.length > 64) k = mb_md5_raw(k);
  while (k.length < 64) k.push(0);
  var ipad = [], opad = [];
  for (i = 0; i < 64; i++) { ipad.push(k[i] ^ 0x36); opad.push(k[i] ^ 0x5c); }
  return mb_md5_raw(opad.concat(mb_md5_raw(ipad.concat(msgBytes))));
}

var MB_B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function mb_b64enc(bytes) {
  var s = '', i, a, b, c;
  for (i = 0; i < bytes.length; i += 3) {
    a = bytes[i]; b = (i + 1 < bytes.length) ? bytes[i + 1] : 0; c = (i + 2 < bytes.length) ? bytes[i + 2] : 0;
    s += MB_B64_CHARS[a >> 2] + MB_B64_CHARS[((a & 3) << 4) | (b >> 4)];
    s += (i + 1 < bytes.length) ? MB_B64_CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    s += (i + 2 < bytes.length) ? MB_B64_CHARS[c & 63] : '=';
  }
  return s;
}

function mb_b64dec(str) {
  var map = {}, i;
  for (i = 0; i < 64; i++) map[MB_B64_CHARS.charAt(i)] = i;
  str = String(str).replace(/[^A-Za-z0-9+\/=]/g, '');
  var out = [], a, b, c, d;
  for (i = 0; i < str.length; i += 4) {
    a = map[str.charAt(i)] || 0; b = map[str.charAt(i + 1)] || 0;
    c = map[str.charAt(i + 2)] || 0; d = map[str.charAt(i + 3)] || 0;
    out.push((a << 2) | (b >> 4));
    if (str.charAt(i + 2) !== '=') out.push(((b & 15) << 4) | (c >> 2));
    if (str.charAt(i + 3) !== '=') out.push(((c & 3) << 6) | d);
  }
  return out;
}

function mb_b64decStr(str) {
  var bytes = mb_b64dec(str), s = '', i;
  for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/* ------------------------------------------------------------------ */
/* request signing                                                     */
/* ------------------------------------------------------------------ */

function mb_revStr(s) {
  var r = '';
  for (var i = s.length - 1; i >= 0; i--) r += s.charAt(i);
  return r;
}

function mb_sortQuery(path) {
  var i = path.indexOf('?');
  if (i < 0) return path;
  var base = path.slice(0, i);
  var parts = path.slice(i + 1).split('&');
  parts.sort();
  return base + '?' + parts.join('&');
}

function mb_sign(method, path, body) {
  var ts = String(new Date().getTime());
  var clientToken = ts + ',' + mb_md5_hex(mb_revStr(ts));
  var bodyLen = '', bodyHash = '';
  if (body) {
    var bb = mb_utf8Bytes(body);
    bodyLen = String(bb.length);
    bodyHash = mb_bytesToHex(mb_md5_raw(bb));
  }
  var canon = method + '\n' + 'application/json' + '\n' + 'application/json' + '\n' +
              bodyLen + '\n' + ts + '\n' + bodyHash + '\n' + mb_sortQuery(path);
  var keyBytes = mb_b64dec(MB_HMAC_KEY_B64);
  var sig = mb_b64enc(mb_hmac_md5_raw(keyBytes, mb_utf8Bytes(canon)));
  return { clientToken: clientToken, signature: ts + '|2|' + sig };
}

/* ------------------------------------------------------------------ */
/* http                                                                */
/* ------------------------------------------------------------------ */

function mb_fetchJson(method, path, body) {
  var attempt = 0;
  function tryHost() {
    if (attempt >= MB_HOSTS.length) {
      return Promise.reject(new Error('MovieBox: all hosts failed'));
    }
    var host = MB_HOSTS[(MB_HOST_IDX + attempt) % MB_HOSTS.length];
    var s = mb_sign(method, path, body || '');
    var opt = {
      headers: {
        'X-Client-Token': s.clientToken,
        'x-tr-signature': s.signature,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-client-status': '0',
        'appid': MB_APP_ID,
        'appkey': MB_APP_KEY,
        'lang': 'en',
        'os': 'android',
        'User-Agent': MB_UA
      },
      timeoutMs: 15000
    };
    if (method === 'POST') { opt.method = 'POST'; opt.body = body || ''; }
    return fetch(host + path, opt).then(function (r) {
      var txt = (r && typeof r.body === 'string') ? r.body : '';
      var j;
      try { j = JSON.parse(txt); }
      catch (e) { throw new Error('MovieBox: invalid JSON from ' + host); }
      return j;
    }).catch(function () {
      attempt++;
      MB_HOST_IDX = (MB_HOST_IDX + 1) % MB_HOSTS.length;
      return tryHost();
    });
  }
  return tryHost();
}

/* Unwraps the {code,message,data} envelope; rejects on non-zero code. */
function mb_api(method, path, body) {
  return mb_fetchJson(method, path, body).then(function (j) {
    if (j && typeof j === 'object' && typeof j.code === 'number') {
      if (j.code !== 0) {
        throw new Error('MovieBox: api error ' + j.code + ' ' + (j.message || j.reason || ''));
      }
      return (j.data != null) ? j.data : j;
    }
    return j;
  });
}

/* ------------------------------------------------------------------ */
/* parsing helpers                                                     */
/* ------------------------------------------------------------------ */

function mb_abs(u) {
  u = String(u || '');
  if (!u) return null;
  if (u.indexOf('http') === 0) return u.split(' ').join('%20');
  return (MB_SITE + (u.charAt(0) === '/' ? '' : '/') + u).split(' ').join('%20');
}

function mb_typeOf(subjectType) {
  return (subjectType === 2 || subjectType === 3) ? 'tv' : 'movie';
}

function mb_toMediaItem(it) {
  try {
    var sid = String(it.subjectId || '');
    if (!sid) return null;
    MB_CACHE[sid] = it;
    return {
      id: sid,
      title: String(it.title || 'Unknown'),
      url: 'moviebox:subject:' + sid,
      cover: mb_abs(it.cover && it.cover.url),
      type: mb_typeOf(it.subjectType),
      sourceId: SOURCE_ID
    };
  } catch (e) { return null; }
}

function mb_subjectsFromData(data) {
  var out = [];
  try {
    var items = [];
    if (data) {
      if (data.list && data.list.length) items = data.list;
      else if (data.results) {
        for (var i = 0; i < data.results.length; i++) {
          var subs = data.results[i].subjects || [];
          for (var j = 0; j < subs.length; j++) items.push(subs[j]);
        }
      } else if (Object.prototype.toString.call(data) === '[object Array]') items = data;
    }
    for (var k = 0; k < items.length; k++) {
      if (items[k] && items[k].subjectType > 3) continue;
      var m = mb_toMediaItem(items[k]);
      if (m) out.push(m);
    }
  } catch (e) {}
  return out;
}

function mb_epUrl(sid, se, ep) {
  return 'moviebox:episode:' + sid + ':' + se + ':' + ep;
}

function mb_ep(sid, se, ep, title) {
  var u = mb_epUrl(sid, se, ep);
  return { id: u, number: 0, title: String(title || ('S' + se + ' E' + ep)), url: u };
}

/* ------------------------------------------------------------------ */
/* contract                                                            */
/* ------------------------------------------------------------------ */

function getInfo() {
  return {
    name: 'MovieBox',
    lang: 'en',
    baseUrl: 'https://api3.aoneroom.com',
    logo: 'https://moviebox.ph/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

function search(query, page, opts) {
  var q = String(query || '').replace(/^\s+|\s+$/g, '');
  var p = parseInt(page, 10);
  if (!(p > 0)) p = 1;
  if (!q) return Promise.resolve([]);
  var body = JSON.stringify({ keyword: q, page: p, perPage: 20 });
  return mb_api('POST', '/wefeed-mobile-bff/subject-api/search/v2', body)
    .then(function (data) { return mb_subjectsFromData(data); })
    .catch(function () { return []; });
}

function getHome(opts) {
  var tabs = [
    { id: 'movie', title: 'Trending Movies' },
    { id: 'tv', title: 'Trending TV Shows' },
    { id: 'movie_new', title: 'New Movies' },
    { id: 'tv_new', title: 'New TV Shows' }
  ];
  var jobs = tabs.map(function (t) {
    return mb_api('GET', '/wefeed-mobile-bff/tab-operating?page=1&tabId=' + t.id + '&version=1', '')
      .then(function (data) { return { title: t.title, items: mb_subjectsFromData(data) }; })
      .catch(function () { return { title: t.title, items: [] }; });
  });
  return Promise.all(jobs).then(function (rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].items.length) out.push(rows[i]);
    }
    return out;
  });
}

function mb_itemFromDetail(data, sid) {
  try {
    if (!data || typeof data !== 'object') return null;
    var d = (data.data && typeof data.data === 'object') ? data.data : data;
    if (!d || (d.subjectId != null && String(d.subjectId) !== String(sid))) {
      if (!d.title) return null;
    }
    return {
      subjectId: sid,
      title: d.title,
      subjectType: d.subjectType || 1,
      releaseDate: d.releaseDate || '',
      duration: d.duration || '',
      genre: d.genre || '',
      seNum: d.seNum || 0,
      imdbRatingValue: d.imdbRatingValue || d.imdbRating || '',
      countryName: d.countryName || '',
      language: d.language || '',
      description: d.description || d.synopsis || '',
      cover: d.cover || (d.coverUrl ? { url: d.coverUrl } : null)
    };
  } catch (e) { return null; }
}

function mb_buildDetail(sid, item, episodes) {
  var genres = [];
  if (item && item.genre) {
    var gs = String(item.genre).split(',');
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i].replace(/^\s+|\s+$/g, '');
      if (g) genres.push(g);
    }
  }
  return {
    id: sid,
    title: item ? String(item.title || 'Unknown') : 'Unknown',
    url: 'moviebox:subject:' + sid,
    cover: (item && item.cover) ? mb_abs(item.cover.url) : null,
    description: item ? String(item.description || '') : '',
    status: null,
    genres: genres,
    studios: [],
    type: item ? mb_typeOf(item.subjectType) : 'movie',
    sourceId: SOURCE_ID,
    episodes: episodes || [],
    subCount: null,
    dubCount: null
  };
}

function getDetail(url, opts) {
  var m = /^moviebox:subject:([0-9]+)$/.exec(String(url || ''));
  if (!m) return Promise.reject(new Error('MovieBox: bad detail url'));
  var sid = m[1];
  var item = MB_CACHE[sid] || null;

  function finish(it) {
    var type = it ? mb_typeOf(it.subjectType) : 'movie';
    if (type === 'movie') {
      var ep = mb_ep(sid, 0, 0, it ? it.title : 'Movie');
      ep.number = 1;
      return Promise.resolve(mb_buildDetail(sid, it, [ep]));
    }
    return mb_seriesEpisodes(sid, it).then(function (eps) {
      return mb_buildDetail(sid, it, eps);
    });
  }

  if (item) return finish(item);
  /* Not from search/home: try the detail endpoint (often 407 without login). */
  return mb_api('GET', '/wefeed-mobile-bff/subject-api/get?subjectId=' + encodeURIComponent(sid), '')
    .then(function (data) {
      var it2 = mb_itemFromDetail(data, sid);
      if (it2) MB_CACHE[sid] = it2;
      return finish(it2);
    })
    .catch(function () { return finish(null); });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

/* Try season-info; fall back to probing play-info per episode. */
function mb_seriesEpisodes(sid, item) {
  return mb_api('GET', '/wefeed-mobile-bff/subject-api/season-info?subjectId=' + encodeURIComponent(sid), '')
    .then(function (data) {
      var eps = mb_parseSeasonInfo(sid, data);
      if (eps && eps.length) return eps;
      return mb_probeEpisodes(sid, item);
    })
    .catch(function () { return mb_probeEpisodes(sid, item); });
}

function mb_parseSeasonInfo(sid, data) {
  var eps = [], n = 0;
  try {
    var seasons = [];
    if (data) {
      if (Object.prototype.toString.call(data) === '[object Array]') seasons = data;
      else if (data.seasons && data.seasons.length) seasons = data.seasons;
      else if (data.list && data.list.length) seasons = data.list;
    }
    for (var i = 0; i < seasons.length; i++) {
      var s = seasons[i] || {};
      var se = parseInt(s.season || s.se || s.seasonNumber || (i + 1), 10) || (i + 1);
      var list = s.episodes || s.episodeList || s.eps || [];
      for (var j = 0; j < list.length; j++) {
        var e = list[j] || {};
        var ep = parseInt(e.episode || e.ep || e.episodeNumber || e.number || (j + 1), 10) || (j + 1);
        n++;
        var o = mb_ep(sid, se, ep, e.title || e.name || ('S' + se + ' E' + ep));
        o.number = n;
        eps.push(o);
      }
    }
    if (!eps.length && data && data.episodes && data.episodes.length) {
      for (var k = 0; k < data.episodes.length; k++) {
        var f = data.episodes[k] || {};
        var fse = parseInt(f.season || f.se || 1, 10) || 1;
        var fep = parseInt(f.episode || f.ep || (k + 1), 10) || (k + 1);
        n++;
        var o2 = mb_ep(sid, fse, fep, f.title || f.name || ('S' + fse + ' E' + fep));
        o2.number = n;
        eps.push(o2);
      }
    }
  } catch (e) {}
  return eps;
}

/* Raw play-info (no envelope rejection); resolves null on failure. */
function mb_playInfo(sid, se, ep) {
  var path = '/wefeed-mobile-bff/subject-api/play-info?subjectId=' + encodeURIComponent(sid) +
             '&se=' + se + '&ep=' + ep;
  return mb_fetchJson('GET', path, '').then(function (j) {
    if (!j || typeof j !== 'object') return null;
    if (typeof j.code === 'number' && j.code !== 0) return null;
    var d = (j.data && typeof j.data === 'object' && !j.hls && !j.streams) ? j.data : j;
    return d;
  }).catch(function () { return null; });
}

function mb_probeSeason(sid, se) {
  var eps = [];
  var MAX_EP = 80, BATCH = 6;
  function batch(start) {
    if (start > MAX_EP) return Promise.resolve(eps);
    var ps = [];
    for (var e = start; e < start + BATCH && e <= MAX_EP; e++) ps.push(mb_playInfo(sid, se, e));
    return Promise.all(ps).then(function (rs) {
      for (var i = 0; i < rs.length; i++) {
        if (!rs[i] || !rs[i].hasResource) return eps; /* stop at first miss */
        eps.push(mb_ep(sid, se, start + i, 'S' + se + ' E' + (start + i)));
      }
      if (rs.length < BATCH) return eps;
      return batch(start + BATCH);
    });
  }
  return batch(1).catch(function () { return eps; });
}

function mb_probeEpisodes(sid, item) {
  var seNum = (item && item.seNum > 0) ? item.seNum : 1;
  if (seNum > 10) seNum = 10;
  var jobs = [];
  for (var s = 1; s <= seNum; s++) jobs.push(mb_probeSeason(sid, s));
  return Promise.all(jobs).then(function (lists) {
    var eps = [], n = 0;
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        n++;
        lists[i][j].number = n;
        eps.push(lists[i][j]);
      }
    }
    return eps;
  });
}

/* ------------------------------------------------------------------ */
/* streams                                                             */
/* ------------------------------------------------------------------ */

function mb_qrank(q) {
  var s = String(q == null ? '' : q).toLowerCase();
  if (s.indexOf('4k') >= 0) return 2160;
  var m = /(\d{3,4})/.exec(s);
  return m ? parseInt(m[1], 10) : 0;
}

function mb_normQuality(q) {
  if (q == null || q === '') return 'unknown';
  var s = String(q);
  if (/^\d+$/.test(s)) return s + 'p';
  if (/^\d{3,4}p$/i.test(s)) return s.toLowerCase();
  if (/4k/i.test(s)) return '4K';
  return s;
}

/*
 * Anti-piracy dummy-video bypass (v4.0.02+): the real stream base is hidden
 * in signCookie as urlprefix=<base64>. Decode it and append the manifest.
 */
function mb_unwrapSignCookie(sc) {
  try {
    sc = String(sc || '');
    var i = sc.indexOf('urlprefix=');
    if (i < 0) return null;
    var rest = sc.slice(i + 10).split(/[&\s'";]/)[0];
    if (!rest) return null;
    var base = mb_b64decStr(rest);
    if (base.indexOf('http') !== 0) return null;
    if (base.charAt(base.length - 1) !== '/') base += '/';
    if (base.indexOf('/dash/') >= 0) return { url: base + 'index.mpd', container: 'unknown' };
    return { url: base + 'index.m3u8', container: 'hls' };
  } catch (e) { return null; }
}

function mb_containerOf(url, hlsHint) {
  if (hlsHint || /\.m3u8(\?|#|$)/i.test(url)) return 'hls';
  if (/\.mp4(\?|#|$)/i.test(url)) return 'mp4';
  return 'unknown'; /* never 'webm' */
}

function mb_collectStreams(pi) {
  var out = [], seen = {};
  function add(url, quality, container) {
    if (!url) return;
    url = String(url).split(' ').join('%20');
    if (url.indexOf('http') !== 0 || seen[url]) return;
    seen[url] = 1;
    out.push({ url: url, quality: quality, container: container });
  }
  if (!pi || typeof pi !== 'object') return out;

  var groups = [];
  if (pi.hls && pi.hls.length) groups.push({ arr: pi.hls, hls: true });
  if (pi.streams && pi.streams.length) groups.push({ arr: pi.streams, hls: false });
  if (pi.streamList && pi.streamList.length) groups.push({ arr: pi.streamList, hls: false });

  for (var i = 0; i < groups.length; i++) {
    var arr = groups[i].arr.slice().sort(function (a, b) {
      return mb_qrank(b && (b.quality || b.resolution)) - mb_qrank(a && (a.quality || a.resolution));
    });
    for (var j = 0; j < arr.length; j++) {
      var e = arr[j] || {};
      var q = mb_normQuality(e.quality != null ? e.quality : e.resolution);
      var real = mb_unwrapSignCookie(e.signCookie);
      if (real) { add(real.url, q, real.container); continue; }
      if (!e.url) continue;
      add(e.url, q, mb_containerOf(e.url, groups[i].hls));
    }
  }

  var dls = (pi.downloads || []).slice().sort(function (a, b) {
    return ((b && b.resolution) || 0) - ((a && a.resolution) || 0);
  });
  for (var k = 0; k < dls.length; k++) {
    var d = dls[k] || {};
    if (!d.url) continue;
    add(d.url, d.resolution ? (d.resolution + 'p') : 'unknown', mb_containerOf(d.url, false));
  }
  return out;
}

function mb_subtitles(sid) {
  return mb_fetchJson('GET', '/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=' + encodeURIComponent(sid), '')
    .then(function (j) {
      var caps = [];
      if (j) {
        if (j.captions && j.captions.length) caps = j.captions;
        else if (j.data && j.data.captions && j.data.captions.length) caps = j.data.captions;
      }
      var out = [];
      for (var i = 0; i < caps.length; i++) {
        try {
          var c = caps[i] || {};
          var u = mb_abs(c.url);
          if (!u) continue;
          var lang = String(c.language || c.captionName || 'en');
          var label = String(c.captionName || c.language || lang);
          out.push({
            url: u,
            lang: lang,
            label: label,
            format: /\.srt(\?|#|$)/i.test(u) ? 'srt' : 'vtt'
          });
        } catch (e) {}
      }
      return out;
    })
    .catch(function () { return []; });
}

function mb_kind(item) {
  var lang = item && item.language ? String(item.language).toLowerCase() : 'en';
  return (lang === 'en' || lang.indexOf('english') === 0) ? 'dub' : 'raw';
}

function mb_audioLang(item) {
  var lang = item && item.language ? String(item.language).toLowerCase() : 'en';
  return (lang === 'en' || lang.indexOf('english') === 0) ? 'en' : null;
}

function getVideoSources(episodeUrl) {
  var m = /^moviebox:episode:([0-9]+):([0-9]+):([0-9]+)$/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('MovieBox: bad episode url'));
  var sid = m[1], se = parseInt(m[2], 10), ep = parseInt(m[3], 10);
  var item = MB_CACHE[sid] || null;

  function withSubs(pi) {
    var streams = mb_collectStreams(pi);
    if (!streams.length) {
      throw new Error('MovieBox: no playable streams (geo-restricted or unavailable)');
    }
    return mb_subtitles(sid).then(function (subs) {
      var out = [];
      for (var i = 0; i < streams.length; i++) {
        out.push({
          url: streams[i].url,
          quality: streams[i].quality,
          container: streams[i].container,
          headers: { 'User-Agent': MB_UA, 'Referer': MB_SITE + '/' },
          kind: mb_kind(item),
          audioLang: mb_audioLang(item),
          subtitles: subs
        });
      }
      return out;
    });
  }

  return mb_playInfo(sid, se, ep).then(function (pi) {
    if (pi && pi.hasResource) return withSubs(pi);
    /* Movie fallback: some clusters expect se=1/ep=1 instead of se=0/ep=0. */
    if (se === 0 && ep === 0) {
      return mb_playInfo(sid, 1, 1).then(function (pi2) { return withSubs(pi2); });
    }
    return withSubs(pi);
  });
}
