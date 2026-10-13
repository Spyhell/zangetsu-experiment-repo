/*
 * AniLibria — Russian-dubbed anime via the public AniLibria v1 JSON API.
 *
 * VERIFIED chain (2026-10-13, plain HTTP, no login, no crypto, no browser):
 *   GET https://anilibria.top/api/v1/app/search/releases?query=<q>
 *   GET https://anilibria.top/api/v1/anime/releases/latest
 *   GET https://anilibria.top/api/v1/anime/releases/<alias>
 *     -> episodes[] each with hls_480 / hls_720 / hls_1080 URLs
 *        (some qualities null; fall back down). Playlist m3u8 verified HTTP 200
 *        with a real segment list.
 *   NOTE (2026-10-13): the cache*.libria.fun segment CDN 403s this VM's
 *   datacenter IP even with a fresh signed redirect token — textbook
 *   unverifiable-from-vm, NOT a provider break. Phone is the verdict.
 * Audio is Russian voice-over dub (kind:'dub'); English titles + posters
 * come from the API. ES5 only.
 */

var _AL_SITE = 'https://anilibria.top';
var _AL_API = _AL_SITE + '/api/v1';

function getInfo() {
  return {
    name: 'AniLibria', lang: 'en', baseUrl: _AL_SITE,
    logo: _AL_SITE + '/favicon.ico', type: 'anime', version: '1.0.0'
  };
}

function _getJson(url) {
  return fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('AniLibria: HTTP ' + (r && r.status) + ' for ' + url);
    return r.json();
  }).then(function (d) {
    if (!d) throw new Error('AniLibria: bad JSON for ' + url);
    return d;
  });
}

function _title(r) {
  var n = r && r.name;
  if (!n) return 'Unknown';
  return n.english || n.main || 'Unknown';
}

function _cover(r) {
  var p = r && r.poster && r.poster.src;
  if (!p) return null;
  return p.indexOf('http') === 0 ? p : _AL_SITE + p;
}

function _item(r) {
  var alias = r && r.alias;
  if (!alias) return null;
  return {
    id: 'anilibria-' + alias,
    title: _title(r),
    url: 'anilibria://release/' + alias,
    type: 'anime',
    cover: _cover(r),
    dubBadge: 'DUB'
  };
}

function _items(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    var it = _item(list[i]);
    if (it) out.push(it);
  }
  return out;
}

function getHome(opts) {
  return _getJson(_AL_API + '/anime/releases/latest').then(function (d) {
    return [{ title: 'Latest releases', items: _items(d) }];
  });
}

function search(query, page, opts) {
  var q = String(query || '').replace(/^\s+|\s+$/g, '');
  if (!q) return Promise.resolve([]);
  return _getJson(_AL_API + '/app/search/releases?query=' + encodeURIComponent(q))
    .then(function (d) { return _items(d); });
}

function _parseReleaseUrl(url) {
  var m = /^anilibria:\/\/release\/(.+)$/.exec(String(url || ''));
  return m ? m[1] : null;
}

function _parseEpisodeUrl(url) {
  var m = /^anilibria:\/\/episode\/([^/]+)\/(\d+)$/.exec(String(url || ''));
  return m ? { alias: m[1], ordinal: parseInt(m[2], 10) } : null;
}

function _episodesOf(release) {
  var eps = (release && release.episodes) || [];
  var sorted = eps.slice().sort(function (a, b) {
    return (a.ordinal || 0) - (b.ordinal || 0);
  });
  var out = [];
  for (var i = 0; i < sorted.length; i++) {
    var e = sorted[i];
    var n = e.ordinal;
    if (typeof n !== 'number') continue;
    out.push({
      id: 'anilibria-' + release.alias + '-ep' + n,
      title: 'Episode ' + n,
      url: 'anilibria://episode/' + release.alias + '/' + n,
      number: n
    });
  }
  return out;
}

function getDetail(url, opts) {
  var alias = _parseReleaseUrl(url);
  if (!alias) return Promise.reject(new Error('AniLibria: bad url'));
  return _getJson(_AL_API + '/anime/releases/' + encodeURIComponent(alias))
    .then(function (r) {
      return {
        id: 'anilibria-' + alias,
        title: _title(r),
        url: url,
        type: 'anime',
        cover: _cover(r),
        description: r.description || null,
        year: (r.year != null) ? String(r.year) : null,
        episodes: _episodesOf(r)
      };
    });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var p = _parseEpisodeUrl(episodeUrl);
  if (!p) return Promise.resolve([]);
  return _getJson(_AL_API + '/anime/releases/' + encodeURIComponent(p.alias))
    .then(function (r) {
      var eps = r.episodes || [];
      var ep = null;
      for (var i = 0; i < eps.length; i++) {
        if (eps[i].ordinal === p.ordinal) { ep = eps[i]; break; }
      }
      if (!ep) return [];
      var quals = [
        { q: '1080p', u: ep.hls_1080 },
        { q: '720p', u: ep.hls_720 },
        { q: '480p', u: ep.hls_480 }
      ];
      var out = [];
      for (var j = 0; j < quals.length; j++) {
        var u = quals[j].u;
        if (!u || u.indexOf('http') !== 0) continue;
        out.push({
          url: u,
          quality: quals[j].q,
          label: quals[j].q + ' (RU dub)',
          container: 'hls',
          kind: 'dub'
        });
      }
      return out;
    })
    .catch(function () { return []; });
}
