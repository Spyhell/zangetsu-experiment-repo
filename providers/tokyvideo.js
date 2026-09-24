/* TokyVideo (tokyvideo.com) — video hosting site with full movies.
 * Search/detail pages are plain HTML; watch pages embed a direct MP4 <source>.
 * NOTE: catalog is overwhelmingly Spanish-language / Spanish-dubbed.
 * type: movie, lang: es, version 1.0.0 */
'use strict';

var _SITE = 'https://www.tokyvideo.com';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'TokyVideo',
    lang: 'es',
    baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

function _getText(url) {
  return fetch(url, { headers: { 'User-Agent': _UA } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function _yearOf(t) {
  var m = /\b((?:19|20)\d{2})\b/.exec(t || '');
  return m ? m[1] : null;
}

function _cleanTitle(t) {
  return (t || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* <a href=".../video/<slug>" class="thumb-duracion"><img alt="<title>" ... data-src="<poster>" */
function _parseResults(html) {
  var items = [];
  var re = /<a href="([^"]*\/video\/[^"]+)" class="thumb-duracion">\s*<img alt="([^"]*)"[^>]*?data-src="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var pageUrl = m[1];
    if (pageUrl.indexOf('http') !== 0) pageUrl = _SITE + pageUrl;
    var title = _cleanTitle(m[2]);
    if (!title) continue;
    items.push({
      id: 'tkv://' + pageUrl.split('/video/')[1],
      title: title,
      url: pageUrl,
      type: 'movie',
      cover: m[3],
      year: _yearOf(title)
    });
  }
  return items;
}

function search(query, page, opts) {
  var p = page && page > 0 ? page : 1;
  // Site search has no page param in static HTML; page 1 only.
  if (p > 1) return Promise.resolve([]);
  return _getText(_SITE + '/search?q=' + encodeURIComponent(query)).then(_parseResults);
}

function getHome(opts) {
  return Promise.all([
    _getText(_SITE + '/search?order=popular&q=pelicula+completa').then(function (h) {
      return { title: 'Popular Movies', items: _parseResults(h) };
    }),
    _getText(_SITE + '/search?order=latest&q=pelicula+completa').then(function (h) {
      return { title: 'Latest Movies', items: _parseResults(h) };
    })
  ]);
}

function _og(html, prop) {
  var re = new RegExp('<meta property="og:' + prop + '" content="([^"]*)"', 'i');
  var m = re.exec(html);
  return m ? m[1] : '';
}

function getDetail(url, opts) {
  return _getText(url).then(function (html) {
    var title = _cleanTitle(_og(html, 'title'));
    if (!title) {
      var tm = /<title>([^<]*)<\/title>/i.exec(html);
      title = tm ? _cleanTitle(tm[1].replace(/\s*-\s*TokyVideo\s*$/i, '')) : url;
    }
    return {
      id: 'tkv://' + url.split('/video/')[1],
      title: title,
      url: url,
      type: 'movie',
      year: _yearOf(title),
      cover: _og(html, 'image') || undefined
    };
  });
}

function getEpisodes(url, opts) {
  return _getText(url).then(function (html) {
    var title = _cleanTitle(_og(html, 'title')) || url;
    return [{
      id: 'tkv://w/' + url.split('/video/')[1],
      title: title,
      url: url,
      number: 1
    }];
  });
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl).then(function (html) {
    var m = /<source[^>]+src="([^"]+\.mp4[^"]*)"/i.exec(html);
    if (!m) throw new Error('no mp4 source on ' + episodeUrl);
    return [{
      url: m[1].replace(/&amp;/g, '&'),
      container: 'mp4',
      label: 'TokyVideo'
    }];
  });
}
