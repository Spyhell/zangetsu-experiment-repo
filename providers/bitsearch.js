// BitSearch — movie/series torrent search for the Zangetsu app.
//
// Backend: BitSearch's public keyless JSON API.
//   search: https://bitsearch.eu/api/v1/search?q=<q>&page=1
//   -> {"success":true,"results":[{"id","infohash","title","size",
//       "category","subCategory","seeders","leechers","updatedAt"}]}
// Streams are magnet links, played by Zangetsu's native torrent engine
// (streams while downloading). No login, no crypto, JSON-only.
// Results are sorted by seeders (desc) and filtered to 5+ seeders so the
// native engine finds peers instead of hanging on "finding peers".
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'bitsearch';

var _API = 'https://bitsearch.eu/api/v1';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Public trackers appended to every magnet so the torrent engine can
// discover peers quickly instead of relying on DHT alone.
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

var _MIN_SEEDERS = 5;

// ── Posters via TMDB ────────────────────────────────────────────────────
// Torrent indexes carry no images. Clean the release name down to the
// movie/series title and ask TMDB (bundled public key, same one CineStream
// uses) for a poster. Cached per name, 4 new lookups max per call so the
// first load stays fast (a big first-load batch once made the app show its
// retry screen), fully fail-soft: a miss just leaves cover unset.
var _TMDB = 'https://api.themoviedb.org/3';
var _TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var _TMDB_IMG = 'https://image.tmdb.org/t/p/w342';
var MAX_NEW_COVERS = 4;
var _coverCache = {}; // cleaned name -> poster url ('' = none found)

function _cleanName(title) {
  var t = String(title || '');
  t = t.replace(/\.(mkv|mp4|avi|torrent)$/i, '');
  t = t.replace(/[._]+/g, ' ');
  t = t.replace(/[(),]/g, ' ');                       // unbalanced parens/commas
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[^\x00-\x7F]+/, '').trim();          // leading non-Latin run
  t = t.replace(/^www\b.*?\s+-\s+/i, '').trim();       // 'www X - ' junk prefix
  var m = t.match(/^(.*?)\s+[Ss]\d{1,2}([Ee]\d{1,3})?\b.*$/); // S01E01 / S01
  if (m) t = m[1].trim();
  m = t.match(/^(.*?)\s+\d{1,2}[xX]\d{1,3}\b.*$/);              // 1x01
  if (m) t = m[1].trim();
  m = t.match(/^(.*?)\s+[Ee][Pp]?\s*\d{1,4}\b.*$/);             // EP12 / E12
  if (m) t = m[1].trim();
  m = t.match(/^(.*?\b(19|20)\d{2}\b).*$/);                    // cut after year
  if (m) t = m[1].trim();
  var tags = /\b(2160p|1080p|720p|480p|360p|4k|uhd|hd|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|dvdscr|hdcam|cam|ts|x264|x265|xvid|hevc|aac|ac3|dts|ddp|atmos|10bit|8bit|hdr|hdr10|dolby|vision|dual[\s-]?audio|multi|subbed|dubbed|remux|proper|repack|extended|unrated|imax|yify|yts|rarbg|ettv|eztv|subsplease|horriblesubs)\b/gi;
  var prev;
  do { prev = t; t = t.replace(tags, ' ').replace(/\s+/g, ' ').trim(); }
  while (t !== prev && t.length);
  t = t.replace(/\s*-\s*[A-Za-z0-9]{2,}$/, '').trim();          // -GROUP
  return t;
}

function _firstPoster(d) {
  var res = (d && d.results) || [], i;
  for (i = 0; i < res.length; i++) {
    var p = res[i] && res[i].poster_path;
    if (p) return _TMDB_IMG + p;
  }
  return '';
}

