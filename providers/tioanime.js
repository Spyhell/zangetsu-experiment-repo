// TioAnime — anime sub-español source for the Zangetsu provider repo (tioanime.com).
//
// Chain (all plain HTTP, no login) — verified end-to-end from this VM 2026-11-12:
//   POST /api/search (form: value=<q>) -> JSON [{id, slug, title, type}]
//   GET  /                             -> home: <article class="anime"> cards
//   GET  /anime/<slug>                 -> var anime_info = ["<id>","<slug>","<title>","<date>"];
//                                          var episodes = [5,4,3,2,1];
//                                          var episodes_details = ["Hace 1 dia", ...]
//   GET  /ver/<slug>-<n>               -> var videos = [["Mega","https:\/\/mega.nz\/embed\/...",0,0],
//                                          ["Voe","https:\/\/voe.sx\/e\/...",0,0],
//                                          ["YourUpload","https:\/\/www.yourupload.com\/embed\/<code>",0,0]]
//   GET  YourUpload embed              -> https://vidcache.net:8161/<token>/video.mp4
//                                          (302 -> https://s<nn>.vidcache.net:8166/play/<token>/video.mp4)
//                                          HTTP 206, real MP4 (ftypisom) — byte-verified 2026-11-12.
//   Only YourUpload is used: Mega is not directly playable, Voe serves a
//   challenge page. The vidcache token is time-based: resolve fresh per
//   getVideoSources call, and forward the embed URL as Referer (the stream
//   302s without it). Spanish subs -> kind 'sub'.
//
// ES5 only. No atob/btoa/Buffer in the app runtime (none needed here).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'tioanime';

var SITE = 'https://tioanime.com';
var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var REF = SITE + '/';

// ── Network ──────────────────────────────────────────────────────────────────
// 2026-11-12: tioanime.com intermittently resets undici (Node) connections
// ("fetch failed" ~40% of requests) while curl and the app's Android stack
// succeed every time — same class as the mp4upload undici block. Retry each
// request up to 3 times; this also helps flaky mobile networks in-app.
function _delay(ms) {
  if (typeof setTimeout !== 'function') return Promise.resolve();
  return new Promise(function (res) { setTimeout(res, ms); });
}
function _fetchText(url, ref, timeoutMs, opts) {
  var headers = { 'User-Agent': UA, 'Referer': ref || REF };
  var o = opts || {};
  if (o.contentType) headers['Content-Type'] = o.contentType;
  var req = { headers: headers };
  if (o.method) req.method = o.method;
  if (o.body) req.body = o.body;
  var attempts = 0;
  function attempt() {
    attempts++;
    var p = fetch(url, req).then(function (r) {
      return { ok: r.ok, status: r.status, body: String((r && r.body) || '') };
    });
    p = _raceTimeout(p, timeoutMs || 12000, 'TioAnime: timeout ' + url);
    return p.catch(function (e) {
      if (attempts < 3) return _delay(400 * attempts).then(attempt);
      throw e;
    });
  }
  return attempt();
}
function _get(url, ref, timeoutMs) {
  return _fetchText(url, ref, timeoutMs).then(function (r) {
    if (!r.ok) throw new Error('TioAnime: HTTP ' + r.status + ' ' + url);
    return r.body;
  });
}
function _raceTimeout(p, ms, msg) {
  if (typeof setTimeout !== 'function') return p;
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error(msg)); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); },
           function (e) { clearTimeout(t); reject(e); });
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function _dec(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/\\\//g, '/');
}
function _cleanTitle(t) {
  return _dec(t || '').replace(/\s+/g, ' ').trim();
}
function _metaDesc(html) {
  var m = String(html || '').match(
    /<meta\s+name="description"\s+content="([^"]*)"/i);
  return m ? _cleanTitle(m[1]) : null;
}
function _slugOf(url) {
  var m = String(url || '').match(/\/anime\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}
function _item(slug, title, cover, type) {
  var href = SITE + '/anime/' + slug;
  var item = { id: href, title: _cleanTitle(title), url: href,
               type: (type === 'movie' ? 'movie' : 'anime') };
  if (cover) item.cover = cover;
  return item;
}
function _cover(id) {
  return id ? SITE + '/uploads/portadas/' + id + '.jpg' : null;
}

// ── Parsing ──────────────────────────────────────────────────────────────────
function _parseHome(html) {
  var out = [], seen = {}, m;
  var re = /<article class="anime[^"]*"[^>]*>[\s\S]{0,1500}?<a href="(\/anime\/([a-z0-9-]+))"[^>]*>[\s\S]{0,600}?<img src="([^"]+)" alt="([^"]*)"[^>]*>[\s\S]{0,600}?<span class="anime-type-peli">([^<]*)<\/span>/gi;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (seen[m[2]]) continue;
    seen[m[2]] = 1;
    var badge = _cleanTitle(m[5]);
    out.push(_item(m[2], m[4], SITE + m[3],
                   badge.toLowerCase().indexOf('pelicula') !== -1 ? 'movie' : 'anime'));
  }
  return out;
}

