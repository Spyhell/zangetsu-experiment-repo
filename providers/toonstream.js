// ToonStream — anime, movies & cartoons (toonstream.us).
//
// Chain (all server-side, no login):
//   /s?q=<query>            -> article cards (title, poster, /movies|/series/<slug>)
//   /search/all?q=<query>    -> autocomplete JSON {data:[{title,type,url}]} (fallback)
//   /movies/<slug>           -> title, poster, synopsis, single watchable item
//   /series/<slug>           -> title, poster, synopsis, season buttons
//                              data-url="/series/<slug>/season/<n>"
//   /series/<slug>/season/<n>-> episode <li> cards -> /episode/<slug>-<s>x<e>/
//   /episode/<slug>-<s>x<e>/ -> server tabs with <iframe> embeds
//   vidmoly.* embeds         -> sources: [{ file: '<signed master.m3u8>' }]
//                              (other embed hosts need a real browser — skipped)
//
// Home rows come from the site's own language/genre categories
// (Anime, Hindi, Tamil, Telugu, Cartoon, Movies). Hindi/Tamil/Telugu rows
// surface the dubbed catalog the user asked for.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'toonstream';

var SITE = 'https://toonstream.us';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'ToonStream', lang: 'en', baseUrl: SITE,
    logo: SITE + '/public/img/sitename/TOONSTREAM.png',
    type: 'anime', version: '1.0.0' };
}

// ── Network ─────────────────────────────────────────────────────────────────
function _raceTimeout(p, ms, what) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('ToonStream: timed out (' + (what || 'request') + ')')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url, ref) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json',
               'Referer': ref || SITE + '/' }
  }).then(function (r) {
    if (!r.ok) throw new Error('ToonStream: HTTP ' + r.status + ' for ' + url);
    return r.text();
  }), 15000, url);
}

function _getJson(url, ref) {
  return _get(url, ref).then(function (t) { return JSON.parse(t); });
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _decodeEntities(s) {
  return _trim(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ── Cards: <article class="post ... movies|series"> ─────────────────────────
function _cardsFromHtml(html) {
  var out = [], seen = {};
  var re = /<article[^>]*class="[^"]*\bpost\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var card = m[0], body = m[1];
    var lm = /<a[^>]+href="(\/(?:movies|series)\/[^"]+)"[^>]*class="lnk-blk"/.exec(card)
      || /<a[^>]+href="(\/(?:movies|series)\/[^"]+)"/.exec(card);
    if (!lm) continue;
    var path = lm[1];
    if (seen[path]) continue;
    seen[path] = 1;
    var tm = /<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/.exec(body)
      || /alt="Image ([^"]+)"/.exec(body);
    var title = tm ? _decodeEntities(tm[1].replace(/<[^>]+>/g, '')) : path.split('/').pop();
    var im = /<img[^>]+src="([^"]+)"/.exec(body);
    var cover = im ? im[1] : null;
    if (cover && cover.charAt(0) === '/') cover = SITE + cover;
    var type = /\/movies\//.test(path) ? 'movie' : 'anime';
    out.push({
      id: 'toonstream:' + path,
      title: title || path,
      url: 'toonstream://' + path.replace(/^\//, ''),
      type: type,
      cover: cover
    });
  }
  return out;
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var pg = parseInt(page, 10);
  if (isNaN(pg) || pg < 1) pg = 1;
  // WP search page (server-rendered). Page 2+ via /s/<page>?q= … the theme
  // paginates as /s/page/<n>/?q=; try both shapes, keep whichever works.
  var urls = [SITE + '/s?q=' + encodeURIComponent(q)];
  if (pg > 1) urls.push(SITE + '/s/page/' + pg + '/?q=' + encodeURIComponent(q));
  var jobs = urls.map(function (u) {
    return _get(u).then(_cardsFromHtml).catch(function () { return []; });
  });
  return Promise.all(jobs).then(function (lists) {
    var out = [], seen = {}, i, j;
    for (i = 0; i < lists.length; i++) {
      for (j = 0; j < lists[i].length; j++) {
        var it = lists[i][j];
        if (!seen[it.url]) { seen[it.url] = 1; out.push(it); }
      }
    }
    if (out.length) return out.slice(0, 30);
    // Fallback: the live-search JSON API (no posters, but always server-side).
    return _getJson(SITE + '/search/all?q=' + encodeURIComponent(q)).then(function (j) {
      var data = (j && j.data) || [], r = [];
      for (var k = 0; k < data.length && k < 30; k++) {
        var d = data[k], p = String(d.url || '');
        if (!/^\/(movies|series)\//.test(p)) continue;
        r.push({
          id: 'toonstream:' + p,
          title: _decodeEntities(d.title) || p,
          url: 'toonstream://' + p.replace(/^\//, ''),
          type: /^\/movies\//.test(p) ? 'movie' : 'anime',
          cover: null
        });
      }
      return r;
    }).catch(function () { return []; });
  });
}

// ── Home: the site's own language/genre categories ──────────────────────────
var _HOME_ROWS = [
  { title: 'Anime', path: '/category/anime/' },
  { title: 'Hindi Dubbed', path: '/category/hindi/' },
  { title: 'Tamil Dubbed', path: '/category/tamil/' },
  { title: 'Telugu Dubbed', path: '/category/telugu/' },
  { title: 'Cartoons', path: '/category/cartoon/' },
  { title: 'Movies', path: '/category/movies/' }
];

function getHome(opts) {
  var jobs = _HOME_ROWS.map(function (row) {
    return _get(SITE + row.path).then(_cardsFromHtml).then(function (items) {
      return items.length ? { title: row.title, items: items.slice(0, 14) } : null;
    }).catch(function () { return null; });
  });
  return Promise.all(jobs).then(function (rows) {
    return rows.filter(function (r) { return !!r; });
  });
}

// ── Detail ──────────────────────────────────────────────────────────────────
function _itemPath(url) {
  var m = /^toonstream:\/\/((?:movies|series)\/[^?#]+)/.exec(String(url || ''));
  return m ? '/' + m[1] : null;
}

function _parseSeasons(html, seriesSlug) {
  // <a class="season-btn" data-season="1" data-url="/series/<slug>/season/1">
  var out = [], seen = {};
  var re = /class="season-btn[^"]*"[^>]*data-season="(\d+)"[^>]*data-url="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[1], 10), u = m[2];
    if (!seen[n]) { seen[n] = 1; out.push({ season: n, url: u }); }
  }
  out.sort(function (a, b) { return a.season - b.season; });
  return out;
}