function _tmdbCover(name) {
  // TMDB's multi search chokes when the year is inside the query string,
  // so search movies with the year as a proper parameter, then fall back
  // to multi (covers TV shows).
  var q = String(name).replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
  var ym = String(name).match(/\b((19|20)\d{2})\b/);
  var year = ym ? ym[1] : '';
  var query = encodeURIComponent(q || name);
  var movieUrl = _TMDB + '/search/movie?api_key=' + _TMDB_KEY
    + '&query=' + query + '&include_adult=false&page=1'
    + (year ? '&year=' + year : '');
  return _get(movieUrl).then(function (d) {
    var hit = _firstPoster(d);
    if (hit) return hit;
    var multiUrl = _TMDB + '/search/multi?api_key=' + _TMDB_KEY
      + '&query=' + query + '&include_adult=false&page=1';
    return _get(multiUrl).then(_firstPoster);
  }).catch(function () { return ''; });
}

function _resolveCover(title) {
  var name = _cleanName(title);
  if (!name) return Promise.resolve('');
  if (Object.prototype.hasOwnProperty.call(_coverCache, name))
    return Promise.resolve(_coverCache[name]);
  return _tmdbCover(name).then(function (c) {
    _coverCache[name] = c;
    return c;
  });
}

// Run promise factories with at most n in flight (ES5).
function _eachLimit(list, n, fn) {
  if (!list.length) return Promise.resolve([]);
  var i = 0, active = 0, done = false;
  var results = new Array(list.length);
  return new Promise(function (resolve) {
    function finish(idx, v) {
      results[idx] = v; active--;
      if (i >= list.length && active === 0 && !done) { done = true; resolve(results); }
      else pump();
    }
    function pump() {
      if (done) return;
      while (active < n && i < list.length) {
        (function (idx) {
          active++;
          var p;
          try { p = fn(list[idx], idx); }
          catch (e) { finish(idx, undefined); return; }
          Promise.resolve(p).then(function (v) { finish(idx, v); },
                                  function () { finish(idx, undefined); });
        })(i++);
      }
    }
    pump();
  });
}

// Attach covers to a list of items; a poster miss never fails the list.
function _withCovers(items) {
  var seen = {}, queue = [], i, budgeted = 0;
  for (i = 0; i < items.length; i++) {
    var key = _cleanName(items[i].title);
    items[i]._ck = key;
    if (!key || seen[key]) continue;
    seen[key] = 1;
    // Already-known posters are free; only new lookups cost the budget.
    if (Object.prototype.hasOwnProperty.call(_coverCache, key)) continue;
    if (budgeted >= MAX_NEW_COVERS) continue;
    budgeted++;
    queue.push(items[i].title);
  }
  return _eachLimit(queue, 8, _resolveCover).then(function () {
    for (var j = 0; j < items.length; j++) {
      var c = _coverCache[items[j]._ck] || '';
      if (c) items[j].cover = c;
      delete items[j]._ck;
    }
    return items;
  }).catch(function () {
    for (var k = 0; k < items.length; k++) delete items[k]._ck;
    return items;
  });
}

function getInfo() {
  return {
    name: 'BitSearch', lang: 'en', baseUrl: 'https://bitsearch.eu',
    logo: 'https://bitsearch.eu/favicon.ico',
    type: 'movie', version: '1.0.1'
  };
}

// Never hang: 12s race, no-op when the runtime lacks timers (QuickJS-safe).
function _raceTimeout(p, ms) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('BitSearch: request timed out')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    if (!r.ok) throw new Error('BitSearch: HTTP ' + r.status);
    return r.json();
  }), 12000);
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _seeds(r) {
  var n = parseInt(r && r.seeders, 10);
  return isNaN(n) ? 0 : n;
}

function _quality(title) {
  var m = String(title || '').match(/(2160|1080|720|480)p/i);
  return m ? m[1] + 'p' : null;
}

function _size(s) {
  var n = parseFloat(s);
  if (isNaN(n) || n <= 0) return null;
  var u = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (Math.round(n * 10) / 10) + ' ' + u[i];
}

function _magnet(infohash, title) {
  var dn = encodeURIComponent(title || infohash);
  var tr = _TRACKERS.map(function (t) { return '&tr=' + encodeURIComponent(t); }).join('');
  return 'magnet:?xt=urn:btih:' + infohash + '&dn=' + dn + tr;
}

