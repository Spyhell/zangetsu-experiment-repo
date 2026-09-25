// TheNkiri — movies + TV series + anime source for the Zangetsu provider repo.
// Site: https://thenkiri.ng (WordPress).
//
// Flow:
//   search:        GET /?s=<q>                      -> post cards
//   home:          GET /category/<movie|tv-series|anime>/ -> post cards
//   detail:        GET <post-url>                   -> og: meta + wideshares.org links
//   video sources: GET <wideshares-url>             -> force_download.php?path=...
//                  (the player follows its 302 to the file CDN; direct mp4/mkv)
//
// Cards are per-post; a series post carries one wideshares link per posted
// episode file (filename holds sXXeYY). A movie post carries one link.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'thenkiri';

var SITE = 'https://thenkiri.ng';
var WIDE = 'https://wideshares.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return { name: 'TheNkiri', lang: 'en', baseUrl: SITE,
    logo: SITE + '/wp-content/uploads/2025/10/cropped-cropped-nkiri-1.png',
    type: 'movie', version: '1.0.0' };
}

// ── http ─────────────────────────────────────────────────────────────────────

function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
    .then(function (r) {
      if (!r || (r.status !== undefined && r.status >= 400)) {
        throw new Error('thenkiri: http ' + (r && r.status) + ' ' + url);
      }
      return r.body || '';
    });
}

function _dec(s) {
  try { return decodeURIComponent(String(s || '')); } catch (e) { return String(s || ''); }
}

