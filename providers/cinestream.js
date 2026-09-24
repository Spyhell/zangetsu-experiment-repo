/* CineStream — multi-source movie/TV aggregator for Zangetsu.
 * Port of CineStream (CloudStream, by megix / SaurabhKaperwan/CSX).
 * Search + metadata via TMDB API, streams from multiple sub-sources
 * (VidFast, Vidcore, Vidlink) with server-side decrypt via enc-dec.app.
 * type: movie, lang: en, version 1.0.0
 *
 * Settings (via getSettings):
 *   tmdbApiKey  - TMDB API key for search/metadata (get free at themoviedb.org)
 *   srcVidfast  - enable VidFast source
 *   srcVidcore  - enable Vidcore source
 *   srcVidlink  - enable Vidlink source
 */
'use strict';

var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _DECRYPT_API = 'https://enc-dec.app/api';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'CineStream',
    lang: 'en',
    baseUrl: 'https://github.com/SaurabhKaperwan/CSX',
    logo: 'https://raw.githubusercontent.com/SaurabhKaperwan/CSX/main/CineStream/icons/cinestream.png',
    type: 'movie',
    version: '1.0.0'
  };
}

/* ---- Settings ---- */
function getSettings() {
  return [
    {
      key: 'tmdbApiKey',
      label: 'TMDB API Key (required for search)',
      type: 'text',
      default: ''
    },
    {
      key: 'srcVidfast',
      label: 'VidFast source',
      type: 'bool',
      default: true
    },
    {
      key: 'srcVidcore',
      label: 'Vidcore source',
      type: 'bool',
      default: true
    },
    {
      key: 'srcVidlink',
      label: 'Vidlink source',
      type: 'bool',
      default: true
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings.cinestream) || {};
    var v = s[key];
    return (v === undefined || v === null) ? def : v;
  } catch (e) {
    return def;
  }
}

function _tmdbKey() {
  return _cfg('tmdbApiKey', '');
}

/* ---- HTTP helpers ---- */
function _getJson(url, headers) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  h['Accept'] = 'application/json';
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function _getText(url, headers) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function _postJson(url, data, headers) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  h['Content-Type'] = 'application/json';
  h['Accept'] = 'application/json';
  return fetch(url, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(data)
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

/* ---- TMDB ---- */
function _tmdbSearch(query, page) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set. Add it in CineStream settings.'));
  var url = _TMDB_BASE + '/search/multi?api_key=' + encodeURIComponent(key) +
    '&query=' + encodeURIComponent(query) + '&page=' + (page || 1);
  return _getJson(url).then(function (d) {
    var results = (d && d.results) || [];
    var items = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var mt = r.media_type;
      if (mt !== 'movie' && mt !== 'tv') continue;
      var title = mt === 'movie' ? (r.title || r.original_title) : (r.name || r.original_name);
      if (!title) continue;
      var year = (r.release_date || r.first_air_date || '').slice(0, 4) || null;
      items.push({
        id: 'cs://' + mt + '/' + r.id,
        title: title,
        url: 'cs://' + mt + '/' + r.id,
        type: 'movie',
        cover: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : undefined,
        year: year
      });
    }
    return items;
  });
}

function _tmdbDetail(mediaType, tmdbId) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set.'));
  var url = _TMDB_BASE + '/' + mediaType + '/' + tmdbId + '?api_key=' + encodeURIComponent(key);
  return _getJson(url).then(function (d) {
    var title = mediaType === 'movie' ? (d.title || d.original_title) : (d.name || d.original_name);
    return {
      title: title || ('TMDB ' + tmdbId),
      year: ((d.release_date || d.first_air_date || '').slice(0, 4)) || null,
      cover: d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : undefined,
      description: d.overview || ''
    };
  });
}

