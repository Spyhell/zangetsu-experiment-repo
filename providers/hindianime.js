// HindiAnime — Hindi/Tamil/Telugu dubbed anime (hindianime.world).
//
// Chain (all server-side, no login):
//   Site is a TanStack Start app backed by Supabase. Supabase REST is
//   unreachable from some networks, so this provider talks to the site's
//   own server functions (/_serverFn/<fnId>), which proxy Supabase:
//     trending: GET /_serverFn/ba53680698907a98eb39b5fd7707d96e88f1a26f6dd10fa94dcbbe09c25683c0
//     search:   GET /_serverFn/393937bf1d9de2e9c7c58fd299036c4061ab79805e9b01b76e2a3f9aff6ed398
//                      ?payload=<seroval {data:{query,page,pageSize}}>
//     detail:   GET /_serverFn/6baeabef4d80efc6730e4a7e2dbcfe52a8688d01ad36403b58d2dadd4312458d
//                      ?payload=<seroval {data:<slug>}>
//   Request payloads and responses use seroval sync-JSON; a minimal
//   (de)serializer is implemented below (no dependency).
//   Detail records carry seasons[].episodes[].streams[] (server, language,
//   provider, embed_url). VidMoly embeds resolve server-side:
//     GET <vidmoly embed> -> sources:[{file:'<signed master.m3u8>'}]
//   (same extraction as ToonStream; other embed hosts need a real browser
//   and are skipped). Quality expansion follows ToonStream's pattern with
//   a timeout-safe fallback to the single Auto entry.
// NOTE: the _serverFn ids are build hashes — if the site redeploys, they
// may change and this source will need new ids (symptom: 404 on _serverFn).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'hindianime';

var SITE = 'https://www.hindianime.world';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

var FN_TRENDING = 'ba53680698907a98eb39b5fd7707d96e88f1a26f6dd10fa94dcbbe09c25683c0';
var FN_SEARCH   = '393937bf1d9de2e9c7c58fd299036c4061ab79805e9b01b76e2a3f9aff6ed398';
var FN_DETAIL   = '6baeabef4d80efc6730e4a7e2dbcfe52a8688d01ad36403b58d2dadd4312458d';

function getInfo() {
  return { name: 'HindiAnime', lang: 'en', baseUrl: SITE,
    logo: SITE + '/favicon-192.png',
    type: 'anime', version: '1.0.0' };
}

// ── Network ─────────────────────────────────────────────────────────────────
function _raceTimeout(p, ms, what) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('HindiAnime: timed out (' + (what || 'request') + ')')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _get(url, ref) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json',
               'Referer': ref || SITE + '/', 'Origin': SITE }
  }).then(function (r) {
    if (!r.ok) throw new Error('HindiAnime: HTTP ' + r.status + ' for ' + url);
    return r.text();
  }), 20000, url);
}

// ── Minimal seroval sync-JSON (de)serializer ────────────────────────────────
// Tags observed from the live site: 0=number(s), 1=string(s), 9=array(a),
// 10=object(p:{k,v}), 11=back-reference(i). 25=Error (thrown).
var _svId = 0;
function _svSer(v) {
  var id = _svId++;
  var t = typeof v;
  if (v === null || v === undefined) return { t: 5, i: id };
  if (t === 'string') return { t: 1, i: id, s: v };
  if (t === 'number') return { t: 0, i: id, s: v };
  if (t === 'boolean') return { t: 4, i: id, v: v ? 1 : 0 };
  if (v instanceof Array) {
    var a = [];
    for (var k = 0; k < v.length; k++) a.push(_svSer(v[k]));
    return { t: 9, i: id, a: a };
  }
  if (t === 'object') {
    var ks = [], vs = [];
    for (var key in v) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
      ks.push(key); vs.push(_svSer(v[key]));
    }
    return { t: 10, i: id, p: { k: ks, v: vs } };
  }
  return { t: 1, i: id, s: String(v) };
}
function _svPayload(data) {
  _svId = 0;
  var node = _svSer({ data: data });
  return encodeURIComponent(JSON.stringify({ t: node, f: [], m: [] }));
}
function _svDeser(n, byId) {
  byId = byId || {};
  if (n === null || typeof n !== 'object') return n;
  var t = n.t;
  if (t === 0) return n.s;                       // number
  if (t === 1 || t === 2) { byId[n.i] = n.s; return n.s; }  // string
  if (t === 4) return !!n.v;                     // boolean
  if (t === 5) return null;
  if (t === 9) {                                 // array
    var a = []; byId[n.i] = a;
    var arr = n.a || [];
    for (var k = 0; k < arr.length; k++) a.push(_svDeser(arr[k], byId));
    return a;
  }
  if (t === 10) {                                // object
    var o = {}; byId[n.i] = o;
    var ks = n.p.k, vs = n.p.v;
    for (var j = 0; j < ks.length; j++) o[ks[j]] = _svDeser(vs[j], byId);
    return o;
  }
  if (t === 11) return byId[n.i];                 // reference
  if (t === 25) throw new Error('HindiAnime: server error');
  if ('s' in n) { byId[n.i] = n.s; return n.s; }
  if ('v' in n) return n.v;
  return n;
}
function _svResult(text) {
  var snap = JSON.parse(text);
  var val = _svDeser(snap);
  return (val && typeof val === 'object' && 'result' in val) ? val.result : val;
}

