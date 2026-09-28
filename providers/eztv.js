// EZTV — TV series torrents for the Zangetsu app.
//
// Backend: EZTV's public JSON API (eztvx.to) for torrents + TVMaze's public
// API for show metadata/search/posters (both keyless, no login).
//   search/meta: https://api.tvmaze.com/search/shows?q=<q>
//   show:        https://api.tvmaze.com/shows/<tvmazeId>
//   home:        https://api.tvmaze.com/schedule?country=US  (airing today)
//                https://api.tvmaze.com/shows?page=0          (top rated)
//   torrents:    https://eztvx.to/api/get-torrents?imdb_id=<digits>&limit=100
// Streams are magnet links, played by Zangetsu's native torrent engine.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'eztv';

var _TVMAZE = 'https://api.tvmaze.com';
var _EZTV_API = 'https://eztvx.to/api/get-torrents';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return {
    name: 'EZTV', lang: 'en', baseUrl: 'https://eztvx.to',
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/eztv.png',
    type: 'movie', version: '1.0.0'
  };
}

// Never hang: 12s race, no-op when the runtime lacks timers (QuickJS-safe).
function _raceTimeout(p, ms) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('EZTV: request timed out')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    if (!r.ok) throw new Error('EZTV: HTTP ' + r.status);
    return r.json();
  }), 12000);
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _cover(show) {
  var img = show && show.image;
  return (img && (img.medium || img.original)) || null;
}

function _itemFromShow(show) {
  if (!show || !show.id) return null;
  // EZTV torrents are keyed by IMDb id — a show without one is a dead end.
  if (!_imdbDigits(show.externals && show.externals.imdb)) return null;
  return {
    id: 'eztv://show/' + show.id,
    title: _trim(show.name) || 'Unknown',
    url: 'eztv://show/' + show.id,
    type: 'movie',
    cover: _cover(show)
  };
}

function _imdbDigits(imdb) {
  var m = String(imdb || '').match(/tt(\d+)/);
  return m ? m[1] : null;
}

function _parseSE(text) {
  var m = String(text || '').match(/S(\d{1,2})E(\d{1,3})/i);
  if (!m) return null;
  return { s: parseInt(m[1], 10), e: parseInt(m[2], 10) };
}

function _quality(text) {
  var m = String(text || '').match(/(2160|1080|720|480)p/i);
  return m ? m[1] + 'p' : null;
}

function _seeds(t) {
  var n = parseInt(t && t.seeds, 10);
  return isNaN(n) ? 0 : n;
}

function getHome(opts) {
  var rows = [];
  var airing = _get(_TVMAZE + '/schedule?country=US').then(function (list) {
    var seen = {}, items = [];
    (list || []).forEach(function (entry) {
      var show = entry && entry.show;
      if (!show || seen[show.id]) return;
      seen[show.id] = true;
      var it = _itemFromShow(show);
      if (it) items.push(it);
    });
    return { title: 'Airing Today', items: items.slice(0, 30) };
  }).catch(function () { return null; });
  var top = _get(_TVMAZE + '/shows?page=0').then(function (list) {
    var sorted = (list || []).slice().sort(function (a, b) {
      var ra = (a.rating && a.rating.average) || 0;
      var rb = (b.rating && b.rating.average) || 0;
      return rb - ra;
    });
    var items = [];
    sorted.slice(0, 24).forEach(function (show) {
      var it = _itemFromShow(show);
      if (it) items.push(it);
    });
    return { title: 'Top Rated Shows', items: items };
  }).catch(function () { return null; });
  return Promise.all([airing, top]).then(function (r) {
    return r.filter(function (x) { return x && x.items && x.items.length; });
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _get(_TVMAZE + '/search/shows?q=' + encodeURIComponent(q)).then(function (list) {
    var items = [];
    (list || []).forEach(function (entry) {
      var it = _itemFromShow(entry && entry.show);
      if (it) items.push(it);
    });
    return items;
  });
}

function _torrents(imdbDigits) {
  return _get(_EZTV_API + '?imdb_id=' + encodeURIComponent(imdbDigits) + '&limit=100')
    .then(function (d) {
      var list = (d && d.torrents) || [];
      return Array.isArray(list) ? list : [];
    });
}

function getDetail(url, opts) {
  var m = String(url || '').match(/^eztv:\/\/show\/(\d+)/);
  if (!m) return Promise.reject(new Error('EZTV: bad show url'));
  var tvmazeId = m[1];
  return _get(_TVMAZE + '/shows/' + tvmazeId).then(function (show) {
    var digits = _imdbDigits(show && show.externals && show.externals.imdb);
    var base = {
      id: 'eztv://show/' + tvmazeId,
      title: _trim(show && show.name) || 'Unknown',
      url: 'eztv://show/' + tvmazeId,
      type: 'movie',
      cover: _cover(show),
      description: null,
      episodes: []
    };
    if (show && show.summary) {
      try { base.description = _trim(String(show.summary).replace(/<[^>]+>/g, ' ')).slice(0, 500) || null; }
      catch (e) { base.description = null; }
    }
    if (!digits) return base;
    return _torrents(digits).then(function (torrents) {
      var groups = {}, order = [];
      torrents.forEach(function (t) {
        var se = _parseSE(t.title || t.filename);
        if (!se) return;
        var key = se.s + 'x' + se.e;
        if (!groups[key]) {
          groups[key] = [];
          order.push({ key: key, s: se.s, e: se.e });
        }
        groups[key].push(t);
      });
      order.sort(function (a, b) {
        return (a.s * 1000 + a.e) - (b.s * 1000 + b.e);
      });
      base.episodes = order.map(function (o) {
        var rels = groups[o.key].slice().sort(function (a, b) { return _seeds(b) - _seeds(a); });
        var first = rels[0];
        var epName = _trim(first.filename || first.title || '').replace(/\.[^.]+$/, '');
        return {
          id: 'eztv://e/' + digits + '/' + o.s + '/' + o.e,
          title: 'S' + (o.s < 10 ? '0' : '') + o.s + 'E' + (o.e < 10 ? '0' : '') + o.e
            + (epName ? ' — ' + epName.slice(0, 80) : ''),
          url: 'eztv://e/' + digits + '/' + o.s + '/' + o.e,
          number: o.s * 1000 + o.e
        };
      });
      return base;
    }).catch(function () { return base; });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) {
    return (d && d.episodes) || [];
  });
}

function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^eztv:\/\/e\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return Promise.reject(new Error('EZTV: bad episode url'));
  var digits = m[1], s = parseInt(m[2], 10), e = parseInt(m[3], 10);
  return _torrents(digits).then(function (torrents) {
    var out = [];
    torrents.forEach(function (t) {
      var se = _parseSE(t.title || t.filename);
      if (!se || se.s !== s || se.e !== e) return;
      var mag = _trim(t.magnet_url);
      if (!/^magnet:/i.test(mag)) return;
      var q = _quality(t.title || t.filename);
      var src = {
        url: mag,
        label: _trim(t.title || t.filename || 'Episode') + ' [' + _seeds(t) + ' seeds]'
      };
      if (q) src.quality = q;
      out.push(src);
    });
    out.sort(function (a, b) {
      var sa = parseInt(String(a.label.match(/\[(\d+) seeds\]/) || [0, 0])[1], 10);
      var sb = parseInt(String(b.label.match(/\[(\d+) seeds\]/) || [0, 0])[1], 10);
      return sb - sa;
    });
    return out;
  });
}