function _tmdbSeasons(mediaType, tmdbId) {
  // For TV: get season/episode list from TMDB
  if (mediaType !== 'tv') return Promise.resolve(null);
  var key = _tmdbKey();
  if (!key) return Promise.resolve(null);
  var url = _TMDB_BASE + '/tv/' + tmdbId + '?api_key=' + encodeURIComponent(key);
  return _getJson(url).then(function (d) {
    return d.seasons || [];
  }, function () { return null; });
}

/* ---- Provider interface ---- */
function search(query, page, opts) {
  return _tmdbSearch(query, page || 1);
}

function getHome(opts) {
  var key = _tmdbKey();
  if (!key) return Promise.resolve([]);
  // Trending movies + trending TV as home rows
  var trendingMovie = _getJson(_TMDB_BASE + '/trending/movie/week?api_key=' + encodeURIComponent(key))
    .then(function (d) {
      var items = [];
      var results = (d && d.results) || [];
      for (var i = 0; i < Math.min(results.length, 20); i++) {
        var r = results[i];
        if (!r.title) continue;
        items.push({
          id: 'cs://movie/' + r.id,
          title: r.title || r.original_title,
          url: 'cs://movie/' + r.id,
          type: 'movie',
          cover: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : undefined,
          year: (r.release_date || '').slice(0, 4) || null
        });
      }
      return { title: 'Trending Movies', items: items };
    }, function () { return { title: 'Trending Movies', items: [] }; });

  var trendingTv = _getJson(_TMDB_BASE + '/trending/tv/week?api_key=' + encodeURIComponent(key))
    .then(function (d) {
      var items = [];
      var results = (d && d.results) || [];
      for (var i = 0; i < Math.min(results.length, 20); i++) {
        var r = results[i];
        if (!r.name) continue;
        items.push({
          id: 'cs://tv/' + r.id,
          title: r.name || r.original_name,
          url: 'cs://tv/' + r.id,
          type: 'movie',
          cover: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : undefined,
          year: (r.first_air_date || '').slice(0, 4) || null
        });
      }
      return { title: 'Trending TV Shows', items: items };
    }, function () { return { title: 'Trending TV Shows', items: [] }; });

  return Promise.all([trendingMovie, trendingTv]);
}