function _callFn(fnId, data, ref) {
  var url = SITE + '/_serverFn/' + fnId;
  if (data !== undefined) url += '?payload=' + _svPayload(data);
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA,
               'Accept': 'application/x-tss-framed, application/x-ndjson, application/json',
               'x-tsr-serverFn': 'true',
               'Referer': ref || SITE + '/', 'Origin': SITE }
  }).then(function (r) {
    if (!r.ok) throw new Error('HindiAnime: serverFn HTTP ' + r.status);
    return r.text();
  }).then(_svResult), 25000, 'serverFn ' + fnId.slice(0, 8));
}

// ── Mapping ─────────────────────────────────────────────────────────────────
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _dubBadge(langs) {
  var hasDub = false, hasSub = false, i, l;
  for (i = 0; i < (langs || []).length; i++) {
    l = String(langs[i]).toLowerCase();
    if (/hindi|tamil|telugu|multi-audio|tamil|dubbed/.test(l)) hasDub = true;
    if (/japanese|english|sub/.test(l) && !/dubbed/.test(l)) hasSub = true;
  }
  if (hasDub && hasSub) return 'SUB DUB';
  if (hasDub) return 'DUB';
  return 'SUB';
}

function _mediaType(a) {
  return String(a.type || '').toLowerCase() === 'movie' ? 'movie' : 'anime';
}

function _toItem(a) {
  var slug = a.slug || a.id;
  return { id: String(a.id || slug), title: _trim(a.title) || String(slug),
    url: SOURCE_ID + '://anime/' + slug, type: _mediaType(a),
    cover: a.poster || null, banner: a.banner || null,
    dubBadge: _dubBadge(a.languages) };
}

function _toDetail(a) {
  var slug = a.slug || a.id;
  var eps = [];
  var seasons = a.seasons || [];
  for (var si = 0; si < seasons.length; si++) {
    var s = seasons[si];
    var list = s.episodes || [];
    for (var ei = 0; ei < list.length; ei++) {
      var e = list[ei];
      eps.push({
        id: String(e.id),
        title: (seasons.length > 1 ? 'S' + (s.number || (si + 1)) + ' ' : '')
          + 'E' + (e.number || (ei + 1)) + ' — ' + _trim(e.title || ('Episode ' + (ei + 1))),
        url: SOURCE_ID + '://ep/' + slug + '--' + String(e.id),
        number: typeof e.number === 'number' ? e.number : (ei + 1),
        thumbnail: e.thumbnail || null
      });
    }
  }
  return { id: String(a.id || slug), title: _trim(a.title) || String(slug),
    url: SOURCE_ID + '://anime/' + slug, type: _mediaType(a),
    cover: a.poster || null, banner: a.banner || null,
    description: _trim(a.synopsis) || null,
    year: (a.year != null && a.year !== '') ? String(a.year) : null,
    episodes: eps };
}

