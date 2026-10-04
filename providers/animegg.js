// AnimeGG — anime (sub + dub) via animegg.org.
//
// Chain (all server-side, no login):
//   /search/?q=<query>   -> <a class="mse" href="/series/<slug>"> (h2 title, img cover)
//   /popular-series       -> <li class="fea"> cards (img cover, /series/<slug>, title)
//   /series/<slug>        -> <h1> title, vidcache cover, episode list
//                            <a class="anm_det_pop" href="/<slug>-episode-<N>">
//   /<slug>-episode-<N>   -> <div id="subbed-Animegg"><iframe src="/embed/<id>">
//                            <div id="dubbed-Animegg"><iframe src="/embed/<id>">
//   /embed/<id>           -> Sources = [{file: "/play/<id>/video.mp4?for=..",
//                            label: "480p", bk: "..."}]  (direct mp4s; the
//                            ?for= token is per-load, so getVideoSources
//                            re-resolves fresh every playback)
//
// Sub and dub are exposed as separate kinds per the multi-audio rule.
// Verified 2026-10-04: search/home/detail/episodes -> Sources arrays;
// the mp4 file URLs 302 to vidcache.net and serve real video/mp4 bytes
// (HTTP 206 range request verified).
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animegg';

var SITE = 'https://www.animegg.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeGG', lang: 'en', baseUrl: SITE,
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/animegg.png',
    type: 'anime', version: '1.0.0' };
}

// ── Network ─────────────────────────────────────────────────────────────────
function _raceTimeout(p, ms, what) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('AnimeGG: timed out (' + (what || 'request') + ')')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url, ref) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json',
               'Referer': ref || SITE + '/' }
  }).then(function (r) {
    if (!r.ok) throw new Error('AnimeGG: HTTP ' + r.status + ' for ' + url);
    return r.text();
  }), 15000, url);
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _decodeEntities(s) {
  return _trim(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function _stripTags(s) { return _trim(String(s || '').replace(/<[^>]+>/g, ' ')); }

// ── Cards ───────────────────────────────────────────────────────────────────
// Search: <a href="/series/<slug>" class="mse"> ... <img src="<cover>"> ... <h2><title></h2>
function _searchCards(html) {
  var out = [], seen = {}, m, re;
  re = /<a href="(\/series\/[a-z0-9-]+)" class="mse"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1].replace('/series/', '');
    if (seen[slug]) continue;
    seen[slug] = 1;
    var inner = m[2];
    var img = /<img[^>]+src="([^"]+)"/.exec(inner);
    var h2 = /<h2>([\s\S]*?)<\/h2>/.exec(inner);
    out.push({
      id: 'animegg-s-' + slug,
      title: _decodeEntities(_stripTags(h2 ? h2[1] : slug)),
      url: 'animegg://series/' + slug,
      type: 'anime',
      cover: img ? img[1] : null
    });
  }
  return out;
}

// Popular rows: <li class="fea"> <div class="img"><img src="<cover>">
// <a href="/series/<slug>" class="fealink"> ... <div class="rightpop">
// <a href="/series/<slug>"><title></a>
function _popularCards(html) {
  var out = [], seen = {}, m, re;
  re = /<li class="fea">([\s\S]*?)<\/li>/g;
  while ((m = re.exec(html)) !== null) {
    var block = m[1];
    var link = /<a href="(\/series\/[a-z0-9-]+)">([^<]+)<\/a>/.exec(block);
    if (!link) continue;
    var slug = link[1].replace('/series/', '');
    if (seen[slug]) continue;
    seen[slug] = 1;
    var img = /<img[^>]+src="([^"]+)"/.exec(block);
    out.push({
      id: 'animegg-s-' + slug,
      title: _decodeEntities(_trim(link[2])),
      url: 'animegg://series/' + slug,
      type: 'anime',
      cover: img ? img[1] : null
    });
  }
  return out;
}

function getHome(opts) {
  return Promise.all([
    _get(SITE + '/popular-series').then(_popularCards).catch(function () { return []; }),
    _get(SITE + '/popular-series?ongoing=true').then(_popularCards).catch(function () { return []; })
  ]).then(function (rows) {
    var out = [];
    if (rows[0].length) out.push({ title: 'Popular Anime', items: rows[0].slice(0, 20) });
    if (rows[1].length) out.push({ title: 'Ongoing Anime', items: rows[1].slice(0, 20) });
    return out;
  });
}

function search(query, page, opts) {
  return _get(SITE + '/search/?q=' + encodeURIComponent(query || '')).then(_searchCards);
}

