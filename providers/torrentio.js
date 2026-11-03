// Torrentio — movies & series via the Stremio Torrentio addon protocol.
//
// Chain (all verified live 2026-11-03):
//   api.themoviedb.org/3/search/multi          -> TMDB ids (built-in public key)
//   api.themoviedb.org/3/{movie,tv}/{id}
//       ?append_to_response=external_ids       -> imdb_id
//   api.themoviedb.org/3/trending/{movie,tv}/week -> home rows
//   v3-cinemeta.strem.io/meta/series/{imdb}.json -> episode list (season/episode)
//   torrentio.strem.fun/stream/movie/{imdb}.json
//   torrentio.strem.fun/stream/series/{imdb}:{s}:{e}.json
//       -> { infoHash, name, title, sources[] } -> magnet: links
// Magnets play through Zangetsu's native torrent engine (same as
// ToraStream/Nyaa Anime); the harness accepts magnet: URLs as playable.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — none needed here.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'torrentio';

var TIO_BASE = 'https://torrentio.strem.fun';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var CM_BASE = 'https://v3-cinemeta.strem.io';
/* Same public TMDB key CineStream bundles (v1.0.1+); user can override. */
var _BUILTIN_TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function getInfo() {
  return { name: 'Torrentio', lang: 'en', baseUrl: TIO_BASE,
    logo: TIO_BASE + '/favicon.ico', type: 'movie', version: '1.0.0' };
}

function getSettings() {
  return [
    { key: 'tmdbApiKey',
      label: 'TMDB API Key (built-in active — paste yours to override)',
      type: 'text', def: '' },
    { key: 'maxSources', label: 'Max sources per episode', type: 'select',
      def: '10',
      options: [
        { value: '6', label: '6' }, { value: '10', label: '10' },
        { value: '16', label: '16' }, { value: '24', label: '24' } ] }
  ];
}
function _cfg(k, d) {
  try {
    var s = (typeof __settings !== 'undefined' && __settings)
      ? (__settings[SOURCE_ID] || {}) : {};
    var v = s[k];
    return (v === undefined || v === null || v === '') ? d : v;
  } catch (e) { return d; }
}
function _tmdbKey() {
  var k = _cfg('tmdbApiKey', '');
  return k || _BUILTIN_TMDB_KEY;
}
function _maxSrc() {
  var n = parseInt(_cfg('maxSources', '10'), 10);
  return (n > 0 && n <= 30) ? n : 10;
}

function _getJson(url, label) {
  var h = { 'User-Agent': UA, 'Accept': 'application/json' };
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('Torrentio: ' + label + ' HTTP ' + r.status);
    return r.json();
  }).catch(function (e) {
    throw new Error('Torrentio: ' + label + ' failed (' +
      (e && e.message ? e.message : 'fetch failed') + ')');
  });
}
function _tmdb(path) {
  return _getJson(TMDB_BASE + path +
    (path.indexOf('?') >= 0 ? '&' : '?') +
    'api_key=' + encodeURIComponent(_tmdbKey()), 'TMDB');
}
function _dec(s) {
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function _poster(p) {
  return p ? 'https://image.tmdb.org/t/p/w500' + p : undefined;
}
function _yearOf(r) {
  var y = (r.release_date || r.first_air_date || '').slice(0, 4);
  return y || null;
}
function _tmdbItem(r) {
  var mt = r.media_type === 'tv' ? 'tv' : 'movie';
  var title = mt === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title);
  if (!title) return null;
  var it = { id: 'torrentio://' + mt + '/' + r.id, title: _dec(title),
    url: 'torrentio://' + mt + '/' + r.id, type: 'movie',
    year: _yearOf(r) };
  var c = _poster(r.poster_path);
  if (c) it.cover = c;
  return it;
}

/* url shapes:
 *   torrentio://movie/<tmdbid>
 *   torrentio://tv/<tmdbid>
 *   torrentio://movie/<tmdbid>/<imdbid>
 *   torrentio://tv/<tmdbid>/<imdbid>
 *   torrentio://tv/<tmdbid>/<imdbid>/<season>/<episode>  (episodes carry imdb) */

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _tmdb('/search/multi?query=' + encodeURIComponent(q) +
    '&page=' + (page || 1) + '&include_adult=false').then(function (d) {
    var out = [], rs = (d && d.results) || [], i, it;
    for (i = 0; i < rs.length; i++) {
      if (rs[i].media_type !== 'movie' && rs[i].media_type !== 'tv') continue;
      it = _tmdbItem(rs[i]);
      if (it) out.push(it);
    }
    return out;
  });
}

function getHome(opts) {
  var rows = [];
  return _tmdb('/trending/movie/week').then(function (d) {
    var items = [], rs = (d && d.results) || [], i, it;
    for (i = 0; i < rs.length; i++) {
      rs[i].media_type = 'movie';
      it = _tmdbItem(rs[i]);
      if (it) items.push(it);
    }
    if (items.length) rows.push({ title: 'Trending Movies', items: items });
    return _tmdb('/trending/tv/week');
  }).then(function (d) {
    var items = [], rs = (d && d.results) || [], i, it;
    for (i = 0; i < rs.length; i++) {
      rs[i].media_type = 'tv';
      it = _tmdbItem(rs[i]);
      if (it) items.push(it);
    }
    if (items.length) rows.push({ title: 'Trending Series', items: items });
    return rows;
  });
}

