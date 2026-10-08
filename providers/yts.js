// YTS Movies source for the Zangetsu app.
// Backend: the YTS public API (yts.gg mirror, with fallback to the
// officially announced new base movies-api.accel.li).
//   https://yts.gg/api/v2/list_movies.json?query_term=...&sort_by=seeds
//   https://yts.gg/api/v2/movie_details.json?movie_id=<id>
// Curated movie torrents with quality/size/seeder metadata. Streams are
// magnet links, played by Zangetsu's native torrent engine (same as
// ToraStream / Nyaa Anime). Public trackers are appended to every magnet so
// the torrent engine discovers peers fast.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'yts';

var _APIS = [
  'https://yts.gg/api/v2/',
  'https://movies-api.accel.li/api/v2/'
];

var _BASE = 'https://yts.gg';

var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

// Public trackers appended to every magnet so Zangetsu's torrent engine can
// discover peers quickly instead of relying on DHT alone (bare magnets hang
// on "finding peers"). Same proven list as ToraStream.
var _TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.bittor.space:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce'
];

function getInfo() {
  return {
    name: 'YTS', lang: 'en', baseUrl: _BASE,
    logo: 'https://yts.gg/assets/images/website/logo-YTS.svg',
    type: 'movie', version: '1.0.0'
  };
}

function getSettings() {
  return [{
    key: 'minSeeders', label: 'Minimum seeders (0 = show all)', type: 'number',
    default: 5
  }];
}

function _settings() {
  try { return (__settings && __settings[SOURCE_ID]) || {}; }
  catch (e) { return {}; }
}

function _minSeeders() {
  var v = parseInt(_settings().minSeeders, 10);
  return isNaN(v) ? 5 : Math.max(0, v);
}

function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('YTS: HTTP ' + r.status);
      return r.json();
    });
}

// Try each API base in order; first one returning status:'ok' wins.
function _api(path) {
  var i = 0;
  function next() {
    if (i >= _APIS.length) throw new Error('YTS: all API mirrors failed');
    var url = _APIS[i] + path;
    i++;
    return _get(url).then(function (j) {
      if (j && j.status === 'ok' && j.data) return j.data;
      return next();
    }).catch(function () { return next(); });
  }
  return next();
}

function _cover(m) {
  return m.medium_cover_image || m.small_cover_image || m.large_cover_image || '';
}

function _item(m) {
  var it = {
    id: 'yts://movie/' + m.id,
    title: m.title_long || m.title || ('Movie ' + m.id),
    url: 'yts://movie/' + m.id,
    type: 'movie'
  };
  var c = _cover(m);
  if (c) it.cover = c;
  if (m.year) it.year = String(m.year);
  return it;
}

function getHome(opts) {
  var rows = [
    { title: 'Trending Movies', q: 'sort_by=like_count&order_by=desc&limit=24' },
    { title: 'Top Rated', q: 'sort_by=rating&order_by=desc&limit=24' },
    { title: 'New Releases', q: 'sort_by=date_added&order_by=desc&limit=24' }
  ];
  var out = [];
  var chain = Promise.resolve();
  rows.forEach(function (row) {
    chain = chain.then(function () {
      return _api('list_movies.json?' + row.q).then(function (data) {
        var items = [];
        var movies = data.movies || [];
        for (var i = 0; i < movies.length; i++) items.push(_item(movies[i]));
        if (items.length) out.push({ title: row.title, items: items });
      }).catch(function () {});
    });
  });
  return chain.then(function () {
    if (!out.length) throw new Error('YTS: home catalog empty');
    return out;
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = parseInt(page, 10);
  if (isNaN(p) || p < 1) p = 1;
  return _api('list_movies.json?query_term=' + encodeURIComponent(q) +
    '&sort_by=seeds&order_by=desc&limit=30&page=' + p).then(function (data) {
    var items = [];
    var movies = data.movies || [];
    for (var i = 0; i < movies.length; i++) items.push(_item(movies[i]));
    return items;
  });
}

function _idFromUrl(url) {
  var m = String(url || '').match(/^yts:\/\/movie\/(\d+)/);
  return m ? m[1] : null;
}

function getDetail(url, opts) {
  var id = _idFromUrl(url);
  if (!id) return Promise.reject(new Error('YTS: bad url'));
  return _api('movie_details.json?movie_id=' + id + '&with_images=true').then(function (data) {
    var m = data.movie;
    if (!m) throw new Error('YTS: movie not found');
    var d = {
      id: 'yts://movie/' + m.id,
      title: m.title_long || m.title || ('Movie ' + m.id),
      url: 'yts://movie/' + m.id,
      type: 'movie',
      description: m.description_full || m.summary || '',
      episodes: [{
        id: 'yts://movie/' + m.id + '/watch', title: 'Watch',
        url: 'yts://movie/' + m.id + '/watch', number: 1
      }]
    };
    var c = _cover(m);
    if (c) d.cover = c;
    if (m.background_image_original) d.banner = m.background_image_original;
    if (m.year) d.year = String(m.year);
    if (m.genres && m.genres.length) {
      d.genres = m.genres.slice();
      d.description = (d.description ? d.description + '\n\nGenres: ' : 'Genres: ') + m.genres.join(', ');
    }
    return d;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function _magnet(hash, name) {
  var m = 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(name);
  for (var i = 0; i < _TRACKERS.length; i++) {
    m += '&tr=' + encodeURIComponent(_TRACKERS[i]);
  }
  return m;
}

function getVideoSources(episodeUrl, opts) {
  var id = _idFromUrl(episodeUrl);
  if (!id) return Promise.reject(new Error('YTS: bad url'));
  return _api('movie_details.json?movie_id=' + id).then(function (data) {
    var m = data.movie;
    if (!m || !m.torrents || !m.torrents.length) throw new Error('YTS: no torrents');
    var torrents = m.torrents.slice();
    torrents.sort(function (a, b) { return (b.seeds || 0) - (a.seeds || 0); });
    var minS = _minSeeders();
    var filtered = [];
    for (var i = 0; i < torrents.length; i++) {
      if (torrents[i].seeds >= minS) filtered.push(torrents[i]);
    }
    // Fall back to the best available even below the seeder floor, so the
    // source never returns an empty list.
    if (!filtered.length) filtered = torrents;
    var out = [];
    var title = m.title_long || m.title || 'YTS';
    for (var j = 0; j < filtered.length; j++) {
      var t = filtered[j];
      var q = t.quality || '';
      var type = (t.type || '').toLowerCase();
      var tag = (q + (type ? ' ' + type : '')).trim() || 'Torrent';
      var size = t.size || '';
      var seeds = (t.seeds != null ? t.seeds : 0);
      out.push({
        url: _magnet(t.hash, title + ' ' + tag),
        quality: q || undefined,
        label: tag + (size ? ' · ' + size : '') + ' · ' + seeds + ' seeds'
      });
    }
    if (!out.length) throw new Error('YTS: no playable streams');
    return out;
  });
}
