/* Wikimedia Commons — public-domain feature films hosted on upload.wikimedia.org.
 * MediaWiki API search + imageinfo, direct WebM/MP4 streams, duration-filtered.
 * type: movie, lang: en, version 1.0.2 */
'use strict';

var _VMARK = '[v102] '; // TEMP diagnostic: proves which JS build is running on-device

var _API = 'https://commons.wikimedia.org/w/api.php';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var _MIN_SECONDS = 1800; // 30 min — keeps feature films, drops trailers/clips

function getInfo() {
  return {
    name: 'Wikimedia Films',
    lang: 'en',
    baseUrl: 'https://commons.wikimedia.org',
    logo: 'https://commons.wikimedia.org/favicon.ico',
    type: 'movie',
    version: '1.0.2'
  };
}

function _getJson(url) {
  return fetch(url, { headers: { 'User-Agent': _UA, 'Accept': 'application/json' } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function _api(params) {
  return _getJson(_API + '?action=query&format=json&formatversion=2&' + params);
}

/* url forms: 'wc://<encoded File: title>' or 'wc://w/<encoded File: title>' */
function _titleOf(url) {
  var m = /^wc:\/\/(?:w\/)?(.+)$/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function _cleanTitle(fileTitle) {
  var t = fileTitle.replace(/^File:/i, '');
  t = t.replace(/\.(webm|mp4|ogv|ogg)$/i, '');
  return t;
}

function _yearOf(t) {
  var m = /\b((?:19|20)\d{2})\b/.exec(t);
  return m ? m[1] : null;
}

function _durationSec(ii) {
  var md = (ii && ii.metadata) || [];
  for (var i = 0; i < md.length; i++) {
    if (md[i].name === 'playtime_seconds') {
      var v = parseFloat(md[i].value);
      return isNaN(v) ? 0 : v;
    }
  }
  return 0;
}

function _descOf(ii) {
  try {
    var raw = ii.extmetadata && ii.extmetadata.ImageDescription && ii.extmetadata.ImageDescription.value;
    if (raw) return htmlText(String(raw)).slice(0, 400);
  } catch (e) {}
  return '';
}

/* iiurlwidth=640 makes imageinfo return thumburl (a ready 640px thumbnail)
 * which we use as the poster. Without it there is no cover at all. */
var _II_PROPS = 'url|size|metadata|extmetadata';

function _itemFromPage(pg) {
  if (!pg || pg.missing) return null;
  var ii = (pg.imageinfo && pg.imageinfo[0]) || null;
  if (!ii || !ii.url) return null;
  if (_durationSec(ii) < _MIN_SECONDS) return null;
  var title = _cleanTitle(pg.title || '');
  var item = {
    id: 'wc://' + encodeURIComponent(pg.title),
    title: _VMARK + title,
    url: 'wc://' + encodeURIComponent(pg.title),
    type: 'movie',
    year: _yearOf(title)
  };
  if (ii.thumburl) item.cover = ii.thumburl;
  return item;
}

/* Search File: namespace, then batch-resolve durations and filter. */
function _searchFiles(query, limit, offset) {
  var q = _API + '?action=query&format=json&formatversion=2&list=search' +
    '&srsearch=' + encodeURIComponent(query + ' filetype:video') +
    '&srnamespace=6&srlimit=' + limit + '&sroffset=' + offset;
  return _getJson(q).then(function (d) {
    var hits = ((d && d.query && d.query.search) || []);
    if (!hits.length) return [];
    var titles = hits.map(function (h) { return h.title; }).join('|');
    return _api('prop=imageinfo&iiprop=' + _II_PROPS + '&iiurlwidth=640&titles=' + encodeURIComponent(titles))
      .then(function (d2) {
        var pages = ((d2 && d2.query && d2.query.pages) || []);
        var items = [];
        for (var i = 0; i < pages.length; i++) {
          var it = _itemFromPage(pages[i]);
          if (it) items.push(it);
        }
        return items;
      });
  });
}

function search(query, page, opts) {
  var p = page && page > 0 ? page : 1;
  return _searchFiles(query, 20, (p - 1) * 20);
}

function _homeRow(title, query) {
  return _searchFiles(query, 12, 0).then(function (items) {
    return { title: title, items: items };
  });
}

function getHome(opts) {
  return Promise.all([
    _homeRow('Classic Films', 'classic feature film'),
    _homeRow('Silent Era', 'silent film')
  ]);
}

/* Minimal detail derived from the File: title in the URL — used when the
 * API detail fetch fails, so the screen always has something to show. */
function _detailFromTitle(title) {
  var name = _cleanTitle(title);
  return {
    id: 'wc://' + encodeURIComponent(title),
    title: name,
    url: 'wc://' + encodeURIComponent(title),
    type: 'movie',
    year: _yearOf(name),
    description: ''
  };
}

function getDetail(url, opts) {
  var title = _titleOf(url);
  if (!title) return Promise.reject(new Error('bad url: ' + url));
  return _api('prop=imageinfo&iiprop=' + _II_PROPS + '&iiurlwidth=640&titles=' + encodeURIComponent(title))
    .then(function (d) {
      var pages = ((d && d.query && d.query.pages) || []);
      if (!pages.length || pages[0].missing) throw new Error('not found: ' + title);
      var pg = pages[0];
      var ii = (pg.imageinfo && pg.imageinfo[0]) || {};
      var name = _cleanTitle(pg.title || '');
      var detail = {
        id: 'wc://' + encodeURIComponent(title),
        title: name,
        url: url,
        type: 'movie',
        year: _yearOf(name),
        description: _descOf(ii)
      };
      if (ii.thumburl) detail.cover = ii.thumburl;
      return detail;
    }, function () {
      // API unreachable from this device — still show the title screen.
      var fb = _detailFromTitle(title);
      fb.url = url;
      return fb;
    });
}

function getEpisodes(url, opts) {
  var title = _titleOf(url);
  if (!title) return Promise.reject(new Error('bad url: ' + url));
  return Promise.resolve([{
    id: 'wc://w/' + encodeURIComponent(title),
    title: _cleanTitle(title),
    url: 'wc://w/' + encodeURIComponent(title),
    number: 1
  }]);
}

function getVideoSources(episodeUrl) {
  var title = _titleOf(episodeUrl);
  if (!title) return Promise.reject(new Error('bad url: ' + episodeUrl));
  return _api('prop=imageinfo&iiprop=url|size|metadata&titles=' + encodeURIComponent(title))
    .then(function (d) {
      var pages = ((d && d.query && d.query.pages) || []);
      if (!pages.length || pages[0].missing) throw new Error('not found: ' + title);
      var ii = (pages[0].imageinfo && pages[0].imageinfo[0]) || {};
      if (!ii.url) throw new Error('no file url for ' + title);
      var src = { url: ii.url, label: 'Wikimedia Commons' };
      if (/\.mp4(\?|$)/i.test(ii.url)) src.container = 'mp4';
      return [src];
    });
}