// ── Required functions ──────────────────────────────────────────────────────
function getHome(opts) {
  return _callFn(FN_TRENDING).then(function (items) {
    items = items || [];
    return [{ title: 'Trending Now', items: items.map(_toItem) }];
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _callFn(FN_SEARCH, { query: q, page: page || 1, pageSize: 24 },
      SITE + '/browse').then(function (res) {
    var data = (res && res.data) || [];
    return data.map(_toItem);
  });
}

function _slugOf(url) {
  var m = /^hindianime:\/\/anime\/(.+)$/.exec(String(url || ''));
  if (m) return m[1];
  m = /^hindianime:\/\/ep\/(.+)--[^-]+$/.exec(String(url || ''));
  return m ? m[1] : null;
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('HindiAnime: bad detail url'));
  return _callFn(FN_DETAIL, slug, SITE + '/anime/' + slug).then(function (a) {
    if (!a) throw new Error('HindiAnime: title not found');
    return _toDetail(a);
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ── Streams: VidMoly embeds -> signed HLS ───────────────────────────────────
var _VIDMOLY_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?vidmoly\.[a-z]+\//i;

function _expandQualities(masterUrl, label, ref) {
  return _get(masterUrl, ref).then(function (text) {
    var base = masterUrl.replace(/[^\/]*$/, '');
    var out = [], seen = {};
    var re = /#EXT-X-STREAM-INF:([^\n]*)\n([^\n]+)/g, m;
    while ((m = re.exec(text)) !== null) {
      var attrs = m[1], uri = _trim(m[2]);
      if (/^\s*#/.test(uri)) continue;
      if (!/^https?:\/\//i.test(uri)) uri = base + uri;
      var key = uri.split('?')[0];
      if (seen[key]) continue;
      seen[key] = 1;
      var rm = /RESOLUTION=\d+x(\d+)/i.exec(attrs);
      var e = { url: uri, label: label, container: 'hls',
                headers: { 'Referer': ref || SITE + '/', 'User-Agent': UA } };
      if (rm) e.quality = rm[1] + 'p';
      out.push(e);
    }
    out.sort(function (a, b) {
      return parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10);
    });
    out.unshift({ url: masterUrl, label: label + ' · Auto', container: 'hls',
                  quality: 'Auto',
                  headers: { 'Referer': ref || SITE + '/', 'User-Agent': UA } });
    return out;
  }).catch(function () {
    // Master playlist unreachable from this network (the signed media hosts
    // sometimes block datacenter IPs); still hand the app the signed URL —
    // it resolves on real devices.
    return [{ url: masterUrl, label: label + ' · Auto', container: 'hls',
              quality: 'Auto',
              headers: { 'Referer': ref || SITE + '/', 'User-Agent': UA } }];
  });
}

function _resolveVidmoly(embedUrl, ref) {
  return _raceTimeout(_get(embedUrl, ref), 20000, 'vidmoly embed').then(function (html) {
    var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*'([^']+)'/);
    if (!m) return [];
    var master = m[1];
    if (!/^https?:\/\//i.test(master)) return [];
    return _expandQualities(master, 'HindiAnime [VidMoly]', embedUrl);
  }).catch(function () { return []; });
}

function _findEpisode(a, epId) {
  var seasons = a.seasons || [];
  for (var si = 0; si < seasons.length; si++) {
    var list = seasons[si].episodes || [];
    for (var ei = 0; ei < list.length; ei++) {
      if (String(list[ei].id) === String(epId)) return list[ei];
    }
  }
  return null;
}

function getVideoSources(episodeUrl) {
  var m = /^hindianime:\/\/ep\/(.+)--(.+)$/.exec(String(episodeUrl || ''));
  if (!m) return Promise.reject(new Error('HindiAnime: bad episode url'));
  var slug = m[1], epId = m[2];
  return _callFn(FN_DETAIL, slug, SITE + '/anime/' + slug).then(function (a) {
    if (!a) throw new Error('HindiAnime: title not found');
    var ep = _findEpisode(a, epId);
    if (!ep) throw new Error('HindiAnime: episode not found');
    var streams = ep.streams || [];
    var jobs = [];
    for (var i = 0; i < streams.length; i++) {
      var u = streams[i].embed_url || streams[i].url;
      if (u && _VIDMOLY_RE.test(u)) {
        jobs.push({ lang: String(streams[i].language || ''),
                    p: _resolveVidmoly(u, SITE + '/') });
      }
    }
    return Promise.all(jobs.map(function (j) { return j.p; })).then(function (lists) {
      var out = [];
      for (var j = 0; j < lists.length; j++) {
        for (var k = 0; k < lists[j].length; k++) {
          var e = lists[j][k];
          if (/hindi|tamil|telugu|multi/i.test(jobs[j].lang)) e.kind = 'dub';
          out.push(e);
        }
      }
      return out;
    });
  });
}
