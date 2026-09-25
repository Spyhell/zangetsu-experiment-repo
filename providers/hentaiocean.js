// HentaiOcean source for the Zangetsu app.
// Site: https://hentaiocean.com (ENG SUB hentai, direct mp4 mirrors).
//
// How it works:
// - Home: the front page has "Recent releases" / "Newly added" / "Random" rows.
// - Search: /explore embeds the whole catalog as cards; we filter titles locally.
// - Detail: /watch/<slug> pages carry a "mirrors" JSON array. Each mirrorurl is
//   like https://w<N>.hentaiocean.com/play?vid=[HentaiOcean.com] <Title>.mp4
//   (the w<N> host rotates, so we read it from the mirror URL, never hardcode).
//   Their player builds the file as <mirror-base>/video/<url-encoded filename>,
//   so we build the direct mp4 URL ourselves and skip the player page.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'hentaiocean';

var SITE = 'https://hentaiocean.com';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function getInfo() {
  return {
    name: 'HentaiOcean', lang: 'en', baseUrl: SITE,
    logo: SITE + '/assets/logo/logo.png',
    type: 'anime', version: '1.0.0'
  };
}

function _get(url, ref) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  return fetch(url, { headers: h }).then(function (r) {
    return r.body || '';
  }).catch(function () { return ''; });
}

// Decode HTML entities: &#123; &#x1F; &amp; &quot; &lt; &gt; &#039; &nbsp;
function _decode(s) {
  s = String(s == null ? '' : s);
  s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
    try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; }
  });
  s = s.replace(/&#(\d+);/g, function (m, d) {
    try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; }
  });
  s = s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  return s;
}

function _abs(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return SITE + u;
  return SITE + '/' + u;
}

// Parse catalog cards:
// <a href="https://hentaiocean.com/watch/<slug>" class="cell card"> ... <img src="..." alt="Title">
function _parseCards(html) {
  var out = [], seen = {};
  var re = /<a[^>]+href="([^"]*\/watch\/[^"]+)"[^>]*class="cell card"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    try {
      var url = _abs(m[1]);
      if (!url || seen[url]) continue;
      seen[url] = true;
      var inner = m[2];
      var imgM = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/i.exec(inner) ||
        /<img[^>]+alt="([^"]*)"[^>]*src="([^"]+)"/i.exec(inner);
      var cover = null, title = '';
      if (imgM) {
        if (imgM[2] && imgM[1].indexOf('watch/') === -1) { cover = _abs(imgM[1]); title = imgM[2]; }
        else { title = imgM[1]; cover = _abs(imgM[2]); }
      }
      if (!title) {
        var tM = /<p[^>]*class="subtitle[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(inner);
        title = tM ? tM[1] : '';
      }
      title = _decode(String(title).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!title || !url) continue;
      // Prefer the full-size cover from the onerror fallback when present.
      var fbM = /onerror="this\.onerror=null;\s*this\.src='([^']+)'/i.exec(inner);
      if (fbM && fbM[1]) cover = _abs(fbM[1]);
      out.push({ id: url, title: title, url: url, type: 'anime', cover: cover || undefined });
    } catch (e) {}
  }
  return out;
}

function _homeRows(html) {
  var rows = [];
  // Split the page on its section headings; each section holds card links.
  var parts = String(html).split(/<h2[^>]*class="title[^"]*"[^>]*>/i);
  for (var i = 1; i < parts.length; i++) {
    var head = parts[i];
    var titleM = /^([\s\S]*?)<\/h2>/i.exec(head);
    var title = titleM
      ? _decode(titleM[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
      : '';
    if (!/recent releases|newly added|random/i.test(title)) continue;
    var items = _parseCards(head).slice(0, 20);
    if (items.length) rows.push({ title: title, items: items });
    if (rows.length >= 3) break;
  }
  return rows;
}

function getHome(opts) {
  return _get(SITE + '/').then(function (html) {
    if (!html) throw new Error('HentaiOcean: failed to load home');
    var rows = _homeRows(html);
    if (!rows.length) {
      // Fallback: treat the whole page as one row.
      var items = _parseCards(html).slice(0, 20);
      if (items.length) rows.push({ title: 'Latest', items: items });
    }
    return rows;
  });
}

function search(query, page, opts) {
  var q = _decode(String(query || '')).toLowerCase().trim();
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/explore').then(function (html) {
    if (!html) return [];
    var all = _parseCards(html);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].title.toLowerCase().indexOf(q) !== -1) out.push(all[i]);
      if (out.length >= 30) break;
    }
    return out;
  });
}

function _detailMeta(html) {
  var tM = /<h1[^>]*class="title"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  var title = tM
    ? _decode(tM[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    : '';
  var cM = /<img[^>]+src="((?:https?:)?[^"]*assets\/cover\/[^"]+)"/i.exec(html);
  var cover = cM ? _abs(cM[1]) : null;
  var dM = /Upload date:<\/b>\s*[\d-]+\s*<\/p>\s*<hr>\s*([^<]{10,})/i.exec(html);
  var desc = dM ? _decode(dM[1]).replace(/\s+/g, ' ').trim() : '';
  var yM = /Release date:<\/b>\s*([\d-]+)/i.exec(html);
  var year = yM ? yM[1].slice(0, 4) : null;
  return { title: title, cover: cover, description: desc, year: year };
}

// Build the direct mp4 from the mirrors JSON on the watch page.
function _mirrorMp4(html) {
  var urls = [], re = /"mirrorurl"\s*:\s*"((?:[^"\\]|\\.)*)"/g, m;
  while ((m = re.exec(html)) !== null) {
    urls.push(m[1].replace(/\\(.)/g, '$1'));
  }
  // Prefer the VIP /play?vid= mirrors; fall back to any mirror with ?vid=.
  var pick = null, fallback = null;
  for (var i = 0; i < urls.length; i++) {
    var u = urls[i], qi = u.indexOf('?vid=');
    if (qi === -1) continue;
    if (/\/play\?vid=/.test(u)) { pick = u; break; }
    if (!fallback) fallback = u;
  }
  var raw = pick || fallback;
  if (!raw) return null;
  var qi2 = raw.indexOf('?vid=');
  var base = raw.slice(0, qi2).replace(/\/play$/, '').replace(/\/universal$/, '');
  var filename = raw.slice(qi2 + 5);
  if (!filename) return null;
  return base + '/video/' + encodeURIComponent(filename);
}

function getDetail(url, opts) {
  var pageUrl = String(url || '');
  return _get(pageUrl).then(function (html) {
    if (!html) throw new Error('HentaiOcean: failed to load page');
    var meta = _detailMeta(html);
    if (!meta.title) throw new Error('HentaiOcean: no title on page');
    return {
      id: pageUrl, title: meta.title, url: pageUrl, type: 'anime',
      year: meta.year, cover: meta.cover || undefined,
      description: meta.description || undefined,
      episodes: [{ id: pageUrl, title: meta.title, url: pageUrl, number: 1 }]
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var pageUrl = String(episodeUrl || '');
  return _get(pageUrl, pageUrl).then(function (html) {
    if (!html) throw new Error('HentaiOcean: failed to load page');
    var mp4 = _mirrorMp4(html);
    if (!mp4 || mp4.indexOf('http') !== 0) {
      throw new Error('HentaiOcean: no playable mirror found');
    }
    return [{
      url: mp4, quality: 'HD', container: 'mp4',
      headers: { 'User-Agent': UA, 'Referer': pageUrl }
    }];
  });
}
