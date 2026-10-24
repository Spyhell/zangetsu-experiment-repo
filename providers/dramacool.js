// Dramacool (dramaacool.best) — Korean/Chinese/Japanese/Thai dramas + Asian movies,
// English-subbed. Chain: api.dramacool.rest/v1 JSON API (drama detail carries
// per-episode streamUrls) -> vidmoly embed page -> direct signed HLS master.
// streamtape/mixdrop embeds are JS/browser-only from this network, so only
// vidmoly entries are resolved and listed.
// ES5 only (QuickJS): var/function, no arrows, no template literals, no let/const.

var API = 'https://api.dramacool.rest/v1';
var SITE = 'https://dramaacool.best';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
var VERSION = '1.0.0';
var T_API = 12000;
var T_EMBED = 15000;
var T_MASTER = 15000;

function getInfo() {
  return {
    name: 'Dramacool',
    lang: 'en',
    baseUrl: SITE,
    logo: SITE + '/assets/dramacool/favicon/favicon-96x96.png',
    type: 'movie',
    version: VERSION
  };
}

// ---------- http helpers (every call wrapped with a timeout) ----------
function _hdrs(extra) {
  var h = { 'User-Agent': UA, 'x-access-control': 'web' };
  if (extra) { for (var k in extra) { h[k] = extra[k]; } }
  return h;
}

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

var _TIMED_OUT = { __timedOut: true };

function _get(url, headers, ms) {
  var p = fetch(url, { headers: headers || _hdrs() }).then(function (r) {
    if (!r || !r.ok) throw new Error('Dramacool: HTTP ' + (r && r.status) + ' for ' + url);
    return r;
  });
  return _raceTimeout(p, ms || T_API, _TIMED_OUT).then(function (r) {
    if (r === _TIMED_OUT) throw new Error('Dramacool: timeout fetching ' + url);
    return r;
  });
}

function _getJson(url, headers, ms) {
  return _get(url, headers, ms).then(function (r) { return r.json(); });
}

function _enc(q) { return encodeURIComponent(q == null ? '' : String(q)); }

// ---------- detail cache (shared by getDetail / getEpisodes / getVideoSources) ----------
var _detailCache = {};

function _slugFromUrl(url) {
  var m = /^dramacool:\/\/drama\/([A-Za-z0-9\-_.]+)/.exec(String(url || ''));
  if (m) return m[1];
  m = /^dramacool:\/\/ep\/([A-Za-z0-9\-_.]+)\//.exec(String(url || ''));
  if (m) return m[1];
  throw new Error('Dramacool: cannot parse slug from url ' + url);
}

function _detail(slug) {
  if (_detailCache[slug]) return Promise.resolve(_detailCache[slug]);
  return _getJson(API + '/drama/detail?slug=' + _enc(slug), _hdrs(), T_API).then(function (d) {
    if (!d || !d.slug) throw new Error('Dramacool: empty detail for ' + slug);
    _detailCache[slug] = d;
    return d;
  });
}

// ---------- mapping ----------
function _item(d) {
  return {
    id: String(d._id || d.slug),
    title: String(d.name || 'Unknown title'),
    url: 'dramacool://drama/' + d.slug,
    type: 'movie',
    cover: d.image || d.coverImage || null
  };
}

function _eps(d) {
  var list = d.episodes || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var n = (typeof e.number === 'number' && isFinite(e.number)) ? e.number : (i + 1);
    out.push({
      id: d.slug + '-ep' + n,
      title: 'Episode ' + n,
      url: 'dramacool://ep/' + d.slug + '/' + n,
      number: n
    });
  }
  return out;
}

// ---------- required functions ----------
function getHome(opts) {
  return _getJson(API + '/home', _hdrs(), T_API).then(function (sections) {
    var rows = [];
    if (!sections || !sections.length) return rows;
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (!s || !s.title || !s.data || !s.data.length) continue;
      var items = [];
      for (var j = 0; j < s.data.length; j++) {
        var d = s.data[j];
        if (d && d.slug && d.name) items.push(_item(d));
      }
      if (items.length) rows.push({ title: String(s.title), items: items });
    }
    return rows;
  });
}

function search(query, page, opts) {
  var p = parseInt(page, 10);
  if (!p || p < 1) p = 1;
  return _getJson(API + '/drama/search?q=' + _enc(query) + '&page=' + p, _hdrs(), T_API)
    .then(function (r) {
      var body = (r && r.body) || [];
      var out = [];
      for (var i = 0; i < body.length; i++) {
        var d = body[i];
        if (d && d.slug && d.name) out.push(_item(d));
      }
      return out;
    });
}

