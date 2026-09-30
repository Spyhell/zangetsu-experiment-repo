// Pluto TV source for the Zangetsu app.
// Backend: the public, keyless Pluto TV channel API
//   GET https://api.pluto.tv/v2/channels -> [{ _id, name, slug, category,
//     summary, logo: { path }, stitched: { urls: [{ type:'hls', url }] } }]
// Linear HLS comes from the per-channel stitcher URL template the API
// returns; the template's empty device* params are filled in here and the
// request carries `plutotv-device-dnt: 0`. Verified end to end 2026-09-30:
// channels API 200 -> master.m3u8 200 (1-3.3 Mbps variants + EN subs) ->
// variant playlist 200 -> .ts segment HTTP 206 with real bytes.
// Pluto's on-demand VOD endpoints need a Bearer <redacted> (401), so this
// source is linear channels only.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'plutotv';

var API = 'https://api.pluto.tv/v2';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

var _channelCache = null;
var _loading = null;

function getInfo() {
  return {
    name: 'Pluto TV', lang: 'en',
    baseUrl: 'https://pluto.tv/',
    logo: 'https://pluto.tv/assets/images/og_logo.png',
    type: 'movie', version: '1.0.0'
  };
}

function _get(url, accept) {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': accept || 'application/json' }
  }).then(function (r) {
    if (!r.ok) throw new Error('Pluto TV: HTTP ' + r.status);
    return r.json();
  });
}

function _channels() {
  if (_channelCache) return Promise.resolve(_channelCache);
  if (_loading) return _loading;
  _loading = _get(API + '/channels').then(function (d) {
    var list = Array.isArray(d) ? d : (d && d.data) || [];
    _channelCache = list.filter(function (c) {
      return c && c._id && c.name && c.stitched &&
        c.stitched.urls && c.stitched.urls.length;
    });
    return _channelCache;
  }).catch(function (e) {
    _loading = null;
    throw e;
  });
  return _loading;
}

function _trim(s) { return String(s == null ? '' : s).trim(); }

// Fill the stitcher URL template's empty device params. The template
// already carries deviceDNT=0 and must not receive duplicate params.
function _stitchUrl(ch) {
  var u = ch.stitched.urls[0].url;
  u = u.replace('deviceModel=&', 'deviceModel=web&')
       .replace('deviceMake=&', 'deviceMake=chrome&')
       .replace('deviceType=&', 'deviceType=web&')
       .replace('deviceVersion=unknown', 'deviceVersion=1.0')
       .replace('appName=&', 'appName=web&')
       .replace('appVersion=unknown', 'appVersion=1.0');
  return u;
}

function _logo(ch) {
  var l = ch.logo || ch.solidLogoPNG || ch.colorLogoPNG;
  if (l && l.path) return l.path;
  if (typeof l === 'string') return l;
  return null;
}

function _item(ch) {
  return {
    id: 'plutotv:ch:' + ch._id,
    title: _trim(ch.name),
    url: 'plutotv://channel/' + ch._id,
    type: 'movie',
    cover: _logo(ch),
    description: _trim(ch.summary)
  };
}

var _ROW_CATS = ['Movies', 'Comedy', 'Drama', 'Kids', 'News + Opinion',
  'Sports', 'Music Videos', 'Reality', 'Sci-Fi', 'True Crime'];

function getHome(page, opts) {
  return _channels().then(function (chs) {
    var rows = [], i, j;
    for (i = 0; i < _ROW_CATS.length; i++) {
      var cat = _ROW_CATS[i];
      var items = [];
      for (j = 0; j < chs.length && items.length < 24; j++) {
        if ((chs[j].category || '') === cat) items.push(_item(chs[j]));
      }
      if (items.length) rows.push({ title: 'Pluto TV: ' + cat, items: items });
    }
    return rows;
  });
}

function search(query, page, opts) {
  var q = _trim(query).toLowerCase();
  if (!q) return Promise.resolve([]);
  return _channels().then(function (chs) {
    var out = [];
    for (var i = 0; i < chs.length && out.length < 30; i++) {
      var name = _trim(chs[i].name).toLowerCase();
      var cat = _trim(chs[i].category).toLowerCase();
      if (name.indexOf(q) !== -1 || cat.indexOf(q) !== -1) out.push(_item(chs[i]));
    }
    return out;
  });
}

function _find(id) {
  return _channels().then(function (chs) {
    for (var i = 0; i < chs.length; i++) {
      if (String(chs[i]._id) === String(id)) return chs[i];
    }
    throw new Error('Pluto TV: channel not found');
  });
}

function getDetail(url, opts) {
  var m = /^plutotv:\/\/channel\/([a-f0-9]+)/.exec(String(url || ''));
  if (!m) return Promise.reject(new Error('Pluto TV: bad url'));
  return _find(m[1]).then(function (ch) {
    return {
      id: 'plutotv:ch:' + ch._id,
      title: _trim(ch.name),
      url: 'plutotv://channel/' + ch._id,
      type: 'movie',
      cover: _logo(ch),
      description: _trim(ch.summary),
      episodes: [{
        id: 'plutotv:ep:' + ch._id,
        number: 1,
        title: 'Live',
        url: 'plutotv://play/' + ch._id
      }]
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl, opts) {
  var m = /^plutotv:\/\/play\/([a-f0-9]+)/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('Pluto TV: bad episode url'));
  return _find(m[1]).then(function (ch) {
    var master = _stitchUrl(ch);
    var headers = { 'User-Agent': UA, 'plutotv-device-dnt': '0', 'Referer': 'https://pluto.tv/' };
    // Probe the master so a dead channel fails loudly instead of
    // handing the player an unusable URL.
    return fetch(master, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('Pluto TV: stream unavailable (HTTP ' + r.status + ')');
      return r.text();
    }).then(function (body) {
      if (body.indexOf('#EXTM3U') === -1) {
        throw new Error('Pluto TV: stream unavailable (bad playlist)');
      }
      return [{
        url: master,
        quality: 'Auto',
        kind: 'hls',
        headers: headers
      }];
    });
  });
}
