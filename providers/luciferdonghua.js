// Lucifer Donghua — English-subbed (plus Hindi-dub) donghua from luciferdonghua.in.
// Chain (plain HTTP, verified 2026-11-08):
//   home    GET /anime/?status=&type=&order=update -> .bs cards (/anime/<slug>/)
//   search  GET /?s=<q> -> same .bs cards
//   detail  GET /anime/<slug>/ -> h1.entry-title, og:image/description,
//           episode list <li data-index><a href="...-episode-NN-...">
//           <div class="epl-num">NN [4K]</div>
//   sources GET episode page -> server <select> (/v/1/, /v/2/ ...):
//           prefer the [OK.RU] server -> GET /v/N/ -> ok.ru/videoembed/<id>
//           (app-side extractVideo host class; verified per-episode ids,
//           e.g. Golden Curse ep 1 -> 16233625291266). Some episodes also
//           carry a direct archive.org mp4 download link (e.g. Golden Curse
//           ep 14, HEAD-verified 200 video/mp4) — returned first when present.
//           The episode page's Dailymotion/Rumble/VidHide players are NOT
//           used (not app-playable). Older/back-catalog episodes have no
//           server selector (Dailymotion-only) and are unplayable in-app —
//           a real catalog limitation, noted in the README.
var BASE = 'https://luciferdonghua.in';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getInfo() {
  return { name: 'Lucifer Donghua', lang: 'en', baseUrl: BASE,
           logo: 'https://i0.wp.com/luciferdonghua.in/wp-content/uploads/2022/12/cropped-lucifer-donghua-DP-192x192.webp',
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
  //   <img src="..."> ... <h2 itemprop="headline">Title</h2>
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
    var im = card.match(/<img[^>]*src="([^"]+)"/);
    var slug = url.replace(/\/$/, '').split('/').pop();
    if (!title || seen[url]) continue;
    seen[url] = true;
    out.push({ id: 'luciferdonghua-' + slug, title: title, url: url,
               type: 'anime', cover: im ? decodeEntities(im[1]) : null });
  }
  return out;
}

function getHome(opts) {
  return getText(BASE + '/anime/?status=&type=&order=update').then(function (html) {
    var items = parseCards(html);
    if (!items.length) throw new Error('Lucifer Donghua: no items on home');
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
  // <li data-index="N"><a href="...-episode-NN-...">
  //   <div class="epl-num">02 [4K]</div><div class="epl-title">...</div>
  // Movies use <div class="epl-num">MOVIE</div> (single entry, number 1).
  var out = [], seen = {};
  var re = /<li[^>]*data-index="\d+"[^>]*>\s*<a href="([^"]+)"[^>]*>[\s\S]*?<div class="epl-num">([^<]*)<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    if (href.indexOf('http') !== 0) href = BASE + href;
    var nm = String(m[2]).match(/(\d+)/);
    var n = nm ? parseInt(nm[1], 10) : (/MOVIE/i.test(m[2]) ? 1 : 0);
    if (seen[n] || !n) continue;
    seen[n] = true;
    var slug = String(seriesUrl || '').replace(/\/$/, '').split('/').pop();
    out.push({ id: 'luciferdonghua-' + slug + '-ep' + n,
               title: /MOVIE/i.test(m[2]) ? 'Movie' : 'Episode ' + n,
               url: href, number: n });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function parseDetail(html, url) {
  var tm = html.match(/<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/);
  var title = tm ? stripTags(tm[1]) : 'Lucifer Donghua';
  var cm = html.match(/<meta property="og:image" content="([^"]+)"/);
  var dm = html.match(/<meta property="og:description" content="([^"]*)"/);
  var eps = parseEpisodes(html, url);
  var slug = String(url || '').replace(/\/$/, '').split('/').pop();
  // Movie/detail pages with no episode list but a direct archive.org mp4
  // on the page itself: expose it as a single episode.
  if (!eps.length && /archive\.org[^"'\s]*\.mp4/i.test(html)) {
    eps.push({ id: 'luciferdonghua-' + slug + '-ep1', title: 'Episode 1',
               url: url, number: 1 });
  }
  return { id: 'luciferdonghua-' + slug, title: title, url: url, type: 'anime',
           cover: cm ? decodeEntities(cm[1]) : null,
           description: dm ? decodeEntities(dm[1]) : null, episodes: eps };
}

function getDetail(url, opts) {
  return getText(url).then(function (html) { return parseDetail(html, url); });
}

function getEpisodes(url, opts) {
  return getText(url).then(function (html) { return parseEpisodes(html, url); });
}

function getVideoSources(episodeUrl) {
  var ep = String(episodeUrl || '');
  var dub = /hindi-dub/i.test(ep);
  return getText(ep).then(function (html) {
    var out = [], seen = {};
    // 1) Direct archive.org mp4 in the download box (only some episodes
    //    carry one — e.g. Golden Curse ep 14). Best stream when present.
    var re = /href="(https?:\/\/[^"']*archive\.org[^"']*\.mp4[^"']*)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var src = decodeEntities(m[1]);
      if (seen[src]) continue;
      seen[src] = true;
      var q = /4k/i.test(src) ? '2160p' : (/1080/.test(src) ? '1080p' : '720p');
      out.push({ url: src, quality: q, label: 'Archive.org ' + q,
                 container: 'mp4', headers: { Referer: ep },
                 kind: dub ? 'dub' : 'sub' });
    }
    // 2) Server selector: prefer the OK.RU server (app-side extractVideo
    //    host class). Dailymotion/Rumble/VidHide embeds are NOT app-playable
    //    and are skipped. Older episodes have no selector at all.
    var opts = [];
    var ore = /<option value="([^"]+\/v\/\d+\/)"[^>]*>([^<]*)<\/option>/g;
    while ((m = ore.exec(html)) !== null) opts.push({ url: m[1], label: m[2] });
    var okOpt = null;
    for (var i = 0; i < opts.length; i++) {
      if (/OK\.?RU/i.test(opts[i].label)) { okOpt = opts[i]; break; }
    }
    if (!okOpt) {
      if (!out.length) throw new Error('Lucifer Donghua: no playable server on episode page (Dailymotion-only episode?)');
      return out;
    }
    return getText(okOpt.url, { 'User-Agent': _UA, 'Referer': ep }).then(function (vhtml) {
      var vre = /\/\/ok\.ru\/videoembed\/(\d+)/;
      var vm = vhtml.match(vre);
      if (vm) {
        var okUrl = 'https://ok.ru/videoembed/' + vm[1];
        if (!seen[okUrl]) {
          out.push({ url: okUrl, quality: '720p', label: 'OK.ru',
                     container: 'mp4', headers: { Referer: okOpt.url },
                     kind: dub ? 'dub' : 'sub' });
        }
      }
      if (!out.length) throw new Error('Lucifer Donghua: OK.RU server page has no embed');
      return out;
    });
  });
}
