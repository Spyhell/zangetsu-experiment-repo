// AniWorld — German anime source (aniworld.to).
//
// Chain (all verified live 2026-11-03):
//   /beliebte-animes, /neu        -> series cards (/anime/stream/<slug>, cover)
//   /animes                        -> full catalog (2506 titles + alt titles);
//                                     client-side title filter = search
//                                     (the /ajax/search endpoint hangs from
//                                     datacenter IPs)
//   /anime/stream/<slug>           -> seasons (/staffel-<n>), cover, meta
//   /anime/stream/<slug>/staffel-<n> -> /staffel-<n>/episode-<e> links
//   /anime/stream/<slug>/staffel-<n>/episode-<e>
//       -> hoster blocks: <li data-lang-key data-link-target="/redirect/<id>"
//          1 = Deutsch (Ger dub), 2 = Eng subs, 3 = Ger subs
//       -> /redirect/<id> (301) -> vidmoly embed
//       -> embed HTML: sources: [{ file: '<m3u8 master>' }] (static, no JS)
// VOE / Doodstream / Filemoon embeds need JS/token dances the app runtime
// cannot run server-side, so only Vidmoly links are resolved in v1.0.0.
// NOTE: the vmeas.cloud CDN 403s datacenter IPs, so the HLS URL cannot be
// byte-verified from the ops VM — phone playback is the verdict.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — none needed here.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'aniworld';

var _DOMAINS = ['https://aniworld.to'];
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

/* data-lang-key -> { label, kind } */
var LANGS = {
  '1': { label: 'Ger-Dub', kind: 'dub' },
  '2': { label: 'Eng-Sub', kind: 'sub' },
  '3': { label: 'Ger-Sub', kind: 'sub' }
};

function getInfo() {
  return { name: 'AniWorld', lang: 'de', baseUrl: _DOMAINS[0],
    logo: _DOMAINS[0] + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function getSettings() {
  return [
    { key: 'domain', label: 'Site domain', type: 'select', def: 'auto',
      options: [
        { value: 'auto', label: 'Auto (recommended)' },
        { value: 'https://aniworld.to', label: 'aniworld.to' },
        { value: 'custom', label: 'Custom domain (set below)' } ] },
    { key: 'customDomain',
      label: 'Custom domain (https://..., used when Domain = Custom)',
      type: 'text', def: '' },
    { key: 'audio', label: 'Preferred audio', type: 'select', def: 'auto',
      options: [
        { value: 'auto', label: 'Auto (Dub first)' },
        { value: '1', label: 'Deutsch (Dub)' },
        { value: '3', label: 'Mit Untertitel Deutsch' },
        { value: '2', label: 'Mit Untertitel Englisch' } ] }
  ];
}
function _cfg(k, d) {
  try {
    var s = (typeof __settings !== 'undefined' && __settings)
      ? (__settings[SOURCE_ID] || {}) : {};
    var v = s[k];
    return (v === undefined || v === null || v === '') ? d : v;
  } catch (e) { return d; }
}
function _normBase(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
function _base() {
  var d = _cfg('domain', 'auto');
  if (d === 'custom') return _normBase(_cfg('customDomain', '')) || _DOMAINS[0];
  if (d && d !== 'auto') return _normBase(d) || _DOMAINS[0];
  return _DOMAINS[0];
}

function _get(url, ref) {
  var h = { 'User-Agent': UA, 'Referer': ref || _base() + '/' };
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('AniWorld: HTTP ' + r.status + ' (' + url + ')');
    return r.body || '';
  }).catch(function (e) {
    throw new Error('AniWorld: ' +
      (e && e.message ? e.message : 'fetch failed'));
  });
}
function _dec(s) {
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function _abs(p) {
  if (/^https?:\/\//i.test(p)) return p;
  return _base() + (p.charAt(0) === '/' ? p : '/' + p);
}

/* Series cards: <a href="/anime/stream/<slug>" title="<Title> stream online...">
 * with a nearby <img data-src="<cover>">. */
function _parseCards(html) {
  var out = [], seen = {}, re = /<a[^>]*href="(\/anime\/stream\/([a-z0-9-]+))"[^>]*title="([^"]*)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[2];
    if (seen[slug]) continue;
    seen[slug] = 1;
    var title = _dec(m[3].split(' stream online')[0]);
    if (!title) continue;
    /* find the card's cover: first data-src after the <a> */
    var rest = html.slice(m.index, m.index + 2500);
    var cm = /data-src="([^"]+)"/i.exec(rest);
    var it = { id: 'aniworld://' + slug, title: title,
      url: 'aniworld://' + slug, type: 'anime' };
    if (cm) it.cover = _abs(cm[1]);
    out.push(it);
  }
  return out;
}

