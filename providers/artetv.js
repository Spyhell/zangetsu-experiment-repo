// ARTE.tv — documentaries, concerts, films & series from the European
// public broadcaster. Legal, free, no login.
//
// Backend: ARTE's keyless EMAC v4 catalog API + player v2 config API.
//   search:  GET https://api.arte.tv/api/emac/v4/en/web/zones/<searchZone>/content
//              ?authorizedCountry=IN&page=N&query=<q>
//            (searchZone discovered dynamically from the /en/search/ page HTML,
//             so a zone rotation doesn't silently break search)
//   home:    GET https://www.arte.tv/en/ -> zone descriptors (id+title) ->
//            GET .../zones/<id>/content?authorizedCountry=IN&page=1
//   streams: GET https://api.arte.tv/api/player/v2/config/en/<programId>
//            -> attributes.streams[0].url = signed Akamai master m3u8
//            (1080p/720p/432p H264 + soft subs). GEO-blocked programs return
//            error.code = ERROR_GEOLOCATION with zero streams.
// Catalog is filtered with authorizedCountry=IN so listed programs are
// playable in India; geo-blocked leftovers fail loudly with a clear message.
// Collections (RC-*) resolve their member programs as episodes via the
// collection page HTML (embedded player config URLs).
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'artetv';

var _EMAC = 'https://api.arte.tv/api/emac/v4/en/web';
var _PLAYER = 'https://api.arte.tv/api/player/v2/config/en/';
var _SITE = 'https://www.arte.tv';
var _COUNTRY = 'IN';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Home rows we want, in order (matched against live zone titles, case-insensitive).
var _HOME_WANT = [
  'most popular', 'unmissable', 'top documentaries and reportage',
  'concerts', 'cinema', 'series', 'culture', 'history',
  'science and technology'
];
var _HOME_MAX_ROWS = 6;
var _HOME_MAX_ITEMS = 14;

// Never hang: 12s race, no-op when the runtime lacks timers (QuickJS-safe).
function _raceTimeout(p, ms) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('ARTE.tv: request timed out')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url, accept) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': accept || 'application/json' }
  }).then(function (r) {
    if (!r.ok) throw new Error('ARTE.tv: HTTP ' + r.status);
    return r.text();
  }), 12000);
}

