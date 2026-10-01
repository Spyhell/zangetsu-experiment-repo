/*
 * DesiDub Anime — Hindi / Tamil / Telugu dubbed anime from desidubanime.me
 *
 * Chain (all keyless):
 *   home/search/detail : WordPress JSON API (/wp-json/wp/v2/anime)
 *     - home rows are tag-filtered: Hindi (74), Tamil (78), Telugu (79)
 *   episodes           : /wp-json/wp/v2/episode?search=<slug> (+ paginate,
 *                        client-side ^<slug>-episode-N$ filter)
 *   sources            : /watch/<ep>/ -> span[data-embed-id] (base64 name:url)
 *                        -> VidMoly embeds expose a plain HLS master URL
 *                        (sources: [{file: '...master.m3u8'}]).
 * Other servers (Abyss / Streamp2p / Mirror / Ruby / PlayerX) need a real
 * browser (JS token players), so only statically extractable servers ship.
 *
 * v1.0.0: initial release.
 */

var BASE = 'https://www.desidubanime.me';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TAG_HINDI = 74;
var TAG_TAMIL = 78;
var TAG_TELUGU = 79;

function getInfo() {
  return { name: 'DesiDub Anime', lang: 'hi', baseUrl: BASE,
           logo: BASE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

/* ---------------- helpers ---------------- */

function _headers() {
  return { 'User-Agent': UA, 'Accept': 'application/json' };
}

function _get(url, accept) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': accept || 'text/html' } })
    .then(function (r) {
      if (!r.ok) throw new Error('DesiDub: HTTP ' + r.status + ' for ' + url);
      return r.text();
    });
}

function _getJson(url) {
  return fetch(url, { headers: _headers() }).then(function (r) {
    if (!r.ok) throw new Error('DesiDub: HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function _raceTimeout(p, ms, what) {
  if (typeof setTimeout === 'undefined') return p;
  return new Promise(function (resolve, reject) {
    var done = false;
    setTimeout(function () { if (!done) reject(new Error('timeout: ' + what)); }, ms);
    p.then(function (v) { done = true; resolve(v); },
           function (e) { done = true; reject(e); });
  });
}

var _ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'",
             '&#39;': "'", '&#8217;': "'", '&#8216;': "'", '&#8220;': '"',
             '&#8221;': '"', '&nbsp;': ' ', '&#038;': '&', '&#8211;': '-',
             '&#8230;': '...' };
function _decodeEntities(s) {
  s = String(s == null ? '' : s);
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m) {
    if (_ENT[m]) return _ENT[m];
    var n = m.match(/^&#(\d+);$/);
    if (n) return String.fromCharCode(parseInt(n[1], 10));
    var h = m.match(/^&#x([0-9a-fA-F]+);$/);
    if (h) return String.fromCharCode(parseInt(h[1], 16));
    return m;
  });
}

function _stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ');
}

function _b64decode(input) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var s = String(input).replace(/[^A-Za-z0-9+/=]/g, '');
  while (s.length % 4) s += '=';
  var out = '';
  for (var i = 0; i < s.length; i += 4) {
    var a = chars.indexOf(s.charAt(i)), b = chars.indexOf(s.charAt(i + 1));
    var c = chars.indexOf(s.charAt(i + 2)), d = chars.indexOf(s.charAt(i + 3));
    if (a < 0 || b < 0) break;
    var n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out += String.fromCharCode((n >> 16) & 255);
    if (c >= 0) out += String.fromCharCode((n >> 8) & 255);
    if (d >= 0) out += String.fromCharCode(n & 255);
  }
  return out;
}

function _posterOf(it) {
  try {
    var m = it._embedded && it._embedded['wp:featuredmedia'] && it._embedded['wp:featuredmedia'][0];
    return (m && m.source_url) || null;
  } catch (e) { return null; }
}

function _toItem(it) {
  if (!it || !it.slug) return null;
  var title = _decodeEntities((it.title && it.title.rendered) || it.slug).trim() || it.slug;
  return { id: 'dda-' + it.slug, title: title,
           url: 'desidubanime://anime/' + it.slug, type: 'anime',
           cover: _posterOf(it), dubBadge: 'DUB' };
}

/* ---------------- home / search ---------------- */

function _homeRow(title, tagId) {
  return _raceTimeout(
    _getJson(BASE + '/wp-json/wp/v2/anime?tags=' + tagId + '&per_page=15&_embed=1'),
    20000, 'home ' + title
  ).then(function (arr) {
    var items = [];
    (arr || []).forEach(function (it) { var x = _toItem(it); if (x) items.push(x); });
    return { title: title, items: items };
  }).catch(function () { return { title: title, items: [] }; });
}

function getHome() {
  return Promise.all([
    _homeRow('Hindi Dubbed', TAG_HINDI),
    _homeRow('Tamil Dubbed', TAG_TAMIL),
    _homeRow('Telugu Dubbed', TAG_TELUGU)
  ]);
}

function search(query) {
  return _raceTimeout(
    _getJson(BASE + '/wp-json/wp/v2/anime?search=' + encodeURIComponent(query) + '&per_page=30&_embed=1'),
    20000, 'search'
  ).then(function (arr) {
    var items = [];
    (arr || []).forEach(function (it) { var x = _toItem(it); if (x) items.push(x); });
    return items;
  });
}

/* ---------------- detail / episodes ---------------- */

function _epPrefixes(slug) {
  // The anime page lists the latest /watch/<ep>/ links; episode slugs use
  // their own prefix (e.g. kimetsu-no-yaiba-hashira-geiko-hen-season-4),
  // which often differs from the anime slug. Derive it from the page.
  return _raceTimeout(_get(BASE + '/anime/' + slug + '/'), 20000, 'anime page')
    .then(function (html) {
      var counts = {}, re = /\/watch\/([a-z0-9\-_]+?)\//gi, m;
      while ((m = re.exec(html))) {
        var ep = m[1];
        var p = ep.replace(/-episode-\d+$/i, '');
        if (p && p !== ep) counts[p] = (counts[p] || 0) + 1;
      }
      var best = '', bestN = 0;
      Object.keys(counts).forEach(function (p) {
        if (counts[p] > bestN) { bestN = counts[p]; best = p; }
      });
      var out = [];
      if (best) out.push(best);
      if (slug && out.indexOf(slug) < 0) out.push(slug);
      return out;
    })
    .catch(function () { return [slug]; });
}

function _episodesForPrefix(prefix) {
  var out = [];
  var seen = {};
  var page = 1;
  // WP search treats a hyphenated string as one dead phrase; space-separated
  // words are ANDed. Filter client-side with the exact hyphenated prefix.
  var query = prefix.replace(/-/g, ' ');
  var re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-episode-(\\d+)$', 'i');
  function fetchPage() {
    return _raceTimeout(
      _getJson(BASE + '/wp-json/wp/v2/episode?search=' + encodeURIComponent(query) +
               '&per_page=100&page=' + page + '&_fields=slug,link,title'),
      20000, 'episodes p' + page
    ).then(function (arr) {
      arr = arr || [];
      arr.forEach(function (it) {
        var m = it.slug && it.slug.match(re);
        if (m && !seen[it.slug]) {
          seen[it.slug] = 1;
          var n = parseInt(m[1], 10);
          var t = _decodeEntities((it.title && it.title.rendered) || '').trim();
          out.push({ id: 'dda-' + it.slug,
                     title: t && !/^watch\s*now$/i.test(t) ? t : 'Episode ' + n,
                     url: 'desidubanime://watch/' + it.slug, number: n });
        }
      });
      if (arr.length === 100 && page < 10) { page++; return fetchPage(); }
      return out;
    });
  }
  return fetchPage();
}

function _episodes(slug) {
  return _epPrefixes(slug).then(function (prefixes) {
    var chain = Promise.resolve([]);
    prefixes.forEach(function (p) {
      chain = chain.then(function (acc) {
        return _episodesForPrefix(p).then(function (eps) {
          var seen = {};
          acc.forEach(function (e) { seen[e.id] = 1; });
          eps.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; acc.push(e); } });
          return acc;
        }).catch(function () { return acc; });
      });
    });
    return chain;
  }).then(function (out) {
    out.sort(function (a, b) { return a.number - b.number; });
    return out;
  });
}

