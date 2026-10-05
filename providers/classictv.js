/* Classic TV Vault — public-domain classic TV serials from archive.org.
 * Dragnet, The Lone Ranger, Sherlock Holmes, Bonanza and other vintage series.
 * Search + metadata via archive.org JSON APIs, direct MP4 streams, no login.
 * type: movie, lang: en, version 1.0.0 */
'use strict';

var _SITE = 'https://archive.org';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var _COLLS = 'classic_tv_1950s OR classic_tv_1960s OR classic_tv_1970s OR classic_tv_1980s OR classic_tv_1990s';

function getInfo() {
  return {
    name: 'Classic TV Vault',
    lang: 'en',
    baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

function _getJson(url) {
  return fetch(url, { headers: { 'User-Agent': _UA, 'Accept': 'application/json' } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

/* url forms: 'ctv:///series/<id>' or 'ctv:///ep/<id>/<enc-file-path>' */
function _parseUrl(url) {
  var m = /^ctv:\/\/\/(series|ep)\/([^\/]+)(?:\/(.+))?$/.exec(url || '');
  if (!m) return null;
  var out = { kind: m[1], id: m[2] };
  if (m[3]) out.file = decodeURIComponent(m[3]);
  return out;
}

function _cover(identifier) {
  return _SITE + '/services/img/' + identifier;
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
    id: 'ctv://' + identifier,
    title: doc.title || identifier,
    url: 'ctv:///series/' + identifier,
    type: 'movie',
    cover: _cover(identifier),
    year: _yearStr(doc.year)
  };
}

function _searchApi(query, start, rows) {
  var q = 'title:(' + query + ') AND collection:(' + _COLLS + ') AND mediatype:movies';
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
  var q = 'collection:(' + _COLLS + ') AND mediatype:movies';
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
    _homeRow('Most Downloaded', 'downloads desc', 20),
    _homeRow('Recently Added', 'addeddate desc', 20)
  ]);
}

function _metadata(identifier) {
  return _getJson(_SITE + '/metadata/' + encodeURIComponent(identifier));
}

/* Each mp4 file inside the item is one episode (vintage series are uploaded
 * as a folder of episode files). Skip tiny files (previews/extras). */
function _episodeFiles(files) {
  var mp4s = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    var name = f.name || '';
    if (/\.mp4$/i.test(name)) mp4s.push({ name: name, size: parseInt(f.size || '0', 10) || 0 });
  }
  var big = mp4s.filter(function (f) { return f.size >= 20 * 1024 * 1024; });
  var pool = big.length ? big : mp4s;
  pool.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return pool;
}

function _epTitle(name) {
  var base = name.split('/').pop().replace(/\.mp4$/i, '').replace(/[_]+/g, ' ').trim();
  // 'Dragnet (1951) - S01E01 - The Human Bomb' -> 'S01E01 - The Human Bomb'
  var m = /S\d+E\d+\s*[-–:]\s*(.+)$/i.exec(base);
  return m ? m[0].replace(/^S\d+E/i, 'E') : base;
}

function _epNumber(name, idx) {
  var m = /S\d+E(\d+)/i.exec(name);
  return m ? parseInt(m[1], 10) : idx + 1;
}

function _epUrl(id, name) {
  return 'ctv:///ep/' + id + '/' + encodeURIComponent(name);
}

function _episodesFrom(d, identifier) {
  var pool = _episodeFiles((d || {}).files || []);
  var eps = [];
  for (var i = 0; i < pool.length; i++) {
    var eu = _epUrl(identifier, pool[i].name);
    eps.push({
      id: eu,
      title: _epTitle(pool[i].name),
      url: eu,
      number: _epNumber(pool[i].name, i)
    });
  }
  return eps;
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  return _metadata(p.id).then(function (d) {
    var meta = (d || {}).metadata || {};
    var title = meta.title || p.id;
    var eps = _episodesFrom(d, p.id);
    if (!eps.length) throw new Error('no playable episodes for ' + p.id);
    return {
      id: 'ctv://' + p.id,
      title: title,
      url: 'ctv:///series/' + p.id,
      type: 'movie',
      year: _yearStr(meta.year),
      cover: _cover(p.id),
      description: _descStr(meta.description),
      episodes: eps
    };
  });
}

function getEpisodes(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  return _metadata(p.id).then(function (d) {
    var eps = _episodesFrom(d, p.id);
    if (!eps.length) throw new Error('no playable episodes for ' + p.id);
    return eps;
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

function _encPath(name) {
  return name.split('/').map(function (seg) { return encodeURIComponent(seg); }).join('/');
}

/* archive.org/download/<id>/<file> answers 302 -> a dn*.archive.org node.
 * Resolve it here with a 2-byte ranged request and hand the player the
 * direct CDN URL. Falls back to the plain download URL if the resolve fails. */
function _resolveDirect(dlUrl) {
  return fetch(dlUrl, {
    headers: { 'User-Agent': _UA, 'Range': 'bytes=0-1' }
  }).then(function (r) {
    return (r && r.url) ? r.url : dlUrl;
  }, function () { return dlUrl; });
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p || p.kind !== 'ep' || !p.file) return Promise.reject(new Error('bad url: ' + episodeUrl));
  var q = _guessQuality(p.file);
  var dlUrl = _SITE + '/download/' + p.id + '/' + _encPath(p.file);
  return _resolveDirect(dlUrl).then(function (directUrl) {
    var src = { url: directUrl, container: 'mp4', label: 'Archive.org' };
    if (q) src.quality = q;
    return [src];
  });
}
