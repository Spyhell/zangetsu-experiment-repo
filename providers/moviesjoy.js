/* MoviesJoy (moviesjoy.pw) — free HD movies, English.
 * Chain: WP detail page -> moviesroot.online/video_embed.php?id=N
 *   -> audience.vidzstore.com player page -> direct HLS (output.m3u8, .ts).
 * Single server per title, streams validated server-side before shipping.
 * type: movie, lang: en, version 1.0.0 */
'use strict';

var _SITE = 'https://moviesjoy.pw';
var _EMBED = 'https://moviesroot.online';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return {
    name: 'MoviesJoy',
    lang: 'en',
    baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

function _withTimeout(promise, ms, label) {
  if (typeof setTimeout === 'undefined') return promise;
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () {
      if (!done) { done = true; reject(new Error('timeout: ' + label)); }
    }, ms || 15000);
    promise.then(function (v) {
      if (!done) { done = true; clearTimeout(t); resolve(v); }
    }, function (e) {
      if (!done) { done = true; clearTimeout(t); reject(e); }
    });
  });
}

function _getText(url, referer) {
  var headers = { 'User-Agent': _UA, 'Accept': 'text/html,*/*' };
  if (referer) headers.Referer = referer;
  return _withTimeout(fetch(url, { headers: headers }), 15000, 'GET ' + url)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.text();
    });
}

function _decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#038;/g, '&')
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
}

function _cleanTitle(raw) {
  var t = _decodeEntities(raw || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  return t || 'Untitled';
}

function _splitYear(title) {
  var m = /^(.*?)\s+\((\d{4})\)$/.exec(title) || /^(.*?)\s+(\d{4})$/.exec(title);
  if (m) return { title: m[1].replace(/\s+$/g, ''), year: String(m[2]) };
  return { title: title, year: null };
}

function _itemUrl(slug) { return 'moviesjoy://movie/' + slug; }
function _slugFromUrl(url) {
  var m = /^moviesjoy:\/\/movie\/([^\/\?]+)/.exec(url || '');
  return m ? m[1] : null;
}
function _watchFromUrl(url) {
  var m = /^moviesjoy:\/\/watch\/([0-9]+)/.exec(url || '');
  return m ? m[1] : null;
}

/* Parse WP article cards (home, search, genre archives). */
function _parseArticles(html) {
  var items = [];
  var seen = {};
  var re = /<article[^>]*class="[^"]*latestpost[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var block = m[1];
    var hm = /<a[^>]*href="(https?:\/\/moviesjoy\.pw\/([^"\/]+)\/)"[^>]*>/.exec(block);
    if (!hm) continue;
    var slug = hm[2];
    if (seen[slug]) continue;
    seen[slug] = true;
    var tm = /<span class="entry-title"><a[^>]*>([^<]+)<\/a><\/span>/.exec(block) ||
             /title="([^"]+)"[^>]*>\s*<div class="featured-thumbnail">/.exec(block) ||
             /rel="bookmark">([^<]+)<\/a>/.exec(block);
    var raw = tm ? tm[1] : slug.replace(/-/g, ' ');
    var sp = _splitYear(_cleanTitle(raw));
    var im = /<img[^>]*src="(https:\/\/moviesjoy\.pw\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/.exec(block);
    items.push({
      id: 'mj:' + slug,
      title: sp.title,
      url: _itemUrl(slug),
      type: 'movie',
      cover: im ? im[1] : ''
    });
  }
  return items;
}

function _homeRow(title, url) {
  return _getText(url).then(function (html) {
    var items = _parseArticles(html);
    if (!items.length) return null;
    return { title: title, items: items };
  }, function () { return null; });
}

function getHome(opts) {
  return Promise.all([
    _homeRow('Latest Movies', _SITE + '/'),
    _homeRow('2026 Movies', _SITE + '/genre/2026/'),
    _homeRow('Action Movies', _SITE + '/genre/action-movies/'),
    _homeRow('Horror Movies', _SITE + '/genre/horror-movies/')
  ]).then(function (rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) if (rows[i]) out.push(rows[i]);
    return out;
  });
}

