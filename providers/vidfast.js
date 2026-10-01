/*
 * VidFast — movies + TV series via vidfast.vc's multi-server resolver.
 *
 * VERIFIED chain (2026-10-01, from this VM; all steps public, no login,
 * no private key):
 *   1. GET https://vidfast.vc/movie/{tmdbId}  (TV: /tv/{tmdbId}/{s}/{e})
 *      -> page HTML; token via regex \\\\"(?:en|token)\\\\":\\\\"(.*?)\\\\"
 *   2. GET https://enc-dec.app/api/enc-vidfast?text=<token>
 *      -> {result:{servers, stream, token}}   (csrf token for player POSTs)
 *   3. POST <servers> with Referer + X-CSRF-Token -> encrypted server list
 *   4. POST https://enc-dec.app/api/dec-vidfast  {text: <serversEnc>}
 *      -> [{name, data, description}]   (6 servers for Fight Club)
 *   5. per server: POST <stream>/<server.data> -> encrypted;
 *      dec-vidfast decrypt -> {url, tracks:[{file,label}]}
 *      (3 of 6 servers unlocked; 404/502 on the rest is normal per docs)
 *   6. url = HLS master playlist (2160p/1080p/720p/...); playable with
 *      Referer: https://vidfast.vc/  (valid #EXTM3U + fMP4 media segments
 *      confirmed via 206 range request)
 *
 * Crypto note: vidfast's player decrypts inside an obfuscated browser
 * bundle, which cannot run in this JS runtime. The chain above replays the
 * same JSON API steps through the public enc-dec.app decrypt relay
 * (unauthenticated, no key needed). If that relay ever goes down, this
 * source degrades to empty results instead of hanging.
 *
 * Metadata is TMDB-keyed: search/home/detail/episode lists come from the
 * TMDB API using the same built-in public key approach as the repo's
 * CineStream source (empty settings field = built-in active; paste your
 * own key to override). Stream URLs are signed/expiring, so
 * getVideoSources re-resolves them fresh on every playback.
 *
 * v1.0.0
 */

var _BASE = 'https://vidfast.vc';
var _ENC_API = 'https://enc-dec.app/api';
var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _IMG_BASE = 'https://image.tmdb.org/t/p/w500';
var _UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/* ---- Settings (matches CineStream's hidden-built-in-key pattern) ---- */
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
    var s = (__settings && __settings.vidfast) || {};
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
    name: 'VidFast',
    lang: 'en',
    baseUrl: _BASE,
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/vidfast.png',
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

function _postJson(url, data, headers, what) {
  var h = headers || {};
  if (!h['User-Agent']) h['User-Agent'] = _UA;
  h['Content-Type'] = 'application/json';
  return _race(
    fetch(url, { method: 'POST', headers: h, body: JSON.stringify(data) }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + what);
      return r.json();
    }),
    15000, what
  );
}

function _postText(url, headers, what) {
  var h = headers || {};
  if (!h['User-Agent']) h['User-Agent'] = _UA;
  return _race(
    fetch(url, { method: 'POST', headers: h }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + what);
      return r.text();
    }),
    15000, what
  );
}

/* ---- Opaque URL scheme: vidfast://movie/{tmdbId} | vidfast://tv/{tmdbId}/{s}/{e} ---- */
function _parseUrl(url) {
  var m = /^vidfast:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(url || '');
  if (!m) return null;
  return {
    kind: m[1],
    tmdbId: m[2],
    season: m[3] ? parseInt(m[3], 10) : null,
    episode: m[4] ? parseInt(m[4], 10) : null
  };
}

function _tmdbItem(kind, r) {
  if (!r || !r.id) return null;
  var mt = (r.media_type === 'tv' || kind === 'tv') ? 'tv' : 'movie';
  var title = r.title || r.name || ('TMDB ' + r.id);
  var y = r.release_date || r.first_air_date || '';
  var year = y ? y.slice(0, 4) : null;
  return {
    id: 'vidfast://' + mt + '/' + r.id,
    title: title + (year ? ' (' + year + ')' : ''),
    url: 'vidfast://' + mt + '/' + r.id,
    type: 'movie',
    cover: r.poster_path ? _IMG_BASE + r.poster_path : undefined,
    banner: r.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + r.backdrop_path : undefined
  };
}