function _parseDetail(html, slug) {
  var info = null, m;
  m = String(html || '').match(/var anime_info\s*=\s*\[([^\]]*)\]/);
  if (m) {
    var parts = m[1].split(',').map(function (p) {
      return String(p || '').replace(/^["']|["']$/g, '').trim();
    });
    info = { id: parts[0] || null, slug: parts[1] || slug,
             title: parts[2] || null };
  }
  var eps = [];
  m = String(html || '').match(/var episodes\s*=\s*\[([^\]]*)\]/);
  if (m && m[1].trim()) {
    eps = m[1].split(',').map(function (n) { return parseInt(n, 10); })
      .filter(function (n) { return !isNaN(n); });
  }
  var details = [];
  m = String(html || '').match(/var episodes_details\s*=\s*\[([\s\S]*?)\]/);
  if (m) {
    var dm;
    var dre = /"([^"]*)"/g;
    while ((dm = dre.exec(m[1])) !== null) details.push(dm[1]);
  }
  var badge = null;
  m = String(html || '').match(/<span class="anime-type-peli">([^<]*)<\/span>/);
  if (m) badge = _cleanTitle(m[1]);
  var type = (badge && badge.toLowerCase().indexOf('pelicula') !== -1)
    ? 'movie' : 'anime';
  var title = info && info.title ? info.title
    : (function () {
        var t = String(html || '').match(/<title>([^<]*)<\/title>/i);
        return t ? _cleanTitle(t[1].replace(/\s*-\s*TioAnime\s*$/i, '')) : slug;
      })();
  return { info: info, episodes: eps, details: details, type: type,
           title: title, cover: _cover(info && info.id),
           description: _metaDesc(html) };
}

function _episodesFrom(detail, slug) {
  var out = [];
  var eps = detail.episodes || [];
  for (var i = 0; i < eps.length; i++) {
    var n = eps[i];
    var href = SITE + '/ver/' + slug + '-' + n;
    var label = detail.details && detail.details[i]
      ? 'Episodio ' + n + ' (' + detail.details[i] + ')' : 'Episodio ' + n;
    out.push({ id: href, title: label, url: href, number: n });
  }
  return out;
}

// ── Required functions ───────────────────────────────────────────────────────
function getInfo() {
  return { name: 'TioAnime', lang: 'es', baseUrl: SITE,
           logo: SITE + '/assets/img/icon-32x32.png', type: 'anime', version: '1.0.0' };
}

function getHome(opts) {
  return _get(SITE + '/', REF).then(function (html) {
    var items = _parseHome(html);
    if (!items.length) throw new Error('TioAnime: no home items');
    return [{ title: 'Últimos animes', items: items }];
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var body = 'value=' + encodeURIComponent(q);
  return _fetchText(SITE + '/api/search', REF, 12000,
    { method: 'POST', body: body,
      contentType: 'application/x-www-form-urlencoded' })
    .then(function (r) {
      if (!r.ok) throw new Error('TioAnime: HTTP ' + r.status + ' /api/search');
      var data;
      try { data = JSON.parse(r.body); }
      catch (e) { throw new Error('TioAnime: bad search JSON'); }
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var d = data[i];
        if (!d || !d.slug) continue;
        out.push(_item(d.slug, d.title, _cover(d.id),
                       d.type === 'movie' ? 'movie' : 'anime'));
      }
      return out;
    });
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('TioAnime: bad detail url ' + url));
  return _get(SITE + '/anime/' + slug, REF).then(function (html) {
    var d = _parseDetail(html, slug);
    var href = SITE + '/anime/' + slug;
    var detail = { id: href, title: d.title, url: href, type: d.type };
    if (d.cover) detail.cover = d.cover;
    if (d.description) detail.description = d.description;
    detail.episodes = _episodesFrom(d, slug);
    return detail;
  });
}

function getEpisodes(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('TioAnime: bad episodes url ' + url));
  return _get(SITE + '/anime/' + slug, REF).then(function (html) {
    var d = _parseDetail(html, slug);
    return _episodesFrom(d, slug);
  });
}

function getVideoSources(episodeUrl) {
  var ep = String(episodeUrl || '');
  return _get(ep, REF).then(function (html) {
    var m = String(html || '').match(/"YourUpload","(https:[^"]+)"/);
    if (!m) throw new Error('TioAnime: no YourUpload server on ' + ep);
    var embed = _dec(m[1]);
    return _get(embed, ep).then(function (embHtml) {
      var v = String(embHtml || '').match(
        /(?:https:)?\/\/vidcache\.net:8161\/[A-Za-z0-9]+\/video\.mp4/);
      if (!v) throw new Error('TioAnime: no vidcache mp4 in embed');
      var mp4 = v[0].indexOf('https:') === 0 ? v[0] : 'https:' + v[0];
      return [{ url: mp4, label: 'YourUpload', container: 'mp4',
                headers: { 'Referer': embed }, kind: 'sub' }];
    });
  });
}
