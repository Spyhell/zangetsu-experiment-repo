/* TG Cloud v2.0.0 — PencariMovie server source for Zangetsu.
 * Bring-your-own-server: point it at your own pencarimovie-server
 * (Render/Railway/VPS/localhost) and it plays your Telegram files.
 *
 * Flow: password login -> token -> pencarimovie.com catalog search ->
 * resolve short_code on your server -> /api/download stream URL.
 */

var WP_API = 'https://pencarimovie.com/wp-admin/admin-ajax.php';
var _token = null;   // cached auth token (memory only)

function getInfo() {
  return {
    name: 'TG Cloud',
    lang: 'en',
    baseUrl: 'https://pencarimovie.com',
    type: 'movie',
    version: '2.0.2'
  };
}

/* ---- Settings ---- */
function getSettings() {
  return [
    {
      key: 'serverUrl',
      label: 'Server URL (your pencarimovie-server, e.g. https://my-server.onrender.com)',
      type: 'text',
      default: ''
    },
    {
      key: 'serverPassword',
      label: 'Server Password (your server login password)',
      type: 'text',
      default: ''
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings.tgcloud) || {};
    var v = s[key];
    return (v === undefined || v === null || v === '') ? def : v;
  } catch (e) {
    return def;
  }
}

function _serverUrl() {
  var u = _cfg('serverUrl', '');
  if (!u) return '';
  return String(u).replace(/\/+$/, '');
}

function _password() {
  return _cfg('serverPassword', '');
}

function _fetchJson(url, opts) {
  opts = opts || {};
  var headers = opts.headers || {};
  headers['User-Agent'] = 'Zangetsu/1.0';
  headers['Accept'] = 'application/json';
  return fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body
  }).then(function (r) {
    if (!r.ok) {
      var err = new Error('HTTP ' + r.status);
      err.status = r.status;
      throw err;
    }
    return r.json();
  });
}

/* Login to the server, cache the token. */
function _login() {
  if (_token) return Promise.resolve(_token);
  var base = _serverUrl();
  var pw = _password();
  if (!base) throw new Error('TG Cloud: add your Server URL in settings first.');
  if (!pw) throw new Error('TG Cloud: add your Server Password in settings first.');
  return _fetchJson(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  }).then(function (d) {
    if (!d || !d.ok || !d.token) throw new Error('TG Cloud: wrong server password.');
    _token = d.token;
    return _token;
  });
}

/* Authenticated GET against the server (auto re-login once on 401). */
function _srv(path) {
  var base = _serverUrl();
  function call() {
    return _login().then(function (tok) {
      return _fetchJson(base + path, {
        headers: { 'X-Auth-Token': tok }
      });
    });
  }
  return call().catch(function (e) {
    if (e && e.status === 401) {
      _token = null;   // token expired/invalid -> login again once
      return call();
    }
    throw e;
  });
}

/* Build the /api/download stream URL the way the server expects:
 * base64url(json({short_code,bot_id,file_id,file_size,file_name,mime})) */