// ── Detail / episodes ───────────────────────────────────────────────────────
function _episodesFromDetail(html, seriesTitle) {
  var out = [], seen = {}, m, re;
  // <li> <div><a href="/<slug>-episode-<N>" class="anm_det_pop"><strong>Title N</strong></a>
  // optional <span class="btn-xs btn-dubbed">DUBBED</span> in the same <li>
  re = /<li>([\s\S]*?)<\/li>/g;
  while ((m = re.exec(html)) !== null) {
    var li = m[1];
    var a = /<a href="(\/[a-z0-9-]+-episode-(\d+))" class="anm_det_pop">/.exec(li);
    if (!a) continue;
    var path = a[1].replace(/^\//, '');
    if (seen[path]) continue;
    seen[path] = 1;
    var num = parseInt(a[2], 10);
    var strong = /<strong>([\s\S]*?)<\/strong>/.exec(li);
    var sub = /<i class="anititle">([\s\S]*?)<\/i>/.exec(li);
    var title = strong ? _decodeEntities(_stripTags(strong[1])) : (seriesTitle + ' ' + num);
    if (sub && _trim(sub[1])) title += ' — ' + _decodeEntities(_stripTags(sub[1]));
    out.push({
      id: 'animegg-e-' + path,
      title: title,
      url: 'animegg://ep/' + path,
      number: num,
      dubBadge: /btn-dubbed/.test(li) ? 'DUB' : 'SUB'
    });
  }
  out.sort(function (x, y) { return x.number - y.number; });
  return out;
}

function _detailFromHtml(html, slug) {
  var h1s = [], m, re = /<h1>([\s\S]*?)<\/h1>/g;
  while ((m = re.exec(html)) !== null) h1s.push(_stripTags(m[1]));
  var title = h1s.length > 1 ? h1s[1] : (h1s[0] || slug);
  var cover = null, im;
  var imgRe = /<img[^>]+src="([^"]+)"[^>]*>/g;
  while ((im = imgRe.exec(html)) !== null) {
    if (/vidcache\.net/.test(im[1]) && /\/static\//.test(im[1])) { cover = im[1]; break; }
  }
  var desc = /<meta name="description" content="([^"]*)"/.exec(html);
  var eps = _episodesFromDetail(html, _decodeEntities(title));
  return {
    id: 'animegg-s-' + slug,
    title: _decodeEntities(title),
    url: 'animegg://series/' + slug,
    type: 'anime',
    cover: cover,
    description: desc ? _decodeEntities(desc[1]) : null,
    episodes: eps
  };
}

function getDetail(url, opts) {
  var m = /^animegg:\/\/series\/([a-z0-9-]+)$/.exec(String(url || ''));
  if (!m) return Promise.reject(new Error('AnimeGG: bad detail url'));
  var slug = m[1];
  return _get(SITE + '/series/' + slug).then(function (html) {
    return _detailFromHtml(html, slug);
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Video sources ────────────────────────────────────────────────────────────
// Episode page: <div id="subbed-Animegg"><iframe src="/embed/<id>">
//               <div id="dubbed-Animegg"><iframe src="/embed/<id>">
// Embed page:  Sources = [{file: "/play/<id>/video.mp4?for=..", label: "480p", ...}];
function _embedIds(epHtml) {
  var out = [], m;
  var re = /<div id="(subbed|dubbed)-Animegg"[^>]*>[\s\S]*?<iframe src="(\/embed\/\d+)"/g;
  while ((m = re.exec(epHtml)) !== null) out.push({ kind: m[1], embed: m[2] });
  return out;
}

function _sourcesFromEmbed(embedHtml, kind) {
  var out = [], m;
  var re = /\{file:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g;
  while ((m = re.exec(embedHtml)) !== null) {
    var file = m[1], label = _trim(m[2]) || 'Auto';
    var abs = file.indexOf('http') === 0 ? file : SITE + file;
    var q = /^\d+p$/.test(label) ? label : undefined;
    var k = kind === 'dubbed' ? 'dub' : 'sub';
    out.push({
      url: abs,
      quality: q,
      label: 'AnimeGG [' + k.toUpperCase() + '] ' + label,
      container: 'mp4',
      kind: k,
      headers: { 'Referer': SITE + '/', 'User-Agent': UA }
    });
  }
  return out;
}

function getVideoSources(episodeUrl) {
  var m = /^animegg:\/\/ep\/([a-z0-9-]+-episode-\d+)$/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('AnimeGG: bad episode url: ' + episodeUrl));
  var epPath = m[1];
  return _get(SITE + '/' + epPath).then(function (epHtml) {
    var embeds = _embedIds(epHtml);
    if (!embeds.length) throw new Error('AnimeGG: no player embeds on ' + epPath);
    var jobs = embeds.map(function (e) {
      return _get(SITE + e.embed).then(function (embedHtml) {
        return _sourcesFromEmbed(embedHtml, e.kind);
      }).catch(function () { return []; });
    });
    return Promise.all(jobs).then(function (lists) {
      var sources = [];
      lists.forEach(function (l) { sources = sources.concat(l); });
      if (!sources.length) throw new Error('AnimeGG: no streams parsed');
      // sub first, then dub; higher quality first within each kind
      var rank = function (s) { return parseInt(s.quality || '0', 10) || 0; };
      sources.sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind === 'sub' ? -1 : 1;
        return rank(b) - rank(a);
      });
      return sources;
    });
  });
}
