// ToraStream — multi-API torrent source for the Zangetsu provider repo.
//
// Own build, modeled on phisher98's TorraStream CloudStream extension:
// catalog + metadata come from Cinemeta (movies/series) and the anime-kitsu
// Stremio addon (anime); streams come from Torrentio's public Stremio API
// with an optional ThePirateBay+ addon fallback. Results are magnet links,
// played by Zangetsu's native torrent engine (streams while downloading).
//
// Settings: stream APIs, Torrentio providers, sort, per-quality limit,
// quality filter, min seeders, movie/TV size caps, max results, anime row.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'torastream';

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

var _CINEMETA = 'https://v3-cinemeta.strem.io';
var _CINEMETA_CAT = 'https://cinemeta-catalogs.strem.io';
var _KITSU = 'https://anime-kitsu.strem.fun';
var _TORRENTIO = 'https://torrentio.strem.fun';
var _TPBPLUS = 'https://thepiratebay-plus.strem.fun';

// Public trackers appended to every magnet so Zangetsu's torrent engine can
// discover peers quickly instead of relying on DHT alone (bare magnets hang
// on "finding peers").
var _TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.bittor.space:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce'
];

var _ALL_PROVIDERS = '1337x,AniDex,BluDV,Cinecalidad,Comando,EZTV,HorribleSubs,'
  + 'KickassTorrents,MagnetDL,NyaaSi,RARBG,Rutor,ThePirateBay,TokyoTosho,TorrentGalaxy';

function getInfo() {
  return {
    name: 'ToraStream', lang: 'en', baseUrl: 'https://torrentio.strem.fun',
    logo: 'https://torrentio.strem.fun/images/logo_v1.png',
    type: 'movie', version: '1.0.1'
  };
}

function getSettings() {
  return [
    {
      key: 'mainApis',
      label: 'Stream APIs',
      type: 'enum',
      default: 'all',
      options: [
        { value: 'all', label: 'Torrentio + ThePirateBay+' },
        { value: 'torrentio', label: 'Torrentio only' },
        { value: 'tpbplus', label: 'ThePirateBay+ only' }
      ]
    },
    {
      key: 'providers',
      label: 'Torrentio providers (comma-separated, blank = all)',
      type: 'text',
      default: _ALL_PROVIDERS
    },
    {
      key: 'sort',
      label: 'Torrentio sorting',
      type: 'enum',
      default: 'qualityseed',
      options: [
        { value: 'qualityseed', label: 'By quality, then seeders' },
        { value: 'qualitysize', label: 'By quality, then size' },
        { value: 'seeders', label: 'By seeders' },
        { value: 'size', label: 'By size' }
      ]
    },
    {
      key: 'extraTrackers',
      label: 'Add public trackers to magnets (faster peer discovery)',
      type: 'bool',
      default: true
    },
    {
      key: 'limitPerQuality',
      label: 'Max results per quality (0 = unlimited)',
      type: 'enum',
      default: '5',
      options: [
        { value: '0', label: 'Unlimited' },
        { value: '1', label: '1 per quality' },
        { value: '2', label: '2 per quality' },
        { value: '3', label: '3 per quality' },
        { value: '5', label: '5 per quality' },
        { value: '10', label: '10 per quality' }
      ]
    },
    {
      key: 'qualities',
      label: 'Allowed qualities, comma-separated (blank = all)',
      type: 'text',
      default: ''
    },
    {
      key: 'minSeeders',
      label: 'Minimum seeders',
      type: 'enum',
      default: '0',
      options: [
        { value: '0', label: 'Any' },
        { value: '5', label: '5+' },
        { value: '10', label: '10+' },
        { value: '25', label: '25+' },
        { value: '50', label: '50+' },
        { value: '100', label: '100+' }
      ]
    },
    {
      key: 'maxMovieSize',
      label: 'Movie size cap in GB (blank = none)',
      type: 'text',
      default: ''
    },
    {
      key: 'maxTvSize',
      label: 'Series/Anime size cap in GB (blank = none)',
      type: 'text',
      default: ''
    },
    {
      key: 'excludePacks',
      label: 'Exclude season packs / batches',
      type: 'bool',
      default: false
    },
    {
      key: 'maxResults',
      label: 'Max results',
      type: 'enum',
      default: '20',
      options: [
        { value: '10', label: '10' },
        { value: '15', label: '15' },
        { value: '20', label: '20' },
        { value: '30', label: '30' },
        { value: '50', label: '50' }
      ]
    },
    {
      key: 'includeAnime',
      label: 'Show anime row on home',
      type: 'bool',
      default: true
    },
    {
      key: 'torrentioBase',
      label: 'Torrentio base URL (optional override)',
      type: 'text',
      default: _TORRENTIO
    }
  ];
}