/* ---- Home: TMDB trending rows (no account needed) ---- */
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
      detail.episodes = [{
        id: url,
        title: 'Movie',
        url: url,
        number: 1
      }];
      return detail;
    }
    // TV: build episode list from per-season episode counts (no extra calls per season)
    var eps = [];
    var n = 0;
    ((d.seasons) || []).forEach(function (sn) {
      var s = sn.season_number;
      var cnt = sn.episode_count || 0;
      if (s === 0 || !cnt) return;
      for (var e = 1; e <= cnt; e++) {
        n++;
        eps.push({
          id: 'vidfast://tv/' + p.tmdbId + '/' + s + '/' + e,
          title: 'S' + s + ' E' + e,
          url: 'vidfast://tv/' + p.tmdbId + '/' + s + '/' + e,
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

/* ---- VidFast resolver ---- */
var _SUB_LANGS = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
  portuguese: 'pt', russian: 'ru', arabic: 'ar', hindi: 'hi', tamil: 'ta',
  telugu: 'te', japanese: 'ja', korean: 'ko', chinese: 'zh', dutch: 'nl',
  turkish: 'tr', polish: 'pl', indonesian: 'id', vietnamese: 'vi'
};

function _subLang(label) {
  var l = String(label || '').toLowerCase();
  var k;
  for (k in _SUB_LANGS) {
    if (_SUB_LANGS.hasOwnProperty(k) && l.indexOf(k) === 0) return _SUB_LANGS[k];
  }
  return 'und';
}

function _extractToken(page) {
  var m = /\\"(?:en|token)\\":\\"(.*?)\\"/.exec(String(page || ''));
  return m ? m[1] : null;
}

function _vidfastHeaders(csrf) {
  var h = {
    'User-Agent': _UA,
    'Referer': _BASE + '/',
    'Accept': 'application/json, text/plain, */*'
  };
  if (csrf) h['X-CSRF-Token'] = csrf;
  return h;
}

function _decrypt(text, what) {
  return _postJson(_ENC_API + '/dec-vidfast', { text: text }, null, what).then(function (j) {
    return (j && j.result) || null;
  });
}

function _qualityOf(desc) {
  var d = String(desc || '');
  if (/4k|2160/i.test(d)) return '2160p';
  if (/1080/i.test(d)) return '1080p';
  if (/720/i.test(d)) return '720p';
  if (/480/i.test(d)) return '480p';
  return 'Auto';
}

function _unlockServer(streamBase, csrf, server) {
  var hdrs = _vidfastHeaders(csrf);
  return _postText(streamBase + '/' + server.data, hdrs, 'unlock:' + server.name)
    .then(function (enc) { return _decrypt(enc, 'dec:stream:' + server.name); })
    .then(function (data) {
      var url = data && data.url;
      if (!url || !/^https?:\/\//i.test(url)) throw new Error('no stream url from ' + server.name);
      var subs = ((data.tracks) || []).filter(function (t) { return t && t.file; })
        .slice(0, 8)
        .map(function (t) {
          return { url: t.file, lang: _subLang(t.label), label: t.label || 'Subtitle' };
        });
      return {
        url: url,
        quality: _qualityOf(server.description || server.name),
        label: 'VidFast [' + (server.name || 'server') + '] ' + _qualityOf(server.description || server.name),
        container: 'hls',
        kind: 'sub',
        headers: { 'Referer': _BASE + '/', 'User-Agent': _UA },
        subtitles: subs
      };
    });
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('bad episode url: ' + episodeUrl));
  var pageUrl = (p.kind === 'movie')
    ? _BASE + '/movie/' + p.tmdbId
    : _BASE + '/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode;

  var chain = _getText(pageUrl, { 'Referer': _BASE + '/' }, 'vidfast:page')
    .then(function (page) {
      var token = _extractToken(page);
      if (!token) throw new Error('no player token on ' + pageUrl);
      return _getJson(_ENC_API + '/enc-vidfast?text=' + encodeURIComponent(token), null, 'vidfast:enc');
    })
    .then(function (j) {
      var init = (j && j.result) || {};
      if (!init.servers || !init.stream) throw new Error('no server routes from enc step');
      return init;
    });

  // hard overall budget so the source sheet never spins forever
  return _race(chain, 45000, 'vidfast:init').then(function (init) {
    var hdrs = _vidfastHeaders(init.token);
    return _race(
      _postText(init.servers, hdrs, 'vidfast:servers').then(function (enc) {
        return _decrypt(enc, 'vidfast:dec-servers');
      }),
      30000, 'vidfast:server-list'
    ).then(function (servers) {
      if (!servers || !servers.length) throw new Error('no servers unlocked');
      var jobs = servers.slice(0, 6).map(function (sv) {
        return _unlockServer(init.stream, init.token, sv).catch(function () { return null; });
      });
      return Promise.all(jobs).then(function (out) {
        var sources = out.filter(function (x) { return !!x; });
        if (!sources.length) throw new Error('all VidFast servers failed');
        return sources;
      });
    });
  });
}
