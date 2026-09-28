// AnimeX (animex.one) — sub & dub anime in HD HLS.
// Chain: AniList GraphQL (search / home / details) -> animex.one
// __data.json (internal slug + episode count) -> pp.animex.one
// /rest/api/servers + /rest/api/sources (HLS master + soft subtitles).
// ES5 only (QuickJS): var/function, no arrows, no template literals.

var API = 'https://animex.one';
var PP = 'https://pp.animex.one';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var VERSION = '1.0.1';

function getInfo() {
  return {
    name: 'AnimeX',
    lang: 'en',
    baseUrl: API,
    logo: API + '/favicon.ico',
    type: 'anime',
    version: VERSION
  };
}

// ---------- tiny http/json helpers (never hang silently) ----------
function _get(url, headers) {
  return fetch(url, { headers: headers || { 'User-Agent': UA } }).then(function (r) {
    if (!r || !r.ok) throw new Error('AnimeX: HTTP ' + (r && r.status) + ' for ' + url);
    return r;
  });
}
function _getJson(url, headers) {
  return _get(url, headers).then(function (r) { return r.json(); });
}
function _gql(query, vars) {
  return fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query: query, variables: vars || {} })
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('AnimeX: AniList HTTP ' + (r && r.status));
    return r.json();
  }).then(function (d) {
    if (!d || !d.data) throw new Error('AnimeX: bad AniList response');
    return d.data;
  });
}