function _isAdult(r) {
  // BitSearch category 5 = adult. Never surface it.
  return String(r && r.category) === '5';
}

function _results(q, limit) {
  return _get(_API + '/search?q=' + encodeURIComponent(q) + '&page=1')
    .then(function (d) {
      var list = (d && d.success && d.results) || [];
      if (!Array.isArray(list)) list = [];
      return list.filter(function (r) {
        return r && /^[a-fA-F0-9]{40}$/.test(String(r.infohash || '')) && !_isAdult(r);
      }).sort(function (a, b) { return _seeds(b) - _seeds(a); })
        .filter(function (r) { return _seeds(r) >= _MIN_SEEDERS; })
        .slice(0, limit || 30);
    });
}

function _itemFromResult(r) {
  var hash = String(r.infohash).toLowerCase();
  var title = _trim(r.title) || hash;
  var url = 'bitsearch://t/' + hash
    + '?t=' + encodeURIComponent(title)
    + '&s=' + _seeds(r);
  return {
    id: url,
    title: title,
    url: url,
    type: 'movie',
    cover: null
  };
}

function _parseUrl(url) {
  var m = String(url || '').match(/^bitsearch:\/\/t\/([a-fA-F0-9]{40})\?(.*)$/);
  if (!m) return null;
  var q = {}, parts = m[2].split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    q[kv[0]] = kv[1] || '';
  }
  var title = '';
  try { title = decodeURIComponent(q.t || ''); } catch (e) { title = q.t || ''; }
  return { hash: m[1].toLowerCase(), title: title, seeds: parseInt(q.s, 10) || 0 };
}

function getHome(opts) {
  var rows = [
    { title: 'Popular Movies', q: 'oppenheimer' },
    { title: 'Popular Series', q: 'breaking bad' },
    { title: 'Anime', q: 'naruto' }
  ].map(function (row) {
    return _results(row.q, 14).then(function (list) {
      return _withCovers(list.map(_itemFromResult)).then(function (items) {
        return { title: row.title, items: items };
      });
    }).catch(function () { return null; });
  });
  return Promise.all(rows).then(function (r) {
    return r.filter(function (x) { return x && x.items && x.items.length; });
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _results(q, 30).then(function (list) {
    return _withCovers(list.map(_itemFromResult));
  });
}

function getDetail(url, opts) {
  var ref = _parseUrl(url);
  var base = {
    id: null, title: '', url: url, type: 'movie', cover: null,
    description: '', episodes: []
  };
  if (!ref) return Promise.resolve(base);
  base.id = 'bitsearch:' + ref.hash;
  base.title = ref.title || ref.hash;
  base.description = 'BitSearch torrent' + (ref.seeds ? ' · ' + ref.seeds + ' seeders' : '');
  base.episodes = [{
    id: 'bitsearch:ep:' + ref.hash,
    number: 1,
    title: ref.title || 'Play',
    url: 'bitsearch://play/' + ref.hash
      + '?t=' + encodeURIComponent(ref.title || ref.hash)
      + '&s=' + ref.seeds
  }];
  return _resolveCover(ref.title).then(function (c) {
    if (c) base.cover = c;
    return base;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^bitsearch:\/\/play\/([a-fA-F0-9]{40})\?(.*)$/);
  if (!m) return Promise.reject(new Error('BitSearch: bad episode url'));
  var q = {}, parts = m[2].split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    q[kv[0]] = kv[1] || '';
  }
  var title = '';
  try { title = decodeURIComponent(q.t || ''); } catch (e) { title = q.t || ''; }
  var hash = m[1].toLowerCase();
  var tq = _quality(title);
  var label = '🧲 BitSearch' + (tq ? ' · ' + tq : '')
    + (q.s ? ' · ' + q.s + ' seeds' : '');
  var src = {
    url: _magnet(hash, title || hash),
    label: label,
    container: 'torrent'
  };
  if (tq) src.quality = tq;
  return Promise.resolve([src]);
}
