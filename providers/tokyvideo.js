/* TokyVideo (tokyvideo.com) — video hosting site with full movies.
 * Search/detail pages are plain HTML; watch pages embed a direct MP4 <source>.
 * NOTE: catalog is overwhelmingly Spanish-language / Spanish-dubbed.
 * type: movie, lang: es, version 1.0.3 */
'use strict';

var _VMARK = ''; // diagnostic marker retired
var _SITE = 'https://www.tokyvideo.com';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'TokyVideo',
    lang: 'es',
    baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
    type: 'movie',
    version: '1.0.3'
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

/* Item URLs are self-contained: 'tkv://<slug>?t=..&y=..&p=..' so detail and
 * episodes resolve locally with no network. The episode keeps the real
 * https page URL for getVideoSources (the MP4 token lives in that page). */
function _parseQuery(qs) {
  var out = {};
  var parts = (qs || '').split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    if (kv[0]) {
      try { out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); }
      catch (e) { out[kv[0]] = kv[1] || ''; }
    }
  }
  return out;
}

function _parseItemUrl(url) {
  var m = /^tkv:\/\/([^\?]+)(?:\?(.*))?$/.exec(url || '');
  if (!m) return null;
  return { slug: m[1], meta: _parseQuery(m[2] || '') };
}

function _itemUrl(slug, title, year, poster) {
  return 'tkv://' + slug +
    '?t=' + encodeURIComponent(title || '') +
    '&y=' + encodeURIComponent(year || '') +
    '&p=' + encodeURIComponent(poster || '');
}

function _pageUrl(slug) {
  return _SITE + '/video/' + slug;
}

/* <a href=".../video/<slug>" class="thumb-duracion"><img alt="<title>" ... data-src="<poster>" */
function _parseResults(html) {
  var items = [];
  var re = /<a href="([^"]*\/video\/[^"]+)" class="thumb-duracion">\s*<img alt="([^"]*)"[^>]*?data-src="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var pageUrl = m[1];
    if (pageUrl.indexOf('http') !== 0) pageUrl = _SITE + pageUrl;
    var slug = pageUrl.split('/video/')[1] || '';
    var title = _cleanTitle(m[2]);
    if (!title || !slug) continue;
    var year = _yearOf(title);
    var poster = m[3];
    if (poster.indexOf('http') !== 0) poster = _SITE + poster;
    items.push({
      id: 'tkv://' + slug,
      title: _VMARK + title,
      url: _itemUrl(slug, title, year, poster),
      type: 'movie',
      cover: poster,
      year: year
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
  var parsed = _parseItemUrl(url);
  // Self-contained URL from search/home: resolve locally, no network.
  if (parsed && (parsed.meta.t || parsed.slug)) {
    var meta = parsed.meta;
    var title = meta.t || _cleanTitle(parsed.slug);
    var detail = {
      id: 'tkv://' + parsed.slug,
      title: title,
      url: url,
      type: 'movie',
      year: meta.y || _yearOf(title)
    };
    if (meta.p) detail.cover = meta.p;
    var epUrl = _pageUrl(parsed.slug);
    detail.episodes = [{ id: 'tkv://w/' + parsed.slug, title: title, url: epUrl, number: 1 }];
    return Promise.resolve(detail);
  }
  // Legacy https page URL: fetch the page as before.
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
      cover: _og(html, 'image') || undefined,
      episodes: [{ id: 'tkv://w/' + url.split('/video/')[1], title: title, url: url, number: 1 }]
    };
  });
}

function getEpisodes(url, opts) {
  var parsed = _parseItemUrl(url);
  if (parsed && parsed.slug) {
    var meta = parsed.meta || {};
    var page = _pageUrl(parsed.slug);
    return Promise.resolve([{
      id: 'tkv://w/' + parsed.slug,
      title: meta.t || _cleanTitle(parsed.slug) || 'Full Movie',
      url: page,
      number: 1
    }]);
  }
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