function getHome(opts) {
  var rows = [];
  return _get(_base() + '/beliebte-animes').then(function (h) {
    var items = _parseCards(h).slice(0, 24);
    if (items.length) rows.push({ title: 'Beliebte Animes', items: items });
    return _get(_base() + '/neu');
  }).then(function (h) {
    var items = _parseCards(h).slice(0, 24);
    if (items.length) rows.push({ title: 'Neu hinzugefugt', items: items });
    return rows;
  });
}

/* Search = client-side filter over the full /animes catalog
 * (<a ... data-alternative-title="..." href="/anime/stream/<slug>" ...>Title</a>). */
var _catalogCache = null;
function _catalog() {
  if (_catalogCache) return Promise.resolve(_catalogCache);
  return _get(_base() + '/animes').then(function (h) {
    var out = [], re = /<a[^>]*data-alternative-title="([^"]*)"[^>]*href="\/anime\/stream\/([a-z0-9-]+)"[^>]*>([^<]*)<\/a>/gi;
    var m;
    while ((m = re.exec(h)) !== null) {
      out.push({ slug: m[2], title: _dec(m[3]),
        alt: _dec(m[1]).toLowerCase() });
    }
    _catalogCache = out;
    return out;
  });
}
function search(query, page, opts) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return Promise.resolve([]);
  var words = q.split(/\s+/);
  return _catalog().then(function (cat) {
    var out = [], i, c, hay, ok, w;
    for (i = 0; i < cat.length && out.length < 30; i++) {
      c = cat[i];
      hay = (c.title + ' ' + c.alt).toLowerCase();
      ok = true;
      for (w = 0; w < words.length; w++) {
        if (hay.indexOf(words[w]) < 0) { ok = false; break; }
      }
      if (ok) out.push({ id: 'aniworld://' + c.slug, title: c.title,
        url: 'aniworld://' + c.slug, type: 'anime' });
    }
    return out;
  });
}

/* url: aniworld://<slug> | aniworld://<slug>/staffel-<n>/episode-<e> */
function _slugOf(url) {
  var m = /^aniworld:\/\/([a-z0-9-]+)/.exec(String(url || ''));
  return m ? m[1] : null;
}
function _epOf(url) {
  var m = /^aniworld:\/\/[a-z0-9-]+\/staffel-(\d+)\/episode-(\d+)/.exec(String(url || ''));
  return m ? { s: parseInt(m[1], 10), e: parseInt(m[2], 10) } : null;
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('AniWorld: bad url'));
  return _get(_base() + '/anime/stream/' + slug).then(function (h) {
    var tm = /<h1[^>]*>([^<]*)<\/h1>/i.exec(h);
    var title = tm ? _dec(tm[1]) : slug;
    var det = { id: 'aniworld://' + slug, title: title,
      url: 'aniworld://' + slug, type: 'anime' };
    var cm = /<img[^>]*data-src="([^"]+)"[^>]*itemprop="image"/i.exec(h) ||
      /<img[^>]*itemprop="image"[^>]*data-src="([^"]+)"/i.exec(h);
    if (cm) det.cover = _abs(cm[1]);
    var dm = /<p[^>]*class="description"[^>]*>([\s\S]*?)<\/p>/i.exec(h) ||
      /<div[^>]*id="beschreibung"[^>]*>([\s\S]*?)<\/div>/i.exec(h);
    if (dm) det.description = _dec(dm[1].replace(/<[^>]+>/g, ' ')).slice(0, 600);
    return det;
  });
}

function _episodesOfSeason(slug, season) {
  return _get(_base() + '/anime/stream/' + slug + '/staffel-' + season)
    .then(function (h) {
      var out = [], seen = {},
        re = new RegExp('href="(/anime/stream/' + slug +
          '/staffel-' + season + '/episode-(\\d+))"', 'gi'), m;
      while ((m = re.exec(h)) !== null) {
        var e = parseInt(m[2], 10);
        if (seen[e]) continue;
        seen[e] = 1;
        out.push({ id: 'aniworld://' + slug + '/staffel-' + season + '/episode-' + e,
          title: 'Staffel ' + season + ' · Episode ' + e,
          url: 'aniworld://' + slug + '/staffel-' + season + '/episode-' + e,
          number: e });
      }
      out.sort(function (a, b) { return a.number - b.number; });
      return out;
    }, function () { return []; });
}

