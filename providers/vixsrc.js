/* VixSrc (vixsrc.to) — movies + TV series.
 *
 * Catalog/metadata: TMDB (built-in API key). Streams: vixsrc.to API
 *   /api/movie/{tmdbId} | /api/tv/{tmdbId}/{s}/{e}
 *   -> {"src":"/embed/<id>?token=..&expires=..&lang=en&canPlayFHD=1"}
 *   -> embed page window.masterPlaylist = {params:{token,expires,asn}, url}
 *   -> playlist URL needs: url + token + expires (+asn) + &h=1&lang=en
 *   -> signed HLS master with multi-audio (EN/IT) + subtitles + 480p/720p/1080p.
 *
 * ES5 only (QuickJS): var/function, no arrow/let/const/template literals/spread.
 */

var _BASE = 'https://vixsrc.to';
var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _BUILTIN_TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var _REF = 'https://vixsrc.to/';
var _ICON = 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/vixsrc.png';

/* ---- timeouts ---- */
function _raceTimeout(promise, ms, expired) {
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

function _fetchText(url, ms, label) {
  var p = fetch(url, { headers: { 'User-Agent': _UA, 'Referer': _REF, 'Accept': '*/*' } })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return String((r && r.body) || '');
    });
  p.catch(function () {}); // late failures after a timeout must stay silent
  return _raceTimeout(p, ms || 15000, null).then(function (v) {
    if (v === null || v === undefined) throw new Error('timeout: ' + (label || url));
    return v;
  });
}

