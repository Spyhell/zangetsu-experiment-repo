// AnimeHeaven — anime source for the Zangetsu provider repo (animeheaven.me).
//
// Chain (all server-side, no JS needed):
//   fastsearch.php?xhr=1&s=<q>  -> quick-search HTML snippets (/anime.php?<code>)
//   /anime.php?<code>           -> info (infotitle/infodes/posterimg/infoyear)
//                               + episode list (id="<32hex>" gatea() blocks)
//   /gate.php  (Cookie: key=<episode-hash>) -> watch page with direct MP4s:
//                               <source src='https://<co|ct|ck>.animeheaven.me/video.mp4?<hash>&<token>'
//
// The site is sub-only (hardsubbed MP4s on their own CDN). No dub section
// exists, so every stream is kind:'sub' and getHome('dub') returns [].
// The gate.php token rotates per hit, so getVideoSources always resolves a
// fresh token at playback time. MP4s range-fetch fine with a plain UA.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animeheaven';

var SITE = 'https://animeheaven.me';
// Poster images: image.php on the main host 302-redirects to the cx CDN.
// Hand the app the final CDN URL directly so posters load even if the image
// loader does not follow redirects (and one round-trip is saved).
var IMG = 'https://cx.animeheaven.me';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeHeaven', lang: 'en', baseUrl: SITE,
    logo: SITE + '/ah_logo.png', type: 'anime', version: '1.0.2' };
}

// ── Timeout guard (copied pattern from animesuge.js) ─────────────────────────
// Race a promise against a timer so a hanging host can never stall a call
// forever. If the runtime has no timers, returns the promise unchanged.
function _raceTimeout(promise, ms, expired) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) {
    t = setTimeout(function () { resolve(expired); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}

function _get(url, headers, ms) {
  var p = fetch(url, { headers: headers || { 'User-Agent': UA } })
    .then(function (r) {
      if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?') + ' ' + url);
      return String((r && r.body) || '');
    });
  p.catch(function () {}); // late failures after a timeout must stay silent
  return _raceTimeout(p, ms || 20000, '').then(function (body) {
    if (!body) throw new Error('empty/timeout ' + url);
    return body;
  });
}

// ── tiny HTML entity decoder (the injected htmlText does not decode) ─────────
function _decodeEntities(s) {
  var t = String(s || '');
  t = t.replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
  t = t.replace(/&#x([0-9a-fA-F]+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 16)); });
  var map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&apos;': "'" };
  return t.replace(/&(amp|lt|gt|quot|apos|#0?39);/g, function (m) { return map[m] || m; });
}

function _clean(s) {
  return _decodeEntities(htmlText(s || '')).replace(/\s+/g, ' ').trim();
}

function _animeItem(code, title, coverHref) {
  var cover = null; if (coverHref) { var c = String(coverHref); var m = c.match(/image\.php\?([a-z0-9]+)/i); cover = m ? IMG + '/image.php?' + m[1] : absUrl(c, SITE); }
  return { id: 'animeheaven://anime/' + code, title: _clean(title),
    url: 'animeheaven://anime/' + code, type: 'anime', cover: cover };
}

// ── search ───────────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/fastsearch.php?xhr=1&s=' + encodeURIComponent(q);
  return _get(url, { 'User-Agent': UA, 'Referer': SITE + '/' }).then(function (html) {
    var out = [], seen = {};
    // <a class='ac' href='/anime.php?<code>'>...<img ... src='...' alt='...'>...
    // <div class='fastname'>Title</div></a>
    var re = /<a class='ac' href='([^']*?anime\.php\?([a-z0-9]+))'>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
      var code = m[2];
      if (seen[code]) continue; seen[code] = 1;
      var block = m[3];
      var im = block.match(/<img[^>]*src='([^']+)'[^>]*alt='([^']*)'/);
      var nm = block.match(/<div class='fastname'>([^<]*)<\/div>/);
      var title = nm ? nm[1] : (im ? im[2] : '');
      out.push(_animeItem(code, title, im ? im[1] : null));
    }
    return out;
  });
}

// ── home (sub schedule; the site has no dub section) ─────────────────────────
function _chartItems(html) {
  var items = [], seen = {}, m;
  // <div class='chartimg'><a href='anime.php?<code>'><img class='coverimg'
  //   src='image.php?<code>' alt='Title' ...>
  var re = /<div class='chartimg'><a href='anime\.php\?([a-z0-9]+)'><img class='coverimg'\s+src='([^']+)' alt='([^']*)'/g;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[1]]) continue; seen[m[1]] = 1;
    items.push(_animeItem(m[1], m[3], m[2]));
  }
  return items;
}

function getHome(opts) {
  var cat = (opts && opts.category) || 'sub';
  if (cat === 'dub') return Promise.resolve([]);
  var hdrs = { 'User-Agent': UA };
  function row(path, title) {
    return _get(SITE + path, hdrs).then(function (html) {
      return { title: title, items: _chartItems(html) };
    }, function () { return { title: title, items: [] }; });
  }
  return Promise.all([
    row('/', 'Recently Updated (Sub)'),
    row('/new.php', 'New Series'),
    row('/popular.php', 'Popular')
  ]).then(function (rows) {
    // Drop rows that came back empty, but never return zero rows when the
    // homepage itself parsed fine.
    var out = [], i;
    for (i = 0; i < rows.length; i++) if (rows[i].items.length) out.push(rows[i]);
    return out.length ? out : rows.slice(0, 1);
  });
}

// ── anime page fetch shared by getDetail/getEpisodes ─────────────────────────
function _animePage(url) {
  var code = String(url || '').split('/anime/')[1] || '';
  if (!code) return Promise.reject(new Error('bad anime url ' + url));
  return _get(SITE + '/anime.php?' + encodeURIComponent(code),
    { 'User-Agent': UA, 'Referer': SITE + '/' }).then(function (html) {
    return { code: code, html: html };
  });
}