function getDetail(url) {
  var slug = String(url).split('desidubanime://anime/')[1] || '';
  slug = slug.split('?')[0].split('#')[0];
  return _raceTimeout(
    _getJson(BASE + '/wp-json/wp/v2/anime?slug=' + encodeURIComponent(slug) + '&_embed=1'),
    20000, 'detail'
  ).then(function (arr) {
    if (!arr || !arr.length) throw new Error('DesiDub: anime not found');
    var it = arr[0];
    return _episodes(slug).then(function (eps) {
      var desc = _decodeEntities(_stripTags(it.excerpt && it.excerpt.rendered)).replace(/\s+/g, ' ').trim();
      return { id: 'dda-' + slug,
               title: _decodeEntities(it.title.rendered).trim(),
               url: url, type: 'anime',
               cover: _posterOf(it),
               description: desc || null,
               episodes: eps };
    });
  });
}

function getEpisodes(url) {
  var slug = String(url).split('desidubanime://anime/')[1] || '';
  slug = slug.split('?')[0].split('#')[0];
  return _episodes(slug);
}

/* ---------------- video sources ---------------- */

function _serverName(raw) {
  return String(raw || '').replace(/dub$/i, '').trim() || 'Server';
}

function _hlsEntry(mediaUrl, label, referer) {
  return { url: mediaUrl, quality: 'auto', label: label, container: 'hls',
           kind: 'dub', headers: { 'Referer': referer, 'User-Agent': UA } };
}