function _getJson(url, ms) {
  var p = fetch(url, { headers: { 'User-Agent': _UA, 'Accept': 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  p.catch(function () {});
  return _raceTimeout(p, ms || 15000, null).then(function (v) {
    if (v === null || v === undefined) throw new Error('timeout: ' + url);
    return v;
  });
}

/* ---- opaque url: vixsrc://movie/<tmdbId> | vixsrc://tv/<tmdbId>/<s>/<e> ---- */
function _parseUrl(u) {
  var m = /^vixsrc:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(String(u || ''));
  if (!m) return null;
  return {
    mediaType: m[1],
    tmdbId: m[2],
    season: m[3] ? parseInt(m[3], 10) : null,
    episode: m[4] ? parseInt(m[4], 10) : null
  };
}

/* ---- TMDB catalog ---- */
function _cover(path) {
  return path ? 'https://image.tmdb.org/t/p/w500' + path : undefined;
}
function _yearOf(r) {
  var y = ((r.release_date || r.first_air_date) || '').slice(0, 4);
  return y || null;
}
function _searchItem(r, mt) {
  var title = mt === 'movie' ? (r.title || r.original_title) : (r.name || r.original_name);
  if (!title) return null;
  var u = 'vixsrc://' + mt + '/' + r.id;
  return { id: u, title: title, url: u, type: 'movie', cover: _cover(r.poster_path), year: _yearOf(r) };
}

function search(query, page, opts) {
  if (!query) return Promise.resolve([]);
  var url = _TMDB_BASE + '/search/multi?api_key=' + encodeURIComponent(_BUILTIN_TMDB_KEY) +
    '&query=' + encodeURIComponent(query) + '&page=' + (page || 1);
  return _getJson(url).then(function (d) {
    var out = [], rs = (d && d.results) || [], i, r, it;
    for (i = 0; i < rs.length; i++) {
      r = rs[i];
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      it = _searchItem(r, r.media_type);
      if (it) out.push(it);
    }
    return out;
  });
}

function _homeRow(url, rowTitle) {
  return _getJson(url).then(function (d) {
    var out = [], rs = (d && d.results) || [], i, r, it, mt;
    for (i = 0; i < rs.length; i++) {
      r = rs[i];
      mt = r.media_type === 'tv' ? 'tv' : 'movie';
      if (r.title === undefined && mt === 'movie' && !r.title) continue;
      it = _searchItem(r, mt);
      if (it) out.push(it);
      if (out.length >= 20) break;
    }
    return { title: rowTitle, items: out };
  }, function () { return { title: rowTitle, items: [] }; });
}

function getHome(opts) {
  var key = encodeURIComponent(_BUILTIN_TMDB_KEY);
  return Promise.all([
    _homeRow(_TMDB_BASE + '/trending/movie/week?api_key=' + key, 'Trending Movies'),
    _homeRow(_TMDB_BASE + '/trending/tv/week?api_key=' + key, 'Trending TV')
  ]);
}

function _tmdbDetail(mediaType, tmdbId) {
  var url = _TMDB_BASE + '/' + mediaType + '/' + tmdbId + '?api_key=' + encodeURIComponent(_BUILTIN_TMDB_KEY);
  return _getJson(url).then(function (d) {
    var title = mediaType === 'movie' ? (d.title || d.original_title) : (d.name || d.original_name);
    return {
      title: title || ('TMDB ' + tmdbId),
      year: ((d.release_date || d.first_air_date) || '').slice(0, 4) || null,
      cover: _cover(d.poster_path),
      description: d.overview || '',
      seasons: d.seasons || []
    };
  });
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  return _tmdbDetail(p.mediaType, p.tmdbId).then(function (meta) {
    var detail = {
      id: 'vixsrc://' + p.mediaType + '/' + p.tmdbId,
      title: meta.title,
      url: url,
      type: 'movie',
      year: meta.year,
      cover: meta.cover,
      description: meta.description,
      episodes: []
    };
    var eps = [];
    if (p.mediaType === 'movie') {
      var mu = 'vixsrc://movie/' + p.tmdbId;
      eps.push({ id: mu, title: meta.title, url: mu, number: 1 });
    } else {
      var i, s, e, eu;
      for (i = 0; i < meta.seasons.length; i++) {
        s = meta.seasons[i];
        if (!s.season_number || s.season_number < 1) continue;
        for (e = 1; e <= (s.episode_count || 0); e++) {
          eu = 'vixsrc://tv/' + p.tmdbId + '/' + s.season_number + '/' + e;
          eps.push({ id: eu, title: 'S' + s.season_number + ' E' + e, url: eu, number: e });
          if (eps.length >= 100) break;
        }
        if (eps.length >= 100) break;
      }
      if (!eps.length) {
        var fu = 'vixsrc://tv/' + p.tmdbId + '/1/1';
        eps.push({ id: fu, title: 'S1 E1', url: fu, number: 1 });
      }
    }
    detail.episodes = eps;
    return detail;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

/* ---- vixsrc stream chain ---- */
function _masterFor(baseUrl, params, lang) {
  var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
  var q = sep + 'token=' + encodeURIComponent(params.token) +
    '&expires=' + encodeURIComponent(params.expires);
  if (params.asn) q += '&asn=' + encodeURIComponent(params.asn);
  q += '&h=1&lang=' + encodeURIComponent(lang);
  return baseUrl + q;
}

function _langShort(l) {
  var m = { eng: 'en', ita: 'it', spa: 'es', fra: 'fr', deu: 'de', por: 'pt' };
  l = String(l || '').toLowerCase();
  return m[l] || l;
}

function _parseMediaTags(body) {
  // Parse #EXT-X-MEDIA entries for AUDIO and SUBTITLES
  var audios = [], subs = [], seen = {}, i, m, attrs, name, lang, uri, sl;
  var lines = String(body || '').split('\n');
  for (i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('#EXT-X-MEDIA') !== 0) continue;
    attrs = lines[i];
    if (attrs.indexOf('TYPE=AUDIO') === -1 && attrs.indexOf('TYPE=SUBTITLES') === -1) continue;
    name = (/NAME="([^"]*)"/.exec(attrs) || [])[1] || '';
    lang = (/LANGUAGE="([^"]*)"/.exec(attrs) || [])[1] || '';
    uri = (/URI="([^"]*)"/.exec(attrs) || [])[1] || '';
    if (!uri || seen[uri]) continue;
    seen[uri] = 1;
    if (attrs.indexOf('TYPE=AUDIO') !== -1) {
      audios.push({ name: name, lang: _langShort(lang), rawLang: lang });
    } else {
      sl = String(lang).toLowerCase().replace(/^forced-/, '');
      subs.push({ url: uri, lang: _langShort(sl), label: name || sl });
    }
  }
  return { audios: audios, subs: subs };
}

function _isDefaultAudio(body, name) {
  // Does the AUDIO entry with this NAME carry DEFAULT=YES?
  var lines = String(body || '').split('\n'), i, l;
  for (i = 0; i < lines.length; i++) {
    l = lines[i];
    if (l.indexOf('#EXT-X-MEDIA') === 0 && l.indexOf('TYPE=AUDIO') !== -1 &&
        l.indexOf('NAME="' + name + '"') !== -1) {
      return l.indexOf('DEFAULT=YES') !== -1;
    }
  }
  return false;
}
function _expandQualities(masterUrl, hdrs, subs, tag, audioLang, preBody) {
  var suffix = tag ? ' [' + tag + ']' : '';
  function autoEntry() {
    return { url: masterUrl, quality: 'Auto', label: 'Auto' + suffix,
      container: 'hls', headers: hdrs, audioLang: audioLang || null, subtitles: subs };
  }
  // NOTE: vixsrc playlist URLs carry no .m3u8 extension, so parse by content.
  function fromBody(body) {
    if (!body || body.indexOf('#EXT-X-STREAM-INF') === -1) return [autoEntry()];
    var re = /#EXT-X-STREAM-INF:([^\r\n]*)\r?\n([^\r\n]+)/g, m;
    var vars = [], seen = {}, v, uri, url;
    while ((m = re.exec(body)) !== null) {
      uri = String(m[2]).trim();
      if (!uri || uri.charAt(0) === '#') continue;
      url = uri;
      if (seen[url]) continue;
      seen[url] = 1;
      var hm = m[1].match(/RESOLUTION=\d+x(\d+)/i);
      var bw = m[1].match(/BANDWIDTH=(\d+)/i);
      vars.push({ url: url, h: hm ? parseInt(hm[1], 10) : 0, bw: bw ? parseInt(bw[1], 10) : 0 });
    }
    if (!vars.length) return [autoEntry()];
    vars.sort(function (a, b) { return (b.h - a.h) || (b.bw - a.bw); });
    var out = [autoEntry()], i;
    for (i = 0; i < vars.length; i++) {
      v = vars[i];
      out.push({ url: v.url, quality: v.h ? (v.h + 'p') : 'Auto',
        label: (v.h ? (v.h + 'p') : 'Auto') + suffix,
        container: 'hls', headers: hdrs, audioLang: audioLang || null, subtitles: subs });
    }
    return out;
  }
  if (typeof preBody === 'string' && preBody) {
    // Master already fetched by the caller (audio-default check) — reuse it
    // instead of downloading the same playlist a second time.
    if (preBody.indexOf('#EXTM3U') === -1) return Promise.resolve([autoEntry()]);
    return Promise.resolve(fromBody(preBody));
  }
  var bodyP = _fetchText(masterUrl, 5000, 'master playlist');
  return bodyP.then(function (body) {
    if (body.indexOf('#EXTM3U') === -1) return [autoEntry()];
    return fromBody(body);
  }, function () { return [autoEntry()]; });
}

function _embedParams(embedBody) {
  // Slice the window.masterPlaylist block, then pull its fields.
  var start = embedBody.indexOf('window.masterPlaylist');
  if (start === -1) return null;
  var slice = embedBody.slice(start, start + 1200);
  var nextW = slice.indexOf('window.', 20);
  if (nextW !== -1) slice = slice.slice(0, nextW);
  var token = (/'token'\s*:\s*'([^']+)'/.exec(slice) || [])[1];
  var expires = (/'expires'\s*:\s*'([^']+)'/.exec(slice) || [])[1];
  var asn = (/'asn'\s*:\s*'([^']*)'/.exec(slice) || [])[1] || '';
  var url = (/url\s*:\s*'([^']+)'/.exec(slice) || [])[1];
  if (!token || !expires || !url) return null;
  return { token: token, expires: expires, asn: asn, url: url };
}