// ── helpers ────────────────────────────────────────────────────────────────
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _settings() {
  try {
    var bag = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
    return bag[SOURCE_ID] || {};
  } catch (e) { return {}; }
}

function _bool(v, dflt) {
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return !!dflt;
}

function _int(v, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) ? dflt : n;
}

function _float(v, dflt) {
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) || n <= 0 ? dflt : n;
}

function _mainApis() {
  var v = _trim(_settings().mainApis || 'all');
  return (v === 'torrentio' || v === 'tpbplus') ? v : 'all';
}

function _torrentioBase() {
  var b = _trim(_settings().torrentioBase || '') || _TORRENTIO;
  while (b.length && b.charAt(b.length - 1) === '/') b = b.slice(0, -1);
  return b;
}

function _providersParam() {
  var p = _trim(_settings().providers || '');
  if (!p) return '';
  var all = _trim(_ALL_PROVIDERS).toLowerCase().split(',');
  var picked = p.split(',').map(function (x) { return _trim(x).toLowerCase(); })
    .filter(function (x) { return x && all.indexOf(x) >= 0; });
  return picked.length ? picked.join(',') : '';
}

function _sortKey() {
  var s = _trim(_settings().sort || 'qualityseed');
  if (s === 'qualitysize' || s === 'seeders' || s === 'size') return s;
  return 'qualityseed';
}

function _limitPerQuality() { return Math.max(0, _int(_settings().limitPerQuality, 5)); }
function _minSeeders() { return Math.max(0, _int(_settings().minSeeders, 0)); }
function _maxResults() { var n = _int(_settings().maxResults, 20); return n > 0 ? n : 20; }
function _excludePacks() { return _bool(_settings().excludePacks, false); }
function _includeAnime() { return _bool(_settings().includeAnime, true); }

function _allowedQualities() {
  var q = _trim(_settings().qualities || '');
  if (!q) return null;
  return q.split(',').map(function (x) {
    return _trim(x).toLowerCase().replace(/[^0-9a-z]/g, '');
  }).filter(Boolean);
}

function _sizeCapGb(kind) {
  var raw = kind === 'movie' ? _settings().maxMovieSize : _settings().maxTvSize;
  return _float(raw, 0);
}

function _pad(n) {
  n = parseInt(n, 10) || 0;
  return n < 10 ? ('0' + n) : String(n);
}

function _extraTrackers() { return _bool(_settings().extraTrackers, true); }

// Full magnet with display name + public trackers so playback starts fast.
function _buildMagnet(hash, name) {
  var m = 'magnet:?xt=urn:btih:' + hash;
  if (name) m += '&dn=' + encodeURIComponent(String(name).slice(0, 200));
  if (_extraTrackers()) {
    for (var i = 0; i < _TRACKERS.length; i++) {
      m += '&tr=' + encodeURIComponent(_TRACKERS[i]);
    }
  }
  return m;
}

// fetch JSON, following up to 3 redirects (Cinemeta → cinemeta-catalogs).
function _tj(url, depth) {
  depth = depth || 0;
  return fetch(url, { headers: { 'User-Agent': UA }, timeoutMs: 15000 })
    .then(function (r) {
      var loc = (r.headers && (r.headers.location || r.headers.Location)) || '';
      if (loc && r.status >= 300 && r.status < 400 && depth < 3) {
        if (loc.charAt(0) === '/') {
          var m = String(url).match(/^(https?:\/\/[^/]+)/);
          loc = (m ? m[1] : '') + loc;
        }
        return _tj(loc, depth + 1);
      }
      try { return JSON.parse(r.body || 'null'); } catch (e) { return null; }
    })
    .catch(function () { return null; });
}

