/*
 * VidZee — movies + TV series via VidZee's public plaintext stream API.
 *
 * VERIFIED chain (2026-10-09, plain HTTP, no login, no crypto, no browser):
 *   GET https://core.vidzee.wtf/streams/movie/{tmdbId}?s={server}&e=0
 *   GET https://core.vidzee.wtf/streams/tv/{tmdbId}/{s}/{e}?s={server}&e=0
 *     -> {"language":"Auto","url":"https://<cdn>/.../master.m3u8","headers":{}}
 *        (the `e=0` flag opts out of the encrypted envelope; without it the
 *        payload is encrypted and unresolvable in this JS runtime)
 *   The returned URL is a valid #EXTM3U VOD playlist. Playback wants
 *   Referer: https://player.vidzee.wtf/ (sent in entry headers).
 *
 * Servers (queried in parallel, every responder becomes a listed source):
 *   dcloud, ipcloud, tik. Bad names return {"error":"Unknown server"} and
 *   are skipped; a 502ing server is skipped too. Availability varies by
 *   title and day — racing several servers is what makes this reliable.
 *
 * Metadata is TMDB-keyed: search/home/detail/episode lists come from the
 * TMDB API using the repo's shared built-in key (empty settings field =
 * built-in active; paste your own key to override). Stream URLs are
 * signed/expiring, so getVideoSources re-resolves them fresh on playback.
 * ES5 only.
 */

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'vidzee';

var _VZ_API = 'https://core.vidzee.wtf';
var _VZ_PLAYER_REFERER = 'https://player.vidzee.wtf/';
var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _IMG_BASE = 'https://image.tmdb.org/t/p/w500';
var _UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

/* servers tried for every title; all that answer become sources */
var _VZ_SERVERS = ['dcloud', 'ipcloud', 'tik'];

/* ---- Settings (hidden built-in key pattern: empty = built-in active) ---- */
function getSettings() {
  return [
    {
      key: 'tmdbApiKey',
      label: 'TMDB API Key (built-in active — paste yours to override)',
      type: 'text',
      default: ''
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings[SOURCE_ID]) || {};
    var v = s[key];
    return (v === undefined || v === null) ? def : v;
  } catch (e) {
    return def;
  }
}

var _BUILTIN_TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
function _tmdbKey() {
  var k = _cfg('tmdbApiKey', '');
  return k || _BUILTIN_TMDB_KEY;
}

/* ---- Info ---- */
function getInfo() {
  return {
    name: 'VidZee',
    lang: 'en',
    baseUrl: 'https://vidzee.wtf',
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/vidzee.png',
    type: 'movie',
    version: '1.0.0'
  };
}

/* ---- Fail-fast HTTP ---- */
function _timeout(ms, what) {
  return new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error('timeout: ' + what)); }, ms);
  });
}

function _race(p, ms, what) {
  if (typeof setTimeout === 'undefined') return p;
  return Promise.race([p, _timeout(ms, what)]);
}

function _getJson(url, headers, what) {
  var h = headers || {};
  if (!h['User-Agent']) h['User-Agent'] = _UA;
  return _race(
    fetch(url, { headers: h }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + what);
      return r.json();
    }),
    15000, what
  );
}

function _getText(url, headers, what) {
  var h = headers || {};
  if (!h['User-Agent']) h['User-Agent'] = _UA;
  return _race(
    fetch(url, { headers: h }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + what);
      return r.text();
    }),
    15000, what
  );
}

/* ---- Opaque URL scheme: vidzee://movie/{tmdbId} | vidzee://tv/{tmdbId}/{s}/{e} ---- */
function _parseUrl(url) {
  var m = /^vidzee:\/\/((movie|tv))\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(url || '');
  if (!m) return null;
  return {
    kind: m[1],
    tmdbId: m[3],
    season: m[4] ? parseInt(m[4], 10) : null,
    episode: m[5] ? parseInt(m[5], 10) : null
  };
}

