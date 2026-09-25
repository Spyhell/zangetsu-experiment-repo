// Live TV India source for the Zangetsu app.
// Backend: the public iptv-org India playlist
//   https://iptv-org.github.io/iptv/countries/in.m3u
// 700+ live Indian TV channels as direct HLS streams, grouped by category
// (News, Entertainment, Movies, Sports, Music, Kids, ...), each with a logo.
// Streams are the channels' own public HLS feeds; availability varies and some
// feeds are geo-restricted or go offline — that is the nature of live IPTV.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'livetvindia';

var PLAYLIST = 'https://iptv-org.github.io/iptv/countries/in.m3u';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

var _channels = null;
var _loading = null;

function getInfo() {
  return {
    name: 'Live TV India', lang: 'en',
    baseUrl: 'https://iptv-org.github.io/iptv/',
    logo: 'https://iptv-org.github.io/iptv/images/logo.png',
    type: 'movie', version: '1.0.0'
  };
}

function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA } }).then(function (r) {
    return r.body || '';
  }).catch(function () { return ''; });
}

function _attr(s, name) {
  var m = String(s).match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

function _cleanTitle(t) {
  return String(t || '').replace(/\s*\(\d+p\)\s*$/i, '').trim();
}

function _quality(t) {
  var m = String(t || '').match(/\((\d+p)\)\s*$/i);
  return m ? m[1] : '';
}

// Parse an #EXTM3U playlist into [{id,title,logo,group,url,quality}].
function _parseM3U(text) {
  var out = [];
  var lines = String(text || '').split('\n');
  var meta = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\r$/, '');
    if (line.indexOf('#EXTINF') === 0) {
      meta = line;
    } else if (meta && line && line.charAt(0) !== '#') {
      var url = line.trim();
      if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
        var raw = meta.slice(meta.indexOf(',') + 1).trim();
        out.push({
          id: 'ch' + out.length,
          title: _cleanTitle(raw) || ('Channel ' + (out.length + 1)),
          logo: _attr(meta, 'tvg-logo'),
          group: _attr(meta, 'group-title') || 'General',
          url: url,
          quality: _quality(raw)
        });
      }
      meta = null;
    }
  }
  return out;
}

function _load() {
  if (_channels) return Promise.resolve(_channels);
  if (_loading) return _loading;
  _loading = _get(PLAYLIST).then(function (text) {
    _channels = _parseM3U(text);
    _loading = null;
    return _channels;
  });
  return _loading;
}

function _chanUrl(ch) { return 'livetv://channel/' + ch.id; }

function _item(ch) {
  var it = {
    id: _chanUrl(ch), title: ch.title, url: _chanUrl(ch), type: 'movie'
  };
  if (ch.logo) it.cover = ch.logo;
  return it;
}

function _byGroup(channels, group, limit) {
  var out = [];
  for (var i = 0; i < channels.length && out.length < limit; i++) {
    if (channels[i].group === group) out.push(_item(channels[i]));
  }
  return out;
}

var HOME_ROWS = [
  ['News', 'News'],
  ['Entertainment', 'Entertainment'],
  ['Movies', 'Movies'],
  ['Sports', 'Sports'],
  ['Music', 'Music'],
  ['Kids', 'Kids']
];

function getHome(opts) {
  return _load().then(function (channels) {
    if (!channels.length) throw new Error('Live TV India: empty playlist');
    var rows = [];
    for (var r = 0; r < HOME_ROWS.length; r++) {
      var items = _byGroup(channels, HOME_ROWS[r][1], 24);
      if (items.length) rows.push({ title: HOME_ROWS[r][0], items: items });
    }
    return rows;
  });
}

function search(query, page, opts) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return Promise.resolve([]);
  return _load().then(function (channels) {
    var out = [];
    for (var i = 0; i < channels.length && out.length < 30; i++) {
      if (channels[i].title.toLowerCase().indexOf(q) !== -1) out.push(_item(channels[i]));
    }
    return out;
  });
}

function _find(id) {
  for (var i = 0; i < _channels.length; i++) {
    if (_channels[i].id === id) return _channels[i];
  }
  return null;
}

function _idFromUrl(url) {
  var m = String(url || '').match(/^livetv:\/\/channel\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function getDetail(url, opts) {
  return _load().then(function () {
    var ch = _find(_idFromUrl(url));
    if (!ch) throw new Error('Live TV India: channel not found');
    var d = {
      id: _chanUrl(ch), title: ch.title, url: _chanUrl(ch), type: 'movie',
      description: 'Live TV' + (ch.group ? ' • ' + ch.group : '') +
        (ch.quality ? ' • ' + ch.quality : ''),
      episodes: [{ id: _chanUrl(ch) + '/live', title: 'Live', url: _chanUrl(ch) + '/live', number: 1 }]
    };
    if (ch.logo) d.cover = ch.logo;
    return d;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl, opts) {
  return _load().then(function () {
    var ch = _find(_idFromUrl(episodeUrl));
    if (!ch) throw new Error('Live TV India: channel not found');
    var src = { url: ch.url, container: 'hls', label: 'Live' + (ch.quality ? ' ' + ch.quality : '') };
    if (ch.quality) src.quality = ch.quality;
    return [src];
  });
}
