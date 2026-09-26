// Nyaa Anime — anime torrent source for the Zangetsu provider repo.
// Backend: nyaa.si public RSS (no login, no JS):
//   search: https://nyaa.si/?page=rss&q=<q>&c=1_2&f=0
//   home:   https://nyaa.si/?page=rss&c=1_2
// Each <item> carries <link> (direct .torrent), <nyaa:infoHash>,
// <nyaa:seeders>, <nyaa:size>, <nyaa:category>.
// One release = one catalog item; getVideoSources hands the app a magnet
// built from the infoHash + public trackers (same playback path as
// ToraStream, which the user confirmed working). Releases under 5 seeders
// are hidden and results sort by seeders, per the ToraStream rule.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'nyaa';

var SITE = 'https://nyaa.si';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var MIN_SEEDERS = 5;

// Public trackers appended to every magnet so the torrent engine finds
// peers quickly instead of relying on DHT alone.
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

function getInfo() {
  return { name: 'Nyaa Anime', lang: 'en', baseUrl: SITE,
    logo: SITE + '/static/favicon.png', type: 'anime', version: '1.0.0' };
}

function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.body || '';
  });
}

function _unesc(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
}

function _tag(block, name) {
  var m = block.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
  return m ? _unesc(m[1]).trim() : '';
}

// Parse one RSS <item> into a release record. Returns null when unusable.
function _parseItem(block) {
  var title = _tag(block, 'title');
  var link = _tag(block, 'link');
  var hash = _tag(block, 'nyaa:infoHash');
  if (!title || !hash) return null;
  var idm = link.match(/\/download\/(\d+)\.torrent/);
  var seeders = parseInt(_tag(block, 'nyaa:seeders') || '0', 10) || 0;
  return {
    id: idm ? idm[1] : hash.slice(0, 12),
    title: title,
    hash: hash.toLowerCase(),
    seeders: seeders,
    size: _tag(block, 'nyaa:size'),
    category: _tag(block, 'nyaa:category'),
    torrentUrl: link || null
  };
}

function _parseRss(xml) {
  var out = [], chunks = String(xml || '').split('<item>');
  for (var i = 1; i < chunks.length; i++) {
    var block = chunks[i].split('</item>')[0];
    var r = _parseItem(block);
    if (r) out.push(r);
  }
  return out;
}

// Hide dead torrents (the ToraStream rule), most-shared first.
function _filterSort(releases) {
  var out = [];
  for (var i = 0; i < releases.length; i++) {
    if (releases[i].seeders >= MIN_SEEDERS) out.push(releases[i]);
  }
  out.sort(function (a, b) { return b.seeders - a.seeders; });
  return out;
}

function _quality(title) {
  var m = String(title || '').match(/\b(4320|2160|1080|720|480|360)p\b/i);
  if (m) return m[1] + 'p';
  if (/\b(4k|uhd)\b/i.test(title || '')) return '2160p';
  return null;
}

function _audioKind(title) {
  var t = String(title || '').toLowerCase();
  if (/\bdual[\s_-]?audio\b|\bdub\b/.test(t)) return 'dub';
  return 'sub';
}

function _releaseUrl(r) {
  return 'nyaa://release/' + r.id + '?h=' + r.hash
    + '&s=' + r.seeders + '&t=' + encodeURIComponent(r.title);
}

function _itemOf(r) {
  return { id: 'nyaa:' + r.id, title: r.title, url: _releaseUrl(r),
    cover: null, type: 'anime', sourceId: SOURCE_ID };
}

function _parseReleaseUrl(url) {
  var m = String(url || '').match(/^nyaa:\/\/release\/([^?]+)\?(.*)$/);
  if (!m) return null;
  var q = {}, parts = m[2].split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    q[kv[0]] = kv[1] || '';
  }
  var title = '';
  try { title = decodeURIComponent(q.t || ''); } catch (e) { title = q.t || ''; }
  return { id: m[1], hash: q.h || '', seeders: parseInt(q.s || '0', 10) || 0,
    title: title };
}

