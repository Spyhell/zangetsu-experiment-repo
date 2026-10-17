/*
 * Zangetsu source — Anv (anv.to)
 * Anime with SUB and DUB variants, direct HLS via the site's own API.
 *
 * Site model (verified live 2026-10-17):
 * - Metadata comes from a GraphQL-style proxy: POST /api/catalog
 *   {operation, variables} -> {data}. Operations: HomeAnime (hero/trending
 *   rows), SearchAnime {search, page, perPage}, AnimeDetail {slug}.
 *   Media objects are AniList-shaped: id = 1000000000 + anilistId, slug,
 *   title{english, romaji}, coverImage{extraLarge}, episodes, idMal,
 *   nextAiringEpisode. /api/recent-episodes (GET) gives latest releases.
 * - Playback: POST /api/episode {anilistId, malId, episode, first:true}
 *   -> {status:'ready', variants:[{id:'sub'|'dub', sources:[{label, url,
 *   tracks}]}]}. Stream URLs are relative /stream/<token>/index.m3u8?k=...
 * - EVERYTHING under /api/episode and /stream/ is gated by the `shiro_watch`
 *   cookie, which anv.to sets (HttpOnly) on WATCH page loads only
 *   (GET /anime/<slug>-episode-<n>). The source warms a session by fetching
 *   the episode's own watch page and capturing Set-Cookie (guarded: not
 *   every runtime exposes response headers), then sends the cookie on the
 *   episode API, playlist expansions, and every stream entry.
 * - Server caveat (byte-verified): servers "Pear" and "Banana" serve CLEAN
 *   MPEG-TS segments; server "Orange" prefixes every segment with a fake
 *   PNG header that ffmpeg/mpv probing rejects (detects png_pipe). Orange
 *   is therefore skipped whenever a clean server exists for the episode.
 * - Signed /stream/ URLs expire — always resolved fresh at runtime.
 */

var _ANV = 'https://anv.to';
var _ANV_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/* ---------------------------------- session -------------------------------- */

var _anvCookie = '';      /* "shiro_watch=<value>" once captured */
var _anvCookieAt = 0;

function _nowMs() {
  try { return Date.now(); } catch (e) { return 0; }
}

function _captureCookie(setCookie) {
  if (!setCookie) return;
  var m = /(?:^|[,;]\s*)shiro_watch=([^;,\s]+)/.exec(String(setCookie));
  if (m) {
    _anvCookie = 'shiro_watch=' + m[1];
    _anvCookieAt = _nowMs();
  }
}

/* --------------------------------- fetching -------------------------------- */

function _raceTimeout(promise, ms, fallback) {
  var hasTimers = typeof setTimeout === 'function' && typeof clearTimeout === 'function';
  if (!hasTimers) return promise;
  return Promise.race([
    promise,
    new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); })
  ]);
}

/* Fetch that returns body text + the raw Set-Cookie header (when the runtime
 * exposes response headers). Always sends the session cookie once captured
 * and captures a fresh one from any response that sets it. */
function _fetchFull(url, opts) {
  opts = opts || {};
  var h = { 'User-Agent': _ANV_UA, 'Accept-Language': 'en-US,en;q=0.9' };
  if (_anvCookie) h['Cookie'] = _anvCookie;
  if (opts.headers) { for (var k in opts.headers) h[k] = opts.headers[k]; }
  var init = { headers: h };
  if (opts.method) init.method = opts.method;
  if (opts.body) init.body = opts.body;
  return _raceTimeout(fetch(url, init).then(function (r) {
    if (!r) throw new Error('Anv: empty response for ' + url);
    var setCookie = '';
    try {
      if (r.headers) {
        if (typeof r.headers.getSetCookie === 'function') {
          var arr = r.headers.getSetCookie();
          if (arr && arr.length) setCookie = arr.join('; ');
        }
        if (!setCookie && typeof r.headers.get === 'function') setCookie = r.headers.get('set-cookie') || '';
        else if (!setCookie && r.headers['set-cookie']) setCookie = String(r.headers['set-cookie']);
      }
    } catch (e) {}
    _captureCookie(setCookie);
    return r.text().then(function (t) {
      return { ok: !!r.ok, status: r.status, body: t };
    });
  }), 20000, null).then(function (v) {
    if (v == null) throw new Error('Anv: timeout for ' + url);
    return v;
  });
}

