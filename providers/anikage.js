// ─────────────────────────────────────────────────────────────────────────────
// Anikage — anime streaming provider for the Zangetsu provider repo.
// Source site: https://anikage.cc
// Uses the site's public JSON API (search / browse / detail / episodes /
// sources) and resolves the encrypted stream tokens through
// https://og.bakayaro.live (the site's own stream gateway), the same
// mapping the Aniyomi Anikage extension uses.
// ─────────────────────────────────────────────────────────────────────────────

var _UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var _API = 'https://anikage.cc/api/media/anime';
var _SITE = 'https://anikage.cc';
var _OG = 'https://og.bakayaro.live';

var _JHEADERS = {
  'User-Agent': _UA,
  Accept: 'application/json',
  Referer: _SITE + '/',
  Origin: _SITE
};

// Providers known to the site's /servers endpoint. `neko` serves segments
// wrapped in a fake PNG header (needs a stripping proxy the app doesn't
// have), so it is NOT in the default list.
var _KNOWN_PROVIDERS = ['koto', 'kiwi', 'wave', 'megg', 'suge', 'dib', 'zen', 'uwu', 'neko'];

function getInfo() {
  return {
    name: 'Anikage',
    lang: 'en',
    baseUrl: _SITE,
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/anikage.png',
    type: 'anime',
    version: '1.0.0'
  };
}

function getSettings() {
  return [
    {
      key: 'providers',
      label: 'Stream providers (comma-separated)',
      type: 'text',
      default: 'koto,kiwi,wave'
    },
    {
      key: 'includeDub',
      label: 'Include dubbed sources',
      type: 'bool',
      default: true
    },
    {
      key: 'includeAdult',
      label: 'Include 18+ titles',
      type: 'bool',
      default: false
    },
    {
      key: 'maxResults',
      label: 'Max results per row / search',
      type: 'enum',
      default: '20',
      options: [
        { value: '10', label: '10' },
        { value: '20', label: '20' },
        { value: '30', label: '30' }
      ]
    }
  ];
}

// ── settings helpers ─────────────────────────────────────────────────────────

function _settings() {
  try {
    var all = typeof __settings === 'object' && __settings ? __settings : {};
    var s = all.anikage || all.ANIKAGE || all.Anikage || {};
    return typeof s === 'object' && s ? s : {};
  } catch (e) { return {}; }
}

function _str(v, dflt) {
  if (v === undefined || v === null) return dflt;
  var s = String(v).trim();
  return s === '' ? dflt : s;
}

function _bool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  var s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return dflt;
}

function _int(v, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) || n <= 0 ? dflt : n;
}

function _providers() {
  var raw = _str(_settings().providers, 'koto,kiwi,wave').toLowerCase();
  var list = raw.split(/[,\s]+/).map(function (p) { return p.trim(); })
    .filter(function (p) { return p && _KNOWN_PROVIDERS.indexOf(p) >= 0; });
  return list.length ? list : ['koto'];
}

function _includeDub() { return _bool(_settings().includeDub, true); }
function _includeAdult() { return _bool(_settings().includeAdult, false); }
function _limit() { return _int(_settings().maxResults, 20); }

// ── http ─────────────────────────────────────────────────────────────────────

function _getJson(url) {
  return fetch(url, { headers: _JHEADERS }).then(function (res) {
    if (!res || (res.status !== undefined && res.status >= 400)) {
      throw new Error('http ' + (res && res.status));
    }
    return JSON.parse(res.body);
  });
}

// ── mappers ──────────────────────────────────────────────────────────────────

function _title(t) {
  t = t || {};
  return _str(t.english, '') || _str(t.romaji, '') || _str(t.native, '') || 'Unknown';
}

function _cover(c) {
  c = c || {};
  return c.extraLarge || c.large || c.medium || '';
}

function _adult(item) {
  return item && item.isAdult === true;
}

function _item(it) {
  if (!it || !it.slug) return null;
  if (!_includeAdult() && _adult(it)) return null;
  var t = _title(it.title);
  var sub = [it.year, it.format, it.status].filter(Boolean).join(' · ');
  return {
    id: it.slug,
    title: t,
    url: 'anikage://anime/' + it.slug,
    cover: _cover(it.coverImage),
    banner: it.bannerImage || '',
    subtitle: sub,
    year: it.year || null,
    rating: typeof it.averageScore === 'number' ? it.averageScore / 10 : null
  };
}

function _streamHeaders() {
  // The stream gateway checks Referer/Origin — without them playback fails.
  return { 'User-Agent': _UA, Referer: _SITE + '/', Origin: _SITE };
}

function _subtitleOf(s) {
  var label = _str(s.label, 'Subtitle');
  return {
    url: _OG + '/stream/' + s.file,
    lang: label,
    label: label,
    format: 'vtt',
    default: /english/i.test(label)
  };
}

