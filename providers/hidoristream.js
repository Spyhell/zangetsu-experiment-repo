// HidoriStream — Indonesian-subbed anime from v10.hidoristream.online.
// Chain (plain HTTP, verified 2026-11-08):
//   home    GET /anime/?status=&type=&order=update -> .bs cards (/anime/<slug>/)
//   search  GET /?s=<q> -> same .bs cards (cover in <noscript><img>)
//   detail  GET /anime/<slug>-subtitle-indonesia/ -> <title>, og:image,
//           episode list /<series>-episode-<n>-subtitle-indonesia/
//   sources GET episode page -> direct mp4 on a storage host, e.g.
//           https://storeghido.createmyakun123.hidoristream.my.id/4:/..._eps_5.mp4
//           (Range GET byte-verified HTTP 206 video/mp4 on eps 4 and 5).
//           The mirrored.to _links file is NOT a stream and is excluded.
//           Fallback: the site's own embed (stream.hidoristream.my.id) is
//           not used — direct mp4 only. No login, no cookies.
// NOTE: the base domain rotates (v10. as of 2026-11-08); if the site moves,
// update BASE. The mp4 storage host also rotates — the provider matches any
// .mp4 URL on the episode page (excluding mirrored.to).
var BASE = 'https://v10.hidoristream.online';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return { name: 'HidoriStream', lang: 'id', baseUrl: BASE,
           logo: 'https://v10.hidoristream.online/wp-content/uploads/2024/02/cropped-301675065_188526060232091_1333645110538615656_n-192x192.jpg',
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

function parseCards(html) {
  // <article class="bs"> ... <a href="/anime/<slug>/" title="...">
  //   <noscript><img src="cover"> ... <h2>Title</h2> (search pages) or
  //   title attr only (catalog pages).
  var out = [], seen = {};
  var re = /<article class="bs"[\s\S]*?<a href="([^"]*\/anime\/[^"]+)"[^>]*title="([^"]*)"[\s\S]*?<\/article>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var card = m[0];
    var url = m[1];
    if (url.indexOf('http') !== 0) url = BASE + url;
    var title = stripTags(m[2]);
    var hm = card.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (hm) title = stripTags(hm[1]) || title;
    var im = card.match(/<noscript><img[^>]*src="([^"]+)"/) ||
             card.match(/<img[^>]*src="([^"]+)"/);
    var slug = url.replace(/\/$/, '').split('/').pop();
    if (!title || seen[url]) continue;
    seen[url] = true;
    out.push({ id: 'hidoristream-' + slug, title: title, url: url,
               type: 'anime', cover: im ? decodeEntities(im[1]) : null });
  }
  return out;
}

function getHome(opts) {
  return getText(BASE + '/anime/?status=&type=&order=update').then(function (html) {
    var items = parseCards(html);
    if (!items.length) throw new Error('HidoriStream: no items on home');
    return [{ title: 'Recently Updated', items: items }];
  });
}

function search(query, page, opts) {
  var url = BASE + '/?s=' + enc(query);
  if (page && page > 1) url += '&paged=' + page;
  return getText(url).then(function (html) {
    return parseCards(html);
  });
}

function parseEpisodes(html, seriesUrl) {
  var out = [], seen = {};
  var re = /href="(https?:\/\/[^"]*?-episode-(\d+)-subtitle-indonesia\/)"/g;
  var m;
  var slug = String(seriesUrl || '').replace(/\/$/, '').split('/').pop();
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[2], 10);
    if (seen[n]) continue;
    seen[n] = true;
    out.push({ id: 'hidoristream-' + slug + '-ep' + n, title: 'Episode ' + n,
               url: m[1], number: n });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function parseDetail(html, url) {
  var tm = html.match(/<title>([^<]*)<\/title>/);
  var title = tm ? stripTags(tm[1]).split(' - ')[0] : 'HidoriStream';
  var cm = html.match(/<meta property="og:image" content="([^"]+)"/);
  var dm = html.match(/<meta property="og:description" content="([^"]*)"/);
  var slug = String(url || '').replace(/\/$/, '').split('/').pop();
  return { id: 'hidoristream-' + slug, title: title, url: url, type: 'anime',
           cover: cm ? decodeEntities(cm[1]) : null,
           description: dm ? decodeEntities(dm[1]) : null,
           episodes: parseEpisodes(html, url) };
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
    // Direct mp4 URLs on the episode page, quote-terminated. Exclude the
    // mirrored.to _links file (ends .mp4_links, not a stream).
    var re = /(https?:\/\/[^"'\s<>]+\.mp4)(?=["'])/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var src = decodeEntities(m[1]);
      if (src.indexOf('mirrored.to') !== -1) continue;
      if (seen[src]) continue;
      seen[src] = true;
      out.push({ url: src, quality: '720p', label: 'HidoriStream',
                 container: 'mp4', headers: { Referer: ep }, kind: 'sub' });
    }
    if (!out.length) throw new Error('HidoriStream: no direct mp4 on episode page');
    return out;
  });
}
