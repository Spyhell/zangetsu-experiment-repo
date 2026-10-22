// Samehadaku — Indonesian-subbed anime source (samehadaku.ac).
//
// Chain:
//   /?s=<q>                              -> anime cards (/anime/<slug>/)
//   /anime/?status=ongoing|completed      -> home rows (Ongoing / Complete)
//   /anime/<slug>/                        -> detail + episode list (eplister)
//   /<slug>-episode-<n>-subtitle-indonesia/ -> watch page
//   watch page -> <select class="mirror"> base64 iframes + default iframe
//      -> https://www.blogger.com/video.g?token=... (player HTML page)
//      -> embedded signed googlevideo.com/videoplayback mp4 URLs (itag 18)
//
// The blogger video.g endpoint does NOT 302 here; it returns the Blogger
// video-player HTML with JS-escaped googlevideo URLs ({"url":"https:\/\/...
// googlevideo.com\/videoplayback?...","mimeType":"video/mp4"}). Those URLs
// are signed per requester IP and expire (~8h), so they are resolved live
// in getVideoSources and must never be cached. Indonesian hardsub; no soft
// subtitle tracks exist, so no subtitle entries are fabricated.
//
// ES5 only (QuickJS). No crypto.subtle / TextEncoder / TextDecoder.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'samehadaku';

var SITE = 'https://samehadaku.ac';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'Samehadaku', lang: 'id', baseUrl: SITE,
    logo: SITE + '/wp-content/uploads/2026/05/samehadaku-.png',
    type: 'anime', version: '1.0.0' };
}

// ── Network ─────────────────────────────────────────────────────────────────
function _get(url, ref) {
  var h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': ref || SITE + '/'
  };
  return fetch(url, { headers: h }).then(function (r) {
    if (!r || !r.ok) {
      throw new Error('Samehadaku: HTTP ' + (r ? r.status : '??') + ' for ' + url);
    }
    return r.body || '';
  }, function (e) {
    throw new Error('Samehadaku: network error for ' + url
      + ' (' + (e && e.message ? e.message : e) + ')');
  });
}

// ── Text helpers ────────────────────────────────────────────────────────────
function _de(s) {
  var t = String(s || '');
  t = t.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
    return String.fromCharCode(parseInt(h, 16));
  });
  t = t.replace(/&#(\d+);/g, function (m, d) {
    return String.fromCharCode(parseInt(d, 10));
  });
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#0*39;/g, "'");
  return t;
}
function _clean(s) {
  return _de(htmlText(String(s || ''))).replace(/\s+/g, ' ').trim();
}
// Undo Blogger's JS string escaping: \u003d -> =, \u0026 -> &, \/ -> /.
function _jsUnescape(s) {
  return String(s || '')
    .replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
// Pure-JS base64 decode (mirror <option> values are base64 iframes).
var _B64ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64decode(b64) {
  var clean = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  while (clean.length % 4 !== 0) clean += '=';
  var out = [], i, j;
  for (i = 0; i + 3 < clean.length + 1; i += 4) {
    var n = 0, pad = 0;
    for (j = 0; j < 4; j++) {
      var ch = clean.charAt(i + j);
      var v = (ch === '=') ? 0 : _B64ABC.indexOf(ch);
      if (ch === '=') pad++;
      n = (n << 6) | (v < 0 ? 0 : v);
    }
    out.push((n >> 16) & 255);
    if (pad < 2) out.push((n >> 8) & 255);
    if (pad < 1) out.push(n & 255);
  }
  return out;
}
function _b64ToStr(b64) {
  var bytes = _b64decode(b64), s = '', i = 0;
  while (i < bytes.length) {
    var c = bytes[i++];
    if (c < 0x80) { s += String.fromCharCode(c); continue; }
    if (c < 0xE0) { s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f)); continue; }
    if (c < 0xF0) {
      s += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      continue;
    }
    var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12)
      | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    cp -= 0x10000;
    s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
  }
  return s;
}