function _sourceOf(src, providerId, lang) {
  var isHls = src.isM3U8 !== false; // default true; gateway serves both
  var url = _OG + (isHls ? '/m3u8/' : '/stream/') + src.url;
  var kindLabel = lang === 'dub' ? 'Dub' : 'Sub';
  var q = _str(src.quality, '');
  var label = providerId.charAt(0).toUpperCase() + providerId.slice(1) + ' · ' + kindLabel;
  if (q && q.toLowerCase() !== 'auto') label += ' · ' + q;
  return {
    url: url,
    quality: 'auto',
    label: label,
    container: isHls ? 'hls' : 'mp4',
    headers: _streamHeaders(),
    kind: lang,
    audioLang: lang === 'dub' ? 'en' : 'ja',
    subtitles: []
  };
}

// ── public API ───────────────────────────────────────────────────────────────

function search(query) {
  var q = _str(query, '');
  if (!q) return Promise.resolve([]);
  var url = _API + '/search?q=' + encodeURIComponent(q) + '&limit=' + _limit();
  return _getJson(url).then(function (d) {
    return (d.data || []).map(_item).filter(Boolean).slice(0, _limit());
  });
}

function _browseRow(title, sort) {
  var url = _API + '/browse?page=1&sort=' + sort + '&limit=' + _limit();
  return _getJson(url).then(function (d) {
    var items = (d.data || []).map(_item).filter(Boolean);
    if (!items.length) return null;
    return { title: title, items: items };
  }).catch(function () { return null; });
}

function getHome() {
  return Promise.all([
    _browseRow('Trending Now', 'trending'),
    _browseRow('Most Popular', 'popularity'),
    _browseRow('Recently Updated', 'updated')
  ]).then(function (rows) { return rows.filter(Boolean); });
}

function getDetail(url) {
  var m = /anikage:\/\/anime\/([^#?]+)/.exec(url || '');
  if (!m) return Promise.reject(new Error('bad url'));
  var slug = m[1];
  var durl = _API + '/' + slug;
  var eurl = _API + '/' + slug + '/episodes';
  return Promise.all([_getJson(durl), _getJson(eurl).catch(function () { return []; })])
    .then(function (pair) {
      var a = (pair[0] && pair[0].anime) || pair[0] || {};
      var eps = Array.isArray(pair[1]) ? pair[1] : [];
      var t = _title(a.title);
      var desc = _str(a.description, '');
      var studios = (a.studios || []).map(function (s) { return s.name; }).filter(Boolean);
      var meta = [a.format, a.status, a.year, a.season].filter(Boolean).join(' · ');
      if (studios.length) meta += (meta ? ' · ' : '') + studios.slice(0, 3).join(', ');
      var episodes = eps.map(function (e) {
        var n = e.number != null ? e.number : 0;
        var et = _str(e.title, 'Episode ' + n);
        return {
          id: slug + '-' + n,
          title: 'E' + n + ' — ' + et,
          number: n,
          url: 'anikage://anime/' + slug + '#' + n,
          thumbnail: e.image || '',
          date: e.airDate || ''
        };
      });
      return {
        id: slug,
        title: t,
        url: 'anikage://anime/' + slug,
        cover: _cover(a.coverImage),
        banner: a.bannerImage || a.fanart || '',
        description: desc,
        genres: a.genres || [],
        subtitle: meta,
        year: a.year || null,
        rating: typeof a.averageScore === 'number' ? a.averageScore / 10 : null,
        episodes: episodes
      };
    });
}

function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var m = /anikage:\/\/anime\/([^#?]+)#(\d+)/.exec(episodeUrl || '');
  if (!m) return Promise.resolve([]);
  var slug = m[1];
  var num = m[2];
  var providers = _providers();
  var langs = _includeDub() ? ['sub', 'dub'] : ['sub'];

  var jobs = [];
  providers.forEach(function (p) {
    langs.forEach(function (lang) {
      var url = _API + '/' + slug + '/episodes/' + num +
        '/sources?lang=' + lang + '&provider=' + p;
      jobs.push(
        _getJson(url).then(function (d) {
          var subs = (d.subtitles || []).filter(function (s) { return s && s.file; })
            .map(_subtitleOf);
          return (d.sources || []).filter(function (s) { return s && s.url; })
            .map(function (s) {
              var v = _sourceOf(s, p, lang);
              v.subtitles = subs;
              return v;
            });
        }).catch(function () { return []; })
      );
    });
  });

  return Promise.all(jobs).then(function (lists) {
    var out = [];
    var seen = {};
    lists.forEach(function (l) {
      l.forEach(function (v) {
        if (!seen[v.url]) { seen[v.url] = 1; out.push(v); }
      });
    });
    return out;
  });
}