function _getJson(url) {
  return _get(url).then(function (t) { return JSON.parse(t); });
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _cover(url, size) {
  var u = _trim(url);
  if (!u) return null;
  return u.replace('__SIZE__', size || '940x530');
}

function _isCollection(it) {
  var k = it && it.kind;
  return !!(k && k.isCollection);
}

function _playable(it) {
  if (!it || _isCollection(it)) return false;
  var a = it.availability || {};
  if (a.hasVideoStreams === false) return false;
  var g = it.geoblocking || {};
  var code = g.code;
  if (!code || code === 'ALL') return true;
  var incl = g.inclusion || [];
  for (var i = 0; i < incl.length; i++) {
    if (String(incl[i]).toUpperCase() === _COUNTRY) return true;
  }
  return false;
}

function _itemFromTeaser(it) {
  var pid = String(it.programId || it.id || '');
  // programIds look like '132676-000-A' (programs) or 'RC-028079' (collections)
  var isColl = _isCollection(it) || pid.indexOf('RC-') === 0;
  var title = _trim(it.title) || pid;
  var sub = _trim(it.subtitle);
  var url = 'artetv://' + (isColl ? 'collection/' : 'program/') + pid;
  if (isColl && it.url) {
    // collection pages 308-redirect unless the full slug path is used
    url += '?u=' + encodeURIComponent(String(it.url));
  }
  return {
    id: url,
    title: sub ? title + ' — ' + sub : title,
    url: url,
    type: 'movie',
    cover: _cover(it.mainImage && it.mainImage.url, '640x360'),
    dubBadge: isColl ? undefined : 'SUB'
  };
}

function _listable(it) {
  // Programs must be playable; collections resolve their members as episodes.
  return _playable(it) || _isCollection(it);
}

// Programs before collections: a collection's members aren't country-
// filtered, so its first episode can be geo-blocked where a program isn't.
function _programsFirst(items) {
  var progs = [], colls = [], i;
  for (i = 0; i < items.length; i++) {
    if (_isCollection(items[i])) colls.push(items[i]); else progs.push(items[i]);
  }
  return progs.concat(colls);
}

function _zoneContent(zoneId, extra) {
  var url = _EMAC + '/zones/' + zoneId + '/content?authorizedCountry='
    + _COUNTRY + '&page=1' + (extra ? '&' + extra : '');
  return _getJson(url).then(function (d) {
    var items = (d && d.data) || [];
    return _programsFirst(items.filter(_listable)).map(_itemFromTeaser).slice(0, _HOME_MAX_ITEMS);
  });
}

// The site's own pages embed the API zone ids in escaped JSON:
// \"id\":\"<uuid>\" ... \"title\":\"<title>\"
function _extractZones(html) {
  var zones = [], seen = {};
  var B = String.fromCharCode(92); // backslash
  // NOTE: inside a RegExp, a literal backslash must itself be escaped,
  // so the regex-safe "escaped quote" is backslash-backslash-backslash-quote.
  var q = B + B + B + '"';
  // match: \\\"id\\\":\\\"UUID\\\", ... \\\"title\\\":\\\"TITLE\\\"
  var re = new RegExp(
    q + 'id' + q + ':' + q + '([a-f0-9-]{36})' + q +
    '[\\s\\S]{0,400}?' + q + 'title' + q + ':' + q + '((?:(?!' + q + ')[\\s\\S])*)' + q,
    'g'
  );
  var m;
  while ((m = re.exec(html)) !== null) {
    var zid = m[1], title = m[2].replace(/\\u0026/g, '&');
    if (!seen[zid]) { seen[zid] = 1; zones.push({ id: zid, title: title }); }
  }
  return zones;
}

// programIds embedded as player config URLs: .../player/v2/config/en/<programId>
function _extractProgramIds(html) {
  var ids = [], seen = {};
  var re = /player\/v2\/config\/en\/([A-Z0-9-]+)/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = 1; ids.push(m[1]); }
  }
  return ids;
}

function getInfo() {
  return {
    name: 'ARTE TV', lang: 'en', baseUrl: 'https://www.arte.tv',
    logo: 'https://www.arte.tv/favicon.ico',
    type: 'movie', version: '1.0.0'
  };
}

