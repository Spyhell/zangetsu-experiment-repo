// Music Live TV source for the Zangetsu app.
// Backend: the public iptv-org music category playlist
//   https://iptv-org.github.io/iptv/categories/music.m3u
// ~700 live music TV channels from around the world as direct HLS streams
// with logos, grouped by region on Home (India first); search covers all.
// Streams are the channels' own public HLS feeds; availability varies and some
// feeds are geo-restricted or go offline — that is the nature of live IPTV.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'musictv';

var PLAYLIST = 'https://iptv-org.github.io/iptv/categories/music.m3u';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

// Home row order: India first (user region), then the biggest catalogs.
var ROWS = [
  { code: 'in', name: 'India' },
  { code: 'us', name: 'USA' },
  { code: 'uk', name: 'UK' },
  { code: 'fr', name: 'France' },
  { code: 'de', name: 'Germany' },
  { code: 'it', name: 'Italy' },
  { code: 'es', name: 'Spain' },
  { code: 'ca', name: 'Canada' },
  { code: 'br', name: 'Brazil' },
  { code: 'mx', name: 'Mexico' }
];

var _channels = null;
var _loading = null;

function getInfo() {
  return {
    name: 'Music Live TV', lang: 'en',
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
  return String(t || '').replace(/\s*\(\d+p?\)\s*$/i, '').trim();
}

function _quality(t) {
  var m = String(t || '').match(/\((\d+p)\)\s*$/i);
  return m ? m[1] : '';
}

function _regionCode(meta) {
  var id = _attr(meta, 'tvg-id');
  var m = String(id).match(/\.([a-z]{2})@/i);
  return m ? m[1].toLowerCase() : '';
}

function _regionName(code) {
  for (var i = 0; i < ROWS.length; i++) {
    if (ROWS[i].code === code) return ROWS[i].name;
  }
  return code ? code.toUpperCase() : 'International';
}

// Parse an #EXTM3U playlist into [{id,title,logo,group,url,quality,region}].
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
        var code = _regionCode(meta);
        out.push({
          id: 'm' + out.length,
          title: _cleanTitle(raw) || ('Channel ' + (out.length + 1)),
          logo: _attr(meta, 'tvg-logo'),
          group: _attr(meta, 'group-title') || 'Music',
          url: url,
          quality: _quality(raw),
          region: code,
          regionName: _regionName(code)
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

function _chanUrl(ch) { return 'musictv://channel/' + ch.id; }

function _item(ch) {
  var it = {
    id: _chanUrl(ch), title: ch.title + ' (' + ch.regionName + ')',
    url: _chanUrl(ch), type: 'movie'
  };
  if (ch.logo) it.cover = ch.logo;
  return it;
}

function _byRegion(channels, code, limit) {
  var out = [];
  for (var i = 0; i < channels.length && out.length < limit; i++) {
    if (channels[i].region === code) out.push(_item(channels[i]));
  }
  return out;
}

function getHome(opts) {
  return _load().then(function (channels) {
    if (!channels.length) throw new Error('Music Live TV: empty playlist');
    var rows = [];
    for (var r = 0; r < ROWS.length; r++) {
      var items = _byRegion(channels, ROWS[r].code, 24);
      if (items.length) rows.push({ title: ROWS[r].name, items: items });
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
  var m = String(url || '').match(/^musictv:\/\/channel\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function getDetail(url, opts) {
  return _load().then(function () {
    var ch = _find(_idFromUrl(url));
    if (!ch) throw new Error('Music Live TV: channel not found');
    var d = {
      id: _chanUrl(ch), title: ch.title, url: _chanUrl(ch), type: 'movie',
      description: 'Live music TV • ' + ch.regionName +
        (ch.group ? ' • ' + ch.group : '') +
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
    if (!ch) throw new Error('Music Live TV: channel not found');
    var src = { url: ch.url, container: 'hls', label: 'Live' + (ch.quality ? ' ' + ch.quality : '') };
    if (ch.quality) src.quality = ch.quality;
    return [src];
  });
}
