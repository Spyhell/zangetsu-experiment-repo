/*
 * NASA Video Library — public NASA image & video library (images.nasa.gov).
 *
 * VERIFIED chain (2026-10-14, plain HTTP, no login, no key, no crypto):
 *   GET https://images-api.nasa.gov/search?q=<q>&media_type=video&page_size=24
 *     -> {collection:{items:[{data:[{title,nasa_id,description,date_created}],
 *         links:[{href: preview thumb}], href: <collection.json URL>}]},
 *         metadata:{total_hits}}
 *   GET https://images-api.nasa.gov/search?nasa_id=<id>&media_type=video
 *     -> same shape, single item (detail lookup)
 *   GET <item.href>  (https://images-assets.nasa.gov/video/<id>/collection.json)
 *     -> {collection:{items:[{href}]}} with per-video files:
 *        ~orig.mp4, ~large.mp4, ~medium.mp4, ~small.mp4, ~mobile.mp4,
 *        ~preview.mp4, .srt (English captions), thumbs.
 *   Direct https mp4 byte-verified: HTTP 206, video/mp4, 200KB range read.
 * Quality tiers mapped from the filename suffix: large->1080p, medium->720p,
 * small->480p, mobile->360p; orig kept as the last (best) entry. The .srt is
 * attached as an English subtitle on every entry.
 * ES5 only.
 */

var _NASA_API = 'https://images-api.nasa.gov';
var _NASA_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function getInfo() {
  return {
    name: 'NASA Video Library', lang: 'en', baseUrl: 'https://images.nasa.gov',
    logo: 'https://www.nasa.gov/favicon.ico', type: 'movie', version: '1.0.0'
  };
}

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

function _getJson(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': _NASA_UA, 'Accept': 'application/json' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('NASA: HTTP ' + (r && r.status) + ' for ' + url);
    return r.json();
  }), 20000, null).then(function (j) {
    if (j == null) throw new Error('NASA: timeout for ' + url);
    return j;
  });
}

function _enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }

function _thumb(item) {
  try {
    var links = item.links || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i] && links[i].href) return String(links[i].href);
    }
  } catch (e) {}
  return null;
}

function _toItem(it) {
  var d = (it.data && it.data[0]) || {};
  var id = String(d.nasa_id || '');
  if (!id) return null;
  var item = {
    id: 'nasa:' + id,
    title: String(d.title || 'Untitled'),
    url: 'nasa://video/' + _enc(id),
    type: 'movie',
    cover: _thumb(it)
  };
  if (d.date_created) {
    var y = String(d.date_created).slice(0, 4);
    if (/^\d{4}$/.test(y)) item.year = y;
  }
  return item;
}

function _searchItems(query, pageSize) {
  var url = _NASA_API + '/search?q=' + _enc(query) + '&media_type=video&page_size=' + (pageSize || 24);
  return _getJson(url).then(function (j) {
    var items = (((j || {}).collection) || {}).items || [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = _toItem(items[i]);
      if (it) out.push(it);
    }
    return out;
  });
}

function _idFromUrl(url) {
  var m = /^nasa:\/\/video\/(.+)$/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

function getHome(opts) {
  var rows = [
    { q: 'mars', title: 'Mars Missions' },
    { q: 'apollo moon landing', title: 'Apollo & the Moon' },
    { q: 'international space station', title: 'Space Station' },
    { q: 'artemis', title: 'Artemis' }
  ];
  var jobs = rows.map(function (r) {
    return _searchItems(r.q, 12).then(function (items) {
      return { title: r.title, items: items };
    });
  });
  return Promise.all(jobs).then(function (all) {
    return all.filter(function (r) { return r.items.length > 0; });
  });
}

function search(query, page, opts) {
  return _searchItems(query, 24);
}

function getDetail(url, opts) {
  var id = _idFromUrl(url);
  if (!id) return Promise.reject(new Error('NASA: bad url ' + url));
  return _getJson(_NASA_API + '/search?nasa_id=' + _enc(id) + '&media_type=video').then(function (j) {
    var items = (((j || {}).collection) || {}).items || [];
    var d = ((items[0] || {}).data || [])[0] || {};
    var it = items[0] ? _toItem(items[0]) : null;
    return {
      id: 'nasa:' + id,
      title: String(d.title || (it && it.title) || 'Untitled'),
      url: url,
      type: 'movie',
      cover: it && it.cover,
      description: d.description ? String(d.description).slice(0, 2000) : null,
      episodes: [{ id: 'nasa:play:' + id, title: 'Watch', url: 'nasa://play/' + _enc(id), number: 1 }]
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// Tier order: smallest first, best last (the app plays the last link).
var _TIERS = [
  { suffix: '~mobile.mp4', quality: '360p', label: '360p' },
  { suffix: '~small.mp4', quality: '480p', label: '480p' },
  { suffix: '~medium.mp4', quality: '720p', label: '720p' },
  { suffix: '~large.mp4', quality: '1080p', label: '1080p' },
  { suffix: '~orig.mp4', quality: '4K', label: 'Original' }
];

function getVideoSources(episodeUrl) {
  var m = /^nasa:\/\/play\/(.+)$/.exec(String(episodeUrl || ''));
  var id = m ? decodeURIComponent(m[1]) : _idFromUrl(episodeUrl);
  if (!id) return Promise.reject(new Error('NASA: bad episode url ' + episodeUrl));
  return _getJson(_NASA_API + '/asset/' + _enc(id)).then(function (j) {
    var files = (((j || {}).collection) || {}).items || [];
    var bySuffix = {};
    var srt = null;
    for (var i = 0; i < files.length; i++) {
      var href = String((files[i] || {}).href || '');
      if (!href) continue;
      if (/\.srt$/i.test(href)) { srt = href; continue; }
      if (!/\.mp4$/i.test(href)) continue;
      for (var t = 0; t < _TIERS.length; t++) {
        if (href.indexOf(_TIERS[t].suffix) !== -1) bySuffix[_TIERS[t].suffix] = href;
      }
    }
    var out = [];
    for (var k = 0; k < _TIERS.length; k++) {
      var u = bySuffix[_TIERS[k].suffix];
      if (!u) continue;
      // The API sometimes returns http:// asset URLs; https works and is required.
      if (u.indexOf('http://') === 0) u = 'https://' + u.slice(7);
      var src = {
        url: u, quality: _TIERS[k].quality, label: _TIERS[k].label,
        container: 'mp4', kind: 'sub',
        headers: { 'User-Agent': _NASA_UA, 'Referer': 'https://images.nasa.gov/' }
      };
      if (srt) src.subtitles = [{ url: srt, lang: 'en', label: 'English' }];
      out.push(src);
    }
    if (!out.length) throw new Error('NASA: no mp4 assets for ' + id);
    return out;
  });
}
