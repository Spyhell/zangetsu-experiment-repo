// WcoFlix — cartoons/anime source for the Zangetsu provider repo (wcoflix.tv).
//
// Chain (all plain GET, no login):
//   /subbed-anime-list, /dubbed-anime-list, /cartoon-list
//       -> <li><a href="/anime/<slug>" title="<Title>"> (full A-Z catalogs;
//          POST /search is bot-blocked from datacenters, so search scans these)
//   /anime/<slug>                       -> og: meta + episode links
//   /<slug>-episode-<N>-english-(subbed|dubbed)   (anime)
//   /<slug>-season-<S>-episode-<N>-<title>         (cartoons)
//       -> iframe embed.wcostream.com/inc/embed/index.php?file=...&pid=..&h=..&t=..
//   embed.wcostream.com/inc/embed/video-js.php?<same query>
//       -> $.getJSON("/inc/embed/getvidlink.php?v=neptun/...&embed=neptun&fullhd=1")
//   getvidlink.php (needs X-Requested-With: XMLHttpRequest)
//       -> {enc, hd, fhd, server, cdn} -> server/getvid?evid=<token> (direct mp4)
//
// Byte-verified 2026-10-16: final URL returns HTTP 206 video/mp4,
// ftyp/isom + moov boxes. Sub and dub cuts are separate episode entries and
// are tagged kind:'sub'/'dub' (+ dubBadge on items).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'wcoflix';

var SITE = 'https://www.wcoflix.tv';
var EMBED = 'https://embed.wcostream.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ── Network ──────────────────────────────────────────────────────────────────
function _get(url, ref, extraHeaders, timeoutMs) {
  var headers = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  if (extraHeaders) {
    for (var k in extraHeaders) headers[k] = extraHeaders[k];
  }
  var p = fetch(url, { headers: headers }).then(function (r) {
    if (!r.ok) throw new Error('WcoFlix: HTTP ' + r.status + ' ' + url);
    return String((r && r.body) || '');
  });
  if (typeof setTimeout !== 'function') return p;
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () {
      reject(new Error('WcoFlix: timeout ' + url));
    }, timeoutMs || 15000);
    p.then(function (v) { clearTimeout(t); resolve(v); },
           function (e) { clearTimeout(t); reject(e); });
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function _dec(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function _og(html, prop) {
  var m = String(html || '').match(
    new RegExp('<meta\\s+property="og:' + prop + '"\\s+content="([^"]*)"', 'i'));
  return m ? _dec(m[1]) : null;
}
function _metaDesc(html) {
  var m = String(html || '').match(
    /<meta\s+name="description"\s+content="([^"]*)"/i);
  return m ? _dec(m[1]) : null;
}
function _cleanTitle(t) {
  t = _dec(t || '').trim();
  t = t.replace(/\s*-\s*Watch Cartoons and Anime Online in HD for Free\s*$/i, '')
       .replace(/\s+Online\s*-\s*(Movies|Anime|Cartoons)?\s*$/i, '')
       .replace(/\s*-\s*WCOFun\s*$/i, '').trim();
  return t;
}

// Catalog lists: [path, row title, dubBadge]
var LISTS = [
  ['/subbed-anime-list', 'Anime', 'SUB'],
  ['/dubbed-anime-list', 'Dubbed Anime', 'DUB'],
  ['/cartoon-list', 'Cartoons', null]
];

function _parseList(html, badge) {
  var out = [], seen = {}, m;
  // Some lists (dubbed) ship literal "\n" escapes and put the title in the
  // link text instead of a title attribute.
  var clean = String(html || '').replace(/\\n/g, ' ');
  var re = /<li[^>]*>\s*<a\s+href="(\/anime\/[^"]+)"(?:[^>]*?\btitle="([^"]*)")?[^>]*>([^<]{0,120})<\/a>/gi;
  while ((m = re.exec(clean)) !== null) {
    var href = m[1];
    var title = _dec((m[2] || m[3] || '')).trim();
    if (!title || seen[href]) continue;
    seen[href] = 1;
    var url = SITE + href;
    var item = { id: url, title: title, url: url, type: 'anime' };
    if (badge) item.dubBadge = badge;
    out.push(item);
  }
  return out;
}

function _fetchList(entry) {
  return _get(SITE + entry[0]).then(function (html) {
    return { title: entry[1], items: _parseList(html, entry[2]) };
  });
}