function _tmdbItem(kind, r) {
  if (!r || !r.id) return null;
  var mt = (r.media_type === 'tv' || kind === 'tv') ? 'tv' : 'movie';
  var title = r.title || r.name || ('TMDB ' + r.id);
  var y = r.release_date || r.first_air_date || '';
  var year = y ? y.slice(0, 4) : null;
  return {
    id: 'vidzee://' + mt + '/' + r.id,
    title: title + (year ? ' (' + year + ')' : ''),
    url: 'vidzee://' + mt + '/' + r.id,
    type: 'movie',
    cover: r.poster_path ? _IMG_BASE + r.poster_path : undefined,
    banner: r.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + r.backdrop_path : undefined
  };
}

/* ---- Home: TMDB trending rows ---- */
function getHome(opts) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set.'));
  var movies = _getJson(_TMDB_BASE + '/trending/movie/week?api_key=' + encodeURIComponent(key), null, 'home:trending-movie');
  var series = _getJson(_TMDB_BASE + '/trending/tv/week?api_key=' + encodeURIComponent(key), null, 'home:trending-tv');
  return Promise.all([movies, series]).then(function (res) {
    var rows = [];
    var mItems = ((res[0] && res[0].results) || []).map(function (r) { return _tmdbItem('movie', r); })
      .filter(function (x) { return !!x; });
    var tItems = ((res[1] && res[1].results) || []).map(function (r) { return _tmdbItem('tv', r); })
      .filter(function (x) { return !!x; });
    if (mItems.length) rows.push({ title: 'Trending Movies', items: mItems.slice(0, 24) });
    if (tItems.length) rows.push({ title: 'Trending Series', items: tItems.slice(0, 24) });
    return rows;
  });
}

/* ---- Search: TMDB multi (movies + series only) ---- */
function search(query, page, opts) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set.'));
  return _getJson(_TMDB_BASE + '/search/multi?api_key=' + encodeURIComponent(key) +
    '&query=' + encodeURIComponent(query || '') +
    '&page=' + (page || 1) + '&include_adult=false', null, 'search').then(function (d) {
    return ((d && d.results) || [])
      .filter(function (r) { return r && (r.media_type === 'movie' || r.media_type === 'tv'); })
      .map(function (r) { return _tmdbItem(r.media_type, r); })
      .filter(function (x) { return !!x; });
  });
}

