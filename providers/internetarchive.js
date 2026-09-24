/* Internet Archive (archive.org) — public-domain / classic feature films.
 * Search + metadata via archive.org JSON APIs, direct MP4 streams.
 * type: movie, lang: en, version 1.0.3 */
'use strict';

var _VMARK = ''; // diagnostic marker retired
var _SITE = 'https://archive.org';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'Internet Archive',
    lang: 'en',
    baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
    type: 'movie',
    version: '1.0.3'
  };
}

function _getJson(url) {
  return fetch(url, { headers: { 'User-Agent': _UA, 'Accept': 'application/json' } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function _idOf(url) {
  // url forms: 'ia://movie/<identifier>' or 'ia://watch/<identifier>'
  var m = /^ia:\/\/(?:movie|watch)\/(.+)$/.exec(url || '');
  return m ? m[1] : null;
}

function _cover(identifier) {
  return _SITE + '/download/' + identifier + '/__ia_thumb.jpg';
}

function _yearStr(v) {
  if (v == null) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') { var t = v.trim(); return t ? t : null; }
  return null;
}

function _descStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Array) return v.join('\n\n');
  return String(v);
}

function _docToItem(doc) {
  var identifier = doc.identifier;
  if (!identifier) return null;
  return {
    id: 'ia://' + identifier,
    title: _VMARK + (doc.title || identifier),
    url: 'ia://movie/' + identifier,
    type: 'movie',
    cover: _cover(identifier),
    year: _yearStr(doc.year)
  };
}

function _searchApi(query, start, rows) {
  // Title-scoped search inside the curated feature_films collection.
  var q = 'title:(' + query + ') AND collection:feature_films';
  var url = _SITE + '/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl[]=identifier&fl[]=title&fl[]=year' +
    '&rows=' + rows + '&start=' + start + '&output=json';
  return _getJson(url).then(function (d) {
    var docs = (((d || {}).response || {}).docs) || [];
    var items = [];
    for (var i = 0; i < docs.length; i++) {
      var it = _docToItem(docs[i]);
      if (it) items.push(it);
    }
    return items;
  });
}

function search(query, page, opts) {
  var p = page && page > 0 ? page : 1;
  var rows = 20;
  return _searchApi(query, (p - 1) * rows, rows);
}

function _homeRow(title, sort, rows) {
  var q = 'collection:feature_films AND mediatype:movies';
  var url = _SITE + '/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl[]=identifier&fl[]=title&fl[]=year' +
    '&rows=' + rows + '&sort[]=' + encodeURIComponent(sort) + '&output=json';
  return _getJson(url).then(function (d) {
    var docs = (((d || {}).response || {}).docs) || [];
    var items = [];
    for (var i = 0; i < docs.length; i++) {
      var it = _docToItem(docs[i]);
      if (it) items.push(it);
    }
    return { title: title, items: items };
  });
}

function getHome(opts) {
  return Promise.all([
    _homeRow('Trending Classics', 'downloads desc', 20),
    _homeRow('Recently Added', 'addeddate desc', 20)
  ]);
}

function _metadata(identifier) {
  return _getJson(_SITE + '/metadata/' + encodeURIComponent(identifier));
}

function getDetail(url, opts) {
  var identifier = _idOf(url);
  if (!identifier) return Promise.reject(new Error('bad url: ' + url));
  return _metadata(identifier).then(function (d) {
    var meta = (d || {}).metadata || {};
    var title = meta.title || identifier;
    var epUrl = 'ia://watch/' + identifier;
    return {
      id: 'ia://' + identifier,
      title: title,
      url: 'ia://movie/' + identifier,
      type: 'movie',
      year: _yearStr(meta.year),
      cover: _cover(identifier),
      description: _descStr(meta.description),
      episodes: [{ id: epUrl, title: title, url: epUrl, number: 1 }]
    };
  });
}

function getEpisodes(url, opts) {
  var identifier = _idOf(url);
  if (!identifier) return Promise.reject(new Error('bad url: ' + url));
  return _metadata(identifier).then(function (d) {
    var meta = (d || {}).metadata || {};
    return [{
      id: 'ia://watch/' + identifier,
      title: meta.title || identifier,
      url: 'ia://watch/' + identifier,
      number: 1
    }];
  });
}

function _guessQuality(name) {
  var n = (name || '').toLowerCase();
  if (/2160|4k|uhd/.test(n)) return '2160p';
  if (/1080/.test(n)) return '1080p';
  if (/720/.test(n)) return '720p';
  if (/480/.test(n)) return '480p';
  if (/360/.test(n)) return '360p';
  return undefined;
}

/* archive.org/download/<id>/<file> answers 302 -> a dn*.archive.org node.
 * The app player does not follow that redirect, so resolve it here with a
 * 2-byte ranged request (the bridge follows redirects and reports the final
 * URL) and hand the player the direct CDN URL. Falls back to the plain
 * download URL if the resolve fails. */
function _resolveDirect(dlUrl) {
  return fetch(dlUrl, {
    headers: { 'User-Agent': _UA, 'Range': 'bytes=0-1' }
  }).then(function (r) {
    return (r && r.url) ? r.url : dlUrl;
  }, function () { return dlUrl; });
}

function getVideoSources(episodeUrl) {
  var identifier = _idOf(episodeUrl);
  if (!identifier) return Promise.reject(new Error('bad url: ' + episodeUrl));
  return _metadata(identifier).then(function (d) {
    var files = (d || {}).files || [];
    var mp4s = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = f.name || '';
      if (/\.mp4$/i.test(name)) mp4s.push({ name: name, size: parseInt(f.size || '0', 10) || 0 });
    }
    if (!mp4s.length) throw new Error('no mp4 files for ' + identifier);
    // Prefer substantial files (skip tiny previews/samples), largest first.
    var big = mp4s.filter(function (f) { return f.size >= 50 * 1024 * 1024; });
    var pool = big.length ? big : mp4s;
    pool.sort(function (a, b) { return b.size - a.size; });
    var jobs = [];
    for (var j = 0; j < Math.min(pool.length, 3); j++) {
      (function (fname) {
        var q = _guessQuality(fname);
        var dlUrl = _SITE + '/download/' + identifier + '/' + encodeURIComponent(fname).replace(/%2F/g, '/');
        jobs.push(_resolveDirect(dlUrl).then(function (directUrl) {
          var src = { url: directUrl, container: 'mp4', label: 'Archive.org' };
          if (q) src.quality = q;
          return src;
        }));
      })(pool[j].name);
    }
    return Promise.all(jobs);
  });
}