function _parseUrl(url) {
  var m = /^torrentio:\/\/([^\/]+)\/([^\/]+)(?:\/([^\/]+))?(?:\/(\d+)\/(\d+))?/.exec(String(url || ''));
  if (!m) return null;
  return { mt: m[1], tmdb: m[2], imdb: m[3] || null,
    season: m[4] != null ? parseInt(m[4], 10) : null,
    episode: m[5] != null ? parseInt(m[5], 10) : null };
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('Torrentio: bad url'));
  return _tmdb('/' + p.mt + '/' + p.tmdb + '?append_to_response=external_ids')
    .then(function (d) {
      var isTv = p.mt === 'tv';
      var title = isTv ? (d.name || d.original_name) : (d.title || d.original_title);
      var imdb = (d.external_ids && d.external_ids.imdb_id) || null;
      var det = { id: 'torrentio://' + p.mt + '/' + p.tmdb, title: _dec(title || 'Unknown'),
        url: url, type: 'movie',
        description: _dec(d.overview || '') };
      var y = _yearOf(d);
      if (y) det.year = y;
      var c = _poster(d.poster_path);
      if (c) det.cover = c;
      if (imdb) det.id = det.id + '/' + imdb;
      return det;
    });
}

function getEpisodes(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('Torrentio: bad url'));
  function withImdb(imdb) {
    if (p.mt === 'movie') {
      return [{ id: 'torrentio://movie/' + p.tmdb + '/' + imdb + '/0/0',
        title: 'Play', url: 'torrentio://movie/' + p.tmdb + '/' + imdb + '/0/0',
        number: 1 }];
    }
    return _getJson(CM_BASE + '/meta/series/' + imdb + '.json', 'Cinemeta')
      .then(function (d) {
        var vs = ((d && d.meta) || {}).videos || [], out = [], i, v;
        for (i = 0; i < vs.length; i++) {
          v = vs[i];
          if (v.season == null || v.episode == null) continue;
          if (v.season === 0) continue;
          out.push({
            id: 'torrentio://tv/' + p.tmdb + '/' + imdb + '/' + v.season + '/' + v.episode,
            title: 'S' + v.season + ' E' + v.episode +
              (v.name ? ' · ' + _dec(v.name) : ''),
            url: 'torrentio://tv/' + p.tmdb + '/' + imdb + '/' + v.season + '/' + v.episode,
            number: v.episode,
            thumbnail: v.thumbnail || undefined
          });
        }
        if (!out.length) throw new Error('Torrentio: no episodes listed');
        return out;
      });
  }
  if (p.imdb) return Promise.resolve(withImdb(p.imdb));
  return _tmdb('/' + p.mt + '/' + p.tmdb + '?append_to_response=external_ids')
    .then(function (d) {
      var imdb = (d.external_ids && d.external_ids.imdb_id) || null;
      if (!imdb) throw new Error('Torrentio: no IMDb id for this title');
      return withImdb(imdb);
    });
}

function _qualityOf(title) {
  var t = String(title || '').toLowerCase();
  if (/\b(2160p|4k)\b/.test(t)) return '2160p';
  if (/\b1080p\b/.test(t)) return '1080p';
  if (/\b720p\b/.test(t)) return '720p';
  if (/\b480p\b/.test(t)) return '480p';
  return undefined;
}
function _magnet(s) {
  if (!s || !s.infoHash) return null;
  var m = 'magnet:?xt=urn:btih:' + String(s.infoHash).toLowerCase();
  var name = (s.name && s.title)
    ? (String(s.name) + ' ' + String(s.title).split('\n')[0]) : (s.name || 'torrent');
  m += '&dn=' + encodeURIComponent(String(name).slice(0, 120));
  var trs = s.sources || [], i, seen = {};
  for (i = 0; i < trs.length && i < 12; i++) {
    var tr = String(trs[i] || '').trim();
    if (!tr || seen[tr]) continue;
    seen[tr] = 1;
    m += '&tr=' + encodeURIComponent(tr);
  }
  return m;
}

function getVideoSources(episodeUrl, opts) {
  var p = _parseUrl(episodeUrl);
  if (!p || !p.imdb) return Promise.reject(new Error('Torrentio: bad episode url'));
  var path = p.mt === 'movie'
    ? '/stream/movie/' + p.imdb + '.json'
    : '/stream/series/' + p.imdb + ':' + p.season + ':' + p.episode + '.json';
  return _getJson(TIO_BASE + path, 'Torrentio streams').then(function (d) {
    var ss = (d && d.streams) || [], out = [], i, s, m, q, label;
    for (i = 0; i < ss.length && out.length < _maxSrc(); i++) {
      s = ss[i];
      m = _magnet(s);
      if (!m) continue;
      q = _qualityOf(s.title);
      label = String(s.title || '').split('\n')[0].slice(0, 90) || 'Torrentio';
      var e = { url: m, label: '[Torrentio] ' + label };
      if (q) e.quality = q;
      out.push(e);
    }
    if (!out.length) throw new Error('Torrentio: no streams returned');
    return out;
  });
}
