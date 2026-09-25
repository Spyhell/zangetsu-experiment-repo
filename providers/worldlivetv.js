// World Live TV source for the Zangetsu app.
// Backend: the public iptv-org country playlists
//   https://iptv-org.github.io/iptv/countries/in.m3u  (India)
//   https://iptv-org.github.io/iptv/countries/us.m3u  (USA)
//   https://iptv-org.github.io/iptv/countries/uk.m3u  (UK)
// ~2,500 live TV channels as direct HLS streams with logos, grouped by
// country on Home; search covers all countries at once.
// Streams are the channels' own public HLS feeds; availability varies and some
// feeds are geo-restricted or go offline — that is the nature of live IPTV.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'worldlivetv';

var REGIONS = [
  { key: 'in', name: 'India', url: 'https://iptv-org.github.io/iptv/countries/in.m3u' },
  { key: 'us', name: 'USA', url: 'https://iptv-org.github.io/iptv/countries/us.m3u' },
  { key: 'uk', name: 'UK', url: 'https://iptv-org.github.io/iptv/countries/uk.m3u' }
];
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

var _channels = null;
var _loading = null;

function getInfo() {
  return {
    name: 'World Live TV', lang: 'en',
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

// Parse an #EXTM3U playlist into [{id,title,logo,group,url,quality,region}].
function _parseM3U(text, regionKey, regionName, startIdx) {
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
          id: regionKey + (startIdx + out.length),
          title: _cleanTitle(raw) || ('Channel ' + (startIdx + out.length + 1)),
          logo: _attr(meta, 'tvg-logo'),
          group: _attr(meta, 'group-title') || 'General',
          url: url,
          quality: _quality(raw),
          region: regionName
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
  _loading = Promise.all(REGIONS.map(function (rg) { return _get(rg.url); }))
    .then(function (texts) {
      var all = [];
      for (var r = 0; r < REGIONS.length; r++) {
        var chans = _parseM3U(texts[r], REGIONS[r].key, REGIONS[r].name, all.length);
        for (var i = 0; i < chans.length; i++) all.push(chans[i]);
      }
      _channels = all;
      _loading = null;
      return _channels;
    });
  return _loading;
}

function _chanUrl(ch) { return 'worldtv://channel/' + ch.id; }

function _item(ch) {
  var it = {
    id: _chanUrl(ch), title: ch.title + ' (' + ch.region + ')',
    url: _chanUrl(ch), type: 'movie'
  };
  if (ch.logo) it.cover = ch.logo;
  return it;
}

function _byRegion(channels, region, limit) {
  var out = [];
  for (var i = 0; i < channels.length && out.length < limit; i++) {
    if (channels[i].region === region) out.push(_item(channels[i]));
  }
  return out;
}

function getHome(opts) {
  return _load().then(function (channels) {
    if (!channels.length) throw new Error('World Live TV: empty playlists');
    var rows = [];
    for (var r = 0; r < REGIONS.length; r++) {
      var items = _byRegion(channels, REGIONS[r].name, 24);
      if (items.length) rows.push({ title: REGIONS[r].name, items: items });
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
  var m = String(url || '').match(/^worldtv:\/\/channel\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function getDetail(url, opts) {
  return _load().then(function () {
    var ch = _find(_idFromUrl(url));
    if (!ch) throw new Error('World Live TV: channel not found');
    var d = {
      id: _chanUrl(ch), title: ch.title, url: _chanUrl(ch), type: 'movie',
      description: 'Live TV • ' + ch.region +
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
    if (!ch) throw new Error('World Live TV: channel not found');
    var src = { url: ch.url, container: 'hls', label: 'Live' + (ch.quality ? ' ' + ch.quality : '') };
    if (ch.quality) src.quality = ch.quality;
    return [src];
  });
}