function _quality(s) {
  var str = String(s || '');
  var m = str.match(/\b(4320|2160|1080|720|480|360)p\b/i);
  if (m) return m[1] + 'p';
  if (/\b(4k|uhd|2160)\b/i.test(str)) return '2160p';
  if (/\bcam\b/i.test(str)) return 'CAM';
  if (/\bscr\b/i.test(str)) return 'SCR';
  return null;
}

function _resRank(q) {
  var n = parseInt(String(q || '').replace(/p$/i, ''), 10);
  return isNaN(n) ? 0 : n;
}

function _parseSizeToBytes(s) {
  var m = String(s || '').match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
  if (!m) return 0;
  var n = parseFloat(m[1]);
  if (isNaN(n)) return 0;
  var u = m[2].toUpperCase();
  if (u === 'TB') return n * 1099511627776;
  if (u === 'GB') return n * 1073741824;
  if (u === 'MB') return n * 1048576;
  return n * 1024;
}

function _sizeLabel(bytes) {
  var n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  if (n >= 1048576) return Math.round(n / 1048576) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

function _basename(path) {
  var s = String(path || '').replace(/\\/g, '/');
  var i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

// Tag streams so the app's pickDefault(prefer: dub|sub) can honor Settings.
function _detectAudioKind(blob) {
  var s = String(blob || '').toLowerCase();
  if (!s) return 'raw';
  if (/\bdual[\s._-]*audio\b|\bdualaudio\b/.test(s)) return 'dub';
  if (/\b(?:eng(?:lish)?[\s._-]*)?dub(?:bed)?\b/.test(s) && !/\bdubtitle/.test(s)) return 'dub';
  if (/\b(?:multi[\s._-]*audio|multiaudio)\b/.test(s) && /\b(?:eng(?:lish)?|en)\b/.test(s)) return 'dub';
  if (/\b(?:soft[\s._-]*)?subs?\b|\bhardsub|\bmulti[\s._-]*subs?\b/.test(s)
    && !/\bdub(?:bed)?\b|\bdual[\s._-]*audio\b/.test(s)) return 'sub';
  if (/\b(?:jpn?|japanese|raw)\b/.test(s) && !/\b(?:eng(?:lish)?|dual|dub)\b/.test(s)) return 'sub';
  return 'raw';
}

function _isPack(release) {
  var s = String(release || '');
  return /complete\s+(?:series|season)|season\s*\d+\s*[-–~]\s*season|\bs\d{1,2}\s*[-–~]\s*s?\d{1,2}\b|\[\s*0*1\s*[-–~]\s*\d{2,4}\s*\]|\(\s*0*1\s*[-–~]\s*\d{2,4}\s*\)|\bbatch\b/i.test(s);
}

// Opaque media / episode URLs. Anime keeps both the kitsu id (catalog) and
// the imdb id (streams) in the query.
function _mediaUrl(kind, id, imdb) {
  var u = 'torastream://' + kind + '/' + encodeURIComponent(id);
  if (imdb) u += '?imdb=' + encodeURIComponent(imdb);
  return u;
}

function _epUrl(kind, id, season, episode, imdb) {
  var u = _mediaUrl(kind, id, imdb);
  return u + '#' + (season || 0) + '/' + (episode || 0);
}

function _parseUrl(url) {
  var s = String(url || '');
  var m = s.match(/^torastream:\/\/(movie|series|anime)\/([^#?]+)/i);
  if (!m) return null;
  var q = {};
  var qi = s.indexOf('?');
  if (qi >= 0) {
    var hash = s.indexOf('#', qi);
    var qstr = hash >= 0 ? s.slice(qi + 1, hash) : s.slice(qi + 1);
    var parts = qstr.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
  }
  var se = null;
  var hi = s.indexOf('#');
  if (hi >= 0) {
    var frag = s.slice(hi + 1).split('/');
    se = { season: parseInt(frag[0], 10) || 0, episode: parseInt(frag[1], 10) || 0 };
  }
  return {
    kind: m[1].toLowerCase(),
    id: decodeURIComponent(m[2]),
    imdb: q.imdb || null,
    season: se ? se.season : null,
    episode: se ? se.episode : null
  };
}

// ── catalog (Cinemeta + anime-kitsu) ────────────────────────────────────────
function _metaItem(meta, kind) {
  var name = _trim(meta.name || '');
  if (!name) return null;
  var imdb = meta.imdb_id || meta.id || null;
  var id = (kind === 'anime') ? String(meta.id || '') : String(imdb || meta.id || '');
  if (!id) return null;
  var year = _trim(meta.releaseInfo || '').slice(0, 4) || null;
  var url = _mediaUrl(kind, id, kind === 'anime' ? imdb : null);
  return {
    id: url,
    title: year ? (name + ' (' + year + ')') : name,
    cover: meta.poster || null,
    url: url,
    type: 'movie',
    sourceId: SOURCE_ID
  };
}

function _catalogSearch(query) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var enc = encodeURIComponent(q);
  var jobs = [
    _tj(_CINEMETA + '/catalog/movie/top/search=' + enc + '.json'),
    _tj(_CINEMETA + '/catalog/series/top/search=' + enc + '.json')
  ];
  if (_includeAnime()) jobs.push(_tj(_KITSU + '/catalog/anime/kitsu-anime-list/search=' + enc + '.json'));
  return Promise.all(jobs).then(function (all) {
    var out = [];
    var kinds = ['movie', 'series', 'anime'];
    for (var i = 0; i < all.length; i++) {
      var metas = (all[i] && all[i].metas) || [];
      for (var j = 0; j < metas.length; j++) {
        var it = _metaItem(metas[j], kinds[i]);
        if (it) out.push(it);
      }
    }
    return out.slice(0, 40);
  }).catch(function () { return []; });
}

function search(query, page, opts) {
  return _catalogSearch(query);
}

function getHome(opts) {
  var jobs = [
    _tj(_CINEMETA_CAT + '/top/catalog/movie/top.json').then(function (j) {
      var out = [], metas = (j && j.metas) || [];
      for (var i = 0; i < metas.length; i++) {
        var it = _metaItem(metas[i], 'movie');
        if (it) out.push(it);
      }
      return { title: 'Trending Movies', items: out.slice(0, 20) };
    }),
    _tj(_CINEMETA_CAT + '/top/catalog/series/top.json').then(function (j) {
      var out = [], metas = (j && j.metas) || [];
      for (var i = 0; i < metas.length; i++) {
        var it = _metaItem(metas[i], 'series');
        if (it) out.push(it);
      }
      return { title: 'Trending Series', items: out.slice(0, 20) };
    })
  ];
  if (_includeAnime()) {
    jobs.push(_tj(_KITSU + '/catalog/anime/kitsu-anime-list/top.json').then(function (j) {
      var out = [], metas = (j && j.metas) || [];
      for (var i = 0; i < metas.length; i++) {
        var it = _metaItem(metas[i], 'anime');
        if (it) out.push(it);
      }
      return { title: 'Top Anime', items: out.slice(0, 20) };
    }));
  }
  return Promise.all(jobs).catch(function () { return []; });
}

function _metaUrl(kind, id) {
  if (kind === 'anime') return _KITSU + '/meta/anime/' + encodeURIComponent(id) + '.json';
  return _CINEMETA + '/meta/' + kind + '/' + encodeURIComponent(id) + '.json';
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.resolve(null);
  return _tj(_metaUrl(p.kind, p.id)).then(function (j) {
    var meta = j && j.meta;
    if (!meta) return null;
    var name = _trim(meta.name || 'Untitled');
    var year = _trim(meta.releaseInfo || '').slice(0, 4) || null;
    var imdb = meta.imdb_id || p.imdb || null;
    var genres = (meta.genres || []).filter(Boolean).slice(0, 8);
    var base = {
      id: _mediaUrl(p.kind, p.id, p.kind === 'anime' ? imdb : null),
      title: name,
      cover: meta.poster || null,
      url: url,
      description: meta.description || '',
      status: 'unknown',
      genres: genres,
      studios: [],
      type: 'movie',
      sourceId: SOURCE_ID,
      year: year,
      episodes: [],
      subCount: 0,
      dubCount: 0
    };
    if (p.kind === 'movie') {
      base.episodes = [{
        id: 'movie',
        title: name,
        number: 1,
        url: _epUrl('movie', p.id, 0, 0, imdb)
      }];
      base.subCount = 1;
      return base;
    }
    var videos = meta.videos || [];
    var eps = [];
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      var s = parseInt(v.season, 10) || 0;
      var e = parseInt(v.episode, 10) || 0;
      if (!e) continue;
      // anime-kitsu season 0 = absolute numbering; show S/E when a real season exists.
      var label = s > 0
        ? ('S' + _pad(s) + ' E' + _pad(e))
        : ('E' + _pad(e));
      eps.push({
        id: s + 'x' + e,
        title: label + ' - ' + (_trim(v.title) || ('Episode ' + e)),
        number: e,
        url: _epUrl(p.kind, p.id, s, e, imdb),
        date: v.released || null,
        thumbnail: v.thumbnail || null
      });
    }
    base.episodes = eps;
    base.subCount = eps.length;
    return base;
  }).catch(function () { return null; });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) {
    return (d && d.episodes) || [];
  });
}

// ── streams (Torrentio + TPB+) ─────────────────────────────────────────────
function _torrentioOptsPrefix() {
  var parts = ['sort=' + _sortKey()];
  var prov = _providersParam();
  if (prov) parts.push('providers=' + prov);
  var lim = _limitPerQuality();
  if (lim > 0) parts.push('limit=' + lim);
  return parts.join('|') + '/';
}

function _streamPath(kind, streamId, season, episode) {
  if (kind === 'movie') return 'stream/movie/' + streamId + '.json';
  return 'stream/series/' + streamId + ':' + season + ':' + episode + '.json';
}

function _fetchStreams(base, optsPrefix, kind, streamId, season, episode) {
  var url = base + '/' + optsPrefix + _streamPath(kind, streamId, season, episode);
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': base + '/'
    },
    timeoutMs: 25000
  }).then(function (r) {
    var j = null;
    try { j = JSON.parse(r.body || 'null'); } catch (e) { }
    var list = (j && j.streams) || [];
    return Array.isArray(list) ? list : [];
  }).catch(function () { return []; });
}