function _magnet(hash, name) {
  var u = 'magnet:?xt=urn:btih:' + hash;
  if (name) u += '&dn=' + encodeURIComponent(String(name).slice(0, 200));
  for (var i = 0; i < _TRACKERS.length; i++) {
    u += '&tr=' + encodeURIComponent(_TRACKERS[i]);
  }
  return u;
}

// ── Search ──────────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/?page=rss&q=' + encodeURIComponent(q) + '&c=1_2&f=0';
  return _get(url).then(function (xml) {
    var items = _filterSort(_parseRss(xml));
    var out = [];
    for (var i = 0; i < items.length; i++) out.push(_itemOf(items[i]));
    return out;
  }).catch(function () { return []; });
}

// ── Home ────────────────────────────────────────────────────────────────────
function getHome(opts) {
  var url = SITE + '/?page=rss&c=1_2';
  return _get(url).then(function (xml) {
    var items = _filterSort(_parseRss(xml));
    var cards = [];
    for (var i = 0; i < items.length; i++) cards.push(_itemOf(items[i]));
    if (!cards.length) return [];
    return [{ title: 'Latest Anime Torrents', items: cards }];
  }).catch(function () { return []; });
}

// ── Detail + episodes ───────────────────────────────────────────────────────
function getDetail(url, opts) {
  var ref = _parseReleaseUrl(url);
  var base = { id: null, title: '', url: url, cover: null, description: '',
    status: 'unknown', genres: [], studios: [], type: 'anime',
    sourceId: SOURCE_ID, episodes: [], year: null, malId: null,
    subCount: 0, dubCount: 0 };
  if (!ref) return Promise.resolve(base);
  var kind = _audioKind(ref.title);
  base.id = 'nyaa:' + ref.id;
  base.title = ref.title;
  base.description = 'Nyaa.si torrent release · ' + ref.seeders + ' seeders';
  base.episodes = [{
    id: 'nyaa:ep:' + ref.id,
    number: 1,
    title: ref.title,
    url: 'nyaa://stream/' + ref.hash + '?i=' + ref.id
      + '&t=' + encodeURIComponent(ref.title)
  }];
  base.subCount = kind === 'sub' ? 1 : 0;
  base.dubCount = kind === 'dub' ? 1 : 0;
  return Promise.resolve(base);
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// ── Streams ─────────────────────────────────────────────────────────────────
// Returns the magnet FIRST (proven playback path — same shape as ToraStream,
// which the user confirmed working) and the direct .torrent HTTPS URL second
// (verified to serve real application/x-bittorrent data from nyaa.si).
function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^nyaa:\/\/stream\/([a-fA-F0-9]{40})\?(.*)$/);
  if (!m) return Promise.reject(new Error('Nyaa: bad episode url'));
  var q = {}, parts = m[2].split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    q[kv[0]] = kv[1] || '';
  }
  var title = '';
  try { title = decodeURIComponent(q.t || ''); } catch (e) { title = q.t || ''; }
  var hash = m[1].toLowerCase();
  var tq = _quality(title);
  var kind = _audioKind(title);
  var baseLabel = 'Nyaa' + (tq ? ' · ' + tq : '');
  var out = [{
    url: _magnet(hash, title || hash),
    quality: tq || undefined,
    label: '🧲 ' + baseLabel,
    container: 'torrent',
    kind: kind,
    audioLang: kind === 'dub' ? 'en' : 'ja'
  }];
  if (/^\d+$/.test(q.i || '')) {
    out.push({
      url: SITE + '/download/' + q.i + '.torrent',
      quality: tq || undefined,
      label: '📄 ' + baseLabel + ' · .torrent',
      container: 'torrent',
      kind: kind,
      audioLang: kind === 'dub' ? 'en' : 'ja'
    });
  }
  return Promise.resolve(out);
}
