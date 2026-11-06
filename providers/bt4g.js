// BT4G — general torrent search over the DHT (bt4gprx.com).
//
// Chain (all verified live 2026-11-06):
//   /search?q=<q>&orderby=seeders&p=<n> -> server-rendered result rows:
//       <a title="<title>" href="/magnet/<40-char base32 hash>">
//   /magnet/<hash>                    -> title, file list, size, seeders/leechers
//   provider builds magnet:?xt=urn:btih:<hash>&dn=<title> (+ public trackers)
// Magnets play through Zangetsu's native torrent engine (same as
// ToraStream/Nyaa Anime/Torrentio); the harness accepts magnet: URLs.
//
// CONTENT FILTER: bt4g is unfiltered DHT — an innocent query like "naruto"
// surfaces explicit/AI-generated artbooks. This provider drops results whose
// titles match an adult-keyword blocklist or the "(66P)" artbook-page pattern,
// so the in-app list stays clean. It is a keyword filter, not a guarantee.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — none needed here.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'bt4g';

var SITE = 'https://bt4gprx.com';
var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

var TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://explodie.org:6969/announce'
];

/* Adult / explicit keyword filter (see header note). */
var ADULT_RE = /\b(porn|xxx|hentai|jav|onlyfans|erotic|sex|sexy|milf|pussy|cock|dick|anal|blowjob|creampie|nude|naked|fetish|bdsm|escort|camgirl|threesome|orgy|masturbat|hardcore|lesbian|busty|boobs|tits|assfuck|gangbang|cuckold|shemale|transsexual)\b/i;
var ARTBOOK_RE = /\(\d{2,4}P\)|\[AI Generated\]/i;

function getInfo() {
  return { name: 'BT4G', lang: 'en', baseUrl: SITE,
    logo: SITE + '/static/favicon.ico', type: 'movie', version: '1.0.0' };
}

function _getText(url, label) {
  var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' };
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('BT4G: ' + label + ' HTTP ' + r.status);
    return r.text();
  }).catch(function (e) {
    throw new Error('BT4G: ' + label + ' failed (' +
      (e && e.message ? e.message : 'fetch failed') + ')');
  });
}

function _dec(s) {
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function _clean(title) {
  return ADULT_RE.test(title) || ARTBOOK_RE.test(title);
}

function _qualityOf(title) {
  var t = String(title || '').toLowerCase();
  if (/\b(2160p|4k)\b/.test(t)) return '2160p';
  if (/\b1080p\b/.test(t)) return '1080p';
  if (/\b720p\b/.test(t)) return '720p';
  if (/\b480p\b/.test(t)) return '480p';
  return undefined;
}

/* Parse one search page into items. Rows live in notion-list-item blocks:
 *   <a title="<title>" href="/magnet/<hash>">…</a>
 *   <span class="notion-tag …">Video|Archive|Other|…</span> */
function _parseSearch(html) {
  var out = [], seen = {};
  var blocks = String(html || '').split('notion-list-item">');
  var i, b, m, title, hash, tag;
  for (i = 1; i < blocks.length; i++) {
    b = blocks[i];
    m = /<a[^>]+title="([^"]+)"[^>]+href="\/magnet\/([A-Za-z0-9]{32,40})"/.exec(b);
    if (!m) continue;
    title = _dec(m[1]).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    hash = m[2];
    if (!title || seen[hash] || _clean(title)) continue;
    tag = /notion-tag[^>]*>([^<]+)<\/span>/.exec(b);
    var it = { id: 'bt4g://magnet/' + hash, title: title,
      url: SITE + '/magnet/' + hash, type: 'movie' };
    if (tag) it.description = tag[1];
    seen[hash] = 1;
    out.push(it);
  }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/search?q=' + encodeURIComponent(q) +
    '&orderby=seeders&p=' + (page || 1);
  return _getText(url, 'search').then(function (html) {
    return _parseSearch(html);
  });
}

function getHome(opts) {
  var rows = [];
  var queries = ['avengers', 'naruto', 'one piece'];
  var chain = Promise.resolve();
  queries.forEach(function (q) {
    chain = chain.then(function () {
      return search(q, 1, {}).then(function (items) {
        if (items.length) {
          rows.push({ title: 'Top Torrents: ' + q, items: items.slice(0, 12) });
        }
      }).catch(function () { /* one dead row must not kill home */ });
    });
  });
  return chain.then(function () {
    if (!rows.length) throw new Error('BT4G: home returned no items');
    return rows;
  });
}

function _parseMagnetPage(html, url) {
  var m = /\/magnet\/([A-Za-z0-9]{32,40})/.exec(String(url || ''));
  var hash = m ? m[1] : null;
  var tm = /<title>([^<]*)<\/title>/.exec(html);
  var title = tm ? _dec(tm[1]).replace(/\s+Torrent download\s*$/i, '').replace(/^\s+|\s+$/g, '') : (hash || 'Unknown');
  var sm = /Seeders<\/span>\s*<span[^>]*>(?:<span[^>]*>)?(\d+)/.exec(html);
  var lm = /Leechers<\/span>\s*<span[^>]*>(?:<span[^>]*>)?(\d+)/.exec(html);
  var fm = /File Size<\/span>\s*<span[^>]*>([^<]+)<\/span>/.exec(html);
  var desc = [];
  if (fm) desc.push('Size: ' + _dec(fm[1]).replace(/^\s+|\s+$/g, ''));
  if (sm) desc.push('Seeders: ' + sm[1]);
  if (lm) desc.push('Leechers: ' + lm[1]);
  return { hash: hash, title: title, description: desc.join(' · ') || undefined };
}

function _magnet(hash, title) {
  var m = 'magnet:?xt=urn:btih:' + hash +
    '&dn=' + encodeURIComponent(String(title || hash).slice(0, 120));
  var i;
  for (i = 0; i < TRACKERS.length; i++) {
    m += '&tr=' + encodeURIComponent(TRACKERS[i]);
  }
  return m;
}

function getDetail(url, opts) {
  return _getText(url, 'detail').then(function (html) {
    var d = _parseMagnetPage(html, url);
    if (!d.hash) throw new Error('BT4G: bad magnet url');
    var det = { id: 'bt4g://magnet/' + d.hash, title: d.title, url: url,
      type: 'movie' };
    if (d.description) det.description = d.description;
    det.episodes = [{ id: 'bt4g://magnet/' + d.hash + '/1', title: 'Play',
      url: url, number: 1 }];
    return det;
  });
}

function getEpisodes(url, opts) {
  return _getText(url, 'episodes').then(function (html) {
    var d = _parseMagnetPage(html, url);
    if (!d.hash) throw new Error('BT4G: bad magnet url');
    return [{ id: 'bt4g://magnet/' + d.hash + '/1', title: 'Play',
      url: url, number: 1 }];
  });
}

function getVideoSources(episodeUrl, opts) {
  return _getText(episodeUrl, 'magnet page').then(function (html) {
    var d = _parseMagnetPage(html, episodeUrl);
    if (!d.hash) throw new Error('BT4G: bad magnet url');
    var src = { url: _magnet(d.hash, d.title),
      label: '[BT4G] ' + d.title.slice(0, 90) };
    var q = _qualityOf(d.title);
    if (q) src.quality = q;
    return [src];
  }).catch(function (e) {
    throw new Error('BT4G: video sources failed (' +
      (e && e.message ? e.message : 'fetch failed') + ')');
  });
}