function getEpisodes(url, opts) {
  var slug = _slugOf(url), ep = _epOf(url);
  if (!slug) return Promise.reject(new Error('AniWorld: bad url'));
  if (ep) {
    return [{ id: url, title: 'Staffel ' + ep.s + ' · Episode ' + ep.e,
      url: url, number: ep.e }];
  }
  return _get(_base() + '/anime/stream/' + slug).then(function (h) {
    var seasons = [], seen = {},
      re = new RegExp('href="(/anime/stream/' + slug + '/staffel-(\\d+))"', 'gi'), m;
    while ((m = re.exec(h)) !== null) {
      var s = parseInt(m[2], 10);
      if (!seen[s]) { seen[s] = 1; seasons.push(s); }
    }
    seasons.sort(function (a, b) { return a - b; });
    /* film-only entries expose a /filme page instead of seasons */
    if (!seasons.length && /\/anime\/stream\/[^"']*\/filme"/i.test(h)) {
      return [{ id: 'aniworld://' + slug + '/filme',
        title: 'Film', url: 'aniworld://' + slug + '/filme', number: 1 }];
    }
    if (!seasons.length) throw new Error('AniWorld: no seasons found');
    var chain = Promise.resolve([]), out = [];
    seasons.forEach(function (s) {
      chain = chain.then(function () {
        return _episodesOfSeason(slug, s).then(function (eps) {
          out = out.concat(eps);
        });
      });
    });
    return chain.then(function () {
      if (!out.length) throw new Error('AniWorld: no episodes found');
      return out;
    });
  });
}

/* Episode page -> [{ langKey, redirectId, host }] */
function _hosters(html) {
  var out = [], re = /<li[^>]*data-lang-key="(\d)"[^>]*data-link-target="\/redirect\/(\d+)"[^>]*>[\s\S]*?<h4[^>]*>([^<]*)<\/h4>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    out.push({ lang: m[1], id: m[2], host: _dec(m[3]).toLowerCase() });
  }
  return out;
}
function _resolveEmbed(id, ref) {
  /* Returns { embedUrl, html }. Some runtimes honor redirect:'manual'
   * (embedUrl = the 301 Location); others follow the redirect and hand us
   * the embed page itself (html set, embedUrl null). */
  return fetch(_base() + '/redirect/' + id, {
    headers: { 'User-Agent': UA, 'Referer': ref },
    redirect: 'manual'
  }).then(function (r) {
    var loc = null;
    try { loc = r.headers.get('location'); } catch (e) {}
    if (loc) {
      if (loc.charAt(0) === '/') loc = _base() + loc;
      return { embedUrl: loc, html: null };
    }
    var body = r.body || '';
    if (/vidmoly|sources:\s*\[/i.test(body)) return { embedUrl: null, html: body };
    throw new Error('AniWorld: redirect gave no target');
  }).catch(function (e) {
    throw new Error('AniWorld: redirect failed (' +
      (e && e.message ? e.message : 'fetch failed') + ')');
  });
}
/* Vidmoly embed: static `sources: [{ file: '<m3u8>' }]` in the HTML. */
function _vidmolyFile(html) {
  var m = /sources:\s*\[\s*\{\s*file:\s*'([^']+)'/i.exec(html) ||
    /file:\s*"([^"]+master\.m3u8[^"]*)"/i.exec(html);
  if (!m) throw new Error('AniWorld: no stream file in embed');
  return m[1];
}

function getVideoSources(episodeUrl, opts) {
  var slug = _slugOf(episodeUrl), ep = _epOf(episodeUrl);
  if (!slug) return Promise.reject(new Error('AniWorld: bad url'));
  var epPath = ep
    ? '/anime/stream/' + slug + '/staffel-' + ep.s + '/episode-' + ep.e
    : '/anime/stream/' + slug + '/filme';
  var pref = _cfg('audio', 'auto');
  return _get(_base() + epPath).then(function (h) {
    var hs = _hosters(h);
    if (!hs.length) throw new Error('AniWorld: no hosters listed');
    /* preferred audio first, then the rest; vidmoly only in v1.0.0 */
    hs.sort(function (a, b) {
      var pa = (pref === 'auto') ? (a.lang === '1' ? 0 : 1)
        : (a.lang === pref ? 0 : 1);
      var pb = (pref === 'auto') ? (b.lang === '1' ? 0 : 1)
        : (b.lang === pref ? 0 : 1);
      return pa - pb;
    });
    var vm = hs.filter(function (x) { return x.host.indexOf('vidmoly') >= 0; })
      .slice(0, 6);
    if (!vm.length) throw new Error('AniWorld: no Vidmoly hoster available');
    var chain = Promise.resolve([]), out = [];
    vm.forEach(function (t) {
      chain = chain.then(function () {
        return _resolveEmbed(t.id, _base() + epPath).then(function (r) {
          var got = r.html != null
            ? Promise.resolve(r.html)
            : _get(r.embedUrl, _base() + '/');
          return got.then(function (html) {
            var file = _vidmolyFile(html);
            var L = LANGS[t.lang] || { label: 'Stream', kind: 'sub' };
            out.push({ url: file, container: 'hls', kind: L.kind,
              label: '[Vidmoly] ' + L.label,
              headers: { 'Referer': r.embedUrl || (_base() + '/redirect/' + t.id),
                'User-Agent': UA } });
          });
        }, function () { /* host failed — try next */ });
      });
    });
    return chain.then(function () {
      if (!out.length) throw new Error('AniWorld: all hosters failed');
      return out;
    });
  });
}
