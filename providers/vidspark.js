/* VidSpark — movies/series source for Zangetsu.
 * Catalog metadata via TMDB (built-in key, override in settings).
 * Streams from VidSpark's Vidora API, called FRESH inside getVideoSources
 * (URLs are signed with ~12h expiry — never cached or persisted):
 *   movie: GET https://vidspark.to/api/vidora/v1/movie/{tmdbId}
 *   tv:    GET https://vidspark.to/api/vidora/v1/tv/{tmdbId}/{season}/{episode}
 * with headers x-player-key + Referer: https://vidspark.to/
 * Each master playlist is expanded into one VideoSource per variant
 * (Auto first, then highest quality first); a playlist fetch failure
 * falls back to the single Auto entry pointing at the master URL.
 * type: movie, lang: en, version 1.0.0
 */
'use strict';

var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _VS_BASE = 'https://vidspark.to';
var _VS_API = _VS_BASE + '/api/vidora/v1';
var _VS_KEY = '3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'VidSpark',
    lang: 'en',
    baseUrl: 'https://vidspark.to',
    logo: 'https://vidspark.to/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

/* ---- Settings ---- */
function getSettings() {
  return [
    {
      key: 'tmdbKey',
      label: 'TMDB API Key (built-in active — paste yours to override)',
      type: 'text',
      default: ''
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings.vidspark) || {};
    var v = s[key];
    return (v === undefined || v === null) ? def : v;
  } catch (e) {
    return def;
  }
}

var _BUILTIN_TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
function _tmdbKey() {
  var k = _cfg('tmdbKey', '');
  return k || _BUILTIN_TMDB_KEY;
}

/* ---- HTTP helpers ----
 * Every network call is raced against a 12s timeout so a hanging host can
 * never stall the app; failures reject with a message, never hang. */
function _raceTimeout(promise, ms, what) {
  var p = Promise.resolve(promise);
  try { p.catch(function () {}); } catch (e) {} // late failures after a timeout stay silent
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return p;
  var t;
  var timeout = new Promise(function (resolve, reject) {
    t = setTimeout(function () {
      reject(new Error('request timed out after ' + ms + 'ms: ' + (what || '')));
    }, ms);
  });
  return Promise.race([p, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  }, function (err) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    throw err;
  });
}

function _fetch12(url, opts, what) {
  return _raceTimeout(fetch(url, opts || {}), 12000, what || url).then(function (r) {
    if (!r) throw new Error('no response: ' + (what || url));
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + (what || url));
    return r;
  });
}

function _getJson(url, headers, what) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  h['Accept'] = 'application/json';
  return _fetch12(url, { headers: h }, what || url).then(function (r) { return r.json(); });
}

/* ---- TMDB (mirrors cinestream's helpers) ---- */
function _yearOf(d) {
  var s = String(d.release_date || d.first_air_date || '');
  return s.length >= 4 ? s.slice(0, 4) : null;
}

function _coverOf(d) {
  return d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : undefined;
}

// Unreleased titles can never have streams on the backend (e.g. the first
// 'avengers' TMDB hit is an unreleased 2026 film the vidora API 404s on),
// so drop them from search/home rows. Unknown dates are kept.
function _released(d) {
  var s = String(d.release_date || d.first_air_date || '');
  if (!s || s.length < 10) return true;
  var t = new Date();
  var today = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2)
    + '-' + ('0' + t.getDate()).slice(-2);
  return s.slice(0, 10) <= today;
}

function _tmdbSearch(query, page) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set. Add it in VidSpark settings.'));
  var url = _TMDB_BASE + '/search/multi?api_key=' + encodeURIComponent(key) +
    '&query=' + encodeURIComponent(query) + '&page=' + (page || 1);
  return _getJson(url, null, 'TMDB search').then(function (d) {
    var results = (d && d.results) || [];
    var items = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var mt = r.media_type;
      if (mt !== 'movie' && mt !== 'tv') continue;
      if (!_released(r)) continue;
      var title = mt === 'movie' ? (r.title || r.original_title) : (r.name || r.original_name);
      if (!title) continue;
      var id = 'vidspark://' + mt + '/' + r.id;
      items.push({
        id: id,
        title: title,
        url: id,
        type: 'movie',
        cover: _coverOf(r),
        year: _yearOf(r)
      });
    }
    return items;
  });
}

