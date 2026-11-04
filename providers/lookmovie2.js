// LookMovie2 — movies + TV shows (lookmovie2.to).
//
// Chain (all plain GET, no login):
//   /movies/search/?q= , /shows/search/?q=  -> card HTML (movie-item-style-2)
//   /movies/view/<slug> | /shows/view/<slug> -> og meta + /movies|shows/play/<id>-<slug>
//   play page -> window.movie_storage {id_movie, hash, expires}
//             | window.show_storage {hash, expires} + window.seasons JSON
//   GET /api/v1/security/movie-access?id_movie=&hash=&expires=
//   GET /api/v1/security/episode-access?id_episode=&hash=&expires=
//       -> {streams: {360p/480p/720p/1080p | 480/720/1080}, subtitles: [{language, file}]}
//
// Stream URLs are AES-signed per client IP: byte-verification from a datacenter
// VM fails (rotating egress IP -> "WRONG HASH"), but the chain is fully
// server-side resolvable and the URLs resolve on real devices (phone verdict
// needed, same class as aniworld's vmeas.cloud). The provider hands the app
// the fresh signed HLS URLs + subtitle tracks.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'lookmovie2';

var SITE = 'https://www.lookmovie2.to';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'LookMovie2', lang: 'en', baseUrl: SITE,
           logo: SITE + '/favicon.ico', type: 'movie', version: '1.0.0' };
}

// ── Network ──────────────────────────────────────────────────────────────────
function _get(url, ref, timeoutMs) {
  var headers = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  var p = fetch(url, { headers: headers }).then(function (r) {
    if (!r.ok) throw new Error('LookMovie2: HTTP ' + r.status + ' ' + url);
    return r.text();
  });
  if (typeof setTimeout === 'function' && Promise && Promise.race) {
    var to = new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('LookMovie2: timed out ' + url)); },
                 timeoutMs || 25000);
    });
    return Promise.race([p, to]);
  }
  return p;
}