function _parseStream(s) {
  if (!s || !s.infoHash) return null;
  var hash = String(s.infoHash).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return null;
  var nameLines = String(s.name || '').split('\n');
  var tagQuality = _trim(nameLines[1] || '');
  var titleLines = String(s.title || '').split('\n');
  var release = _trim(titleLines[0] || '');
  var blob = String(s.title || '') + '\n' + String(s.name || '');
  var seeders = 0;
  var sm = blob.match(/👤\s*([\d.]+[kKmM]?)/) || blob.match(/(\d+)\s*seed/i);
  if (sm) {
    var raw = sm[1];
    if (/k$/i.test(raw)) seeders = Math.round(parseFloat(raw) * 1000);
    else if (/m$/i.test(raw)) seeders = Math.round(parseFloat(raw) * 1000000);
    else seeders = parseInt(raw, 10) || 0;
  }
  var sizeStr = ((blob.match(/💾\s*([\d.]+\s*[TGMK]B)/i) || [])[1]) || '';
  var size = _parseSizeToBytes(sizeStr);
  var pm = blob.match(/⚙️\s*([^\n🇬🇺🇸🇷🇺🇮🇹🇵🇹🇪🇸🇰🇷🇨🇳🇫🇩🇪🇯🇵🇮🇳🇧🇷🇲🇽]+)/);
  var provider = pm ? _trim(pm[1]) : '';
  var filename = (s.behaviorHints && s.behaviorHints.filename) || '';
  if (!filename) {
    for (var i = 1; i < titleLines.length; i++) {
      if (/\.(mkv|mp4|avi|m4v|mov|wmv|webm|ts|m2ts|mpg|mpeg)$/i.test(titleLines[i])) {
        filename = _basename(titleLines[i]);
        break;
      }
    }
  }
  var q = _quality(tagQuality) || _quality(filename) || _quality(release) || null;
  var tagBlob = (release + ' ' + filename + ' ' + blob).toLowerCase();
  return {
    hash: hash,
    magnet: _buildMagnet(hash, filename || release),
    title: release || filename || hash,
    filename: filename,
    size: size,
    seeders: seeders,
    quality: q,
    provider: provider,
    pack: _isPack(release),
    audioKind: _detectAudioKind(tagBlob)
  };
}