function _b64url(obj) {
  var json = JSON.stringify(obj);
  var b64;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(json, 'utf8').toString('base64');
  } else {
    b64 = btoa(unescape(encodeURIComponent(json)));
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _safeName(name) {
  var n = String(name || 'video').replace(/[^\w\-. ]+/g, '_').trim();
  if (!/\.(mp4|mkv|avi|mov|webm)$/i.test(n)) n += '.mp4';
  return n;
}

function _streamUrl(resolved, token) {
  var payload = {
    short_code: resolved.short_code || resolved.shortCode || '',
    bot_id: resolved.bot_id || resolved.botId || '',
    file_id: resolved.file_id_mt || resolved.file_id || '',
    file_size: resolved.file_size || resolved.fileSize || 0,
    file_name: resolved.title || resolved.file_name || 'video.mp4',
    mime: resolved.mime || 'video/mp4'
  };
  var p64 = _b64url(payload);
  return _serverUrl() + '/' + encodeURIComponent(token) +
         '/api/download/' + p64 + '/' + encodeURIComponent(_safeName(payload.file_name));
}

function _cleanTitle(t) {
  var s = String(t || 'Unknown');
  // strip extension
  s = s.replace(/\.(mp4|mkv|avi|mov|webm)$/i, '');
  // dots/underscores -> spaces (keep apostrophes)
  s = s.replace(/[._]+/g, ' ');
  var yearM = /\b(19\d{2}|20\d{2})\b/.exec(s);
  var year = yearM ? yearM[1] : '';
  var name;
  if (year) {
    // take everything before the year as the title
    name = s.substring(0, yearM.index);
  } else {
    // no year: cut at season/episode markers or release tags
    name = s.split(/\bS\d{1,2}E\d{1,2}\b/i)[0];
  }
  // remove release tags
  name = name.replace(/\b(1080p|720p|480p|2160p|4k|webrip|web-dl|webdl|bluray|hdtv|hdrip|hdcam|malaysub|malay sub|hardsub|x264|x265|hevc|aac|mp3|hindi|tamil|telugu|dubbed|subbed|links2u|csmelayu|moviehuntermy)\b/gi, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  // reattach episode marker for series
  var epM = /\b(S\d{1,2}E\d{1,2})\b/i.exec(s);
  var out = name;
  if (year && !/\(\d{4}\)/.test(out)) out += ' ' + year;
  if (epM) out += ' ' + epM[1].toUpperCase();
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out || String(t);
}

/* ---- TMDB posters (same public key as CineStream) ---- */
var _TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _posterCache = {};

function _tmdbPoster(title, isSeries) {
  var cacheKey = (isSeries ? 'tv:' : 'movie:') + title.toLowerCase();
  if (_posterCache[cacheKey] !== undefined) return Promise.resolve(_posterCache[cacheKey]);
  var type = isSeries ? 'tv' : 'movie';
  var yearM = /(\d{4})/.exec(title);
  var year = yearM ? yearM[1] : '';
  // query = title without year and without episode marker
  var query = title.replace(/\b(19\d{2}|20\d{2})\b/g, '').replace(/\bS\d{1,2}E\d{1,2}\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  function doSearch(withYear) {
    var url = _TMDB_BASE + '/search/' + type + '?api_key=' + _TMDB_KEY +
              '&query=' + encodeURIComponent(query);
    if (withYear && year) url += (isSeries ? '&first_air_date_year=' : '&year=') + year;
    return _fetchJson(url).then(function (d) {
      return (d && d.results && d.results[0]) || null;
    });
  }
  return doSearch(true).then(function (r) {
    if (!r && year) return doSearch(false);  // retry without year filter
    return r;
  }).then(function (r) {
    var poster = r && r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : null;
    _posterCache[cacheKey] = poster;
    return poster;
  }).catch(function () {
    _posterCache[cacheKey] = null;
    return null;
  });
}

/* Enhance items with TMDB posters (parallel, best-effort). */
function _withPosters(items) {
  return Promise.all(items.map(function (it) {
    // skip if already has a real (non-placeholder) thumbnail
    if (it.cover && it.cover.indexOf('tg-placeholder') === -1) return Promise.resolve(it);
    var isSeries = it.type === 'anime';
    return _tmdbPoster(it.title, isSeries).then(function (poster) {
      if (poster) it.cover = poster;
      else if (it.cover && it.cover.indexOf('tg-placeholder') !== -1) it.cover = undefined;
      return it;
    });
  }));
}

function _toItem(f) {
  var rawTitle = f.title || f.name || 'Unknown';
  var title = _cleanTitle(rawTitle);
  var code = f.short_code || f.shortCode || f.code || '';
  var isSeries = /S\d{1,2}E\d{1,2}/i.test(rawTitle) || /\bepisode\s*\d+/i.test(rawTitle);
  return {
    id: String(code),
    title: title,
    url: 'tgcloud://file/' + encodeURIComponent(code),
    type: isSeries ? 'anime' : 'movie',
    cover: f.thumbnail_url || f.poster || f.thumbnail || undefined
  };
}

function _wp(action, params) {
  var q = 'action=' + encodeURIComponent(action);
  for (var k in params) q += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  return _fetchJson(WP_API + '?' + q).then(function (d) {
    if (d && d.data && d.data.files) return d.data.files;
    if (d && d.data && Array.isArray(d.data)) return d.data;
    if (Array.isArray(d)) return d;
    if (d && d.results) return d.results;
    return [];
  });
}

function getHome(opts) {
  var base = _serverUrl();
  if (!base || !_password()) return [{ title: 'Setup required', items: [] }];
  var latest = _wp('stream_search_files', { search: '', limit: 14 }).then(function (items) {
    var mapped = items.map(_toItem);
    return _withPosters(mapped).then(function (done) {
      return { title: 'Latest Files', items: done };
    });
  });
  var movies = _wp('stream_search_files', { search: '2025', limit: 14 }).then(function (items) {
    var mapped = items.filter(function (f) {
      return !/S\d{1,2}E\d{1,2}/i.test(f.title || '');
    }).map(_toItem);
    return _withPosters(mapped).then(function (done) {
      return { title: 'New Movies', items: done };
    });
  });
  var series = _wp('stream_search_files', { search: 'S01E01', limit: 14 }).then(function (items) {
    var mapped = items.map(_toItem);
    return _withPosters(mapped).then(function (done) {
      return { title: 'New Series', items: done };
    });
  });
  return Promise.all([latest, movies, series]).catch(function () {
    return [{ title: 'Latest Files', items: [] }];
  });
}

function search(query, page, opts) {
  var base = _serverUrl();
  if (!base) throw new Error('TG Cloud: add your Server URL in settings first.');
  return _wp('stream_search_files', { search: query, limit: 25 }).then(function (items) {
    return _withPosters(items.map(_toItem));
  });
}

function getDetail(url, opts) {
  var code = decodeURIComponent(String(url).replace('tgcloud://file/', ''));
  return _srv('/api/resolve-shortcode?short_code=' + encodeURIComponent(code))
    .then(function (r) {
      var title = r.title || r.file_name || ('File ' + code);
      var isSeries = /S\d{1,2}E\d{1,2}/i.test(title) || /\bepisode\s*\d+/i.test(title);
      return {
        id: code,
        title: title,
        url: url,
        type: isSeries ? 'anime' : 'movie',
        cover: r.poster || r.thumbnail || undefined,
        description: r.caption || '',
        episodes: [{
          id: code,
          title: title,
          url: 'tgcloud://play/' + encodeURIComponent(code),
          number: 1
        }]
      };
    });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var code = decodeURIComponent(String(episodeUrl).replace('tgcloud://play/', ''));
  var tok;
  return _login().then(function (t) {
    tok = t;
    return _srv('/api/resolve-shortcode?short_code=' + encodeURIComponent(code));
  }).then(function (r) {
    if (!r || r.ok === 0) throw new Error('TG Cloud: could not resolve this file on your server.');
    r.short_code = code;
    var url = _streamUrl(r, tok);
    var label = r.title || r.file_name || 'TG Cloud';
    var quality = '720p';
    var m = /(\d{3,4})p/i.exec(label);
    if (m) quality = m[1] + 'p';
    else if (/2160|4k/i.test(label)) quality = '2160p';
    else if (/1080/i.test(label)) quality = '1080p';
    else if (/480/i.test(label)) quality = '480p';
    return [{ url: url, quality: quality, label: label, container: 'mp4' }];
  });
}
