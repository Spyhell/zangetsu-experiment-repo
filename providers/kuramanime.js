// Kuramanime — Indonesian-subbed anime (v9.kuramanime.blog).
// Chain (all plain HTTP, verified 2026-11-07):
//   search  GET /anime?search=<q>&order_by=oldest -> #animeList .product__item cards
//   detail  GET /anime/<id>/<slug> -> title/cover/synopsis + episode list in the
//           "Daftar Episode" popover's data-content attribute (Ep N links)
//   sources GET episode page -> data-kk -> GET /assets/js/<data-kk>.js (MIX_*
//           route constants) -> GET /assets/<ROUTE_PARAM>.txt with
//           X-Fuck-ID: <KEY>:<TOKEN> -> access token (StTk, rotates ~hourly)
//           -> POST <episode-url>?<PAGE_KEY>=<StTk>&<SERVER_KEY>=kuramadrive&page=1
//           with form authorization=<CONST>&data={} -> fragment HTML with
//           <source src="...kdrive...mp4" size="720"> direct MP4s (720p/480p/360p),
//           byte-verified HTTP 206 video/mp4. No cookies needed.
// The 40-char authorization value is a static constant in the site's
// leviathan.js (identical across episodes/servers/tokens in 5 trials);
// everything else is read live per request, so a data-kk / route-param /
// token rotation does not break the provider.
var BASE = 'https://v9.kuramanime.blog';
var SITE = BASE;
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Static authorization constant from the site's leviathan.js (fetchSecure).
var _AUTH_CONST = 'kJuHHkaqcBFXiGMHQf6bJw8YAyDcwGD8Ur';
// Last-known data-kk value, only a fallback when the episode page has none.
var _DATA_KK_FALLBACK = 'wzl3ClXO8shDECR';

function getInfo() {
  return { name: 'Kuramanime', lang: 'id', baseUrl: SITE,
           logo: 'https://v9.kuramanime.blog/assets/img/logo-full-512.png',
           type: 'anime', version: '1.0.0' };
}

function enc(s) { return encodeURIComponent(String(s || '')); }

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
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

