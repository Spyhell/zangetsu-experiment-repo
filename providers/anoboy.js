// Anoboy — Indonesian-subbed anime (anoboy.watch).
//
// Chain (all verified live 2026-11-06):
//   /                              -> latest episode posts (server-rendered)
//   /anime/?status=&type=&order=update -> series catalog
//   /?s=<q>                        -> search (series results)
//   /anime/<slug>/                -> series page; episode posts
//                                    /<slug>-episode-<n>-subtitle-indonesia/
//   episode post                   -> single <iframe src="https://www.blogger.com/video.g?token=...">
//   blogger.com/video.g?token=...  -> page embedding direct googlevideo.com
//                                    videoplayback MP4s (itag 22 = 720p, 18 = 360p)
//   googlevideo URLs are signed (~9h expiry, IP-bound) but resolution happens
//   on-device at playback time, so the provider returns them fresh per call.
//   Byte-verified 2026-11-06: Range 0-1023 on both itags -> HTTP 206 video/mp4.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — none needed here.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'anoboy';

var SITE = 'https://anoboy.watch';
var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function getInfo() {
  return { name: 'Anoboy', lang: 'id', baseUrl: SITE,
    logo: SITE + '/wp-content/uploads/2026/05/ano-icon.png',
    type: 'anime', version: '1.0.0' };
}

function _getText(url, label) {
  var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' };
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('Anoboy: ' + label + ' HTTP ' + r.status);
    return r.text();
  }).catch(function (e) {
    throw new Error('Anoboy: ' + label + ' failed (' +
      (e && e.message ? e.message : 'fetch failed') + ')');
  });
}

function _dec(s) {
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\\u0026/g, '&').replace(/\\u003d/g, '=').replace(/\\\//g, '/');
}

function _stripTags(s) {
  return _dec(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

/* Episode-post URL -> series URL: /<slug>-episode-<n>-subtitle-indonesia/ */
function _seriesUrlFromEp(epUrl) {
  var m = /\/([a-z0-9][a-z0-9-]*)-episode-\d+-subtitle-indonesia\/?$/.exec(String(epUrl || ''));
  if (!m) return null;
  return { slug: m[1], url: SITE + '/anime/' + m[1] + '/' };
}

function _slugOf(url) {
  var m = /\/anime\/([a-z0-9][a-z0-9-]*)\/?$/.exec(String(url || ''));
  return m ? m[1] : null;
}

/* Parse series cards from a page: <a href=".../anime/<slug>/">...</a>.
 * Covers come from <img> inside the same anchor; titles from anchor text. */
function _parseSeriesCards(html) {
  var out = [], seen = {}, re = /<a[^>]+href="(https:\/\/anoboy\.watch\/anime\/[a-z0-9][a-z0-9-]*\/)"[^>]*>([\s\S]{0,600}?)<\/a>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = m[1], slug = _slugOf(url);
    if (!slug || seen[slug]) continue;
    var inner = m[2];
    var title = _stripTags(inner);
    if (!title) continue;
    var im = /<img[^>]+src="([^"]+)"/.exec(inner);
    var it = { id: 'anoboy://anime/' + slug, title: title, url: url, type: 'anime' };
    if (im) it.cover = im[1];
    seen[slug] = 1;
    out.push(it);
  }
  return out;
}

/* Parse episode-post cards from the home page: each card links the episode
 * post, shows the series title in <div class="tt"> and a poster <img>. */
function _parseHomeCards(html) {
  var out = [], seen = {};
  var re = /<a[^>]+href="(https:\/\/anoboy\.watch\/[a-z0-9][a-z0-9-]*-episode-\d+-subtitle-indonesia\/)"[^>]*>([\s\S]{0,1500}?)<\/a>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var sv = _seriesUrlFromEp(m[1]);
    if (!sv || seen[sv.slug]) continue;
    var inner = m[2];
    var tm = /<div class="tt">\s*([^<]+?)\s*<h2/.exec(inner);
    var title = tm ? _stripTags(tm[1]) : null;
    if (!title) continue;
    var im = /<img[^>]+src="([^"]+)"/.exec(inner);
    var it = { id: 'anoboy://anime/' + sv.slug, title: title, url: sv.url, type: 'anime' };
    if (im) it.cover = im[1];
    seen[sv.slug] = 1;
    out.push(it);
  }
  return out;
}