function _tmdbDetail(mediaType, tmdbId) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set.'));
  var url = _TMDB_BASE + '/' + mediaType + '/' + tmdbId + '?api_key=' + encodeURIComponent(key);
  return _getJson(url, null, 'TMDB detail').then(function (d) {
    return {
      title: (mediaType === 'movie' ? (d.title || d.original_title) : (d.name || d.original_name)) || ('TMDB ' + tmdbId),
      year: _yearOf(d),
      cover: _coverOf(d),
      description: d.overview || '',
      seasons: (d.seasons || [])
    };
  });
}

function _tmdbSeasonEpisodes(tmdbId, seasonNo) {
  var key = _tmdbKey();
  if (!key) return Promise.resolve([]);
  var url = _TMDB_BASE + '/tv/' + tmdbId + '/season/' + seasonNo +
    '?api_key=' + encodeURIComponent(key);
  return _getJson(url, null, 'TMDB season ' + seasonNo).then(function (d) {
    var eps = (d && d.episodes) || [];
    var out = [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      var e = ep.episode_number;
      if (typeof e !== 'number' || e < 1) continue;
      var eu = 'vidspark://play/tv/' + tmdbId + '/' + seasonNo + '/' + e;
      var t = 'S' + seasonNo + ' E' + e;
      if (ep.name) t += ': ' + ep.name;
      out.push({ id: eu, title: t, url: eu, number: e });
    }
    return out;
  }, function () { return []; });
}

function _parseUrl(url) {
  // vidspark://play/movie/550  or  vidspark://play/tv/66732/1/1
  var pm = /^vidspark:\/\/play\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(url || '');
  if (pm) {
    return {
      play: true,
      mediaType: pm[1],
      tmdbId: pm[2],
      season: pm[3] ? parseInt(pm[3], 10) : null,
      episode: pm[4] ? parseInt(pm[4], 10) : null
    };
  }
  // vidspark://movie/550  or  vidspark://tv/66732
  var m = /^vidspark:\/\/(movie|tv)\/(\d+)$/.exec(url || '');
  if (!m) return null;
  return { play: false, mediaType: m[1], tmdbId: m[2], season: null, episode: null };
}

/* ---- Provider interface ---- */
function search(query, page, opts) {
  return _tmdbSearch(query, page || 1);
}

function _homeRow(title, apiPath, key) {
  return _getJson(_TMDB_BASE + apiPath + '?api_key=' + encodeURIComponent(key), null, 'TMDB ' + title)
    .then(function (d) {
      var items = [];
      var results = (d && d.results) || [];
      for (var i = 0; i < Math.min(results.length, 20); i++) {
        var r = results[i];
        var mt = apiPath.indexOf('/movie/') !== -1 ? 'movie' : 'tv';
        if (!_released(r)) continue;
        var name = mt === 'movie' ? (r.title || r.original_title) : (r.name || r.original_name);
        if (!name || !r.id) continue;
        var id = 'vidspark://' + mt + '/' + r.id;
        items.push({
          id: id,
          title: name,
          url: id,
          type: 'movie',
          cover: _coverOf(r),
          year: _yearOf(r)
        });
      }
      return { title: title, items: items };
    }, function () { return { title: title, items: [] }; });
}