function getVideoSources(episodeUrl, opts) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('bad url: ' + episodeUrl));
  var apiUrl = (p.mediaType === 'movie')
    ? _BASE + '/api/movie/' + p.tmdbId
    : _BASE + '/api/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode;
  var hdrs = { 'Referer': _REF, 'User-Agent': _UA };

  return _getJson(apiUrl, 15000).then(function (d) {
    var src = d && d.src;
    if (!src) throw new Error('no embed src from ' + apiUrl);
    return _fetchText(_BASE + src, 15000, 'embed page');
  }).then(function (html) {
    var mp = _embedParams(html);
    if (!mp) throw new Error('masterPlaylist not found on embed page');
    // Resolve the primary (en) master to discover audio/subtitle tracks.
    var masterEn = _masterFor(mp.url, mp, 'en');
    return _fetchText(masterEn, 8000, 'master playlist').then(function (body) {
      if (body.indexOf('#EXTM3U') === -1) throw new Error('master playlist not HLS');
      var tags = _parseMediaTags(body);
      var jobs;
      if (tags.audios.length > 1) {
        // Separate entry set per audio language (EN default first).
        // Each audio's master is fetched ONCE; the body is reused for both
        // the default-track check and the quality expansion below.
        jobs = [];
        var defAudios = [], otherAudios = [], i, a;
        for (i = 0; i < tags.audios.length; i++) {
          a = tags.audios[i];
          if (a.lang === 'en') defAudios.push(a); else otherAudios.push(a);
        }
        var ordered = defAudios.concat(otherAudios);
        for (i = 0; i < ordered.length; i++) {
          (function (audio) {
            var mu = _masterFor(mp.url, mp, audio.lang);
            // The 'en' master body is already in hand — reuse it, no re-fetch.
            var first = (audio.lang === 'en' && body)
              ? Promise.resolve({ url: mu, body: body })
              : _fetchText(mu, 5000, 'master playlist').then(function (b2) {
                  return { url: mu, body: b2 };
                }, function () { return null; });
            jobs.push(first.then(function (res) {
              if (!res) {
                // Short lang code failed: try the raw code from the playlist.
                var mu2 = _masterFor(mp.url, mp, audio.rawLang);
                return _fetchText(mu2, 5000, 'master playlist').then(function (b3) {
                  return { url: mu2, body: b3 };
                }, function () { return { url: mu, body: null }; });
              }
              // Prefer the lang param that actually marks this track DEFAULT.
              if (_isDefaultAudio(res.body, audio.name)) return res;
              var mu2b = _masterFor(mp.url, mp, audio.rawLang);
              return _fetchText(mu2b, 5000, 'master playlist').then(function (b3) {
                return _isDefaultAudio(b3, audio.name) ? { url: mu2b, body: b3 } : res;
              }, function () { return res; });
            }).then(function (final) {
              // subtitles: [] on purpose. The master playlist already declares
              // its subtitle renditions and ExoPlayer loads those natively;
              // the rendition URLs are HLS playlists, not VTT files, so
              // passing them as subtitles would only hand the player 14
              // broken subtitle tracks.
              return _expandQualities(final.url, hdrs, [],
                audio.name || audio.lang, audio.lang, final.body);
            }));
          })(ordered[i]);
        }
      } else {
        var audioLang = tags.audios.length ? tags.audios[0].lang : null;
        jobs = [_expandQualities(masterEn, hdrs, [],
          audioLang === 'en' ? null : audioLang, audioLang, body)];
      }
      return Promise.all(jobs).then(function (sets) {
        var out = [], i, j;
        for (i = 0; i < sets.length; i++) {
          for (j = 0; j < sets[i].length; j++) out.push(sets[i][j]);
        }
        if (!out.length) throw new Error('no playable streams');
        return out;
      });
    });
  });
}

function getInfo() {
  return {
    name: 'VixSrc',
    lang: 'en',
    baseUrl: _BASE,
    logo: _ICON,
    type: 'movie',
    version: '1.0.2'
  };
}