function getHome(opts) {
  return _get(_SITE + '/en/', 'text/html').then(function (html) {
    var zones = _extractZones(html);
    var picked = [], i, j;
    for (i = 0; i < _HOME_WANT.length && picked.length < _HOME_MAX_ROWS; i++) {
      for (j = 0; j < zones.length; j++) {
        if (zones[j].title.toLowerCase().indexOf(_HOME_WANT[i]) !== -1) {
          picked.push(zones[j]);
          break;
        }
      }
    }
    // Fallback: if title matching failed (site redesign), take the first zones.
    if (!picked.length) picked = zones.slice(0, _HOME_MAX_ROWS);
    var jobs = picked.map(function (z) {
      return _zoneContent(z.id).then(function (items) {
        return items.length ? { title: z.title, items: items } : null;
      }).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (rows) {
      return rows.filter(function (r) { return !!r; });
    });
  });
}

var _searchZoneId = null;
function _findSearchZone() {
  if (_searchZoneId) return Promise.resolve(_searchZoneId);
  return _get(_SITE + '/en/search/?q=arte', 'text/html').then(function (html) {
    var B = String.fromCharCode(92);
    var re = new RegExp('/api/emac/v4/en/web/zones/([a-f0-9-]{36})/content');
    // the escaped form in the page: \/api\/emac...
    var re2 = new RegExp(B + B + '/api' + B + B + '/emac/v4/en/web/zones/([a-f0-9-]{36})/content');
    var m = re.exec(html) || re2.exec(html);
    if (!m) throw new Error('ARTE.tv: search zone not found');
    _searchZoneId = m[1];
    return _searchZoneId;
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var pg = parseInt(page, 10);
  if (isNaN(pg) || pg < 1) pg = 1;
  return _findSearchZone().then(function (zid) {
    var url = _EMAC + '/zones/' + zid + '/content?authorizedCountry=' + _COUNTRY
      + '&page=' + pg + '&query=' + encodeURIComponent(q);
    return _getJson(url);
  }).then(function (d) {
    var items = (d && d.data) || [];
    return _programsFirst(items.filter(_listable)).map(_itemFromTeaser).slice(0, 30);
  });
}

function _programDetail(pid) {
  return _getJson(_PLAYER + pid).then(function (d) {
    var a = d && d.data && d.data.attributes;
    if (!a) throw new Error('ARTE.tv: bad player response');
    var md = a.metadata || {};
    var img = (md.images && md.images[0] && md.images[0].url) || null;
    var desc = _trim(md.description);
    var dur = a.duration && a.duration.seconds ? ' · ' + Math.round(a.duration.seconds / 60) + ' min' : '';
    return {
      id: 'artetv:program:' + pid,
      title: _trim(md.title) || pid,
      url: 'artetv://program/' + pid,
      type: 'movie',
      cover: _cover(img, '940x530'),
      description: desc + dur,
      episodes: [{
        id: 'artetv:ep:' + pid,
        number: 1,
        title: _trim(md.title) || 'Play',
        url: 'artetv://play/' + pid
      }]
    };
  });
}

// A collection's member programs come from its playlist endpoint:
//   GET https://api.arte.tv/api/player/v2/playlist/en/<collectionId>
//   -> data.attributes.items[] { providerId, title, ... }
function _collectionDetail(pid, pageUrl) {
  return _getJson(_PLAYER.replace('/config/', '/playlist/') + pid)
    .catch(function () {
      // Fallback: scrape the collection page's member zones.
      return _collectionDetailViaZones(pid, pageUrl);
    })
    .then(function (d) {
      if (d && d.episodes) return d; // already resolved by fallback
      var a = d && d.data && d.data.attributes;
      if (!a) throw new Error('ARTE.tv: bad playlist response');
      var md = a.metadata || {};
      var items = a.items || [];
      var eps = [], seen = {}, n = 0;
      for (var i = 0; i < items.length && n < 60; i++) {
        var x = String(items[i].providerId || '');
        if (!x || seen[x] || x === pid || x.indexOf('RC-') === 0) continue;
        seen[x] = 1; n++;
        eps.push({
          id: 'artetv:ep:' + x,
          number: n,
          title: _trim(items[i].title) || ('Episode ' + n),
          url: 'artetv://play/' + x
        });
      }
      return {
        id: 'artetv:collection:' + pid,
        title: _trim(md.title) || pid,
        url: 'artetv://collection/' + pid,
        type: 'movie',
        cover: null,
        description: _trim(md.description),
        episodes: eps
      };
    });
}

// Fallback: collection members via the page's embedded member-zone URLs.
function _collectionDetailViaZones(pid, pageUrl) {
  var fetchPage = pageUrl
    ? _get(pageUrl, 'text/html')
    : _get(_SITE + '/en/videos/' + pid + '/', 'text/html');
  return fetchPage.then(function (html) {
    var title = 'Collection';
    var mt = /<title>([^<]*)<\/title>/.exec(html);
    if (mt) title = _trim(mt[1]).replace(/\s*-\s*ARTE.*$/, '');
    var zoneUrls = [], seen = {};
    var re = /\/api\/emac\/v4\/en\/web\/zones\/[a-f0-9-]{36}\/content\?[^"]*?collectionId=[^"]*/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var u = m[0].replace(/\\u0026/g, '&');
      if (!seen[u]) { seen[u] = 1; zoneUrls.push(u); }
    }
    if (!zoneUrls.length) throw new Error('ARTE.tv: collection has no loadable sections');
    var jobs = zoneUrls.slice(0, 4).map(function (u) {
      return _getJson(_EMAC + u.replace(/^\/api\/emac\/v4\/en\/web/, ''))
        .then(function (d) { return d && d.data ? d.data : []; })
        .catch(function () { return []; });
    });
    return Promise.all(jobs).then(function (lists) {
      var eps = [], seenPid = {}, n = 0;
      for (var i = 0; i < lists.length && n < 60; i++) {
        var items = lists[i];
        for (var j = 0; j < items.length && n < 60; j++) {
          var it = items[j];
          if (!_playable(it)) continue;
          var x = String(it.programId || '');
          if (!x || seenPid[x]) continue;
          seenPid[x] = 1; n++;
          eps.push({
            id: 'artetv:ep:' + x,
            number: n,
            title: _trim(it.title) || ('Episode ' + n),
            url: 'artetv://play/' + x
          });
        }
      }
      return {
        id: 'artetv:collection:' + pid,
        title: title || pid,
        url: 'artetv://collection/' + pid,
        type: 'movie',
        cover: null,
        description: '',
        episodes: eps
      };
    });
  });
}

function getDetail(url, opts) {
  var m = /^artetv:\/\/(program|collection)\/([A-Za-z0-9-]+)(\?u=([^&]*))?/.exec(String(url || ''));
  if (!m) return Promise.reject(new Error('ARTE.tv: bad url'));
  if (m[1] === 'collection') {
    var pageUrl = null;
    if (m[4]) { try { pageUrl = decodeURIComponent(m[4]); } catch (e) { pageUrl = null; } }
    return _collectionDetail(m[2], pageUrl);
  }
  return _programDetail(m[2]);
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// Fetch master playlist, return one entry per H264 variant (highest first).
function _expandQualities(masterUrl, label) {
  return _get(masterUrl, 'application/vnd.apple.mpegurl').then(function (text) {
    var base = masterUrl.replace(/[^\/]*$/, '');
    var out = [];
    var re = /#EXT-X-STREAM-INF:([^\n]*)\n([^\n]+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var attrs = m[1], uri = _trim(m[2]);
      if (/hev1|hvc1/i.test(attrs)) continue; // HEVC: skip, app players vary
      if (!/^https?:\/\//i.test(uri)) uri = base + uri;
      var rm = /RESOLUTION=\d+x(\d+)/i.exec(attrs);
      var q = rm ? rm[1] + 'p' : null;
      var e = { url: uri, label: label, container: 'hls' };
      if (q) e.quality = q;
      out.push(e);
    }
    out.sort(function (a, b) {
      return parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10);
    });
    var auto = { url: masterUrl, label: label + ' · Auto', container: 'hls', quality: 'Auto' };
    return [auto].concat(out);
  }).catch(function () {
    return [{ url: masterUrl, label: label + ' · Auto', container: 'hls' }];
  });
}

function getVideoSources(episodeUrl) {
  var m = /^artetv:\/\/play\/([A-Za-z0-9-]+)/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('ARTE.tv: bad episode url'));
  var pid = m[1];
  return _getJson(_PLAYER + pid).then(function (d) {
    var a = d && d.data && d.data.attributes;
    if (!a) throw new Error('ARTE.tv: bad player response');
    var err = a.error;
    if (err && err.code) {
      throw new Error('ARTE.tv: ' + (_trim(err.title) || 'not available in your country'));
    }
    var streams = a.streams || [];
    if (!streams.length || !streams[0].url) {
      throw new Error('ARTE.tv: no streams for this programme');
    }
    var master = streams[0].url;
    var versions = streams[0].versions || [];
    // Prefer the original-language version's manifest when the API splits them.
    var label = 'ARTE.tv';
    return _expandQualities(master, label);
  });
}
