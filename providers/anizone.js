// AniZone — anizone.to — subbed anime (EN), multi-audio HLS (JP+EN tracks).
// Chain (all server-rendered, no login, no DRM):
//   search:  GET /anime?search=<q>  -> x-data items JSON blob
//   detail:  GET /anime/<slug>      -> episodes JSON blob (first 24; long
//            series paginate via Livewire POST which hangs from datacenter
//            IPs, so only the first page is listed)
//   episode: GET /anime/<slug>/<n>  -> vidstackPlayer JSON -> master.m3u8
//            on *.vid-cdn.xyz (360/720/1080, JP+EN audio) + EN SRT subs
var BASE = 'https://anizone.to';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AniZone', lang: 'en', baseUrl: BASE,
    logo: BASE + '/apple-touch-icon.png', type: 'anime', version: '1.0.0' };
}

function fetchText(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('AniZone HTTP ' + r.status);
      return r.text();
    });
}

function https(u) {
  if (!u) return u;
  return u.replace(/^http:\/\//, 'https://');
}

// The site embeds data as x-data="... items: JSON.parse('[...]') ...".
// The payload is a JS single-quoted string literal: \uXXXX escapes for
// quotes, \\ for backslashes, \/ for slashes. Decode it the way a JS
// engine would (one left-to-right pass), then JSON.parse the result.
function decodeJsString(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, function (m, hex, ch) {
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return ch;
  });
}

function extractJsonBlobs(html) {
  var out = [];
  var re = /JSON\.parse\('([\s\S]*?)'\)/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(decodeJsString(m[1]))); } catch (e) { /* skip bad blob */ }
  }
  return out;
}

function isAnimeList(a) {
  return a && a.length && a[0] && typeof a[0] === 'object' &&
    typeof a[0].main_title === 'string' && typeof a[0].slug === 'string';
}
function isEpisodeList(a) {
  return a && a.length && a[0] && typeof a[0] === 'object' &&
    typeof a[0].slug === 'string' && a[0].title_list && typeof a[0].title_list === 'object' &&
    typeof a[0].url === 'string' && a[0].url.indexOf('/anime/') !== -1;
}
function isHomeEpisodeList(a) {
  return a && a.length && a[0] && typeof a[0] === 'object' &&
    a[0].anime && typeof a[0].anime === 'object';
}

function animeItem(a) {
  var type = (a.type === 'Movie') ? 'movie' : 'anime';
  return { id: 'anizone:' + a.slug, title: a.main_title, url: https(a.url),
    type: type, cover: https(a.cover),
    year: (a.start_year != null) ? String(a.start_year) : null };
}

function epTitle(e) {
  var t = e.title_list || {};
  return t['1'] || t['5'] || t['2'] || ('Episode ' + e.slug);
}

function episodeItem(e) {
  var num = /^\d+$/.test(e.slug) ? parseInt(e.slug, 10) : undefined;
  var item = { id: 'anizone:ep:' + e.url.replace(/^https?:\/\/anizone\.to\/anime\//, ''),
    title: epTitle(e), url: https(e.url) };
  if (num !== undefined) item.number = num;
  if (e.snapshot) item.thumbnail = https(e.snapshot);
  return item;
}

function getHome(opts) {
  return fetchText(BASE + '/').then(function (html) {
    var blobs = extractJsonBlobs(html);
    var rows = [];
    var i, b;
    for (i = 0; i < blobs.length; i++) {
      b = blobs[i];
      if (isAnimeList(b)) {
        rows.push({ title: 'Latest Anime', items: b.map(animeItem) });
      } else if (isHomeEpisodeList(b)) {
        rows.push({ title: 'Latest Episodes', items: b.map(function (e) {
          var a = e.anime;
          return { id: 'anizone:' + a.slug,
            title: (a.main_title || a.title_list['1'] || 'Episode') + ' — Ep ' + e.slug,
            url: https(a.url), type: 'anime', cover: https(e.snapshot) };
        }) });
      }
    }
    if (!rows.length) throw new Error('AniZone: no home rows parsed');
    return rows;
  });
}

function search(query, page, opts) {
  return fetchText(BASE + '/anime?search=' + encodeURIComponent(query)).then(function (html) {
    var blobs = extractJsonBlobs(html);
    var i;
    for (i = 0; i < blobs.length; i++) {
      if (isAnimeList(blobs[i])) return blobs[i].map(animeItem);
    }
    return [];
  });
}

function parseDetail(html, url) {
  var blobs = extractJsonBlobs(html);
  var titles = null, episodes = null, i;
  for (i = 0; i < blobs.length; i++) {
    var b = blobs[i];
    if (!titles && b && typeof b === 'object' && !Array.isArray(b) && typeof b['1'] === 'string') titles = b;
    if (!episodes && isEpisodeList(b)) episodes = b;
  }
  var title = (titles && (titles['1'] || titles['5'])) || 'AniZone';
  var coverMatch = html.match(/lightbox',\s*'(https:\/\/anizone\.to\/images\/anime\/[^']+)'/);
  var cover = coverMatch ? coverMatch[1] : null;
  if (!cover) {
    var imgs = html.match(/https:\/\/anizone\.to\/images\/anime\/[a-f0-9-]+\.jpg/g);
    if (imgs && imgs.length > 1) cover = imgs[1];
    else if (imgs && imgs.length) cover = imgs[0];
  }
  var syn = html.match(/Synopsis<\/h3>\s*<div>([\s\S]*?)<\/div>/);
  var typeMatch = html.match(/<span class="inline-block">([^<]+)<\/span>/);
  var type = (typeMatch && typeMatch[1] === 'Movie') ? 'movie' : 'anime';
  var slug = url.replace(/^https?:\/\/anizone\.to\/anime\//, '').replace(/\/.*$/, '');
  return { id: 'anizone:' + slug, title: title, url: url, type: type,
    cover: cover || undefined,
    description: syn ? syn[1].replace(/\s+/g, ' ').trim() : undefined,
    episodes: (episodes || []).map(episodeItem) };
}

function getDetail(url, opts) {
  return fetchText(url).then(function (html) { return parseDetail(html, url); });
}

function getEpisodes(url, opts) {
  return fetchText(url).then(function (html) {
    var d = parseDetail(html, url);
    return d.episodes || [];
  });
}

function getVideoSources(episodeUrl) {
  return fetchText(episodeUrl).then(function (html) {
    var m = html.match(/vidstackPlayer\(JSON\.parse\('([\s\S]*?)'\)\)/);
    if (!m) throw new Error('AniZone: no player data on episode page');
    var data = JSON.parse(decodeJsString(m[1]));
    if (!data.src) throw new Error('AniZone: no stream src');
    var subs = (data.subtitles || []).map(function (s) {
      return { url: https(s.file), lang: s.language || 'en', label: s.title || 'English' };
    });
    return [{ url: https(data.src), quality: '1080p', label: 'AniZone [Multi-Audio]',
      container: 'hls', subtitles: subs }];
  });
}