function _fetchText(url, headers) {
  return _fetchFull(url, { headers: headers }).then(function (res) {
    if (!res.ok) throw new Error('Anv: HTTP ' + res.status + ' for ' + url);
    return res.body;
  });
}

function _fetchJson(url, headers) {
  return _fetchText(url, headers).then(function (t) {
    try { return JSON.parse(t); }
    catch (e) { throw new Error('Anv: bad JSON from ' + url); }
  });
}

function _postJson(url, obj, headers) {
  var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (headers) { for (var k in headers) h[k] = headers[k]; }
  return _fetchFull(url, { method: 'POST', body: JSON.stringify(obj), headers: h }).then(function (res) {
    if (!res.ok) throw new Error('Anv: HTTP ' + res.status + ' for ' + url);
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error('Anv: bad JSON from ' + url); }
  });
}

/* Warm the shiro_watch session: the cookie is set on watch-page loads.
 * A warm-up younger than 45 min is reused. If the runtime hides response
 * headers the capture simply stays empty and calls proceed anyway (a
 * native cookie jar, when present, still makes them work). */
function _ensureSession(watchPath) {
  var fresh = _anvCookie && _anvCookieAt && (_nowMs() - _anvCookieAt) < 45 * 60 * 1000;
  if (fresh) return Promise.resolve();
  return _fetchFull(_ANV + (watchPath || '/'), { headers: { 'Accept': 'text/html' } })
    .then(function () {}, function () {});
}

/* --------------------------------- helpers --------------------------------- */

function _abs(u) {
  if (!u) return '';
  u = String(u);
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/') return _ANV + u;
  return _ANV + '/' + u;
}

function _decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function _stripTags(s) {
  if (typeof htmlText === 'function') return htmlText(String(s || ''));
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function _title(m) {
  var t = (m && m.title) || {};
  return _decodeEntities(t.english || t.romaji || t.native || 'Unknown');
}

function _cover(m) {
  var c = (m && m.coverImage) || {};
  return c.extraLarge || c.large || null;
}

function _item(m) {
  if (!m || !m.slug) return null;
  return {
    id: 'anv-' + m.id,
    title: _title(m),
    cover: _cover(m),
    url: 'anv://anime/' + m.slug,
    type: m.format === 'MOVIE' ? 'movie' : 'anime'
  };
}

function _items(list) {
  var out = [];
  var seen = {};
  for (var i = 0; i < (list || []).length; i++) {
    var it = _item(list[i]);
    if (it && !seen[it.url]) { seen[it.url] = true; out.push(it); }
  }
  return out;
}

/* Catalog proxy (no cookie needed, but the session rides along when warm). */
function _catalog(operation, variables) {
  return _postJson(_ANV + '/api/catalog', { operation: operation, variables: variables || {} })
    .then(function (j) {
      if (!j || !j.data) throw new Error('Anv: empty catalog response for ' + operation);
      return j.data;
    });
}

/* ------------------------------- HLS expand -------------------------------- */

/* Parse a master playlist into [{h, url}] variant entries (dedupe by
 * height, keep first), ascending by height. */
function _parseMaster(text, baseUrl) {
  if (!text || text.indexOf('#EXTM3U') < 0) return [];
  var lines = String(text).split(/\r?\n/);
  var out = [];
  var seen = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('#EXT-X-STREAM-INF') === -1) continue;
    var rm = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    var h = rm ? parseInt(rm[2], 10) : 0;
    var uri = null;
    for (var j = i + 1; j < lines.length; j++) {
      var u = String(lines[j]).replace(/^\s+|\s+$/g, '');
      if (u && u.charAt(0) !== '#') { uri = u; break; }
    }
    if (!uri || !h || seen[h]) continue;
    seen[h] = true;
    out.push({ h: h, url: _abs(uri) });
  }
  out.sort(function (a, b) { return a.h - b.h; });
  return out;
}

function _expandQualities(masterUrl, headers) {
  return _fetchText(masterUrl, headers).then(function (t) {
    return _parseMaster(t, masterUrl);
  }, function () { return []; });
}