// ── Cards: <article class="bs"> -> MediaItem (anime pages only) ──────────────
function _slugFromAnime(href) {
  var m = String(href || '').match(/\/anime\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
  return m ? m[1] : null;
}
function _cards(html) {
  var out = [], seen = {};
  var re = /<article class="bs"[\s\S]*?<\/article>/g, m;
  while ((m = re.exec(html)) !== null) {
    var c = m[0];
    var href = (c.match(/<a href="([^"]+)"/) || [])[1];
    var slug = _slugFromAnime(href);
    if (!slug || seen[slug]) continue;
    var title = _clean((c.match(/title="([^"]+)"/) || [])[1] || '');
    if (!title) continue;
    var img = (c.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    seen[slug] = 1;
    out.push({ id: 'samehadaku-' + slug, title: title,
      url: 'samehadaku://anime/' + slug, cover: img, type: 'anime' });
  }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/?s=' + encodeURIComponent(q)
    + ((page && page > 1) ? '&paged=' + page : '');
  return _get(url, SITE + '/').then(function (html) {
    return _cards(html);
  }).catch(function () { return []; });
}

// ── Home: Ongoing + Complete archive lists; Recommendation (episode cards) ───
function _epCardTitle(t) {
  // "Kimetsu no Yaiba Movie 1 ... Episode 1 Subtitle Indonesia" -> series title
  return _clean(t).replace(/\s+Episode\s+\d+(\.\d+)?\s+Subtitle Indonesia\s*$/i, '');
}
function _recCards(html) {
  var out = [], seen = {};
  var i = html.indexOf('>Recommendation</h3>');
  var seg = i >= 0 ? html.substring(i, i + 120000) : '';
  var re = /<article class="bs"[\s\S]*?<\/article>/g, m;
  while ((m = re.exec(seg)) !== null) {
    var c = m[0];
    var href = (c.match(/<a href="([^"]+)"/) || [])[1];
    if (!href || href.indexOf('-episode-') < 0 || seen[href]) continue;
    var title = _epCardTitle((c.match(/title="([^"]+)"/) || [])[1] || '');
    if (!title) continue;
    var img = (c.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    seen[href] = 1;
    out.push({ id: 'samehadaku-ep-' + href.replace(/[^a-z0-9]+/gi, '-'),
      title: title, url: 'samehadaku://episode/' + href,
      cover: img, type: 'anime' });
  }
  return out;
}
function getHome(opts) {
  var rows = [];
  return _get(SITE + '/anime/?status=ongoing', SITE + '/').then(function (html) {
    var items = _cards(html);
    if (items.length) rows.push({ title: 'Ongoing Anime', items: items });
    return _get(SITE + '/anime/?status=completed', SITE + '/');
  }).then(function (html) {
    var items = _cards(html);
    if (items.length) rows.push({ title: 'Complete Anime', items: items });
    return _get(SITE + '/', SITE + '/');
  }).then(function (html) {
    var items = _recCards(html);
    if (items.length) rows.push({ title: 'Recommendation', items: items });
    return rows;
  }).catch(function () { return rows; });
}

// ── Detail ──────────────────────────────────────────────────────────────────
function _animeSlug(url) {
  var u = String(url || '');
  var m = u.match(/^samehadaku:\/\/anime\/([a-z0-9-]+)/i)
    || u.match(/\/anime\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
  return m ? m[1] : null;
}
function _episodeUrl(url) {
  var u = String(url || '');
  var m = u.match(/^samehadaku:\/\/episode\/(https?:\/\/.+)/i);
  if (m) return m[1];
  if (/\/[a-z0-9-]+-episode-\d+[^/]*\/?(?:[?#]|$)/i.test(u)) return u;
  return null;
}
function _parseAnimePage(html, slug) {
  var title = _clean((html.match(
    /<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '') || slug;
  var cover = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || null;
  var desc = (html.match(/<div class="entry-content"[^>]*itemprop="description"[^>]*>\s*<p>([\s\S]*?)<\/p>/) || [])[1]
    || (html.match(/<div class="desc">\s*([\s\S]*?)<\/div>/) || [])[1] || '';
  var year = null;
  var ym = html.match(/<b>Released:<\/b>\s*(\d{4})/);
  if (ym) year = ym[1];
  var statusRaw = _clean((html.match(/<b>Status:<\/b>\s*([^<]+)/) || [])[1] || '').toLowerCase();
  var status = statusRaw.indexOf('complete') >= 0 || statusRaw.indexOf('finish') >= 0
    ? 'completed' : (statusRaw.indexOf('ongoing') >= 0 || statusRaw.indexOf('airing') >= 0
      ? 'ongoing' : 'unknown');
  var genres = [], gm = html.match(/<div class="genxed">([\s\S]*?)<\/div>/);
  if (gm) {
    var gr = /<a[^>]*>([^<]+)<\/a>/g, g;
    while ((g = gr.exec(gm[1])) !== null && genres.length < 12) {
      var gt = _clean(g[1]);
      if (gt) genres.push(gt);
    }
  }
  var episodes = [];
  var er = /<li[^>]*data-index="\d+"[^>]*>\s*<a href="([^"]+)"[^>]*>\s*<div class="epl-num">(\d+)<\/div>\s*<div class="epl-title">([\s\S]*?)<\/div>/g;
  var e;
  while ((e = er.exec(html)) !== null) {
    var num = parseInt(e[2], 10);
    if (!(num >= 1)) continue;
    episodes.push({ id: 'samehadaku-ep-' + num, number: num,
      title: _clean(e[3]) || ('Episode ' + num),
      url: 'samehadaku://episode/' + e[1] });
  }
  episodes.reverse(); // site lists newest first; emit oldest first
  return { id: 'samehadaku-' + slug, title: title,
    url: 'samehadaku://anime/' + slug, cover: cover,
    description: _clean(desc), status: status, genres: genres,
    type: 'anime', year: year, episodes: episodes };
}
function getDetail(url, opts) {
  var slug = _animeSlug(url);
  if (slug) {
    return _get(SITE + '/anime/' + encodeURIComponent(slug) + '/', SITE + '/')
      .then(function (html) { return _parseAnimePage(html, slug); });
  }
  // Episode-page URL: find its series link, then parse the anime page.
  var epUrl = _episodeUrl(url);
  if (!epUrl) return Promise.reject(new Error('Samehadaku: bad detail url'));
  return _get(epUrl, SITE + '/').then(function (html) {
    var m = html.match(/series\s*<a href="([^"]+)"/i)
      || html.match(/<a href="([^"]*\/anime\/[^"]+)"[^>]*aria-label=['"]All Episodes['"]/i);
    var aslug = m ? _animeSlug(m[1]) : null;
    if (!aslug) throw new Error('Samehadaku: cannot find series link');
    return _get(SITE + '/anime/' + encodeURIComponent(aslug) + '/', epUrl)
      .then(function (ahtml) { return _parseAnimePage(ahtml, aslug); });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Streams ─────────────────────────────────────────────────────────────────
// Watch page: default <iframe> plus optional <select class="mirror">
// base64-encoded iframe options. Mirrors seen in the wild: blogger.com
// video.g (primary) and turbovidhls.com /t/ links.
function _embedUrls(epHtml) {
  var urls = [], seen = {};
  function add(u) {
    u = String(u || '').trim();
    if (u && u.indexOf('http') === 0 && !seen[u]) { seen[u] = 1; urls.push(u); }
  }
  var im = /<iframe[^>]+src="(https?:\/\/[^"]+)"/ig, m;
  while ((m = im.exec(epHtml)) !== null) add(m[1]);
  var or = /<option[^>]+value="([A-Za-z0-9+/=]+)"[^>]*>/g, o;
  while ((o = or.exec(epHtml)) !== null) {
    try {
      var dec = _b64ToStr(o[1]);
      var sm = dec.match(/src="([^"]+)"/i);
      if (sm) add(sm[1]);
    } catch (e) {}
  }
  return urls;
}
var _ITAG_Q = { '18': '360p', '59': '480p', '22': '720p', '37': '1080p',
  '38': '2160p', '133': '240p', '134': '360p', '135': '480p', '136': '720p',
  '137': '1080p', '160': '144p', '264': '1440p', '266': '2160p' };
function _qRank(q) {
  var n = parseInt(String(q || '').replace('p', ''), 10);
  return isNaN(n) ? 0 : n;
}
// Fetch one blogger video.g player page, pull the signed googlevideo mp4 URLs.
function _resolveBlogger(embedUrl, epUrl) {
  return _get(embedUrl, epUrl).then(function (phtml) {
    var out = [], seen = {};
    // Blogger escapes inconsistently: sometimes https:\/\/...videoplayback,
    // sometimes plain https://...videoplayback. Match both, and cut the
    // URL at the first &quot; or \u0026quot; so trailing player JSON is
    // never swallowed into the URL.
    var re = /https?:(?:\\?\/\\?\/|\/\/)[A-Za-z0-9.\-]*googlevideo[A-Za-z0-9.\-]*\/videoplayback\?(?:[^"\\]|\\.)*/g;
    var m;
    while ((m = re.exec(phtml)) !== null) {
      var raw = m[0];
      var cut = raw.search(/&quot;|\\u0026quot;/);
      if (cut >= 0) raw = raw.substring(0, cut);
      var url = _jsUnescape(raw);
      if (seen[url] || url.indexOf('http') !== 0) continue;
      seen[url] = 1;
      var im = url.match(/[?&]itag=(\d+)/);
      var q = (im && _ITAG_Q[im[1]]) ? _ITAG_Q[im[1]] : 'SD';
      out.push({ url: url, quality: q, label: q + ' [Blogger]',
        container: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': epUrl },
        kind: 'sub' });
    }
    return out;
  }).catch(function () { return []; });
}
// Turbovid (turbovidhls.com /t/<id>): best-effort m3u8/file sniffing.
// The host is unreachable from some datacenter networks; a failure here
// simply contributes no entries and never fails the whole episode.
function _resolveTurbovid(embedUrl, epUrl) {
  return _get(embedUrl, epUrl).then(function (phtml) {
    var text = _jsUnescape(phtml);
    var out = [], seen = {};
    function add(u) {
      u = String(u || '').trim();
      if (!u || seen[u] || u.indexOf('http') !== 0) return;
      seen[u] = 1;
      var isHls = /\.m3u8(\?|$)/i.test(u);
      out.push({ url: u, quality: 'Auto', label: 'Auto [Turbovid]',
        container: isHls ? 'hls' : 'mp4',
        headers: { 'User-Agent': UA, 'Referer': epUrl }, kind: 'sub' });
    }
    var re = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g, m;
    while ((m = re.exec(text)) !== null) add(m[0]);
    var re2 = /["']?file["']?\s*:\s*["'](https?:\/\/[^"']+)["']/g;
    while ((m = re2.exec(text)) !== null) add(m[1]);
    return out;
  }).catch(function () { return []; });
}
function _resolveEmbed(embedUrl, epUrl) {
  var u = String(embedUrl || '');
  if (/blogger\.com\/video\.g/i.test(u)) return _resolveBlogger(u, epUrl);
  if (/turbovid/i.test(u)) return _resolveTurbovid(u, epUrl);
  return Promise.resolve([]);
}
function getVideoSources(episodeUrl) {
  var epUrl = _episodeUrl(episodeUrl);
  if (!epUrl) return Promise.reject(new Error('Samehadaku: bad episode url'));
  return _get(epUrl, SITE + '/').then(function (html) {
    var embeds = _embedUrls(html);
    if (!embeds.length) throw new Error('Samehadaku: no video embed found');
    var jobs = embeds.map(function (u) { return _resolveEmbed(u, epUrl); });
    return Promise.all(jobs).then(function (lists) {
      var out = [], seen = {};
      lists.forEach(function (l) {
        (l || []).forEach(function (v) {
          if (!v || !v.url || seen[v.url]) return;
          seen[v.url] = 1; out.push(v);
        });
      });
      if (!out.length) throw new Error('Samehadaku: no playable stream URLs');
      // Best quality last (the app plays the last link).
      out.sort(function (a, b) { return _qRank(a.quality) - _qRank(b.quality); });
      return out;
    });
  });
}
