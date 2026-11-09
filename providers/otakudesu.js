// Otakudesu — Indonesian-subbed anime from otakudesu.la.
// Chain (plain HTTP, verified 2026-11-09):
//   home    GET / -> .bsx episode posts; series slug derived from the
//           episode URL (/<series>-episode-<n>-subtitle-indonesia/),
//           series URL is /series/<slug>/.
//   search  GET /?s=<q> -> .bsx cards linking /series/<slug>/.
//   detail  GET /series/<slug>/ -> h1.entry-title, og:image cover,
//           .mindesc description, Released year, episode list
//           (<a href="...-episode-<n>-subtitle-indonesia/"> + .epl-num).
//   sources GET episode page -> <iframe src="https://www.blogger.com/
//           video.g?token=..."> -> fetch Blogger page (Referer = episode
//           URL) -> direct googlevideo mp4 URLs (itag 18, 360p) embedded
//           in the player config JSON (\u003d / \u0026 escaped).
//           NOTE: the signed googlevideo URL is IP-bound — it 403s on a
//           bare Range GET from this VM, but in-app the fetch and the
//           playback share the phone's IP, so the phone is the verdict
//           on actual playback (same class as AnimeJL/AnimeYTX).
//           Subs are hardsubbed in the video. No login, no cookies.
var BASE = 'https://otakudesu.la';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return { name: 'Otakudesu', lang: 'id', baseUrl: BASE,
           logo: 'https://otakudesu.la/wp-content/uploads/2026/05/Otaku-Desu-icon-150x150.webp',
           type: 'anime', version: '1.0.0' };
}

function enc(s) { return encodeURIComponent(String(s || '')); }

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;|&#8217;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-').replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function withTimeout(p, ms, label) {
  return new Promise(function (res, rej) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; rej(new Error('timeout: ' + label)); } }, ms);
    p.then(function (v) { if (!done) { done = true; clearTimeout(t); res(v); } },
         function (e) { if (!done) { done = true; clearTimeout(t); rej(e); } });
  });
}

function getText(url, headers) {
  return withTimeout(fetch(url, { headers: headers || { 'User-Agent': _UA } }), 30000, url)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.text();
    });
}

function seriesItem(slug, title, cover) {
  return { id: 'otakudesu-' + slug, title: stripTags(title), url: BASE + '/series/' + slug + '/',
           type: 'anime', cover: cover ? decodeEntities(cover) : null };
}

// Episode post URL -> { slug, num }: /<slug>-episode-<n>-subtitle-indonesia/
function parseEpUrl(u) {
  var m = String(u || '').match(/\/([a-z0-9\-]+)-episode-(\d+)-subtitle-indonesia\/?$/);
  return m ? { slug: m[1], num: parseInt(m[2], 10) } : null;
}

function parseHomeItems(html) {
  // <div class="bsx"><a href="<ep url>" ...><img src="cover"> ...
  //   <h2>Series Name Episode N Subtitle Indonesia</h2>
  var out = [], seen = {};
  var chunks = String(html).split('<div class="bsx">');
  for (var i = 1; i < chunks.length; i++) {
    var block = chunks[i].slice(0, 6000);
    var am = block.match(/<a[^>]*href="(https?:\/\/otakudesu\.la\/[^"]+-episode-\d+-subtitle-indonesia\/)"/);
    if (!am) continue;
    var ep = parseEpUrl(am[1]);
    if (!ep || seen[ep.slug]) continue;
    seen[ep.slug] = true;
    var hm = block.match(/<h2[^>]*>([^<]+)<\/h2>/);
    var title = hm ? hm[1].replace(/\s+Episode\s+\d+\s+Subtitle Indonesia\s*$/i, '') : ep.slug.replace(/-/g, ' ');
    var im = block.match(/<img[^>]*src="([^"]+)"/);
    out.push(seriesItem(ep.slug, title, im ? im[1] : null));
  }
  return out;
}

function parseSearchItems(html) {
  // Results live in <div class="listupd"> inside .postbody; the sidebar
  // "Anime List" (class='serieslist') also links /series/ pages, so cut
  // the HTML to the results block first — otherwise every query would
  // "match" the sidebar items.
  var start = html.indexOf('class="listupd"');
  if (start !== -1) {
    var end = html.indexOf("class='serieslist'", start);
    if (end === -1) end = html.indexOf('id="sidebar"', start);
    html = end !== -1 ? html.slice(start, end) : html.slice(start);
  }
  // Search cards: <a href="/series/<slug>/"> ... <img src="cover"> ...
  //   <h2>Title</h2> ... </a>
  var out = [], seen = {};
  var re = /<a[^>]*href="(https?:\/\/otakudesu\.la\/series\/([a-z0-9\-]+)\/)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[2];
    if (seen[slug]) continue;
    seen[slug] = true;
    var block = m[3];
    var hm = block.match(/<h2[^>]*>([^<]+)<\/h2>/);
    var im = block.match(/<img[^>]*src="([^"]+)"/);
    out.push(seriesItem(slug, hm ? hm[1] : slug.replace(/-/g, ' '), im ? im[1] : null));
  }
  return out;
}