/* ---------------------------------- API ------------------------------------ */

function getInfo() {
  return {
    name: 'Anv', id: 'anv', baseUrl: _ANV, lang: 'en',
    logo: _ANV + '/brand/blob.svg', type: 'anime', version: '1.0.0'
  };
}

function getHome() {
  var catalogP = _catalog('HomeAnime', {}).then(function (data) {
    var rows = [];
    var hero = _items((data.hero || {}).media);
    if (hero.length) rows.push({ name: 'Spotlight', items: hero });
    var trending = _items((data.trending || {}).media);
    if (trending.length) rows.push({ name: 'Trending Now', items: trending });
    return rows;
  }, function () { return []; });

  var recentP = _fetchJson(_ANV + '/api/recent-episodes').then(function (j) {
    var media = [];
    var sched = (j && j.schedules) || [];
    for (var i = 0; i < sched.length; i++) { if (sched[i] && sched[i].media) media.push(sched[i].media); }
    var items = _items(media);
    return items.length ? [{ name: 'Latest Episodes', items: items }] : [];
  }, function () { return []; });

  return Promise.all([catalogP, recentP]).then(function (parts) {
    return parts[0].concat(parts[1]);
  });
}

function search(query) {
  return _catalog('SearchAnime', { search: String(query || ''), page: 1, perPage: 24 })
    .then(function (data) {
      return _items(((data.Page || {}).media) || []);
    });
}

function _detailFromSlug(slug) {
  return _catalog('AnimeDetail', { slug: slug }).then(function (data) {
    var m = data.Media;
    if (!m) throw new Error('Anv: title not found');
    return m;
  });
}

function _releasedCount(m) {
  var n = (typeof m.episodes === 'number' && m.episodes > 0) ? m.episodes : 0;
  if (m.nextAiringEpisode && typeof m.nextAiringEpisode.episode === 'number') {
    var released = m.nextAiringEpisode.episode - 1;
    if (released >= 0 && (n === 0 || released < n)) n = released;
  }
  if (n < 1) n = (m.format === 'MOVIE') ? 1 : 0;
  return n;
}

function _episodeList(m) {
  var count = _releasedCount(m);
  var anilistId = (typeof m.id === 'number' && m.id > 1000000000) ? m.id - 1000000000 : 0;
  var eps = [];
  for (var i = 1; i <= count; i++) {
    eps.push({
      id: 'anv-ep-' + anilistId + '-' + i,
      title: 'Episode ' + i,
      url: 'anv://ep/' + m.slug + '/' + anilistId + '/' + (m.idMal || 0) + '/' + i,
      number: i
    });
  }
  return eps;
}

function getDetail(url) {
  var slug = String(url || '').replace('anv://anime/', '');
  return _detailFromSlug(slug).then(function (m) {
    var detail = {
      id: 'anv-' + m.id,
      title: _title(m),
      cover: _cover(m),
      type: m.format === 'MOVIE' ? 'movie' : 'anime',
      url: 'anv://anime/' + m.slug,
      episodes: _episodeList(m)
    };
    if (m.bannerImage) detail.banner = String(m.bannerImage);
    if (m.description) detail.description = _decodeEntities(_stripTags(m.description));
    if (m.seasonYear) detail.year = String(m.seasonYear);
    return detail;
  });
}

function getEpisodes(url) {
  var slug = String(url || '').replace('anv://anime/', '');
  return _detailFromSlug(slug).then(function (m) { return _episodeList(m); });
}

/* ------------------------------ video sources ------------------------------ */