function _parseUrl(url) {
  // cs://<movie|tv>/<tmdbId>[/<season>/<episode>]
  var m = /^cs:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(url || '');
  if (!m) return null;
  return {
    mediaType: m[1],
    tmdbId: m[2],
    season: m[3] ? parseInt(m[3], 10) : null,
    episode: m[4] ? parseInt(m[4], 10) : null
  };
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  return _tmdbDetail(p.mediaType, p.tmdbId).then(function (meta) {
    var detail = {
      id: 'cs://' + p.mediaType + '/' + p.tmdbId,
      title: meta.title,
      url: url,
      type: 'movie',
      year: meta.year,
      cover: meta.cover,
      description: meta.description
    };
    if (p.mediaType === 'movie') {
      // Single episode for movies
      var epUrl = 'cs://movie/' + p.tmdbId + '/1/1';
      detail.episodes = [{ id: epUrl, title: meta.title, url: epUrl, number: 1 }];
      return detail;
    }
    // TV: fetch seasons to build episode list
    return _tmdbSeasons(p.mediaType, p.tmdbId).then(function (seasons) {
      var eps = [];
      if (seasons) {
        for (var i = 0; i < seasons.length; i++) {
          var s = seasons[i];
          if (!s.season_number || s.season_number < 1) continue;
          var count = s.episode_count || 0;
          for (var e = 1; e <= count; e++) {
            var eu = 'cs://tv/' + p.tmdbId + '/' + s.season_number + '/' + e;
            eps.push({
              id: eu,
              title: 'S' + s.season_number + ' E' + e,
              url: eu,
              number: e
            });
          }
          if (eps.length >= 100) break; // cap for sanity
        }
      }
      if (!eps.length) {
        // Fallback: single episode
        var fu = 'cs://tv/' + p.tmdbId + '/1/1';
        eps = [{ id: fu, title: 'S1 E1', url: fu, number: 1 }];
      }
      detail.episodes = eps;
      return detail;
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

/* ---- Sub-source scrapers (via enc-dec.app for server-side decrypt) ---- */

function _extractToken(page) {
  var m = /\\"(?:en|token)\\":\\"(.*?)\\"/.exec(String(page || ''));
  return m ? m[1] : null;
}

function _scrapeVidfast(p) {
  if (!_cfg('srcVidfast', true)) return Promise.resolve([]);
  var base = 'https://vidfast.vc';
  var pageUrl = p.mediaType === 'movie'
    ? base + '/movie/' + p.tmdbId + '/'
    : base + '/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode + '/';
  var headers = { 'Referer': base + '/' };
  return _getText(pageUrl, headers).then(function (page) {
    var token = _extractToken(page);
    if (!token) return [];
    return _getJson(_DECRYPT_API + '/enc-vidfast?text=' + encodeURIComponent(token)).then(function (ij) {
      var init = (ij && ij.result) || {};
      if (!init.servers || !init.stream) return [];
      var h2 = { 'Referer': base + '/' };
      if (init.token) h2['X-CSRF-Token'] = init.token;
      return fetch(init.servers, { method: 'POST', headers: h2 }).then(function (r) {
        return r.text();
      }).then(function (serversEnc) {
        return _postJson(_DECRYPT_API + '/dec-vidfast', { text: serversEnc });
      }).then(function (sj) {
        var servers = (sj && sj.result) || [];
        var jobs = [];
        for (var i = 0; i < Math.min(servers.length, 5); i++) {
          (function (server) {
            jobs.push(
              fetch(init.stream + '/' + server.data, { method: 'POST', headers: h2 })
                .then(function (r) { return r.text(); })
                .then(function (streamEnc) {
                  return _postJson(_DECRYPT_API + '/dec-vidfast', { text: streamEnc });
                })
                .then(function (stj) {
                  var data = (stj && stj.result) || {};
                  if (!data.url) return null;
                  var src = {
                    url: data.url,
                    container: /\.m3u8(\?|$)/i.test(data.url) ? 'hls' : 'mp4',
                    label: 'VidFast [' + (server.name || 'server') + ']',
                    headers: { 'Referer': base + '/' }
                  };
                  // Subtitles
                  var tracks = data.tracks || [];
                  var subs = [];
                  for (var t = 0; t < Math.min(tracks.length, 8); t++) {
                    if (tracks[t] && tracks[t].file) {
                      subs.push({
                        url: tracks[t].file,
                        lang: tracks[t].label || 'en',
                        label: (tracks[t].label || 'Subtitle') + ' [VidFast]'
                      });
                    }
                  }
                  if (subs.length) src.subtitles = subs;
                  return src;
                }, function () { return null; })
            );
          })(servers[i]);
        }
        return Promise.all(jobs).then(function (results) {
          var out = [];
          for (var j = 0; j < results.length; j++) {
            if (results[j]) out.push(results[j]);
          }
          return out;
        });
      });
    }, function () { return []; });
  }, function () { return []; });
}

function _scrapeVidcore(p) {
  if (!_cfg('srcVidcore', true)) return Promise.resolve([]);
  var base = 'https://vidcore.io';
  var pageUrl = p.mediaType === 'movie'
    ? base + '/movie/' + p.tmdbId
    : base + '/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode;
  var headers = { 'Referer': base + '/', 'X-Requested-With': 'XMLHttpRequest' };
  return _getText(pageUrl, headers).then(function (page) {
    var token = _extractToken(page);
    if (!token) return [];
    return _getJson(_DECRYPT_API + '/enc-vidcore?text=' + encodeURIComponent(token)).then(function (ij) {
      var init = (ij && ij.result) || {};
      if (!init.servers || !init.stream) return [];
      var h2 = { 'Referer': base + '/', 'X-Requested-With': 'XMLHttpRequest' };
      if (init.token) h2['X-CSRF-Token'] = init.token;
      return fetch(init.servers, { method: 'POST', headers: h2 }).then(function (r) {
        return r.text();
      }).then(function (serversEnc) {
        return _postJson(_DECRYPT_API + '/dec-vidcore', { text: serversEnc });
      }).then(function (sj) {
        var servers = (sj && sj.result) || [];
        var jobs = [];
        for (var i = 0; i < Math.min(servers.length, 5); i++) {
          (function (server) {
            jobs.push(
              fetch(init.stream + '/' + server.data, { method: 'POST', headers: h2 })
                .then(function (r) { return r.text(); })
                .then(function (streamEnc) {
                  return _postJson(_DECRYPT_API + '/dec-vidcore', { text: streamEnc });
                })
                .then(function (stj) {
                  var data = (stj && stj.result) || {};
                  if (!data.url) return null;
                  var src = {
                    url: data.url,
                    container: /\.m3u8(\?|$)/i.test(data.url) ? 'hls' : 'mp4',
                    label: 'Vidcore [' + (server.name || 'server') + ']',
                    headers: { 'Referer': base + '/' }
                  };
                  var tracks = data.tracks || [];
                  var subs = [];
                  for (var t = 0; t < Math.min(tracks.length, 8); t++) {
                    if (tracks[t] && tracks[t].file) {
                      subs.push({
                        url: tracks[t].file,
                        lang: tracks[t].label || 'en',
                        label: (tracks[t].label || 'Subtitle') + ' [Vidcore]'
                      });
                    }
                  }
                  if (subs.length) src.subtitles = subs;
                  return src;
                }, function () { return null; })
            );
          })(servers[i]);
        }
        return Promise.all(jobs).then(function (results) {
          var out = [];
          for (var j = 0; j < results.length; j++) {
            if (results[j]) out.push(results[j]);
          }
          return out;
        });
      });
    }, function () { return []; });
  }, function () { return []; });
}

function _scrapeVidlink(p) {
  if (!_cfg('srcVidlink', true)) return Promise.resolve([]);
  // Vidlink uses TMDB ID directly via their API
  var apiUrl = 'https://vidlink.pro/api/' + (p.mediaType === 'movie' ? 'movie' : 'tv') +
    '/' + p.tmdbId;
  if (p.mediaType === 'tv') apiUrl += '/' + p.season + '/' + p.episode;
  return _getJson(apiUrl).then(function (d) {
    var out = [];
    // Vidlink returns stream URLs directly or via their player
    if (d && d.url) {
      out.push({
        url: d.url,
        container: /\.m3u8(\?|$)/i.test(d.url) ? 'hls' : 'mp4',
        label: 'Vidlink',
        headers: { 'Referer': 'https://vidlink.pro/' }
      });
    }
    if (d && d.sources) {
      for (var i = 0; i < d.sources.length; i++) {
        var s = d.sources[i];
        if (s.url) {
          out.push({
            url: s.url,
            container: /\.m3u8(\?|$)/i.test(s.url) ? 'hls' : 'mp4',
            quality: s.quality || undefined,
            label: 'Vidlink [' + (s.label || 'server') + ']',
            headers: { 'Referer': 'https://vidlink.pro/' }
          });
        }
      }
    }
    return out;
  }, function () { return []; });
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('bad url: ' + episodeUrl));
  if (!p.season) p.season = 1;
  if (!p.episode) p.episode = 1;

  // Fan out to all enabled sub-sources
  return Promise.all([
    _scrapeVidfast(p),
    _scrapeVidcore(p),
    _scrapeVidlink(p)
  ]).then(function (results) {
    var out = [];
    var seen = {};
    for (var i = 0; i < results.length; i++) {
      var arr = results[i] || [];
      for (var j = 0; j < arr.length; j++) {
        var s = arr[j];
        if (s && s.url && !seen[s.url]) {
          seen[s.url] = true;
          out.push(s);
        }
      }
    }
    if (!out.length) throw new Error('No streams found. Check TMDB API key in settings and source toggles.');
    return out;
  });
}
