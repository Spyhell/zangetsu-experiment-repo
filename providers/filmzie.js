/* Filmzie (filmzie.com) — free, legal ad-supported movie catalog.
 * Public JSON API, direct ad-free HLS streams (up to 1080p observed).
 * type: movie, lang: en, version 1.0.2 */
'use strict';

var _VMARK = '[v102] '; // TEMP diagnostic: proves which JS build is running on-device

var _SITE = 'https://filmzie.com';
var _API = _SITE + '/api/v1';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'Filmzie',
    lang: 'en',
    baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
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

function _getText(url) {
  return fetch(url, { headers: { 'User-Agent': _UA } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

/* Posters live on Filmzie's CloudFront distribution. NOTE: the
 * img.filmzie.com/cdn/<key> form 303s into a broken cloudimg.io URL
 * (HTTP 400), so it must not be used. Verified 200 on 2026-09-24. */
var _IMG_CDN = 'https://d3qxhvuywdalwo.cloudfront.net';

function _poster(item) {
  try {
    var key = item.images && item.images.poster && item.images.poster.amazonKey;
    if (key) return _IMG_CDN + '/' + key;
  } catch (e) {}
  return '';
}

function _year(item) {
  var rel = item.released || '';
  var m = /^(\d{4})/.exec(rel);
  return m ? m[1] : null;
}

function _desc(item) {
  var d = item.description;
  if (d == null) return '';
  d = String(d);
  return d.length > 400 ? d.slice(0, 400) : d;
}

/* Item URLs are self-contained: fz://m/<contentId>/<videoId>?t=..&y=..&p=..&d=..
 * (the API has no exact-match detail endpoint, so metadata rides along). */
function _itemUrl(item) {
  return 'fz://m/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(item.mainVideoId) +
    '?t=' + encodeURIComponent(item.title || '') +
    '&y=' + encodeURIComponent(_year(item) || '') +
    '&p=' + encodeURIComponent(_poster(item)) +
    '&d=' + encodeURIComponent(_desc(item));
}

function _parseQuery(qs) {
  var out = {};
  var parts = (qs || '').split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  }
  return out;
}

function _metaFromUrl(url) {
  var m = /^fz:\/\/m\/([^\/\?]+)\/([^\?]+)(?:\?(.*))?$/.exec(url || '');
  if (!m) return null;
  var q = _parseQuery(m[3] || '');
  return {
    contentId: decodeURIComponent(m[1]),
    videoId: decodeURIComponent(m[2]),
    title: q.t || '',
    year: q.y || null,
    poster: q.p || '',
    description: q.d || ''
  };
}

function _docToItem(doc) {
  if (!doc || doc.type !== 'MOVIE' || !doc.mainVideoId || !doc.id) return null;
  return {
    id: 'fz://' + doc.id,
    title: _VMARK + (doc.title || 'Untitled'),
    url: _itemUrl(doc),
    type: 'movie',
    cover: _poster(doc) || undefined,
    year: _year(doc)
  };
}

function _list(params, rows) {
  return _getJson(_API + '/content?' + params + '&limit=' + rows + '&offset=0').then(function (d) {
    var docs = (d && d.data && d.data.data) || [];
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
  var off = (p - 1) * rows;
  return _getJson(_API + '/content?keyword=' + encodeURIComponent(query) + '&limit=' + rows + '&offset=' + off)
    .then(function (d) {
      var docs = (d && d.data && d.data.data) || [];
      var items = [];
      for (var i = 0; i < docs.length; i++) {
        var it = _docToItem(docs[i]);
        if (it) items.push(it);
      }
      return items;
    });
}

function _homeRow(title, category) {
  return _list('category=' + encodeURIComponent(category), 20).then(function (items) {
    return { title: title, items: items };
  });
}

function getHome(opts) {
  return Promise.all([
    _homeRow('Action Movies', 'action'),
    _homeRow('Comedy Movies', 'comedy'),
    _homeRow('Drama Movies', 'drama')
  ]);
}

function getDetail(url, opts) {
  var meta = _metaFromUrl(url);
  if (!meta) return Promise.reject(new Error('bad url: ' + url));
  return Promise.resolve({
    id: 'fz://' + meta.contentId,
    title: meta.title || meta.contentId,
    url: url,
    type: 'movie',
    year: meta.year || null,
    cover: meta.poster || undefined,
    description: meta.description || ''
  });
}

function getEpisodes(url, opts) {
  var meta = _metaFromUrl(url);
  if (!meta) return Promise.reject(new Error('bad url: ' + url));
  return Promise.resolve([{
    id: 'fz://w/' + meta.videoId,
    title: meta.title || 'Full Movie',
    url: 'fz://w/' + meta.videoId,
    number: 1
  }]);
}

function _resolveUrl(rel, base) {
  if (/^https?:\/\//i.test(rel)) return rel;
  var b = base.split('?')[0];
  var idx = b.lastIndexOf('/');
  return b.slice(0, idx + 1) + rel;
}

function _parseMaster(text, masterUrl) {
  var lines = text.split('\n');
  var best = null; // {width, uri, quality}
  var audioLang = null;
  var subs = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var am = /^#EXT-X-MEDIA:TYPE=AUDIO[^,]*,.*LANGUAGE="([^"]+)"/i.exec(line);
    if (am && !audioLang) audioLang = am[1].toLowerCase();
    var sm = /^#EXT-X-MEDIA:TYPE=SUBTITLES(.*)$/i.exec(line);
    if (sm) {
      var langM = /LANGUAGE="([^"]+)"/i.exec(sm[1]);
      var uriM = /URI="([^"]+)"/i.exec(sm[1]);
      if (langM && uriM) subs.push({ lang: langM[1], uri: _resolveUrl(uriM[1], masterUrl) });
    }
    var rm = /^#EXT-X-STREAM-INF:.*RESOLUTION=(\d+)x(\d+)/i.exec(line);
    if (rm) {
      var j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length) {
        var w = parseInt(rm[1], 10);
        if (!best || w > best.width) {
          best = { width: w, uri: lines[j].trim() };
        }
      }
    }
  }
  return { best: best, audioLang: audioLang, subs: subs };
}

function _qualityLabel(width) {
  if (width >= 1080) return '1080p';
  if (width >= 720) return '720p';
  if (width >= 480) return '480p';
  return '360p';
}

function getVideoSources(episodeUrl) {
  var m = /^fz:\/\/w\/(.+)$/.exec(episodeUrl || '');
  if (!m) return Promise.reject(new Error('bad episode url: ' + episodeUrl));
  var videoId = m[1];
  return _getJson(_API + '/video/stream/' + encodeURIComponent(videoId)).then(function (d) {
    var src = d && d.data && d.data.source;
    var master = src && src.hlsV2;
    if (!master) throw new Error('no stream for video ' + videoId);
    return _getText(master).then(function (text) {
      var parsed = _parseMaster(text, master);
      if (!parsed.best) throw new Error('no renditions in master playlist');
      var streamUrl = _resolveUrl(parsed.best.uri, master);
      var label = 'Filmzie';
      if (parsed.audioLang && parsed.audioLang !== 'en' && parsed.audioLang !== 'eng') {
        label += ' · ' + parsed.audioLang;
      }
      var out = {
        url: streamUrl,
        container: 'hls',
        quality: _qualityLabel(parsed.best.width),
        label: label
      };
      if (parsed.subs.length) {
        out.subtitles = parsed.subs.map(function (s) {
          return { url: s.uri, lang: s.lang, label: s.lang };
        });
      }
      return [out];
    });
  });
}