var _LANG_CODES = { english: 'en', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', arabic: 'ar', hindi: 'hi', japanese: 'ja', italian: 'it', russian: 'ru' };

function _trackSubs(tracks) {
  var subs = [];
  for (var i = 0; i < (tracks || []).length; i++) {
    var t = tracks[i] || {};
    if (!t.src) continue;
    var label = String(t.label || t.lang || t.srclang || 'English');
    var code = _LANG_CODES[label.toLowerCase()] || (label.length === 2 ? label.toLowerCase() : 'en');
    subs.push({ url: _abs(t.src), lang: code, label: label });
  }
  return subs;
}

/* One server's entries: variants ascending, Auto (master) LAST. */
function _serverStreams(server, variant, referer, subs) {
  var masterUrl = _abs(server.url);
  var headers = { 'Referer': referer, 'User-Agent': _ANV_UA };
  if (_anvCookie) headers['Cookie'] = _anvCookie;
  var kind = variant.id === 'dub' ? 'dub' : 'sub';
  var tag = (variant.label || variant.id) + ' · ' + server.label;
  return _expandQualities(masterUrl, headers).then(function (variants) {
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      out.push({
        url: variants[i].url, quality: variants[i].h + 'p',
        label: tag + ' · ' + variants[i].h + 'p',
        container: 'hls', headers: headers,
        subtitles: subs, kind: kind
      });
    }
    out.push({
      url: masterUrl, quality: 'auto',
      label: tag + ' · Auto',
      container: 'hls', headers: headers,
      subtitles: subs, kind: kind
    });
    return out;
  });
}

function _episodeRequest(aId, malId, epNum) {
  var body = { anilistId: aId, episode: epNum, first: true };
  if (malId) body.malId = malId;
  return _postJson(_ANV + '/api/episode', body, { 'Referer': _ANV + '/' })
    .then(function (j) { return j; }, function () { return null; });
}

function getVideoSources(epUrl) {
  var parts = String(epUrl || '').replace('anv://ep/', '').split('/');
  var slug = parts[0] || '';
  var aId = parseInt(parts[1], 10) || 0;
  var malId = parseInt(parts[2], 10) || 0;
  var epNum = parseInt(parts[3], 10) || 1;
  if (!slug || !aId) return Promise.reject(new Error('Anv: bad episode reference'));
  var watchPath = '/anime/' + slug + '-episode-' + epNum;
  var referer = _ANV + watchPath;

  return _ensureSession(watchPath).then(function () {
    return _episodeRequest(aId, malId, epNum);
  }).then(function (data) {
    if (data && data.status === 'ready' && data.variants && data.variants.length) return data;
    /* One retry with a forced re-warm — the backend sometimes needs a
     * second beat, and a stale cookie should not fail the episode. */
    _anvCookie = ''; _anvCookieAt = 0;
    return _ensureSession(watchPath).then(function () {
      return _episodeRequest(aId, malId, epNum);
    }).then(function (data2) {
      if (data2 && data2.status === 'ready' && data2.variants && data2.variants.length) return data2;
      var reason = (data2 && data2.reason) || (data && data.reason) || 'unavailable';
      throw new Error('Anv: episode ' + epNum + ' ' + reason);
    });
  }).then(function (data) {
    /* Split variants into clean servers (Pear/Banana — plain TS segments)
     * and Orange (PNG-prefixed segments the app player cannot probe).
     * Orange is only used when an episode has no clean server at all. */
    var jobs = [];
    var dubs = [];
    var subsGroup = [];
    var variants = data.variants.slice();
    /* Dub group first, sub group last: the app auto-plays the last link,
     * and sub is this site's canonical default. */
    variants.sort(function (a, b) {
      var ka = a.id === 'dub' ? 0 : 1;
      var kb = b.id === 'dub' ? 0 : 1;
      return ka - kb;
    });
    for (var vi = 0; vi < variants.length; vi++) {
      (function (variant) {
        var servers = variant.sources || [];
        var clean = [];
        var orange = [];
        for (var si = 0; si < servers.length; si++) {
          if (/orange/i.test(String(servers[si].label || ''))) orange.push(servers[si]);
          else clean.push(servers[si]);
        }
        var use = clean.length ? clean : orange;
        var subs = _trackSubs(servers.length ? servers[0].tracks : []);
        for (var ui = 0; ui < use.length; ui++) {
          (function (server) {
            var p = _serverStreams(server, variant, referer, subs);
            if (variant.id === 'dub') dubs.push(p); else subsGroup.push(p);
          })(use[ui]);
        }
      })(variants[vi]);
    }
    jobs = dubs.concat(subsGroup);
    return Promise.all(jobs).then(function (groups) {
      var out = [];
      for (var gi = 0; gi < groups.length; gi++) out = out.concat(groups[gi]);
      if (!out.length) throw new Error('Anv: no playable server resolved for episode ' + epNum);
      return out;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getInfo: getInfo, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources };
}
