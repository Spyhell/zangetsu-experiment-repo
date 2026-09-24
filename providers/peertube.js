/* PeerTube (via search.joinpeertube.org) — federated video network.
 * Search across instances, direct MP4/HLS streams from the hosting instance.
 * type: movie, lang: en, version 1.0.2
 * Note: catalog is user-uploaded and multilingual; instances vary in speed. */
'use strict';

var _VMARK = '[v102] '; // TEMP diagnostic: proves which JS build is running on-device

var _SEARCH = 'https://search.joinpeertube.org/api/v1/search/videos';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return {
    name: 'PeerTube Films',
    lang: 'en',
    baseUrl: 'https://search.joinpeertube.org',
    logo: 'https://search.joinpeertube.org/favicon.ico',
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

/* url forms:
 *   'pt://<host>/<uuid>'                     (legacy detail; needs instance API)
 *   'pt://<host>/<uuid>?t=..&y=..&p=..&d=..' (self-contained; no network needed)
 *   'pt://w/<host>/<uuid>'                   (episode)
 * Detail/episodes are resolved locally from the embedded metadata whenever
 * present, so the detail screen works even when the hosting instance is
 * unreachable from the device. */
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

function _parse(url) {
  var m = /^pt:\/\/(w\/)?([^\/\?]+)\/([0-9a-f-]{36})(?:\?(.*))?$/i.exec(url || '');
  if (!m) return null;
  return { host: m[2], uuid: m[3], meta: _parseQuery(m[4] || '') };
}

function _year(v) {
  var d = v.publishedAt || v.createdAt || '';
  var m = /^(\d{4})/.exec(d);
  return m ? m[1] : null;
}

function _cover(v, host) {
  var p = v.thumbnailPath || v.previewPath;
  if (p) return 'https://' + host + p;
  return '';
}

function _itemUrl(host, uuid, v) {
  var q = '?t=' + encodeURIComponent(v.name || uuid) +
    '&y=' + encodeURIComponent(_year(v) || '') +
    '&p=' + encodeURIComponent(_cover(v, host) || '') +
    '&d=' + encodeURIComponent(((v.description || v.truncatedDescription) || '').slice(0, 300));
  return 'pt://' + host + '/' + uuid + q;
}

function _docToItem(v) {
  if (!v || !v.uuid || !v.account || !v.account.host) return null;
  var host = v.account.host;
  var dur = v.duration || 0;
  if (dur < 600) return null; // skip clips/trailers
  return {
    id: 'pt://' + host + '/' + v.uuid,
    title: _VMARK + (v.name || v.uuid),
    url: _itemUrl(host, v.uuid, v),
    type: 'movie',
    cover: _cover(v, host) || undefined,
    year: _year(v)
  };
}

function _searchApi(params, count, start) {
  var url = _SEARCH + '?' + params + '&nsfw=false&count=' + count + '&start=' + start;
  return _getJson(url).then(function (d) {
    var arr = (d && d.data) || [];
    var items = [];
    for (var i = 0; i < arr.length; i++) {
      var it = _docToItem(arr[i]);
      if (it) items.push(it);
    }
    return items;
  });
}

function search(query, page, opts) {
  var p = page && page > 0 ? page : 1;
  var count = 20;
  return _searchApi('search=' + encodeURIComponent(query), count, (p - 1) * count);
}

function _homeRow(title, params) {
  return _searchApi(params, 20, 0).then(function (items) {
    return { title: title, items: items };
  });
}

function getHome(opts) {
  return Promise.all([
    _homeRow('Trending Films', 'search=film&sort=-trending'),
    _homeRow('New Uploads', 'search=movie&sort=-publishedAt')
  ]);
}

function _videoApi(host, uuid) {
  return _getJson('https://' + host + '/api/v1/videos/' + uuid);
}

function _localDetail(p, url) {
  var meta = p.meta || {};
  return {
    id: 'pt://' + p.host + '/' + p.uuid,
    title: meta.t || p.uuid,
    url: url,
    type: 'movie',
    year: meta.y || null,
    cover: meta.p || undefined,
    description: meta.d || ''
  };
}

function getDetail(url, opts) {
  var p = _parse(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  // Self-contained URL from search: no network needed.
  if (p.meta && p.meta.t) return Promise.resolve(_localDetail(p, url));
  // Legacy URL: fall back to the instance API.
  return _videoApi(p.host, p.uuid).then(function (v) {
    return {
      id: 'pt://' + p.host + '/' + p.uuid,
      title: v.name || p.uuid,
      url: url,
      type: 'movie',
      year: _year(v),
      cover: v.thumbnailUrl || _cover(v, p.host) || undefined,
      description: (v.description || '').slice(0, 400)
    };
  }, function () {
    // Instance unreachable — still show the screen with what the URL has.
    return _localDetail(p, url);
  });
}

function getEpisodes(url, opts) {
  var p = _parse(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  var title = (p.meta && p.meta.t) || null;
  if (title) {
    return Promise.resolve([{
      id: 'pt://w/' + p.host + '/' + p.uuid,
      title: title,
      url: 'pt://w/' + p.host + '/' + p.uuid,
      number: 1
    }]);
  }
  return _videoApi(p.host, p.uuid).then(function (v) {
    return [{
      id: 'pt://w/' + p.host + '/' + p.uuid,
      title: v.name || p.uuid,
      url: 'pt://w/' + p.host + '/' + p.uuid,
      number: 1
    }];
  });
}

function _resolveUrl(rel, base) {
  if (/^https?:\/\//i.test(rel)) return rel;
  var b = base.split('?')[0];
  return b.slice(0, b.lastIndexOf('/') + 1) + rel;
}

function _getText(url) {
  return fetch(url, { headers: { 'User-Agent': _UA } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function _qualityLabel(width) {
  if (width >= 1080) return '1080p';
  if (width >= 720) return '720p';
  if (width >= 480) return '480p';
  return '360p';
}

function _pickRendition(masterText, masterUrl) {
  var lines = masterText.split('\n');
  var best = null;
  for (var i = 0; i < lines.length; i++) {
    var rm = /^#EXT-X-STREAM-INF:.*RESOLUTION=(\d+)x(\d+)/i.exec(lines[i].trim());
    if (rm) {
      var j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length) {
        var w = parseInt(rm[1], 10);
        if (!best || w > best.width) best = { width: w, uri: lines[j].trim() };
      }
    }
  }
  return best;
}

function getVideoSources(episodeUrl) {
  var p = _parse(episodeUrl);
  if (!p) return Promise.reject(new Error('bad url: ' + episodeUrl));
  return _videoApi(p.host, p.uuid).then(function (v) {
    var files = v.files || [];
    var best = null;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var resId = (f.resolution && f.resolution.id) || 0;
      if (f.fileUrl && (!best || resId > best.resId)) {
        best = { url: f.fileUrl, resId: resId, label: (f.resolution && f.resolution.label) || '' };
      }
    }
    if (best) {
      var q = /1080/.test(best.label) ? '1080p' : /720/.test(best.label) ? '720p' :
              /480/.test(best.label) ? '480p' : /360/.test(best.label) ? '360p' : undefined;
      var src = { url: best.url, container: 'mp4', label: 'PeerTube' };
      if (q) src.quality = q;
      return [src];
    }
    var pls = v.streamingPlaylists || [];
    var master = null;
    for (var j = 0; j < pls.length; j++) {
      if (pls[j].playlistUrl) { master = pls[j].playlistUrl; break; }
    }
    if (!master) throw new Error('no playable files for ' + p.uuid);
    // Drill into the master playlist: pick the highest rendition so the
    // source is a concrete media playlist with a known quality.
    return _getText(master).then(function (text) {
      var rend = _pickRendition(text, master);
      if (!rend) return [{ url: master, container: 'hls', label: 'PeerTube' }];
      return [{
        url: _resolveUrl(rend.uri, master),
        container: 'hls',
        quality: _qualityLabel(rend.width),
        label: 'PeerTube'
      }];
    }, function () {
      return [{ url: master, container: 'hls', label: 'PeerTube' }];
    });
  });
}