function getHome(opts) {
  var rows = [];
  return _getText(SITE + '/', 'home').then(function (html) {
    var eps = _parseHomeCards(html);
    if (eps.length) rows.push({ title: 'Latest Episodes', items: eps });
    return _getText(SITE + '/anime/?status=&type=&order=update', 'catalog');
  }).then(function (html) {
    var items = _parseSeriesCards(html);
    if (items.length) rows.push({ title: 'Latest Anime', items: items });
    if (!rows.length) throw new Error('Anoboy: home returned no items');
    return rows;
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = page && page > 1 ? '/page/' + page : '';
  return _getText(SITE + p + '/?s=' + encodeURIComponent(q), 'search')
    .then(function (html) {
      return _parseSeriesCards(html);
    });
}

function _parseSeriesPage(html, url) {
  var slug = _slugOf(url);
  var tm = /<title>([^<]*)<\/title>/.exec(html);
  var title = tm ? _stripTags(tm[1]).replace(/^Nonton\s+/i, '').replace(/\s+Anoboy\s*$/i, '') : (slug || 'Unknown');
  var cm = /property="og:image" content="([^"]+)"/.exec(html);
  var dm = /property="og:description" content="([^"]*)"/.exec(html);
  var det = { id: 'anoboy://anime/' + (slug || url), title: title, url: url, type: 'anime' };
  if (cm) det.cover = cm[1];
  if (dm) det.description = _dec(dm[1]);
  var eps = [], seen = {};
  var re = /href="(https:\/\/anoboy\.watch\/[a-z0-9][a-z0-9-]*-episode-(\d+)-subtitle-indonesia\/)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[2], 10);
    if (seen[n]) continue;
    seen[n] = 1;
    eps.push({ id: 'anoboy://ep/' + slug + '/' + n,
      title: 'Episode ' + n, url: m[1], number: n });
  }
  eps.sort(function (a, b) { return a.number - b.number; });
  det.episodes = eps;
  return det;
}

function getDetail(url, opts) {
  return _getText(url, 'detail').then(function (html) {
    var det = _parseSeriesPage(html, url);
    if (!det.episodes.length) throw new Error('Anoboy: no episodes listed');
    return det;
  });
}

function getEpisodes(url, opts) {
  return _getText(url, 'episodes').then(function (html) {
    var det = _parseSeriesPage(html, url);
    if (!det.episodes.length) throw new Error('Anoboy: no episodes listed');
    return det.episodes;
  });
}

function getVideoSources(episodeUrl, opts) {
  var epUrl = String(episodeUrl || '');
  return _getText(epUrl, 'episode').then(function (html) {
    var fm = /<iframe[^>]+src="(https:\/\/www\.blogger\.com\/video\.g\?token=[^"]+)"/.exec(html);
    if (!fm) {
      var any = /<iframe[^>]+src="([^"]+)"/.exec(html);
      if (!any) throw new Error('Anoboy: no video iframe on episode page');
      throw new Error('Anoboy: unsupported embed host (' + any[1].slice(0, 60) + ')');
    }
    var vgUrl = _dec(fm[1]);
    return fetch(vgUrl, { headers: { 'User-Agent': UA, 'Referer': epUrl } })
      .then(function (r) {
        if (!r.ok) throw new Error('Anoboy: video.g HTTP ' + r.status);
        return r.text();
      });
  }).then(function (body) {
    var clean = _dec(body);
    var out = [], seen = {};
    var re = /https:\/\/[a-z0-9.-]+\.googlevideo\.com\/videoplayback[^"'\s<>\\]*/g;
    var m;
    while ((m = re.exec(clean)) !== null) {
      var u = m[0];
      var it = /[?&]itag=(\d+)/.exec(u);
      if (!it) continue;
      var tag = it[1];
      if (tag !== '22' && tag !== '18') continue;
      if (seen[tag]) continue;
      seen[tag] = 1;
      out.push({ url: u, quality: tag === '22' ? '720p' : '360p',
        label: 'Anoboy ' + (tag === '22' ? '720p' : '360p'),
        container: 'mp4', kind: 'sub' });
    }
    out.sort(function (a, b) {
      return (a.quality === '720p' ? 0 : 1) - (b.quality === '720p' ? 0 : 1);
    });
    if (!out.length) throw new Error('Anoboy: no googlevideo MP4 found');
    return out;
  }).catch(function (e) {
    throw new Error('Anoboy: video sources failed (' +
      (e && e.message ? e.message : 'fetch failed') + ')');
  });
}