function _filterAndSort(streams, kind) {
  var allowed = _allowedQualities();
  var minS = _minSeeders();
  var capGb = _sizeCapGb(kind);
  var excludePacks = _excludePacks();
  var out = [];
  var seen = {};
  for (var i = 0; i < streams.length; i++) {
    var c = _parseStream(streams[i]);
    if (!c || seen[c.hash]) continue;
    seen[c.hash] = 1;
    if (minS > 0 && c.seeders < minS) continue;
    if (capGb > 0 && c.size > capGb * 1073741824) continue;
    if (excludePacks && c.pack) continue;
    if (allowed && (!c.quality || allowed.indexOf(c.quality.toLowerCase().replace(/[^0-9a-z]/g, '')) < 0)) continue;
    out.push(c);
  }
  // Packs sink below single releases so episode playback picks the right file.
  var sort = _sortKey();
  out.sort(function (a, b) {
    if (a.pack !== b.pack) return a.pack ? 1 : -1;
    var aq = _resRank(a.quality), bq = _resRank(b.quality);
    if (sort === 'seeders') {
      if (b.seeders !== a.seeders) return b.seeders - a.seeders;
      return bq - aq;
    }
    if (sort === 'size') {
      if ((b.size || 0) !== (a.size || 0)) return (b.size || 0) - (a.size || 0);
      return bq - aq;
    }
    // qualityseed / qualitysize
    if (bq !== aq) return bq - aq;
    if (sort === 'qualitysize') return (b.size || 0) - (a.size || 0);
    return (b.seeders || 0) - (a.seeders || 0);
  });
  // Per-quality limit, preserving order.
  var lim = _limitPerQuality();
  if (lim > 0) {
    var counts = {};
    var kept = [];
    for (var j = 0; j < out.length; j++) {
      var qk = out[j].quality || 'unknown';
      counts[qk] = (counts[qk] || 0) + 1;
      if (counts[qk] <= lim) kept.push(out[j]);
    }
    out = kept;
  }
  return out.slice(0, _maxResults());
}