function _resolveVidmoly(embedUrl, label) {
  return _raceTimeout(_get(embedUrl), 20000, 'vidmoly embed').then(function (html) {
    var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*'([^']+)'/);
    if (!m) throw new Error('DesiDub: no vidmoly file url');
    return [_hlsEntry(m[1], label, embedUrl)];
  }).catch(function () { return []; });
}

function _resolveServer(sv) {
  var name = _serverName(sv.name);
  var label = '[' + name + ' Hindi]';
  var u = sv.url || '';
  if (/^\/\//.test(u)) u = 'https:' + u;   // protocol-relative -> https
  if (/<iframe/i.test(u)) {
    var m = u.match(/src\s*=\s*['"]([^'"]+)['"]/i);
    u = m ? m[1] : '';
    if (/^\/\//.test(u)) u = 'https:' + u;
  }
  if (!/^https?:\/\//i.test(u)) return Promise.resolve([]);
  if (/\.m3u8(\?|#|$)/i.test(u)) return Promise.resolve([_hlsEntry(u, label, BASE + '/')]);
  if (/\.mp4(\?|#|$)/i.test(u))
    return Promise.resolve([{ url: u, quality: 'auto', label: label, container: 'mp4',
                              kind: 'dub', headers: { 'Referer': BASE + '/', 'User-Agent': UA } }]);
  if (/vidmoly\./i.test(u)) return _resolveVidmoly(u, label);
  // Abyss / Streamp2p / Mirror / Ruby / PlayerX need a real browser — skip.
  return Promise.resolve([]);
}

function getVideoSources(episodeUrl) {
  var epSlug = String(episodeUrl).split('desidubanime://watch/')[1] || '';
  epSlug = epSlug.split('?')[0].split('#')[0];
  if (!epSlug) return Promise.reject(new Error('DesiDub: bad episode url'));
  return _raceTimeout(_get(BASE + '/watch/' + epSlug + '/'), 25000, 'watch page')
    .then(function (html) {
      var servers = [];
      var re = /data-embed-id="([^"]+)"/g, m;
      while ((m = re.exec(html))) {
        var raw = m[1], i = raw.indexOf(':');
        if (i < 0) continue;
        try {
          var name = _b64decode(raw.slice(0, i)).trim();
          var eurl = _b64decode(raw.slice(i + 1)).trim();
          if (name && eurl) servers.push({ name: name, url: eurl });
        } catch (e) { /* skip bad entry */ }
      }
      // de-dupe by url
      var seen = {}, uniq = [];
      servers.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = 1; uniq.push(s); } });
      return uniq;
    })
    .then(function (servers) {
      return Promise.all(servers.map(_resolveServer));
    })
    .then(function (lists) {
      var out = [];
      lists.forEach(function (l) { out = out.concat(l); });
      if (!out.length) throw new Error('DesiDub: no playable streams for this episode');
      return out;
    });
}