function _html(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ── post cards (search + category pages) ─────────────────────────────────────

function _typeOf(slug, cls) {
  var s = String(slug || '') + ' ' + String(cls || '');
  if (/anime/i.test(s)) return 'anime';
  return 'movie';
}

function _cards(html) {
  var out = [], seen = {};
  var parts = String(html || '').split('<article');
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i];
    var link = (c.match(/<a[^>]+href="(https:\/\/thenkiri\.ng\/[a-z0-9\-\/]+\/)"/) || [])[1];
    if (!link || seen[link]) continue;
    var img = (c.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    var h2 = (c.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    var title = h2 ? _html(h2).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                   : (c.match(/title="([^"]+)"/) || [])[1];
    if (!title) continue;
    title = _html(title).trim();
    var slug = link.replace(/^https?:\/\/[^\/]+\//, '').replace(/\/$/, '');
    var cls = (c.match(/^[^>]*class="([^"]*)"/) || [])[1] || '';
    seen[link] = 1;
    out.push({
      id: 'thenkiri:' + slug,
      title: title,
      url: link,
      type: _typeOf(slug, cls),
      cover: img ? _html(img).split('?')[0] + '?w=300' : null
    });
  }
  return out;
}

// ── Home ─────────────────────────────────────────────────────────────────────

var _HOME_ROWS = [
  ['movie', 'Latest Movies'],
  ['tv-series', 'Latest TV Series'],
  ['anime', 'Latest Anime']
];

function getHome(opts) {
  var jobs = _HOME_ROWS.map(function (row) {
    return _get(SITE + '/category/' + row[0] + '/').then(function (html) {
      var items = _cards(html).slice(0, 20);
      if (!items.length) return null;
      return { title: row[1], items: items };
    }).catch(function () { return null; });
  });
  return Promise.all(jobs).then(function (rows) {
    return rows.filter(function (r) { return r; });
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/?s=' + encodeURIComponent(q);
  if (page && page > 1) url += '&paged=' + page;
  return _get(url).then(function (html) {
    return _cards(html).slice(0, 30);
  }).catch(function () { return []; });
}

// ── Detail / episodes ────────────────────────────────────────────────────────

function _epNumFrom(name, fallback) {
  var m = /[._\- ]s(\d{1,2})e(\d{1,3})/i.exec(name || '');
  if (m) return parseInt(m[2], 10) || fallback;
  m = /episode[\s\-_]*(\d{1,3})/i.exec(name || '');
  if (m) return parseInt(m[1], 10) || fallback;
  m = /[._\- ]e(\d{1,3})[._\- ]/i.exec(name || '');
  if (m) return parseInt(m[1], 10) || fallback;
  return fallback;
}

function getDetail(url, opts) {
  url = String(url || '');
  var base = { id: null, title: '', url: url, type: 'movie', cover: null,
    description: '', episodes: [], year: null };
  if (url.indexOf(SITE) !== 0) return Promise.resolve(base);
  return _get(url).then(function (html) {
    var og = function (p) {
      var m = html.match(new RegExp('<meta[^>]+property="' + p + '"[^>]+content="([^"]+)"'));
      return m ? _html(m[1]) : null;
    };
    var title = og('og:title') || '';
    title = title.replace(/\s*-\s*Nkiri\s*$/i, '').trim();
    var slug = url.replace(/^https?:\/\/[^\/]+\//, '').replace(/\/$/, '');
    base.id = 'thenkiri:' + slug;
    base.title = title;
    base.cover = og('og:image');
    base.description = og('og:description') || '';
    var ym = /[\(\[](\d{4})[\)\]]/.exec(title);
    base.year = ym ? ym[1] : null;
    var cls = (html.match(/<article[^>]*class="([^"]*)"/) || [])[1] || '';
    base.type = _typeOf(slug, cls);

    // Wideshares file links -> episodes.
    var links = [], seen = {}, lm, lre = /(https:\/\/wideshares\.org\/[^\s"'<>]+)/g;
    while ((lm = lre.exec(html)) !== null) {
      var u = _html(lm[1]).replace(/&amp;/g, '&');
      if (!seen[u]) { seen[u] = 1; links.push(u); }
    }
    var eps = [];
    for (var i = 0; i < links.length; i++) {
      var file = '';
      var pm = /[?&]path=([^&]+)/.exec(links[i]);
      if (pm) file = _dec(pm[1]);
      var num = _epNumFrom(file, links.length > 1 ? i + 1 : 1);
      eps.push({
        id: base.id + ':ep' + num + ':' + i,
        title: links.length > 1 ? 'Episode ' + num : (base.type === 'movie' ? 'Full Movie' : 'Episode ' + num),
        url: links[i],
        number: num
      });
    }
    eps.sort(function (a, b) { return a.number - b.number; });
    base.episodes = eps;
    return base;
  }).catch(function () { return base; });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Video sources ───────────────────────────────────────────────────────────

function getVideoSources(episodeUrl) {
  var url = String(episodeUrl || '');
  if (url.indexOf('https://wideshares.org/') !== 0) {
    return Promise.reject(new Error('thenkiri: bad episode url'));
  }
  return _get(url).then(function (html) {
    // The interstitial page embeds: force_download.php?path=<url-encoded>
    // That endpoint 302s straight to the file CDN (mp4/mkv, range-capable).
    var m = html.match(/force_download\.php\?path=([^"'\s<>]+)/);
    if (!m) throw new Error('thenkiri: no file link found');
    var fileUrl = WIDE + '/force_download.php?path=' + m[1];
    var file = _dec(m[1]);
    var base = file.split('/').pop() || 'video';
    var isMp4 = /\.mp4(\?|$)/i.test(file);
    var label = base.replace(/\.[a-z0-9]+$/i, '').replace(/[._]+/g, ' ').trim();
    var q = /1080p/i.test(file) ? '1080p' : /720p/i.test(file) ? '720p'
          : /480p/i.test(file) ? '480p' : /2160p|4k/i.test(file) ? '4K' : undefined;
    var src = { url: fileUrl, label: label || 'Download',
      headers: { 'User-Agent': UA, 'Referer': WIDE + '/' } };
    if (q) src.quality = q;
    if (isMp4) src.container = 'mp4';
    return [src];
  });
}