function search(query, page, opts) {
  var p = page && page > 1 ? '&paged=' + page : '';
  var url = _SITE + '/?s=' + encodeURIComponent(query || '') + p;
  return _getText(url).then(function (html) { return _parseArticles(html); });
}

function getDetail(url, opts) {
  var slug = _slugFromUrl(url);
  if (!slug) return Promise.reject(new Error('bad detail url: ' + url));
  return _getText(_SITE + '/' + slug + '/').then(function (html) {
    var tm = /<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/.exec(html) ||
             /<meta property="og:title" content="([^"]+)"/.exec(html) ||
             /<title>([^<|]+)/.exec(html);
    var raw = tm ? tm[1].replace(/<[^>]+>/g, '') : slug.replace(/-/g, ' ');
    var sp = _splitYear(_cleanTitle(raw));
    var om = /<meta property="og:image" content="([^"]+)"/.exec(html);
    var dm = /<meta name="description" content="([^"]{20,600})"/.exec(html);
    var desc = dm ? _decodeEntities(dm[1]) : '';
    var em = /video_embed\.php\?id=([0-9]+)/.exec(html);
    var episodes = [];
    if (em) {
      episodes.push({
        id: 'mj:watch:' + em[1],
        title: sp.title + ' — Watch Now',
        url: 'moviesjoy://watch/' + em[1] + '?s=' + encodeURIComponent(slug) +
             '&t=' + encodeURIComponent(sp.title),
        number: 1
      });
    }
    return {
      id: 'mj:' + slug,
      title: sp.title,
      url: url,
      type: 'movie',
      cover: om ? om[1] : '',
      description: desc,
      year: sp.year,
      episodes: episodes
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function _absM3u8(src, base) {
  if (/^https?:\/\//i.test(src)) return src;
  if (/^\//.test(src)) return 'https://audience.vidzstore.com' + src;
  return 'https://audience.vidzstore.com/upload/' + src;
}

function getVideoSources(episodeUrl) {
  var embedId = _watchFromUrl(episodeUrl);
  if (!embedId) return Promise.reject(new Error('bad episode url: ' + episodeUrl));
  var embedPage = _EMBED + '/video_embed.php?id=' + embedId;
  return _getText(embedPage, _SITE + '/').then(function (embHtml) {
    var pm = /https:\/\/audience\.vidzstore\.com\/video_m3u8\.php\?dmdl=007&amp;id=([A-Za-z0-9+\/=%]+)/.exec(embHtml) ||
             /https:\/\/audience\.vidzstore\.com\/video_m3u8\.php\?dmdl=007&id=([A-Za-z0-9+\/=%]+)/.exec(embHtml);
    if (!pm) throw new Error('no vidzstore player found for embed ' + embedId);
    var playerUrl = 'https://audience.vidzstore.com/video_m3u8.php?dmdl=007&id=' + pm[1];
    return _getText(playerUrl, embedPage).then(function (plHtml) {
      return { playerUrl: playerUrl, plHtml: plHtml };
    });
  }).then(function (ctx) {
    var sm = /src:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/.exec(ctx.plHtml) ||
             /src\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/.exec(ctx.plHtml);
    if (!sm) throw new Error('no m3u8 src in player page');
    var m3u8 = _absM3u8(sm[1]);
    /* Validate the master: must be a real playlist with segments. */
    return _getText(m3u8, ctx.playerUrl).then(function (body) {
      if (body.indexOf('#EXTM3U') !== 0 && body.indexOf('#EXTM3U') === -1) {
        throw new Error('invalid m3u8 playlist');
      }
      if (!/#EXTINF|\.ts\b|#EXT-X-STREAM-INF/.test(body)) {
        throw new Error('m3u8 has no segments');
      }
      var qm = /-(720p|1080p|480p|360p)\//.exec(m3u8) || /-(720p|1080p|480p|360p)\./.exec(m3u8);
      return [{
        url: m3u8,
        quality: qm ? qm[1] : 'auto',
        label: 'VidZStore',
        container: 'hls',
        headers: { 'User-Agent': _UA, 'Referer': ctx.playerUrl }
      }];
    });
  });
}