function seriesUrlFrom(href) {
  // 'https://v9.kuramanime.blog/anime/1886/jigokuraku/episode/6' -> series URL
  var m = String(href || '').match(/^(https?:\/\/[^\/]+\/anime\/\d+\/[^\/\?#]+)/);
  if (m) return m[1];
  var m2 = String(href || '').match(/^(\/anime\/\d+\/[^\/\?#]+)/);
  if (m2) return BASE + m2[1];
  return href;
}

function parseCards(html) {
  // #animeList / home .product__item cards: pic link + cover + h5 title.
  var out = [], seen = {};
  var re = /<div class="product__item">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var card = m[1];
    var lm = card.match(/<a href="([^"]+)"[^>]*>\s*<div class="product__item__pic set-bg" data-setbg="([^"]*)"/);
    if (!lm) continue;
    var tm = card.match(/<h5>\s*<a[^>]*>([^<]+)<\/a>/);
    var url = seriesUrlFrom(decodeEntities(lm[1]));
    var title = tm ? stripTags(tm[1]) : '';
    if (!title || seen[url]) continue;
    seen[url] = true;
    var idm = url.match(/\/anime\/(\d+)\//);
    out.push({ id: 'kuramanime-' + (idm ? idm[1] : enc(title)), title: title,
               url: url, type: 'anime', cover: decodeEntities(lm[2]) || null });
  }
  return out;
}

function getHome(opts) {
  return getText(BASE + '/').then(function (html) {
    var items = parseCards(html);
    if (!items.length) throw new Error('Kuramanime: no items on home');
    return [{ title: 'Anime Terbaru', items: items }];
  });
}

function search(query, page, opts) {
  var url = BASE + '/anime?search=' + enc(query) + '&order_by=oldest';
  if (page && page > 1) url += '&page=' + page;
  return getText(url).then(function (html) {
    var items = parseCards(html);
    return items;
  });
}

function parseEpisodes(html, seriesUrl) {
  // Episode list lives in the "Daftar Episode" popover data-content:
  // <a ... href='.../anime/<id>/<slug>/episode/<n>' ...> Ep <n> </a>
  var out = [];
  var dm = html.match(/data-content="([^"]*)"/);
  var blob = dm ? decodeEntities(dm[1]) : html;
  var idm = String(seriesUrl || '').match(/\/anime\/(\d+)\//);
  var aid = idm ? idm[1] : 'x';
  var re = /href='([^']*\/episode\/(\d+)[^']*)'[^>]*>\s*Ep\s*(\d+)/g;
  var m, seen = {};
  while ((m = re.exec(blob)) !== null) {
    var n = parseInt(m[3] || m[2], 10);
    var href = m[1].replace(/^\/\//, 'https://');
    if (href.indexOf('http') !== 0) href = BASE + href;
    if (seen[n]) continue;
    seen[n] = true;
    out.push({ id: 'kuramanime-' + aid + '-ep' + n, title: 'Episode ' + n,
               url: href, number: n });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function getDetail(url, opts) {
  return getText(url).then(function (html) {
    var tm = html.match(/<div class="anime__details__title">[\s\S]*?<h3>([\s\S]*?)<\/h3>/);
    var title = tm ? stripTags(tm[1]) : 'Kuramanime';
    var cm = html.match(/anime__details__pic set-bg" data-setbg="([^"]*)"/);
    var sm = html.match(/<p id="synopsisField">([\s\S]*?)<\/p>/);
    var idm = String(url).match(/\/anime\/(\d+)\//);
    var eps = parseEpisodes(html, url);
    return { id: 'kuramanime-' + (idm ? idm[1] : enc(title)), title: title,
             url: url, type: 'anime', cover: cm ? decodeEntities(cm[1]) : null,
             description: sm ? stripTags(sm[1]) : null, episodes: eps };
  });
}

function getEpisodes(url, opts) {
  return getText(url).then(function (html) {
    return parseEpisodes(html, url);
  });
}

function rand6() {
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var s = '';
  for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function getVideoSources(episodeUrl) {
  var ep = String(episodeUrl || '');
  return getText(ep).then(function (html) {
    var km = html.match(/data-kk="([^"]+)"/);
    var dataKk = km ? km[1] : _DATA_KK_FALLBACK;
    return getText(BASE + '/assets/js/' + dataKk + '.js');
  }).then(function (js) {
    function grab(name) {
      var m = js.match(new RegExp(name + ":\\s*'([^']+)'"));
      return m ? m[1] : null;
    }
    var key = grab('MIX_AUTH_KEY');
    var token = grab('MIX_AUTH_TOKEN');
    var routeParam = grab('MIX_AUTH_ROUTE_PARAM');
    var pageKey = grab('MIX_PAGE_TOKEN_KEY');
    var serverKey = grab('MIX_STREAM_SERVER_KEY');
    if (!key || !token || !routeParam || !pageKey || !serverKey) {
      throw new Error('Kuramanime: route constants not found in ' + dataKk + '.js');
    }
    return getText(BASE + '/assets/' + routeParam, {
      'User-Agent': _UA,
      'X-Fuck-ID': key + ':' + token,
      'X-Request-ID': rand6(),
      'X-Request-Index': '0'
    }).then(function (sttk) {
      return { sttk: String(sttk || '').trim(), pageKey: pageKey, serverKey: serverKey };
    });
  }).then(function (ctx) {
    if (!ctx.sttk) throw new Error('Kuramanime: empty access token');
    var fragUrl = ep + '?' + ctx.pageKey + '=' + enc(ctx.sttk) +
      '&' + ctx.serverKey + '=kuramadrive&page=1';
    var body = 'authorization=' + enc(_AUTH_CONST) + '&data=%7B%7D';
    return withTimeout(fetch(fragUrl, {
      method: 'POST',
      headers: { 'User-Agent': _UA, 'Referer': ep,
                 'X-Requested-With': 'XMLHttpRequest',
                 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }), 60000, 'kuramanime fragment').then(function (r) {
      if (!r.ok) throw new Error('Kuramanime fragment HTTP ' + r.status);
      return r.text();
    });
  }).then(function (frag) {
    if (frag.indexOf('Terjadi kesalahan saat mengambil video') !== -1) {
      throw new Error('Kuramanime: site failed to resolve the video (stale token?)');
    }
    var out = [];
    var re = /<source[^>]*>/g, m;
    while ((m = re.exec(frag)) !== null) {
      var tag = m[0];
      var sm = tag.match(/src="([^"]+)"/);
      if (!sm) continue;
      var src = decodeEntities(sm[1]);
      if (src.indexOf('.mp4') === -1) continue;
      var zm = tag.match(/size="(\d+)"/);
      var qm = src.match(/-(\d{3,4})p[-_]/);
      var q = zm ? zm[1] + 'p' : (qm ? qm[1] + 'p' : '720p');
      out.push({ url: src, quality: q, label: 'Kuramadrive ' + q,
                 container: 'mp4', headers: { Referer: ep }, kind: 'sub' });
    }
    if (!out.length) {
      var hm = frag.match(/data-hls-src="([^"]+)"/);
      if (hm && hm[1]) {
        out.push({ url: decodeEntities(hm[1]), quality: '720p', label: 'Kuramadrive HLS',
                   container: 'hls', headers: { Referer: ep }, kind: 'sub' });
      }
    }
    if (!out.length) throw new Error('Kuramanime: no playable stream in fragment');
    return out;
  });
}
