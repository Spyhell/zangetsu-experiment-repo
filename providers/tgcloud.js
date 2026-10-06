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
    version: '2.1.0'
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
/* Pure-JS base64url encode (no btoa/Buffer — app runtime has neither). */
function _b64url(obj) {
  var json = JSON.stringify(obj);
  // UTF-8 encode
  var bytes = [];
  for (var i = 0; i < json.length; i++) {
    var c = json.charCodeAt(i);
    if (c < 128) { bytes.push(c); }
    else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); }
    else if (c < 55296 || c >= 57344) { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    else {
      i++;
      var c2 = json.charCodeAt(i);
      var cp = 65536 + (((c & 1023) << 10) | (c2 & 1023));
      bytes.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
    }
  }
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var b0 = bytes[j], b1 = j + 1 < bytes.length ? bytes[j + 1] : 0, b2 = j + 2 < bytes.length ? bytes[j + 2] : 0;
    var n = (b0 << 16) | (b1 << 8) | b2;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  // base64url: no padding, -_ instead of +/
  var pad = (3 - (bytes.length % 3)) % 3;
  out = out.substring(0, out.length - pad);
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

function _safeName(name) {
  var n = String(name || 'video').replace(/[^\w\-. ]+/g, '_').trim();
  if (!/\.(mp4|mkv|avi|mov|webm)$/i.test(n)) n += '.mp4';
  return n;
}

function _streamUrl(resolved, token) {
  // Match Stremio's exact payload format (server-tested)
  var payload = {
    short_code: resolved.short_code || resolved.shortCode || '',
    bot_id: String(resolved.bot_id || resolved.botId || ''),
    file_size: parseInt(resolved.file_size || resolved.fileSize || 0, 10),
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

function _isSeriesTitle(t) {
  var s = String(t || '');
  return /S\d{1,2}E\d{1,2}/i.test(s) || /\bEP?\d{1,4}\b/i.test(s) ||
         /\bepisode\s*\d+/i.test(s) || /\bseason\s*\d+/i.test(s);
}

function _toItem(f) {
  var rawTitle = f.title || f.name || 'Unknown';
  var title = _cleanTitle(rawTitle);
  var code = f.short_code || f.shortCode || f.code || '';
  return {
    id: String(code),
    title: title,
    url: 'tgcloud://file/' + encodeURIComponent(code),
    type: _isSeriesTitle(rawTitle) ? 'anime' : 'movie',
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
      return !_isSeriesTitle(f.title || '');
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
      var isSeries = _isSeriesTitle(title) || _isSeriesTitle(r.file_name || '');
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

function _qualityFromLabel(label) {
  var m = /(\d{3,4})p/i.exec(label || '');
  if (m) return m[1] + 'p';
  if (/2160|4k/i.test(label)) return '2160p';
  if (/1080/i.test(label)) return '1080p';
  if (/480/i.test(label)) return '480p';
  return '720p';
}

function _sourceName(title) {
  // Extract core movie/series name for multi-source search
  var s = String(title || '');
  s = s.replace(/\.(mp4|mkv|avi|mov|webm)$/i, '');
  s = s.replace(/[._]+/g, ' ');
  var yearM = /\b(19\d{2}|20\d{2})\b/.exec(s);
  var name = yearM ? s.substring(0, yearM.index) : s.split(/\bS\d{1,2}E\d{1,2}\b/i)[0];
  name = name.replace(/\b(1080p|720p|480p|2160p|4k|webrip|web-dl|webdl|bluray|hdtv|hdrip|hdcam|malaysub|malay sub|hardsub|x264|x265|hevc|aac|mp3|hindi|tamil|telugu|dubbed|subbed|links2u|csmelayu|moviehuntermy)\b/gi, '');
  return name.replace(/\s{2,}/g, ' ').trim();
}

function getVideoSources(episodeUrl) {
  var code = decodeURIComponent(String(episodeUrl).replace('tgcloud://play/', ''));
  var tok;
  var firstResolved;
  return _login().then(function (t) {
    tok = t;
    return _srv('/api/resolve-shortcode?short_code=' + encodeURIComponent(code));
  }).then(function (r) {
    if (!r || r.ok === 0) throw new Error('TG Cloud: could not resolve this file on your server.');
    r.short_code = code;
    firstResolved = r;
    // Find all uploads of the same title (like Nuvio's multiple sources)
    var name = _sourceName(r.title || r.file_name || '');
    if (!name || name.length < 3) return [r];
    return _wp('stream_search_files', { search: name, limit: 15 }).then(function (files) {
      // keep files that look like the same movie/series
      var nameLower = name.toLowerCase();
      var matches = files.filter(function (f) {
        var ft = String(f.title || '').toLowerCase().replace(/[._]+/g, ' ');
        return ft.indexOf(nameLower.split(' ')[0]) !== -1 && f.short_code;
      });
      // always include the original first
      var seen = {};
      seen[code] = true;
      var all = [r];
      for (var i = 0; i < matches.length && all.length < 6; i++) {
        if (!seen[matches[i].short_code]) {
          seen[matches[i].short_code] = true;
          all.push({ short_code: matches[i].short_code, title: matches[i].title,
                     file_name: matches[i].title, _fromSearch: true });
        }
      }
      return all;
    }).catch(function () { return [r]; });
  }).then(function (allResolved) {
    // Resolve each (search results need full resolve) and build URLs in parallel
    var jobs = allResolved.map(function (item) {
      if (!item._fromSearch) {
        // already resolved
        var url = _streamUrl(item, tok);
        var label = item.title || item.file_name || 'TG Cloud';
        return Promise.resolve({ url: url, quality: _qualityFromLabel(label),
          label: _qualityFromLabel(label) + ' | ' + _cleanTitle(label), container: 'mp4' });
      }
      return _srv('/api/resolve-shortcode?short_code=' + encodeURIComponent(item.short_code))
        .then(function (rr) {
          if (!rr || rr.ok === 0) return null;
          rr.short_code = item.short_code;
          var url = _streamUrl(rr, tok);
          var rawLabel = rr.title || rr.file_name || item.title || 'TG Cloud';
          var q = _qualityFromLabel(rawLabel);
          // distinctive label: quality + file size + short name
          var sizeStr = '';
          var sz = parseInt(rr.file_size || 0, 10);
          if (sz > 1073741824) sizeStr = (sz / 1073741824).toFixed(1) + 'GB';
          else if (sz > 1048576) sizeStr = Math.round(sz / 1048576) + 'MB';
          var disp = q + (sizeStr ? ' | ' + sizeStr : '') + ' | ' + _cleanTitle(rawLabel).substring(0, 40);
          return { url: url, quality: q, label: disp, container: 'mp4' };
        }).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (sources) {
      var valid = sources.filter(function (s) { return !!s; });
      if (!valid.length) throw new Error('TG Cloud: no playable sources found.');
      // sort by quality (highest first)
      var qOrder = { '2160p': 5, '1080p': 4, '720p': 3, '480p': 2 };
      valid.sort(function (a, b) {
        return (qOrder[b.quality] || 0) - (qOrder[a.quality] || 0);
      });
      return valid;
    });
  });
}