// Episode links: <a href="/...-episode-<N>..." class="dark-episode-item"
// data-season="s1-0" data-lang="dub">. Anime: /x-episode-<N>-english-(subbed|dubbed);
// cartoons: /x-season-<S>-episode-<N>-<title>.
function _parseEpisodes(html) {
  var out = [], seen = {}, m;
  var re = /<a\s+href="(\/[^"]*?-episode-(\d+)[^"]*)"[^>]*class="dark-episode-item"[^>]*>/gi;
  while ((m = re.exec(String(html || ''))) !== null) {
    var href = m[1];
    if (seen[href]) continue;
    seen[href] = 1;
    var n = parseInt(m[2], 10);
    if (!n) continue;
    var tag = m[0];
    var langM = tag.match(/data-lang="(sub|dub)"/i);
    var kind = langM ? langM[1].toLowerCase()
      : (/english-dubbed/i.test(href) ? 'dub'
        : (/english-subbed/i.test(href) ? 'sub' : null));
    var sm = href.match(/-season-(\d+)-episode-/i);
    var label = 'Episode ' + n;
    if (sm) label = 'S' + sm[1] + ' Ep' + n;
    if (kind === 'dub') label += ' (Dub)';
    var ep = { id: SITE + href, title: label, url: SITE + href, number: n };
    if (kind) ep.kind = kind;
    out.push(ep);
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function getInfo() {
  return { name: 'WcoFlix', lang: 'en', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function getHome(opts) {
  return Promise.all(LISTS.map(_fetchList)).then(function (rows) {
    return rows.map(function (r) {
      return { title: r.title, items: r.items.slice(0, 18) };
    }).filter(function (r) { return r.items.length; });
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return Promise.resolve([]);
  return Promise.all(LISTS.map(_fetchList)).then(function (rows) {
    var out = [], seen = {}, i, j;
    for (i = 0; i < rows.length; i++) {
      var items = rows[i].items;
      for (j = 0; j < items.length; j++) {
        var it = items[j];
        if (seen[it.id]) continue;
        if (it.title.toLowerCase().indexOf(q) === -1) continue;
        seen[it.id] = 1;
        out.push(it);
        if (out.length >= 40) break;
      }
      if (out.length >= 40) break;
    }
    return out;
  });
}

function getDetail(url, opts) {
  url = String(url || '');
  if (url.indexOf('http') !== 0) url = SITE + (url.charAt(0) === '/' ? url : '/' + url);
  return _get(url).then(function (html) {
    var title = _cleanTitle(_og(html, 'title') || '');
    if (!title) {
      var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      title = h1 ? _cleanTitle(h1[1].replace(/<[^>]+>/g, ' ')) : 'Unknown';
    }
    if (/404|not found/i.test(title) && html.length < 8000)
      throw new Error('WcoFlix: title not found');
    return { id: url, title: title || 'Unknown', url: url, type: 'anime',
      cover: _og(html, 'image') || undefined,
      description: _metaDesc(html) || _og(html, 'description') || undefined,
      episodes: _parseEpisodes(html) };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function _kindFromUrl(url) {
  url = String(url || '');
  if (/english-dubbed/i.test(url)) return 'dub';
  if (/english-subbed/i.test(url)) return 'sub';
  return null;
}

function getVideoSources(episodeUrl) {
  var url = String(episodeUrl || '');
  if (url.indexOf('http') !== 0) url = SITE + (url.charAt(0) === '/' ? url : '/' + url);
  if (url.indexOf('wcoflix.tv/') === -1)
    return Promise.reject(new Error('WcoFlix: bad episode url'));
  var kind = _kindFromUrl(url);
  var epRef = url;
  return _get(url, SITE + '/').then(function (html) {
    var m = html.match(
      /<iframe[^>]+src="(https?:\/\/embed\.wcostream\.com\/inc\/embed\/index\.php\?[^"]+)"/i);
    if (!m) throw new Error('WcoFlix: no video embed found');
    var embedUrl = _dec(m[1]);
    var query = embedUrl.split('?')[1] || '';
    if (!query) throw new Error('WcoFlix: bad embed url');
    var playerUrl = EMBED + '/inc/embed/video-js.php?' + query;
    return _get(playerUrl, epRef).then(function (phtml) {
      return { phtml: phtml, playerUrl: playerUrl };
    });
  }).then(function (ctx) {
    var m = ctx.phtml.match(/"(\/inc\/embed\/getvidlink\.php\?[^"]+)"/);
    if (!m) throw new Error('WcoFlix: no stream resolver found');
    var glUrl = EMBED + _dec(m[1]);
    return _get(glUrl, ctx.playerUrl,
      { 'X-Requested-With': 'XMLHttpRequest' }).then(function (body) {
      var j;
      try { j = JSON.parse(body); }
      catch (e) { throw new Error('WcoFlix: bad stream data'); }
      if (!j || !j.server || !j.enc) throw new Error('WcoFlix: no stream tokens');
      return { j: j, ref: ctx.playerUrl };
    });
  }).then(function (ctx) {
    var j = ctx.j, server = String(j.server).replace(/\/$/, '');
    var hdrs = { 'User-Agent': UA, 'Referer': ctx.ref };
    var quals = [
      ['fhd', '1080p'], ['hd', '720p'], ['enc', '480p']
    ];
    var out = [], i;
    for (i = 0; i < quals.length; i++) {
      var tok = j[quals[i][0]];
      if (!tok) continue;
      out.push({ url: server + '/getvid?evid=' + tok,
        quality: quals[i][1], label: 'WcoFlix ' + quals[i][1],
        container: 'mp4', headers: hdrs,
        kind: kind || undefined,
        audioLang: kind === 'dub' ? 'en' : undefined });
    }
    if (!out.length) throw new Error('WcoFlix: no playable streams');
    return out;
  });
}
