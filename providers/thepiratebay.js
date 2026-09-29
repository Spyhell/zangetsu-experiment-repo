// ThePirateBay — movie/series torrents for the Zangetsu app.
//
// Backend: apibay.org, the long-stable public JSON proxy for ThePirateBay.
//   search: https://apibay.org/q.php?q=<q>&cat=<cat>
//   -> [{"id","name","info_hash","leechers","seeders","num_files","size",
//        "username","added","status","category","imdb"}]
//   TPB categories: 100s audio, 200s video (201 movies, 205 TV), 300s apps,
//   400s games, 500s porn, 600s other. Only 200s video is surfaced.
// Streams are magnet links, played by Zangetsu's native torrent engine
// (streams while downloading). No login, no crypto, JSON-only.
// Results are sorted by seeders (desc) and filtered to 5+ seeders so the
// native engine finds peers instead of hanging on "finding peers".
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'thepiratebay';

var _API = 'https://apibay.org/q.php';
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
    name: 'ThePirateBay', lang: 'en', baseUrl: 'https://thepiratebay.org',
    logo: 'https://thepiratebay.org/favicon.ico',
    type: 'movie', version: '1.0.0'
  };
}

// Never hang: 12s race, no-op when the runtime lacks timers (QuickJS-safe).
function _raceTimeout(p, ms) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('ThePirateBay: request timed out')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    if (!r.ok) throw new Error('ThePirateBay: HTTP ' + r.status);
    return r.json();
  }), 12000);
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _seeds(r) {
  var n = parseInt(r && r.seeders, 10);
  return isNaN(n) ? 0 : n;
}

function _quality(name) {
  var m = String(name || '').match(/(2160|1080|720|480)p/i);
  return m ? m[1] + 'p' : null;
}

function _videoOnly(r) {
  // TPB category 200-299 = video. Porn (500s) and everything else dropped.
  var c = parseInt(r && r.category, 10);
  return !isNaN(c) && c >= 200 && c < 300;
}

function _magnet(infohash, name) {
  var dn = encodeURIComponent(name || infohash);
  var tr = _TRACKERS.map(function (t) { return '&tr=' + encodeURIComponent(t); }).join('');
  return 'magnet:?xt=urn:btih:' + infohash + '&dn=' + dn + tr;
}

function _search(q, cat, limit) {
  return _get(_API + '?q=' + encodeURIComponent(q) + '&cat=' + encodeURIComponent(cat))
    .then(function (d) {
      var list = Array.isArray(d) ? d : [];
      return list.filter(function (r) {
        return r && /^[a-fA-F0-9]{40}$/i.test(String(r.info_hash || '')) && _videoOnly(r);
      }).sort(function (a, b) { return _seeds(b) - _seeds(a); })
        .filter(function (r) { return _seeds(r) >= _MIN_SEEDERS; })
        .slice(0, limit || 30);
    });
}

function _itemFromResult(r) {
  var hash = String(r.info_hash).toLowerCase();
  var name = _trim(r.name) || hash;
  var url = 'tpb://t/' + hash
    + '?t=' + encodeURIComponent(name)
    + '&s=' + _seeds(r);
  return {
    id: url,
    title: name,
    url: url,
    type: 'movie',
    cover: null
  };
}

function _parseUrl(url) {
  var m = String(url || '').match(/^tpb:\/\/t\/([a-fA-F0-9]{40})\?(.*)$/);
  if (!m) return null;
  var q = {}, parts = m[2].split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    q[kv[0]] = kv[1] || '';
  }
  var name = '';
  try { name = decodeURIComponent(q.t || ''); } catch (e) { name = q.t || ''; }
  return { hash: m[1].toLowerCase(), name: name, seeds: parseInt(q.s, 10) || 0 };
}

function getHome(opts) {
  var rows = [
    { title: 'Trending Movies', q: '2026', cat: '201' },
    { title: 'Trending TV', q: '2026', cat: '205' }
  ].map(function (row) {
    return _search(row.q, row.cat, 14).then(function (list) {
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
  return _search(q, '200', 30).then(function (list) {
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
  base.id = 'tpb:' + ref.hash;
  base.title = ref.name || ref.hash;
  base.description = 'ThePirateBay torrent' + (ref.seeds ? ' · ' + ref.seeds + ' seeders' : '');
  base.episodes = [{
    id: 'tpb:ep:' + ref.hash,
    number: 1,
    title: ref.name || 'Play',
    url: 'tpb://play/' + ref.hash
      + '?t=' + encodeURIComponent(ref.name || ref.hash)
      + '&s=' + ref.seeds
  }];
  return Promise.resolve(base);
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^tpb:\/\/play\/([a-fA-F0-9]{40})\?(.*)$/);
  if (!m) return Promise.reject(new Error('ThePirateBay: bad episode url'));
  var q = {}, parts = m[2].split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    q[kv[0]] = kv[1] || '';
  }
  var name = '';
  try { name = decodeURIComponent(q.t || ''); } catch (e) { name = q.t || ''; }
  var hash = m[1].toLowerCase();
  var tq = _quality(name);
  var label = '🧲 ThePirateBay' + (tq ? ' · ' + tq : '')
    + (q.s ? ' · ' + q.s + ' seeds' : '');
  var src = {
    url: _magnet(hash, name || hash),
    label: label,
    container: 'torrent'
  };
  if (tq) src.quality = tq;
  return Promise.resolve([src]);
}