function getDetail(url, opts) {
  var slug = _slugFromUrl(url);
  return _detail(slug).then(function (d) {
    var y = d.releaseYear;
    return {
      id: String(d._id || d.slug),
      title: String(d.name || 'Unknown title'),
      url: 'dramacool://drama/' + d.slug,
      type: 'movie',
      cover: d.image || d.coverImage || null,
      description: d.description ? String(d.description) : null,
      year: (y != null && String(y) !== '') ? String(y) : null,
      episodes: _eps(d)
    };
  });
}

function getEpisodes(url, opts) {
  var slug = _slugFromUrl(url);
  return _detail(slug).then(function (d) { return _eps(d); });
}

// ---------- vidmoly resolution ----------
function _qualityFromMaster(body) {
  var m = /RESOLUTION=(\d+)x(\d+)/.exec(body || '');
  if (!m) return '720p';
  var h = parseInt(m[2], 10);
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 450) return '480p';
  return '360p';
}

function _validateMaster(url) {
  return _get(url, _hdrs({ Referer: 'https://vidmoly.biz/' }), T_MASTER).then(function (r) {
    return r.text();
  }).then(function (body) {
    if (!body || body.indexOf('#EXTM3U') === -1 || body.indexOf('#EXT-X-STREAM-INF') === -1) {
      throw new Error('Dramacool: master playlist invalid');
    }
    return _qualityFromMaster(body);
  });
}

function _subsFromEmbed(html) {
  var subs = [];
  var seen = {};
  var rx = /["'](https?:[^"']+\.(vtt|srt)[^"']*)["']/gi;
  var m;
  while ((m = rx.exec(html || '')) !== null) {
    var u = m[1];
    if (!seen[u]) {
      seen[u] = 1;
      subs.push({ url: u, lang: 'en', label: 'English' });
    }
  }
  return subs;
}

// Resolve one vidmoly embed to a playable HLS source. The signed master URL
// is minted by the host seconds before use; if the master fetch is
// rate-limited (403/429) or times out from this network, the URL is still
// listed (fresh-signed, and limits are per client IP) but without a parsed
// quality. Any other failure drops the target.
function _resolveVidmoly(embedUrl, kind) {
  return _get(embedUrl, _hdrs({ Referer: SITE + '/' }), T_EMBED).then(function (r) {
    return r.text();
  }).then(function (html) {
    var m = /file:\s*'(https:[^']*master\.m3u8[^']*)'/.exec(html || '');
    if (!m) m = /'(https:[^']+\.m3u8[^']*)'/.exec(html || '');
    if (!m) throw new Error('Dramacool: no m3u8 found in vidmoly embed');
    var master = m[1];
    var subs = _subsFromEmbed(html);
    function baseSource(q) {
      var s = {
        url: master,
        label: q ? ('[Vidmoly] ' + q) : '[Vidmoly]',
        container: 'hls',
        kind: kind,
        headers: { Referer: 'https://vidmoly.biz/', 'User-Agent': UA },
        subtitles: subs
      };
      if (q) s.quality = q;
      return s;
    }
    return _validateMaster(master).then(
      function (q) { return baseSource(q); },
      function (e) {
        var msg = String((e && e.message) || e);
        if (/HTTP 40[39]|HTTP 429|timeout/i.test(msg)) return baseSource(null);
        throw e;
      }
    );
  });
}

function getVideoSources(episodeUrl) {
  var mm = /^dramacool:\/\/ep\/([A-Za-z0-9\-_.]+)\/(\d+)/.exec(String(episodeUrl || ''));
  if (!mm) return Promise.reject(new Error('Dramacool: bad episode url ' + episodeUrl));
  var slug = mm[1];
  var num = parseInt(mm[2], 10);
  return _detail(slug).then(function (d) {
    var eps = d.episodes || [];
    var ep = null;
    for (var i = 0; i < eps.length; i++) {
      if (Number(eps[i].number) === num) { ep = eps[i]; break; }
    }
    if (!ep && eps.length) ep = eps[0];
    if (!ep) throw new Error('Dramacool: episode ' + num + ' not found');
    var kind = (String(ep.type || '').toUpperCase() === 'DUB') ? 'dub' : 'sub';
    var targets = [];
    var urls = ep.streamUrls || [];
    for (var j = 0; j < urls.length; j++) {
      var u = urls[j];
      if (u && u.url && String(u.source || '').toLowerCase() === 'vidmoly') targets.push(u.url);
    }
    if (!targets.length) return [];
    var seen = {};
    var jobs = [];
    for (var k = 0; k < targets.length; k++) {
      if (seen[targets[k]]) continue;
      seen[targets[k]] = 1;
      (function (embed) {
        jobs.push(_resolveVidmoly(embed, kind).then(
          function (s) { return s; },
          function () { return null; }
        ));
      })(targets[k]);
    }
    return Promise.all(jobs).then(function (arr) {
      var out = [];
      for (var t = 0; t < arr.length; t++) { if (arr[t]) out.push(arr[t]); }
      return out;
    });
  });
}
