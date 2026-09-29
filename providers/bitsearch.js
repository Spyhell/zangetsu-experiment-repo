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

function getInfo() {
  return {
    name: 'BitSearch', lang: 'en', baseUrl: 'https://bitsearch.eu',
    logo: 'https://bitsearch.eu/favicon.ico',
    type: 'movie', version: '1.0.0'
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
      return { title: row.title, items: list.map(_itemFromResult) };
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
    return list.map(_itemFromResult);
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
  return Promise.resolve(base);
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