// Race a promise against a timer so a hanging host can never stall the
// stream list forever. If the runtime has no timers, returns the promise
// unchanged.
function _raceTimeout(promise, ms, expired) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) {
    t = setTimeout(function () { resolve(expired); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}

// ---------- AniList mapping ----------
var FIELDS = 'id title { romaji english } coverImage { large extraLarge } ' +
  'bannerImage description episodes averageScore popularity';

function _title(m) {
  var t = m && m.title;
  return String((t && (t.english || t.romaji)) || 'Unknown title');
}
function _cover(m) {
  var c = m && m.coverImage;
  return (c && (c.extraLarge || c.large)) || null;
}
function _plain(html) {
  try {
    if (typeof htmlText === 'function') return htmlText(String(html || ''));
  } catch (e) {}
  return String(html || '').replace(/<[^>]*>/g, ' ');
}
function _item(m) {
  return {
    id: 'ax-' + m.id,
    title: _title(m),
    url: 'animex://anilist/' + m.id,
    type: 'anime',
    cover: _cover(m),
    banner: (m && m.bannerImage) || null
  };
}

// ---------- home / search (AniList, no auth) ----------
function getHome() {
  var q = 'query ($sort: [MediaSort]) { Page(page: 1, perPage: 14) { ' +
    'media(type: ANIME, sort: $sort) { ' + FIELDS + ' } } }';
  var rows = [
    { title: 'Trending Now', sort: ['TRENDING_DESC'] },
    { title: 'Most Popular', sort: ['POPULARITY_DESC'] },
    { title: 'Top Rated', sort: ['SCORE_DESC'] }
  ];
  return Promise.all(rows.map(function (row) {
    return _gql(q, { sort: row.sort }).then(function (d) {
      return { title: row.title, items: (d.Page.media || []).map(_item) };
    });
  }));
}

function search(query, page) {
  page = page && page > 0 ? page : 1;
  var q = 'query ($s: String, $p: Int) { Page(page: $p, perPage: 20) { ' +
    'media(search: $s, type: ANIME, sort: SEARCH_MATCH) { ' + FIELDS + ' } } }';
  return _gql(q, { s: String(query), p: page }).then(function (d) {
    return (d.Page.media || []).map(_item);
  });
}

// ---------- animex internal slug ----------
// SvelteKit devalue-ish payload: nodes[1].data = [dict, keyMap, ...values]
// where keyMap maps field names to value indexes.
function _parseSlugPayload(d) {
  try {
    var nodes = d && d.nodes;
    var data = nodes && nodes[1] && nodes[1].data;
    if (data && data.length) {
      for (var i = 0; i < data.length; i++) {
        var km = data[i];
        if (km && typeof km === 'object' && km.slug != null &&
            typeof data[km.slug] === 'string') {
          var eps = km.episodeCount != null ? (data[km.episodeCount] | 0) : 0;
          return { slug: data[km.slug], episodeCount: eps };
        }
      }
    }
  } catch (e) {}
  throw new Error('AnimeX: this title is not available for streaming');
}

function _loadAnime(anilistId) {
  var detailP = _gql('query ($id: Int) { Media(id: $id, type: ANIME) { ' + FIELDS + ' } }',
    { id: parseInt(anilistId, 10) });
  var slugP = _getJson(API + '/anime/' + anilistId + '/__data.json?x-sveltekit-invalidated=01',
      { 'User-Agent': UA, 'x-sveltekit-invalidated': '01' })
    .then(_parseSlugPayload);
  return Promise.all([detailP, slugP]).then(function (res) {
    var m = res[0].Media;
    if (!m) throw new Error('AnimeX: title not found');
    var eps = res[1].episodeCount || m.episodes || 0;
    return { media: m, slug: res[1].slug, episodeCount: eps };
  });
}

function _episodes(slug, count, anilistId) {
  var out = [];
  for (var i = 1; i <= count; i++) {
    out.push({
      id: 'ax-' + anilistId + '-e' + i,
      title: 'Episode ' + i,
      url: 'animex://watch/' + slug + '/' + i,
      number: i
    });
  }
  return out;
}

function getDetail(url) {
  var id = String(url).split('/').pop();
  return _loadAnime(id).then(function (a) {
    var m = a.media;
    return {
      id: 'ax-' + m.id,
      title: _title(m),
      url: url,
      type: 'anime',
      cover: _cover(m),
      banner: m.bannerImage || null,
      description: _plain(m.description),
      episodes: _episodes(a.slug, a.episodeCount, m.id)
    };
  });
}

function getEpisodes(url) {
  var id = String(url).split('/').pop();
  return _loadAnime(id).then(function (a) {
    return _episodes(a.slug, a.episodeCount, a.media.id);
  });
}

// ---------- subtitles ----------
var LANG2 = {
  english: 'en', arabic: 'ar', french: 'fr', german: 'de', spanish: 'es',
  portuguese: 'pt', italian: 'it', russian: 'ru', indonesian: 'id', malay: 'ms',
  thai: 'th', vietnamese: 'vi', hindi: 'hi', turkish: 'tr', dutch: 'nl',
  polish: 'pl', ukrainian: 'uk', chinese: 'zh', japanese: 'ja', korean: 'ko'
};
function _mapSubs(tracks) {
  var out = [], seen = {};
  (tracks || []).forEach(function (t) {
    if (!t || !t.url) return;
    var base = String(t.lang || '').toLowerCase().split(/[^a-z]/)[0];
    var lang = LANG2[base] || 'en';
    if (seen[lang]) return;
    seen[lang] = 1;
    out.push({ url: String(t.url), lang: lang, label: String(t.label || t.lang || lang) });
  });
  return out;
}

// ---------- quality expansion ----------
function _expandQualities(masterUrl, hdrs, kind, subs, tag) {
  function autoEntry(ct) {
    return { url: masterUrl, quality: 'Auto', label: tag + ' Auto',
      container: ct, headers: hdrs, kind: kind,
      audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: subs };
  }
  if (!/\.m3u8(\?|$)/i.test(String(masterUrl))) {
    return Promise.resolve([autoEntry('mp4')]);
  }
  var bodyP = fetch(masterUrl, { headers: { 'User-Agent': UA, 'Referer': hdrs.Referer } })
    .then(function (r) { return String((r && r.body) || ''); });
  bodyP.catch(function () {}); // late failures after a timeout stay silent
  return _raceTimeout(bodyP, 5000, '').then(function (body) {
      if (body.indexOf('#EXT-X-STREAM-INF') === -1) return [autoEntry('hls')];
      var base = String(masterUrl).replace(/[^/]*(\?.*)?$/, '');
      var origin = (String(masterUrl).match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
      var re = /#EXT-X-STREAM-INF:([^\r\n]*)\r?\n([^\r\n]+)/g, m;
      var vars = [], seen = {};
      while ((m = re.exec(body)) !== null) {
        var uri = m[2].trim();
        if (!uri || uri.charAt(0) === '#') continue;
        var url = uri;
        if (!/^https?:\/\//i.test(uri)) url = (uri.charAt(0) === '/') ? origin + uri : base + uri;
        if (seen[url]) continue;
        seen[url] = 1;
        var hm = m[1].match(/RESOLUTION=\d+x(\d+)/i);
        var bw = m[1].match(/BANDWIDTH=(\d+)/i);
        vars.push({ url: url, h: hm ? parseInt(hm[1], 10) : 0, bw: bw ? parseInt(bw[1], 10) : 0 });
      }
      if (!vars.length) return [autoEntry('hls')];
      vars.sort(function (a, b) { return (b.h - a.h) || (b.bw - a.bw); });
      var out = [autoEntry('hls')], i, v;
      for (i = 0; i < vars.length; i++) {
        v = vars[i];
        out.push({ url: v.url, quality: v.h ? (v.h + 'p') : 'Auto',
          label: tag + ' ' + (v.h ? (v.h + 'p') : 'Auto'),
          container: 'hls', headers: hdrs, kind: kind,
          audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: subs });
      }
      return out;
    })
    .catch(function () { return [autoEntry('hls')]; });
}

// ---------- video sources ----------
function _providerSources(pid, slug, ep, kind, attempt) {
  var u = PP + '/rest/api/sources?id=' + encodeURIComponent(slug) +
    '&epNum=' + encodeURIComponent(ep) +
    '&type=' + kind + '&providerId=' + encodeURIComponent(pid);
  return _getJson(u).then(function (d) {
    var srcs = (d && d.sources) || [];
    if (!srcs.length || !srcs[0].url) throw new Error('AnimeX: empty sources');
    var dh = (d && d.headers) || {};
    var hdrs = { 'User-Agent': dh['User-Agent'] || UA };
    if (dh.Referer) hdrs.Referer = dh.Referer;
    if (dh.Origin) hdrs.Origin = dh.Origin;
    var subs = _mapSubs(d.tracks || []);
    var tag = (kind === 'dub' ? 'DUB' : 'SUB') + ' [' + pid + ']';
    return _expandQualities(String(srcs[0].url), hdrs, kind, subs, tag);
  }).catch(function (e) {
    if (!attempt) return _providerSources(pid, slug, ep, kind, 1); // one retry
    throw e;
  });
}

// Query every provider in parallel; keep entries from all that succeed
// (default provider first). Different providers use different CDNs, so if
// one CDN is unreachable from the device, another entry may still play.
function _collectAll(providers, slug, ep, kind) {
  var sorted = (providers || []).slice().sort(function (a, b) {
    return ((b && b.default) ? 1 : 0) - ((a && a.default) ? 1 : 0);
  });
  return Promise.all(sorted.map(function (p) {
    return _providerSources(p.id, slug, ep, kind, 0).catch(function () { return null; });
  })).then(function (results) {
    var out = [];
    results.forEach(function (entries) { if (entries) out = out.concat(entries); });
    return out.length ? out : null;
  });
}

function getVideoSources(episodeUrl) {
  var rest = String(episodeUrl).replace('animex://watch/', '');
  var idx = rest.lastIndexOf('/');
  var slug = rest.slice(0, idx), ep = rest.slice(idx + 1);
  if (!slug || !ep) return Promise.reject(new Error('AnimeX: bad episode url'));
  var surl = PP + '/rest/api/servers?id=' + encodeURIComponent(slug) +
    '&epNum=' + encodeURIComponent(ep);
  return _getJson(surl).then(function (sv) {
    var subP = _collectAll(sv.subProviders, slug, ep, 'sub');
    var dubP = _collectAll(sv.dubProviders, slug, ep, 'dub');
    return Promise.all([subP, dubP]).then(function (res) {
      var out = [];
      if (res[0]) out = out.concat(res[0]);
      if (res[1]) out = out.concat(res[1]);
      if (!out.length) throw new Error('AnimeX: no working server for episode ' + ep);
      return out;
    });
  });
}