/* ---- Detail ---- */
function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set.'));
  return _getJson(_TMDB_BASE + '/' + p.kind + '/' + p.tmdbId + '?api_key=' + encodeURIComponent(key),
    null, 'detail').then(function (d) {
    var title = d.title || d.name || ('TMDB ' + p.tmdbId);
    var y = d.release_date || d.first_air_date || '';
    var detail = {
      id: url,
      title: title,
      url: url,
      type: 'movie',
      cover: d.poster_path ? _IMG_BASE + d.poster_path : undefined,
      banner: d.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + d.backdrop_path : undefined,
      description: d.overview || undefined,
      year: y ? String(y.slice(0, 4)) : null
    };
    if (p.kind === 'movie') {
      detail.episodes = [{ id: url, title: 'Movie', url: url, number: 1 }];
      return detail;
    }
    var eps = [];
    var n = 0;
    ((d.seasons) || []).forEach(function (sn) {
      var s = sn.season_number;
      var cnt = sn.episode_count || 0;
      if (s === 0 || !cnt) return;
      for (var e = 1; e <= cnt; e++) {
        n++;
        eps.push({
          id: 'vidzee://tv/' + p.tmdbId + '/' + s + '/' + e,
          title: 'S' + s + ' E' + e,
          url: 'vidzee://tv/' + p.tmdbId + '/' + s + '/' + e,
          number: n
        });
      }
    });
    detail.episodes = eps;
    return detail;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

/* ---- VidZee resolver ---- */
function _streamsUrl(p, server) {
  var path = (p.kind === 'movie')
    ? '/streams/movie/' + p.tmdbId
    : '/streams/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode;
  return _VZ_API + path + '?s=' + encodeURIComponent(server) + '&e=0';
}

/* One server's answer -> VideoSource entries (quality-expanded). */
function _unlockServer(p, server) {
  var streamHeaders = { 'Referer': _VZ_PLAYER_REFERER, 'User-Agent': _UA };
  return _getJson(_streamsUrl(p, server), null, 'vidzee:' + server)
    .then(function (j) {
      var url = j && j.url;
      if (!url || !/^https?:\/\//i.test(url)) throw new Error('no stream url from ' + server);
      var lang = (j.language && j.language !== 'Auto') ? ' [' + j.language + ']' : '';
      return {
        url: url,
        server: server,
        label: 'VidZee [' + server + ']' + lang
      };
    })
    .then(function (base) {
      // Quality expansion: one entry per master-playlist variant.
      return _race(_getText(base.url, streamHeaders, 'vidzee:playlist:' + server), 5000, 'playlist:' + server)
        .then(function (pl) { return _expandQualities(base, pl, streamHeaders); })
        .catch(function () { return [_entry(base, base.url, 'Auto', streamHeaders, null)]; });
    });
}

function _entry(base, url, quality, headers, subs) {
  return {
    url: url,
    quality: quality,
    label: base.label + ' ' + quality,
    container: 'hls',
    kind: 'sub',
    headers: headers,
    subtitles: subs || []
  };
}

function _qualityOfVariant(res, bw) {
  var m = /(\d+)[xX](\d+)/.exec(String(res || ''));
  if (m) {
    var h = parseInt(m[2], 10);
    if (h >= 2000) return '2160p';
    if (h >= 1000) return '1080p';
    if (h >= 700) return '720p';
    if (h >= 450) return '480p';
    return h + 'p';
  }
  var b = parseInt(bw, 10) || 0;
  if (b >= 6000000) return '1080p';
  if (b >= 2500000) return '720p';
  if (b >= 1000000) return '480p';
  return 'Auto';
}

function _expandQualities(base, playlist, headers) {
  var lines = String(playlist || '').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l.indexOf('#EXT-X-STREAM-INF') === 0) {
      var bw = (/BANDWIDTH=(\d+)/.exec(l) || [])[1];
      var res = (/RESOLUTION=([0-9xX]+)/.exec(l) || [])[1];
      var next = (lines[i + 1] || '').trim();
      if (next && next.charAt(0) !== '#') {
        out.push(_entry(base, _absUrl(next, base.url), _qualityOfVariant(res, bw), headers, null));
      }
    }
  }
  if (!out.length) return [_entry(base, base.url, 'Auto', headers, null)];
  // highest first
  var rank = function (q) {
    var m = /(\d+)p/.exec(String(q));
    return m ? parseInt(m[1], 10) : 0;
  };
  out.sort(function (a, b) { return rank(b.quality) - rank(a.quality); });
  out.unshift(_entry(base, base.url, 'Auto', headers, null));
  return out;
}

function _absUrl(u, base) {
  u = String(u || '').trim();
  if (!u) return base;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/') {
    var m = /^(https?:\/\/[^\/]+)/.exec(base || '');
    return m ? m[1] + u : u;
  }
  var d = String(base || '');
  var cut = d.lastIndexOf('/');
  return cut > 0 ? d.slice(0, cut + 1) + u : u;
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('bad episode url: ' + episodeUrl));
  var jobs = _VZ_SERVERS.map(function (server) {
    return _unlockServer(p, server).catch(function () { return null; });
  });
  // hard overall budget so the source sheet never spins forever
  return _race(Promise.all(jobs), 45000, 'vidzee:all-servers').then(function (lists) {
    var sources = [];
    lists.forEach(function (l) {
      if (l && l.length) sources = sources.concat(l);
    });
    if (!sources.length) throw new Error('all VidZee servers failed for ' + episodeUrl);
    return sources;
  });
}