function getHome(opts) {
  return getText(BASE + '/').then(function (html) {
    var items = parseHomeItems(html);
    if (!items.length) throw new Error('Otakudesu: no items on home');
    return [{ title: 'Episode Terbaru', items: items }];
  });
}

function search(query, page, opts) {
  var url = BASE + '/?s=' + enc(query);
  if (page && page > 1) url += '&paged=' + page;
  return getText(url).then(function (html) {
    return parseSearchItems(html);
  });
}

function parseEpisodes(html, seriesUrl) {
  // <a href="...-episode-<n>-subtitle-indonesia/">
  //   <div class="epl-num">N</div><div class="epl-title">...</div>
  var out = [], seen = {};
  var re = /<a[^>]*href="(https?:\/\/otakudesu\.la\/[a-z0-9\-]+-episode-(\d+)-subtitle-indonesia\/)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  var slug = String(seriesUrl || '').replace(/\/$/, '').split('/').pop();
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[2], 10);
    if (seen[n]) continue;
    seen[n] = true;
    var tm = m[3].match(/class="epl-title"[^>]*>([^<]+)</);
    out.push({ id: 'otakudesu-' + slug + '-ep' + n,
               title: tm ? stripTags(tm[1]) : 'Episode ' + n,
               url: m[1], number: n });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function parseDetail(html, url) {
  var tm = html.match(/<h1 class="entry-title"[^>]*>([^<]+)<\/h1>/);
  var title = tm ? stripTags(tm[1]) : 'Otakudesu';
  var og = html.match(/<meta property="og:image" content="([^"]+)"/);
  var dm = html.match(/class="mindesc"[^>]*>([\s\S]*?)<\/div>/);
  var ym = html.match(/<b>Released:<\/b>\s*(\d{4})/);
  var slug = String(url || '').replace(/\/$/, '').split('/').pop();
  return { id: 'otakudesu-' + slug, title: title, url: url, type: 'anime',
           cover: og ? decodeEntities(og[1]) : null,
           description: dm ? stripTags(dm[1]) : null,
           year: ym ? String(ym[1]) : null,
           episodes: parseEpisodes(html, url) };
}

function getDetail(url, opts) {
  return getText(url).then(function (html) { return parseDetail(html, url); });
}

function getEpisodes(url, opts) {
  return getText(url).then(function (html) { return parseEpisodes(html, url); });
}

function unescapeBlogger(s) {
  return String(s || '')
    .replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&')
    .replace(/&quot;/g, '"').replace(/\\"/g, '"');
}

function getVideoSources(episodeUrl) {
  var ep = String(episodeUrl || '');
  return getText(ep).then(function (html) {
    var im = html.match(/<iframe[^>]*src="(https?:\/\/www\.blogger\.com\/video\.g\?token=[^"]+)"/);
    if (!im) throw new Error('Otakudesu: no Blogger embed on episode page');
    var bloggerUrl = decodeEntities(im[1]);
    return getText(bloggerUrl, { 'User-Agent': _UA, 'Referer': ep });
  }).then(function (page) {
    var clean = unescapeBlogger(page);
    // Direct googlevideo mp4 URLs (itag 18 = 360p). Prefer itag=18 entries.
    var out = [], seen = {};
    var re = /(https?:\/\/[a-z0-9\-\.]+\.googlevideo\.com\/videoplayback\?[^"'\s\\]+)/g;
    var m;
    while ((m = re.exec(clean)) !== null) {
      var u = m[1].replace(/&amp;/g, '&');
      if (seen[u] || u.indexOf('mime=video/mp4') === -1) continue;
      seen[u] = true;
      out.push(u);
    }
    if (!out.length) throw new Error('Otakudesu: no googlevideo mp4 in Blogger page');
    out.sort(function (a, b) {
      var ai = a.indexOf('itag=18') !== -1 ? 0 : 1;
      var bi = b.indexOf('itag=18') !== -1 ? 0 : 1;
      return ai - bi;
    });
    var best = out[0];
    return [{ url: best, quality: '360p', label: 'Blogger 360p',
              container: 'mp4', headers: { Referer: 'https://www.blogger.com/' },
              kind: 'sub' }];
  });
}