function getHome(opts) {
  var key = _tmdbKey();
  if (!key) return Promise.resolve([]);
  return Promise.all([
    _homeRow('Trending Movies', '/trending/movie/week', key),
    _homeRow('Trending TV Shows', '/trending/tv/week', key)
  ]);
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('VidSpark: bad url: ' + url));
  return _tmdbDetail(p.mediaType, p.tmdbId).then(function (meta) {
    var detail = {
      id: 'vidspark://' + p.mediaType + '/' + p.tmdbId,
      title: meta.title,
      url: url,
      type: 'movie',
      year: meta.year,
      cover: meta.cover,
      description: meta.description
    };
    if (p.mediaType === 'movie') {
      var epUrl = 'vidspark://play/movie/' + p.tmdbId;
      detail.episodes = [{ id: epUrl, title: meta.title, url: epUrl, number: 1 }];
      return detail;
    }
    // TV: one season endpoint call per season (parallel, fail-soft)
    var seasons = [];
    for (var i = 0; i < meta.seasons.length; i++) {
      var s = meta.seasons[i];
      if (s && s.season_number >= 1) seasons.push(s.season_number);
    }
    if (!seasons.length) {
      var fu = 'vidspark://play/tv/' + p.tmdbId + '/1/1';
      detail.episodes = [{ id: fu, title: 'S1 E1', url: fu, number: 1 }];
      return detail;
    }
    var jobs = [];
    for (var j = 0; j < seasons.length; j++) {
      jobs.push(_tmdbSeasonEpisodes(p.tmdbId, seasons[j]));
    }
    return Promise.all(jobs).then(function (arrs) {
      var eps = [];
      for (var a = 0; a < arrs.length; a++) {
        var arr = arrs[a] || [];
        for (var b = 0; b < arr.length; b++) {
          eps.push(arr[b]);
          if (eps.length >= 300) break;
        }
        if (eps.length >= 300) break;
      }
      if (!eps.length) {
        var gu = 'vidspark://play/tv/' + p.tmdbId + '/1/1';
        eps = [{ id: gu, title: 'S1 E1', url: gu, number: 1 }];
      }
      detail.episodes = eps;
      return detail;
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

/* ---- VidSpark stream API ---- */
function _qualityLabel(h) {
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 500) return '480p';
  if (h >= 300) return '360p';
  return h > 0 ? (h + 'p') : 'Auto';
}

function _expandQualities(masterUrl) {
  var hdrs = { 'Referer': _VS_BASE + '/' };
  function auto() {
    return { url: masterUrl, quality: 'Auto', label: 'VidSpark · Auto', container: 'hls', headers: hdrs };
  }
  // The master may answer 302 before the signed playlist; the player's
  // HTTP stack follows it. If the fetch fails (or the body has no
  // variants), fall back to the single Auto entry on the master URL.
  var bodyP = _fetch12(masterUrl, { headers: hdrs }, 'VidSpark master playlist')
    .then(function (r) { return r.text(); }, function () { return ''; });
  return Promise.resolve(bodyP).then(function (body) {
    body = String(body || '');
    if (body.indexOf('#EXT-X-STREAM-INF') === -1) return [auto()];
    var base = String(masterUrl).replace(/[^/]*(\?.*)?$/, '');
    var origin = (String(masterUrl).match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
    var re = /#EXT-X-STREAM-INF:([^\r\n]*)\r?\n([^\r\n]+)/g, m;
    var vars = [], seen = {};
    while ((m = re.exec(body)) !== null) {
      var uri = m[2].trim();
      if (!uri || uri.charAt(0) === '#') continue;
      var url = uri;
      if (!/^https?:\/\//i.test(uri)) url = (uri.charAt(0) === '/') ? origin + uri : base + uri;
      if (seen[url]) continue;
      seen[url] = 1;
      var hm = m[1].match(/RESOLUTION=\d+x(\d+)/i);
      var bw = m[1].match(/BANDWIDTH=(\d+)/i);
      vars.push({ url: url, h: hm ? parseInt(hm[1], 10) : 0, bw: bw ? parseInt(bw[1], 10) : 0 });
    }
    if (!vars.length) return [auto()];
    vars.sort(function (a, b) { return (b.h - a.h) || (b.bw - a.bw); });
    var out = [auto()], i, v, q;
    for (i = 0; i < vars.length; i++) {
      v = vars[i];
      q = _qualityLabel(v.h);
      out.push({ url: v.url, quality: q, label: 'VidSpark · ' + q, container: 'hls', headers: hdrs });
    }
    return out;
  }, function () { return [auto()]; });
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p || !p.play) return Promise.reject(new Error('VidSpark: bad url: ' + episodeUrl));
  var apiUrl = p.mediaType === 'movie'
    ? _VS_API + '/movie/' + p.tmdbId
    : _VS_API + '/tv/' + p.tmdbId + '/' + (p.season || 1) + '/' + (p.episode || 1);
  var h = { 'x-player-key': _VS_KEY, 'Referer': _VS_BASE + '/' };
  // Fresh API call every time — URLs are signed with ~12h expiry.
  return _getJson(apiUrl, h, 'VidSpark stream API').then(function (d) {
    var srcs = (d && d.result === true && d.sources) || [];
    var master = '';
    for (var i = 0; i < srcs.length; i++) {
      if (srcs[i] && srcs[i].url) { master = srcs[i].url; break; }
    }
    if (!master) throw new Error('VidSpark: no stream for this title');
    return _expandQualities(master);
  });
}