function getDetail(url, opts) {
  return _animePage(url).then(function (r) {
    var html = r.html;
    var t = html.match(/<div class='infotitle c'>([^<]*)<\/div>/);
    var d = html.match(/<div class='infodes c'>([\s\S]*?)<\/div>/);
    var c = html.match(/<img class='posterimg' src='([^']+)'/);
    var y = html.match(/Year:\s*<div class='inline c2'>([^<]*)<\/div>/);
    var year = null;
    if (y) { var ym = y[1].match(/(\d{4})/); if (ym) year = ym[1]; }
    var title = t ? _clean(t[1]) : r.code;
    return { id: 'animeheaven://anime/' + r.code, title: title,
      url: 'animeheaven://anime/' + r.code, type: 'anime',
      cover: (function(){ var cm = c ? String(c[1]).match(/image\.php\?([a-z0-9]+)/i) : null; return cm ? IMG + '/image.php?' + cm[1] : (c ? absUrl(c[1], SITE) : null); })(),
      description: d ? _clean(d[1]) : null, year: year };
  });
}

function getEpisodes(url, opts) {
  return _animePage(url).then(function (r) {
    var html = r.html, out = [];
    // id ="<32hex>" onclick='gatea( "<32hex>" )' ... <div class=' watch2 bc '>NN</div>
    var re = /id\s*=\s*"([0-9a-f]{32})"\s+onclick='gatea\(\s*"[0-9a-f]{32}"\)[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
      var hash = m[1];
      var nm = m[2].match(/watch2[^>]*>\s*(\d+)\s*</);
      if (!nm) continue;
      var n = parseInt(nm[1], 10);
      out.push({ id: 'animeheaven://ep/' + hash, title: 'Episode ' + n,
        url: 'animeheaven://ep/' + hash, number: n });
    }
    // Site lists newest-first; present oldest-first.
    out.sort(function (a, b) { return a.number - b.number; });
    return out;
  });
}

// Probe one mp4 candidate with a tiny range request. Resolves 'live' / 'dead' /
// 'unknown' (timeout or network error) — never rejects, and never runs in
// parallel with another probe: this CDN streams the entire 100MB+ file when
// it gets concurrent range requests, so probes MUST be sequential.
function _probeMp4(url, headers) {
  var h = { 'User-Agent': UA, 'Range': 'bytes=0-1' };
  var k;
  for (k in (headers || {})) h[k] = headers[k];
  var settled = false;
  var p = fetch(url, { headers: h }).then(function (r) {
    settled = true;
    if (!r) return 'unknown';
    return (r.status === 200 || r.status === 206) ? 'live' : 'dead';
  }, function () { settled = true; return 'unknown'; });
  return _raceTimeout(p, 8000, 'unknown').then(function (v) {
    return settled ? v : 'unknown';
  });
}

// Sequentially probe candidates, keeping the ones that serve bytes.
function _probeAll(cands, headers) {
  var states = [];
  function next(i) {
    if (i >= cands.length) return Promise.resolve(states);
    return _probeMp4(cands[i], headers).then(function (st) {
      states.push(st);
      return next(i + 1);
    });
  }
  return next(0);
}

// ── streams: gate.php with the episode key cookie -> direct MP4 mirrors ──────
function getVideoSources(episodeUrl) {
  var hash = String(episodeUrl || '').split('/ep/')[1] || '';
  if (!/^[0-9a-f]{32}$/.test(hash)) return Promise.reject(new Error('bad episode url'));
  var baseHdrs = { 'User-Agent': UA, 'Referer': SITE + '/' };
  function gateOnce() {
    return _get(SITE + '/gate.php',
      { 'User-Agent': UA, 'Referer': SITE + '/', 'Cookie': 'key=' + hash });
  }
  // gate.php occasionally hangs (site-side blip); one retry before giving up.
  return gateOnce().then(function (html) { return html; }, function () {
    return gateOnce();
  }).then(function (html) {
    var re = /<source src='(https?:\/\/[^']*video\.mp4[^']*)'/g, m;
    var byHost = {}, order = [];
    while ((m = re.exec(html)) !== null) {
      var src = m[1].replace(/&(error2?|d)$/, ''); // drop fallback/download suffixes
      var host = (src.match(/^https?:\/\/([^/]+)/) || [])[1] || src;
      if (!byHost[host]) { byHost[host] = src; order.push(host); }
    }
    var cands = [];
    for (var i = 0; i < order.length; i++) cands.push(byHost[order[i]]);
    if (!cands.length) throw new Error('no video sources in gate.php');
    // The page ships fallback mirrors that 404 with this token; keep only
    // the ones that actually serve bytes. Probes run sequentially (the CDN
    // misbehaves on parallel range requests). If every probe is inconclusive
    // ('unknown'), return the candidates unfiltered rather than an empty
    // list; if all are definitively dead, report it.
    return _probeAll(cands, baseHdrs).then(function (states) {
      var live = [], unknown = false, i;
      for (i = 0; i < cands.length; i++) {
        if (states[i] === 'live') live.push(cands[i]);
        else if (states[i] === 'unknown') unknown = true;
      }
      if (!live.length && unknown) live = cands;
      if (!live.length) throw new Error('no playable mirrors for this episode');
      var out = [];
      for (var n = 0; n < live.length; n++) {
        out.push({ url: live[n], quality: 'auto',
          label: 'AnimeHeaven' + (live.length > 1 ? ' [mirror ' + (n + 1) + ']' : ''),
          container: 'mp4', headers: baseHdrs, subtitles: [], kind: 'sub' });
      }
      return out;
    });
  });
}