function getDetail(url, opts) {
  var path = _itemPath(url);
  if (!path) return Promise.reject(new Error('ToonStream: bad url'));
  var isMovie = /^\/movies\//.test(path);
  return _get(SITE + path).then(function (html) {
    var tm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    var title = tm ? _decodeEntities(tm[1].replace(/<[^>]+>/g, '')) : path.split('/').pop();
    var pm = /<div[^>]*class="post-thumbnail[^"]*"[^>]*>[\s\S]{0,400}?<img[^>]+src="([^"]+)"/.exec(html)
      || /<img[^>]+src="(https:\/\/image\.tmdb\.org[^"]+)"[^>]+alt="Image/.exec(html);
    var cover = pm ? pm[1] : null;
    var dm = /class="[^"]*\bdesc\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    var desc = dm ? _decodeEntities(dm[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ') : '';
    var detail = {
      id: 'toonstream:' + path,
      title: title || path,
      url: url,
      type: isMovie ? 'movie' : 'anime',
      cover: cover,
      description: desc ? desc.slice(0, 600) : ''
    };
    if (isMovie) {
      detail.episodes = [{
        id: 'toonstream:ep:' + path,
        number: 1,
        title: title || 'Play',
        url: 'toonstream://watch' + path
      }];
      return detail;
    }
    var slug = path.replace(/^\/series\//, '').replace(/\/$/, '');
    var seasons = _parseSeasons(html, slug);
    detail._seasons = seasons;
    detail._slug = slug;
    return detail;
  });
}

function _episodesFromSeason(seasonUrl, seasonNum, startIdx) {
  return _get(SITE + seasonUrl).then(function (html) {
    var eps = [], seen = {};
    var re = /href="(\/episode\/([a-z0-9-]+?)-(\d+)x(\d+)\/?)"/g;
    var m, n = startIdx;
    while ((m = re.exec(html)) !== null) {
      var epPath = m[1];
      if (seen[epPath]) continue;
      seen[epPath] = 1;
      n++;
      var s = parseInt(m[3], 10), e = parseInt(m[4], 10);
      eps.push({
        id: 'toonstream:ep:' + epPath,
        number: n,
        title: 'S' + s + ' E' + e,
        url: 'toonstream://episode/' + m[2] + '-' + s + 'x' + e + '/'
      });
    }
    return eps;
  }).catch(function () { return []; });
}

function getEpisodes(url, opts) {
  var path = _itemPath(url);
  if (!path) return Promise.reject(new Error('ToonStream: bad url'));
  if (/^\/movies\//.test(path)) {
    return getDetail(url, opts).then(function (d) { return d.episodes || []; });
  }
  return _get(SITE + path).then(function (html) {
    var slug = path.replace(/^\/series\//, '').replace(/\/$/, '');
    var seasons = _parseSeasons(html, slug);
    if (!seasons.length) return [];
    var chain = Promise.resolve([]), idx = 0;
    seasons.forEach(function (sn) {
      chain = chain.then(function (all) {
        return _episodesFromSeason(sn.url, sn.season, idx).then(function (eps) {
          idx += eps.length;
          return all.concat(eps);
        });
      });
    });
    return chain;
  });
}

// ── Streams: episode page iframes -> VidMoly embeds -> signed HLS ───────────
var _VIDMOLY_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?vidmoly\.[a-z]+\//i;

function _expandQualities(masterUrl, label, ref) {
  return _get(masterUrl, ref).then(function (text) {
    var base = masterUrl.replace(/[^\/]*$/, '');
    var out = [], seen = {};
    var re = /#EXT-X-STREAM-INF:([^\n]*)\n([^\n]+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var attrs = m[1], uri = _trim(m[2]);
      if (/^\s*#/ .test(uri)) continue;
      if (!/^https?:\/\//i.test(uri)) uri = base + uri;
      var key = uri.split('?')[0];
      if (seen[key]) continue;
      seen[key] = 1;
      var rm = /RESOLUTION=\d+x(\d+)/i.exec(attrs);
      var e = { url: uri, label: label, container: 'hls',
                headers: { 'Referer': ref || SITE + '/', 'User-Agent': UA } };
      if (rm) e.quality = rm[1] + 'p';
      out.push(e);
    }
    out.sort(function (a, b) {
      return parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10);
    });
    out.unshift({ url: masterUrl, label: label + ' · Auto', container: 'hls',
                  quality: 'Auto',
                  headers: { 'Referer': ref || SITE + '/', 'User-Agent': UA } });
    return out;
  }).catch(function () {
    return [{ url: masterUrl, label: label + ' · Auto', container: 'hls',
              headers: { 'Referer': ref || SITE + '/', 'User-Agent': UA } }];
  });
}

function _resolveVidmoly(embedUrl, ref) {
  return _raceTimeout(_get(embedUrl, ref), 20000, 'vidmoly embed').then(function (html) {
    // JWPlayer setup: sources: [{ file: '<signed master.m3u8>' }]
    var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*'([^']+)'/);
    if (!m) return [];
    var master = m[1];
    if (!/^https?:\/\//i.test(master)) return [];
    var label = 'ToonStream [VidMoly]';
    return _expandQualities(master, label, embedUrl);
  }).catch(function () { return []; });
}

function getVideoSources(episodeUrl) {
  var m = /^toonstream:\/\/(?:watch(\/(?:movies|series)\/[^?#]+)|episode\/([^?#]+))/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('ToonStream: bad episode url'));
  // Movies play from their own item page (single server tab set).
  var pagePath = m[1] ? m[1] : '/episode/' + m[2];
  return _get(SITE + pagePath).then(function (html) {
    var embeds = [], seen = {};
    var re = /<iframe[^>]+src="([^"]+)"/g;
    var im;
    while ((im = re.exec(html)) !== null) {
      var src = im[1];
      if (/^\/\//.test(src)) src = 'https:' + src;
      if (!/^https?:\/\//i.test(src) || seen[src]) continue;
      seen[src] = 1;
      if (/youtube\.com|youtu\.be/i.test(src)) continue; // trailer, not a stream
      embeds.push(src);
    }
    // VidMoly is the only embed host resolvable server-side (signed HLS in
    // the page's JWPlayer config). Others need a real browser — skipped.
    var jobs = embeds.filter(function (u) { return _VIDMOLY_RE.test(u); })
      .map(function (u) { return _resolveVidmoly(u, SITE + pagePath); });
    return Promise.all(jobs).then(function (lists) {
      var out = [];
      for (var i = 0; i < lists.length; i++) out = out.concat(lists[i]);
      return out;
    });
  });
}
