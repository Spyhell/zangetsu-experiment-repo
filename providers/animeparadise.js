// AnimeParadise (animeparadise.moe) — subbed anime source for Zangetsu.
// Chain (all keyless JSON, verified 2026-11-13):
//   search: GET https://api.animeparadise.moe/search?q=<q>
//   detail: GET https://api.animeparadise.moe/anime/<link>
//   episodes: GET https://api.animeparadise.moe/ep/list?origin=<animeId>
//   stream: GET https://api.animeparadise.moe/ep/<uid>?origin=<animeId>
//           -> data.episode.streamLink (opaque token, decrypted server-side)
//           -> https://stream.animeparadise.moe/m3u8?url=<streamLink>
//           -> master HLS (1080p/720p/480p, unencrypted, relative variant URLs)
//   subs: data.episode.subData [{src, label}] -> stream.animeparadise.moe/captions
// Sub-only site (no dub data). No crypto in JS — the proxy does the decrypting.
var API = 'https://api.animeparadise.moe';
var SITE = 'https://animeparadise.moe';
var STREAM = 'https://stream.animeparadise.moe';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeParadise', lang: 'en', baseUrl: SITE,
    logo: 'https://animeparadise.moe/icon/favicon-32x32.png',
    type: 'anime', version: '1.0.0' };
}

function _getJson(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': SITE + '/' } })
    .then(function (r) { return (r && r.body) || ''; })
    .then(function (b) {
      var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; }
      return j;
    });
}

function _poster(a) {
  if (!a) return null;
  var p = a.posterImage;
  if (p) return p.large || p.medium || p.small || null;
  return null;
}

function _year(a) {
  if (!a || !a.animeSeason) return null;
  var y = a.animeSeason.year;
  return (y === undefined || y === null) ? null : String(y);
}

function _item(a) {
  if (!a || !a.link || !a.title) return null;
  return { id: 'animeparadise:' + a.link, title: String(a.title),
    url: 'animeparadise://anime/' + a.link, type: 'anime',
    cover: _poster(a), year: _year(a), dubBadge: 'SUB' };
}

function getHome(opts) {
  var top = _getJson(API + '/anime/highrate').then(function (j) {
    var items = [], d = (j && j.data) || [], i;
    for (i = 0; i < d.length; i++) {
      var it = _item(d[i]);
      if (it) items.push(it);
    }
    return { title: 'Top Rated', items: items };
  });
  var recent = _getJson(API + '/ep/recently-added').then(function (j) {
    var items = [], d = (j && j.data) || [], i, seen = {};
    for (i = 0; i < d.length; i++) {
      var o = d[i] && d[i].origin;
      if (!o || !o.link || seen[o.link]) continue;
      seen[o.link] = 1;
      items.push({ id: 'animeparadise:' + o.link, title: String(o.title),
        url: 'animeparadise://anime/' + o.link, type: 'anime',
        cover: d[i].image || null, dubBadge: 'SUB' });
    }
    return { title: 'Recently Added', items: items };
  });
  return Promise.all([top, recent]).then(function (rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].items.length) out.push(rows[i]);
    }
    if (!out.length) throw new Error('AnimeParadise: home fetch failed');
    return out;
  });
}

function search(query, page, opts) {
  var url = API + '/search?q=' + encodeURIComponent(query || '');
  return _getJson(url).then(function (j) {
    if (!j || !j.success) throw new Error('AnimeParadise: search failed');
    var items = [], d = j.data || [], i;
    for (i = 0; i < d.length; i++) {
      var it = _item(d[i]);
      if (it) items.push(it);
    }
    return items;
  });
}

function _parseAnimeUrl(url) {
  var m = String(url || '').match(/animeparadise:\/\/anime\/(.+)$/);
  return m ? m[1] : null;
}

function _episodesFromList(j) {
  var eps = [], d = (j && j.data && j.data.episodeList) || [], i;
  for (i = 0; i < d.length; i++) {
    var e = d[i];
    if (!e || !e.uid) continue;
    var n = parseInt(e.number, 10);
    if (isNaN(n)) n = i + 1;
    eps.push({ id: 'animeparadise:ep:' + e.uid,
      title: 'Episode ' + n + (e.title ? ' — ' + e.title : ''),
      url: 'animeparadise://ep/' + e.uid + '?origin=' + (e.origin || ''),
      number: n, thumbnail: e.image || null });
  }
  eps.sort(function (a, b) { return a.number - b.number; });
  return eps;
}

function getDetail(url, opts) {
  var link = _parseAnimeUrl(url);
  if (!link) return Promise.reject(new Error('AnimeParadise: bad detail url'));
  return _getJson(API + '/anime/' + encodeURIComponent(link)).then(function (j) {
    if (!j || !j.success || !j.data) throw new Error('AnimeParadise: detail failed');
    var a = j.data;
    var detail = { id: 'animeparadise:' + a.link, title: String(a.title),
      url: url, type: 'anime', cover: _poster(a),
      description: a.synopsys || null, year: _year(a), episodes: [] };
    return _getJson(API + '/ep/list?origin=' + encodeURIComponent(a._id))
      .then(function (ej) {
        detail.episodes = _episodesFromList(ej);
        return detail;
      })
      .catch(function () { return detail; });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function _parseEpUrl(url) {
  var m = String(url || '').match(/animeparadise:\/\/ep\/([^?]+)\?origin=(.+)$/);
  return m ? { uid: m[1], origin: m[2] } : null;
}

function getVideoSources(episodeUrl) {
  var p = _parseEpUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('AnimeParadise: bad episode url'));
  var url = API + '/ep/' + encodeURIComponent(p.uid) +
    '?origin=' + encodeURIComponent(p.origin);
  return _getJson(url).then(function (j) {
    var ep = j && j.data && j.data.episode;
    if (!ep || !ep.streamLink) throw new Error('AnimeParadise: no streamLink');
    var subs = [], sd = ep.subData || [], i;
    for (i = 0; i < sd.length; i++) {
      if (sd[i] && sd[i].src) {
        subs.push({ url: sd[i].src, lang: 'en',
          label: sd[i].label || 'English' });
      }
    }
    return [{ url: STREAM + '/m3u8?url=' + encodeURIComponent(ep.streamLink),
      quality: 'Auto', container: 'hls', label: 'AnimeParadise',
      headers: { Referer: SITE + '/', 'User-Agent': UA },
      subtitles: subs, kind: 'sub' }];
  });
}
