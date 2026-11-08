// Anichin — Indonesian-subbed donghua from ani-chin.com.
// Chain (plain HTTP, verified 2026-11-08):
//   home    GET / -> .post-item cards: category slug from the li class
//           (category-<slug>), series name from .post-cat, cover from img.
//   search  GET /?s=<q> -> .slide cards: background-image cover +
//           <a class="post-cat" href="/category/<slug>/">Name</a>.
//   detail  GET /category/<slug>/ -> <title> "Name Archives - Anichin",
//           cover from first slide background-image, episode list of
//           /<series>-episode-<n>-subtitle-indonesia/ links.
//   sources GET episode page -> single <iframe src="https://ok.ru/videoembed/<id>">
//           (verified on 2 episodes). OK.ru is an app-side extractVideo
//           host class, so the embed URL is returned as the video source.
//           Subs are hardsubbed in the ok.ru video. No login, no cookies.
var BASE = 'https://ani-chin.com';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return { name: 'Anichin', lang: 'id', baseUrl: BASE,
           logo: 'https://ani-chin.com/wp-content/uploads/2026/10/ani-chin.webp',
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
  return { id: 'anichin-' + slug, title: stripTags(title), url: BASE + '/category/' + slug + '/',
           type: 'anime', cover: cover ? decodeEntities(cover) : null };
}

function parseHomeItems(html) {
  // <li class="post-item ... category-<slug> ..."> ... .post-cat name ...
  // <img src="cover">
  var out = [], seen = {};
  var re = /<li class="post-item[^"]*?category-([a-z0-9\-]+)[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    var block = m[2];
    if (seen[slug]) continue;
    seen[slug] = true;
    var nm = block.match(/class="post-cat[^"]*"[^>]*>([^<]+)<\//);
    var im = block.match(/<img[^>]*src="([^"]+)"/);
    out.push(seriesItem(slug, nm ? nm[1] : slug.replace(/-/g, ' '), im ? im[1] : null));
  }
  return out;
}

function parseSlideItems(html) {
  // Search/category pages: <div class="slide" style="background-image: url(cover)">
  //   ... <a class="post-cat" href="/category/<slug>/">Name</a>
  var out = [], seen = {};
  var chunks = String(html).split('<div class="slide"');
  for (var i = 1; i < chunks.length; i++) {
    var block = chunks[i].slice(0, 4000);
    var cm = block.match(/<a[^>]*class="post-cat[^"]*"[^>]*href="([^"]*\/category\/([a-z0-9\-]+)\/)"[^>]*>([^<]+)<\//);
    if (!cm) continue;
    var slug = cm[2];
    if (seen[slug]) continue;
    seen[slug] = true;
    var bg = block.match(/background-image:\s*url\(([^)]+)\)/);
    out.push(seriesItem(slug, cm[3], bg ? bg[1].replace(/['"]/g, '') : null));
  }
  return out;
}

function getHome(opts) {
  return getText(BASE + '/').then(function (html) {
    var items = parseHomeItems(html);
    if (!items.length) throw new Error('Anichin: no items on home');
    return [{ title: 'Rilisan Terbaru', items: items }];
  });
}

function search(query, page, opts) {
  var url = BASE + '/?s=' + enc(query);
  if (page && page > 1) url += '&page=' + page;
  return getText(url).then(function (html) {
    var items = parseSlideItems(html);
    if (!items.length) items = parseHomeItems(html);
    return items;
  });
}

function parseEpisodes(html, seriesUrl) {
  // /<series>-episode-<n>-subtitle-indonesia/
  var out = [], seen = {};
  var re = /href="(https?:\/\/ani-chin\.com\/[a-z0-9\-]+-episode-(\d+)-subtitle-indonesia\/)"/g;
  var m;
  var slug = String(seriesUrl || '').replace(/\/$/, '').split('/').pop();
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[2], 10);
    if (seen[n]) continue;
    seen[n] = true;
    out.push({ id: 'anichin-' + slug + '-ep' + n, title: 'Episode ' + n,
               url: m[1], number: n });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function parseDetail(html, url) {
  var tm = html.match(/<title>([^<]*)<\/title>/);
  var title = tm ? stripTags(tm[1]).replace(/\s*Archives\s*-\s*Anichin\s*$/i, '') : 'Anichin';
  var bg = html.match(/background-image:\s*url\(([^)]+)\)/);
  var slug = String(url || '').replace(/\/$/, '').split('/').pop();
  return { id: 'anichin-' + slug, title: title, url: url, type: 'anime',
           cover: bg ? decodeEntities(bg[1].replace(/['"]/g, '')) : null,
           description: null, episodes: parseEpisodes(html, url) };
}

function getDetail(url, opts) {
  return getText(url).then(function (html) { return parseDetail(html, url); });
}

function getEpisodes(url, opts) {
  return getText(url).then(function (html) { return parseEpisodes(html, url); });
}

function getVideoSources(episodeUrl) {
  var ep = String(episodeUrl || '');
  return getText(ep).then(function (html) {
    var out = [], seen = {};
    var re = /<iframe[^>]*src="(https?:\/\/ok\.ru\/videoembed\/\d+[^"]*)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var src = decodeEntities(m[1]);
      if (seen[src]) continue;
      seen[src] = true;
      out.push({ url: src, quality: '720p', label: 'OK.ru',
                 container: 'mp4', headers: { Referer: ep }, kind: 'sub' });
    }
    if (!out.length) throw new Error('Anichin: no ok.ru embed on episode page');
    return out;
  });
}