function _abs(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/') return SITE + u;
  return SITE + '/' + u;
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _dec(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ── Cards ────────────────────────────────────────────────────────────────────
function _parseCards(html, kind) {
  var items = [], seen = {};
  var re = /<div class="movie-item-style-2[\s\S]*?<a href="(\/(?:movies|shows)\/view\/[a-z0-9-]+)"[\s\S]*?<img class="lozad"[^>]*data-src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<p class="year">([^<]*)<\/p>[\s\S]*?<h6>\s*<a[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    if (seen[href]) continue;
    seen[href] = 1;
    var isShow = href.indexOf('/shows/') === 0;
    var title = _trim(_dec(m[5]).replace(/<[^>]+>/g, ' '));
    items.push({
      id: 'lookmovie2:' + href,
      title: title || _trim(_dec(m[3])) || href,
      url: SITE + href,
      type: 'movie',
      cover: _abs(m[2]),
      year: _trim(m[4]) || null,
      dubBadge: isShow ? 'SUB DUB' : undefined
    });
    if (items.length >= 40) break;
  }
  return items;
}

function search(query, page, opts) {
  var q = encodeURIComponent(String(query || '').trim());
  if (!q) return Promise.resolve([]);
  return Promise.all([
    _get(SITE + '/movies/search/?q=' + q).catch(function () { return ''; }),
    _get(SITE + '/shows/search/?q=' + q).catch(function () { return ''; })
  ]).then(function (pages) {
    return _parseCards(pages[0], 'movie').concat(_parseCards(pages[1], 'show'));
  });
}

function getHome(opts) {
  return Promise.all([
    _get(SITE + '/movies/').catch(function () { return ''; }),
    _get(SITE + '/shows/').catch(function () { return ''; })
  ]).then(function (pages) {
    var rows = [];
    var movies = _parseCards(pages[0], 'movie');
    var shows = _parseCards(pages[1], 'show');
    if (movies.length) rows.push({ title: 'Latest Movies', items: movies.slice(0, 20) });
    if (shows.length) rows.push({ title: 'Latest TV Shows', items: shows.slice(0, 20) });
    return rows;
  });
}

// ── Detail / episodes ────────────────────────────────────────────────────────
function _og(html, prop) {
  var m = new RegExp('<meta[^>]+property="og:' + prop + '"[^>]+content="([^"]*)"', 'i').exec(html) ||
          new RegExp('<meta[^>]+content="([^"]*)"[^>]+property="og:' + prop + '"', 'i').exec(html);
  return m ? _dec(m[1]) : null;
}

function _cleanTitle(t) {
  t = _trim(String(t || ''));
  t = t.replace(/^Watch\s+(show\s+)?/i, '')
       .replace(/\s*-\s*Free Movies.*$/i, '')
       .replace(/\s*on lookmovie2.*$/i, '');
  return _trim(t);
}

function _playLink(html, kind) {
  var re = kind === 'show'
    ? /href="(\/shows\/play\/[a-z0-9-]+)"/i
    : /href="(\/movies\/play\/[a-z0-9-]+)"/i;
  var m = re.exec(html);
  return m ? SITE + m[1] : null;
}

function _storage(html, key) {
  var re = new RegExp("window\\['" + key + "'\\]\\s*=\\s*\\{([\\s\\S]*?)\\};", 'i');
  var m = re.exec(html);
  if (!m) return null;
  var body = m[1];
  function str(k) {
    var mm = new RegExp(k + "\\s*:\\s*['\"]([^'\"]+)['\"]").exec(body);
    return mm ? mm[1] : null;
  }
  function num(k) {
    var mm = new RegExp(k + "\\s*:\\s*([0-9]+)").exec(body);
    return mm ? parseInt(mm[1], 10) : null;
  }
  return { id_movie: num('id_movie'), hash: str('hash'), expires: num('expires') };
}

function _seasons(html) {
  // The page embeds window.seasons='{\"1\":{...}}' — a PHP-escaped JSON string
  // inside a single-quoted JS string.
  var m = /window\.seasons='((?:\\.|[^'\\])*)';/.exec(html);
  if (!m) return null;
  var raw = m[1].replace(/\\"/g, '"').replace(/\\'/g, "'")
                 .replace(/\\\//g, '/').replace(/\\\\/g, '\\');
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function _showEpisodes(playUrl, html) {
  var seasons = _seasons(html);
  if (!seasons) throw new Error('LookMovie2: no episode data');
  var st = _storage(html, 'show_storage');
  var thumb = st ? _abs(st.backdrop_medium) : null;
  var eps = [];
  var sk = Object.keys(seasons);
  for (var si = 0; si < sk.length; si++) {
    var se = seasons[sk[si]] || {};
    var list = se.episodes || se.episods || {};
    var ek = Object.keys(list);
    for (var ei = 0; ei < ek.length; ei++) {
      var ep = list[ek[ei]] || {};
      var num = parseInt(ep.episode_number, 10);
      if (isNaN(num)) num = ei + 1;
      eps.push({
        id: 'lookmovie2://ep/' + ep.id_episode,
        title: 'S' + (si + 1) + ' E' + num + (ep.title ? ' - ' + _trim(ep.title) : ''),
        url: playUrl + '?idep=' + ep.id_episode + '&sn=' + (si + 1) + '&en=' + num,
        number: num,
        thumbnail: thumb
      });
    }
  }
  return eps;
}

function _detailFrom(viewUrl, html) {
  var isShow = viewUrl.indexOf('/shows/') !== -1;
  var kind = isShow ? 'show' : 'movie';
  var title = _cleanTitle(_og(html, 'title')) || 'Unknown';
  var playUrl = _playLink(html, kind);
  if (!playUrl) throw new Error('LookMovie2: no play page found');
  var cover = _abs(_og(html, 'image'));
  var base = { id: 'lookmovie2:' + viewUrl.replace(SITE, ''), title: title,
               url: viewUrl, type: 'movie', cover: cover,
               description: _og(html, 'description') || undefined };
  if (!isShow) {
    base.episodes = [{ id: 'lookmovie2://movie', title: 'Watch', url: playUrl, number: 1 }];
    return Promise.resolve(base);
  }
  return _get(playUrl, viewUrl).then(function (ph) {
    base.episodes = _showEpisodes(playUrl, ph);
    return base;
  });
}

function getDetail(url, opts) {
  url = String(url || '');
  if (url.indexOf('http') !== 0) url = SITE + (url.charAt(0) === '/' ? url : '/' + url);
  return _get(url).then(function (html) { return _detailFrom(url, html); });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Video sources ───────────────────────────────────────────────────────────
var LANG2 = { english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
  portuguese: 'pt', russian: 'ru', arabic: 'ar', hindi: 'hi', turkish: 'tr',
  polish: 'pl', dutch: 'nl', japanese: 'ja', korean: 'ko', chinese: 'zh' };

function _subs(list) {
  var out = [], seen = {}, i;
  for (i = 0; i < (list || []).length; i++) {
    var s = list[i] || {};
    if (!s.file) continue;
    var lang = String(s.language || '').toLowerCase();
    var code = LANG2[lang] || (/^[a-z]{2,3}$/.test(lang) ? lang : 'und');
    var url = _abs(s.file);
    if (seen[url]) continue;
    seen[url] = 1;
    out.push({ url: url, lang: code, label: s.language || code });
  }
  return out;
}

function _streamSources(streams, subs, ref) {
  var out = [], keys = Object.keys(streams || {}), i;
  for (i = 0; i < keys.length; i++) {
    var u = streams[keys[i]];
    if (!u || !/^https?:\/\//i.test(u)) continue;
    var q = /1080/.test(keys[i]) ? '1080p' : /720/.test(keys[i]) ? '720p'
          : /480/.test(keys[i]) ? '480p' : /360/.test(keys[i]) ? '360p' : keys[i];
    out.push({ url: u, quality: q, label: 'LookMovie2 · ' + q, container: 'hls',
               headers: { 'Referer': ref, 'User-Agent': UA },
               subtitles: subs });
  }
  out.sort(function (a, b) {
    return parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10);
  });
  return out;
}

function getVideoSources(episodeUrl) {
  episodeUrl = String(episodeUrl || '');
  var qm = /[?&]idep=([0-9]+)/.exec(episodeUrl);
  var playUrl = episodeUrl.split('?')[0];
  var isMovie = !qm;
  return _get(playUrl, SITE + '/').then(function (html) {
    var api, st;
    if (isMovie) {
      st = _storage(html, 'movie_storage');
      if (!st || !st.id_movie || !st.hash) throw new Error('LookMovie2: no movie token');
      api = SITE + '/api/v1/security/movie-access?id_movie=' + st.id_movie +
            '&hash=' + encodeURIComponent(st.hash) + '&expires=' + st.expires;
    } else {
      st = _storage(html, 'show_storage');
      if (!st || !st.hash) throw new Error('LookMovie2: no show token');
      api = SITE + '/api/v1/security/episode-access?id_episode=' + qm[1] +
            '&hash=' + encodeURIComponent(st.hash) + '&expires=' + st.expires;
    }
    return fetch(api, { headers: { 'User-Agent': UA, 'Referer': playUrl } })
      .then(function (r) {
        if (!r.ok) throw new Error('LookMovie2: stream API HTTP ' + r.status);
        return r.json();
      });
  }).then(function (d) {
    if (!d || d.success !== true) throw new Error('LookMovie2: stream API failed');
    var srcs = _streamSources(d.streams, _subs(d.subtitles), playUrl);
    if (!srcs.length) throw new Error('LookMovie2: no streams returned');
    return srcs;
  });
}
