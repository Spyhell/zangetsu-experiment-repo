/*
 * SubsPlease — current-season English-subbed anime via the public SubsPlease API.
 *
 * VERIFIED chain (2026-10-09, plain HTTP, no login, no crypto, no browser):
 *   GET https://subsplease.org/api/?f=latest&tz=UTC
 *   GET https://subsplease.org/api/?f=search&tz=UTC&s=<query>
 *     -> {"<Show> - <Ep>": {"show","episode","image_url","page",
 *         "downloads":[{"res":"480"|"720"|"1080","magnet":"magnet:?xt=urn:btih:..."
 *                        (trackers already appended),"xl":<bytes>}, ...]}}
 *   Streams are torrent magnets (480p/720p/1080p); Zangetsu's native torrent
 *   engine plays them (same as ToraStream/Nyaa). Posters are absolute URLs
 *   built from image_url. Entries ARE episodes, so lists are grouped by `show`.
 * ES5 only.
 */

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'subsplease';

var _SP_SITE = 'https://subsplease.org';
var _SP_API = _SP_SITE + '/api/?f=';

function getInfo() {
  return {
    name: 'SubsPlease', lang: 'en', baseUrl: _SP_SITE,
    logo: _SP_SITE + '/favicon.ico', type: 'anime', version: '1.0.0'
  };
}

function _getJson(url) {
  return fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('SubsPlease: HTTP ' + (r && r.status) + ' for ' + url);
    return r.json();
  }).then(function (d) {
    if (!d || typeof d !== 'object') throw new Error('SubsPlease: bad JSON for ' + url);
    return d;
  });
}

function _cover(e) {
  var u = e && e.image_url;
  if (!u) return null;
  return u.indexOf('http') === 0 ? u : _SP_SITE + u;
}

function _showId(show) {
  return 'subsplease://show/' + encodeURIComponent(show);
}

function _epId(show, key) {
  return 'subsplease://ep/' + encodeURIComponent(show) + '|' + encodeURIComponent(key);
}

function _parseEpId(url) {
  var m = /^subsplease:\/\/ep\/([^|]+)\|(.+)$/.exec(String(url || ''));
  if (!m) return null;
  return { show: decodeURIComponent(m[1]), key: decodeURIComponent(m[2]) };
}

function _parseShowId(url) {
  var m = /^subsplease:\/\/show\/(.+)$/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

// Group raw API entries (key -> entry) by show name, preserving order.
function _groupByShow(data) {
  var seen = {}, groups = [];
  var keys = Object.keys(data || {});
  for (var i = 0; i < keys.length; i++) {
    var e = data[keys[i]];
    if (!e || !e.show) continue;
    var show = String(e.show);
    if (seen[show]) continue;
    seen[show] = true;
    groups.push({ show: show, first: e });
  }
  return groups;
}

function _showItem(show, first) {
  return {
    id: _showId(show), title: show, url: _showId(show), type: 'anime',
    cover: _cover(first)
  };
}

function _epNumber(ep) {
  var m = /^\s*(\d+)\s*$/.exec(String(ep || ''));
  return m ? parseInt(m[1], 10) : null;
}

function _fmtSize(bytes) {
  var b = parseFloat(bytes);
  if (!(b > 0)) return '';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  return Math.round(b / 1024) + ' KB';
}

// All entries whose `show` exactly matches, newest-first as returned.
function _entriesForShow(show) {
  return _getJson(_SP_API + 'search&tz=UTC&s=' + encodeURIComponent(show))
    .then(function (data) {
      var out = [], keys = Object.keys(data || {});
      var want = String(show).toLowerCase();
      for (var i = 0; i < keys.length; i++) {
        var e = data[keys[i]];
        if (e && String(e.show || '').toLowerCase() === want) {
          out.push({ key: keys[i], e: e });
        }
      }
      return out;
    });
}

function _episodesFromEntries(show, entries) {
  return entries.map(function (x) {
    var ep = String(x.e.episode || x.key);
    var item = {
      id: _epId(show, x.key),
      title: show + ' - ' + ep,
      url: _epId(show, x.key)
    };
    var n = _epNumber(ep);
    if (n !== null) item.number = n;
    return item;
  });
}

function getHome(opts) {
  return _getJson(_SP_API + 'latest&tz=UTC').then(function (data) {
    var groups = _groupByShow(data);
    var latest = [], batches = [];
    for (var i = 0; i < groups.length; i++) {
      var it = _showItem(groups[i].show, groups[i].first);
      latest.push(it);
      if (/-/.test(String(groups[i].first.episode || ''))) batches.push(it);
    }
    var rows = [{ title: 'Latest Releases', items: latest.slice(0, 20) }];
    if (batches.length) rows.push({ title: 'Recent Batches', items: batches.slice(0, 20) });
    return rows;
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _getJson(_SP_API + 'search&tz=UTC&s=' + encodeURIComponent(q))
    .then(function (data) {
      return _groupByShow(data).map(function (g) {
        return _showItem(g.show, g.first);
      });
    });
}

function getDetail(url, opts) {
  var show = _parseShowId(url);
  if (!show) return Promise.reject(new Error('SubsPlease: bad show url'));
  return _entriesForShow(show).then(function (entries) {
    var eps = _episodesFromEntries(show, entries);
    var cover = entries.length ? _cover(entries[0].e) : null;
    return {
      id: _showId(show), title: show, url: _showId(show), type: 'anime',
      cover: cover, description: null, episodes: eps
    };
  });
}

function getEpisodes(url, opts) {
  var show = _parseShowId(url);
  if (!show) return Promise.reject(new Error('SubsPlease: bad show url'));
  return _entriesForShow(show).then(function (entries) {
    return _episodesFromEntries(show, entries);
  });
}

function getVideoSources(episodeUrl) {
  var p = _parseEpId(episodeUrl);
  if (!p) return Promise.reject(new Error('SubsPlease: bad episode url'));
  return _entriesForShow(p.show).then(function (entries) {
    var found = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].key === p.key) { found = entries[i].e; break; }
    }
    if (!found) throw new Error('SubsPlease: episode not found');
    var dls = found.downloads || [];
    // Highest quality first.
    dls = dls.slice().sort(function (a, b) {
      return parseInt(b.res, 10) - parseInt(a.res, 10);
    });
    return dls.map(function (d) {
      var size = _fmtSize(d.xl);
      return {
        url: d.magnet,
        quality: d.res + 'p',
        label: d.res + 'p' + (size ? ' · ' + size : ''),
        kind: 'sub'
      };
    }).filter(function (s) { return s.url && /^magnet:/i.test(s.url); });
  });
}