function _sourceFrom(c) {
  var q = c.quality || 'auto';
  var rel = c.filename || c.title || c.hash;
  if (rel.length > 64) rel = rel.slice(0, 61) + '...';
  var label = (q !== 'auto' ? q + ' · ' : '') + rel;
  var size = _sizeLabel(c.size);
  if (size) label += ' · ' + size;
  if (c.seeders > 0) label += ' · 👤' + c.seeders;
  if (c.provider) label += ' · ' + c.provider;
  if (c.pack) label += ' · Pack';
  var kind = c.audioKind || 'raw';
  if (kind === 'dub' && !/\bdub\b|\bdual/i.test(label)) label += ' · Dub';
  return {
    url: c.magnet,
    quality: q,
    label: '🧲 ' + label,
    container: 'torrent',
    kind: kind,
    audioLang: kind === 'dub' ? 'en' : (kind === 'sub' ? 'ja' : '')
  };
}

function getVideoSources(episodeUrl, fast) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.resolve([]);
  var isMovie = p.kind === 'movie';
  var season = isMovie ? 0 : (p.season || 0);
  var episode = isMovie ? 0 : (p.episode || 0);
  var streamId = p.imdb || null;
  if (!streamId && p.kind === 'anime') {
    // Fallback: kitsu id (Torrentio accepts kitsu: ids on movie/series endpoints).
    streamId = /^kitsu:/i.test(p.id) ? p.id : ('kitsu:' + p.id);
  }
  if (!streamId) return Promise.resolve([]);

  var apis = _mainApis();
  var jobs = [];
  if (apis !== 'tpbplus') {
    jobs.push(_fetchStreams(_torrentioBase(), _torrentioOptsPrefix(), isMovie ? 'movie' : 'series', streamId, season, episode));
  }
  if (apis !== 'torrentio') {
    jobs.push(_fetchStreams(_TPBPLUS, '', isMovie ? 'movie' : 'series', streamId, season, episode));
  }
  return Promise.all(jobs).then(function (all) {
    var merged = [];
    for (var i = 0; i < all.length; i++) merged = merged.concat(all[i]);
    var cands = _filterAndSort(merged, isMovie ? 'movie' : 'tv');
    return cands.map(_sourceFrom);
  }).catch(function () { return []; });
}
