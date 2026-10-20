// NekoSama — French anime (VF / VOSTFR) source for the Zangetsu provider repo.
// Chain: static search index (fr/data/search.json) -> /anime/<slug> page ->
// #js-seasons-data JSON (episode list + per-episode player embeds) ->
// ansembed.net embed page -> regex-extracted signed HLS master (VidMoly-class
// infra: *.vmpx.online, 12h token). Signed media hosts may refuse datacenter
// IPs; the provider still hands the app the fresh signed URL, which resolves
// on real devices (same pattern as hindianime v1.0.0).
var SITE = 'https://neko-sama.fr';
var INDEX_URL = SITE + '/fr/data/search.json';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

var _indexCache = null;

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

// Fetch that never hangs: resolves with the special EXPIRED marker on timeout
// when the runtime has timers, otherwise returns the promise unchanged.
var _EXPIRED = { __expired: true };
function _raceTimeout(promise, ms) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) {
    t = setTimeout(function () { resolve(_EXPIRED); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}

function _get(url, referer) {
  var headers = { 'User-Agent': UA };
  if (referer) headers['Referer'] = referer;
  return _raceTimeout(
    fetch(url, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('NekoSama: HTTP ' + r.status + ' ' + url);
      return r.text();
    }), 20000).then(function (v) {
      if (v === _EXPIRED) throw new Error('NekoSama: timeout ' + url);
      return v;
    });
}

function _getJson(url, referer) {
  return _get(url, referer).then(function (t) { return JSON.parse(t); });
}

function getInfo() {
  return { name: 'NekoSama', lang: 'fr', baseUrl: SITE,
           logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function _loadIndex() {
  if (_indexCache) return Promise.resolve(_indexCache);
  return _getJson(INDEX_URL, SITE + '/').then(function (arr) {
    _indexCache = arr || [];
    return _indexCache;
  });
}

function _toItem(e) {
  return { id: 'nekosama:' + e.slug, title: _trim(e.name) || e.slug,
           url: 'nekosama://anime/' + e.slug, type: 'anime',
           cover: e.img ? SITE + '/fr/' + String(e.img).replace(/^\//, '') : null };
}

function search(query, page, opts) {
  var q = _trim(query).toLowerCase();
  return _loadIndex().then(function (arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (!e || !e.slug) continue;
      if (q && String(e.name || '').toLowerCase().indexOf(q) < 0) continue;
      out.push(_toItem(e));
      if (out.length >= 50) break;
    }
    return out;
  });
}

// Homepage rows: <h2 id=...>Title</h2> ... cards ... (next <h2> or end).
function getHome(opts) {
  return _get(SITE + '/', null).then(function (html) {
    var rows = [];
    var re = /<h2[^>]*id=([a-z0-9-]+)[^>]*>([^<]{2,60})<\/h2>/gi, m;
    var heads = [];
    while ((m = re.exec(html)) !== null) heads.push({ id: m[1], title: _trim(m[2]), at: m.index });
    for (var h = 0; h < heads.length; h++) {
      var end = (h + 1 < heads.length) ? heads[h + 1].at : html.length;
      var seg = html.substring(heads[h].at, end);
      var items = [], seen = {};
      var lr = /<a[^>]+href="(https:\/\/neko-sama\.fr\/anime\/[a-z0-9-]+)"[^>]*>/gi, lm;
      while ((lm = lr.exec(seg)) !== null) {
        var href = lm[1];
        if (seen[href]) continue;
        seen[href] = 1;
        var block = seg.substring(lm.index, lm.index + 2500);
        var im = /<img[^>]+src="([^"]+)"[^>]*>/i.exec(block);
        var tm = /alt="([^"]{2,120})"/i.exec(block);
        var slug = href.split('/').pop();
        items.push({ id: 'nekosama:' + slug, title: tm ? _trim(tm[1]) : slug,
                     url: 'nekosama://anime/' + slug, type: 'anime',
                     cover: im ? im[1] : null });
        if (items.length >= 24) break;
      }
      if (items.length) rows.push({ title: heads[h].title, items: items });
      if (rows.length >= 4) break;
    }
    return rows;
  });
}

function _seasonsData(html) {
  var m = /<script[^>]*id="js-seasons-data"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) throw new Error('NekoSama: no episode data on page');
  return JSON.parse(m[1]);
}

function _slugFromUrl(url) {
  var m = /^nekosama:\/\/anime\/([a-z0-9-]+)/i.exec(String(url));
  return m ? m[1] : null;
}

function _pageTitle(html, slug) {
  var m = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html) ||
          /<title>([^<]{2,120})<\/title>/i.exec(html);
  return m ? _trim(m[1]).replace(/\s*[|–-]\s*Neko.*$/i, '') : slug;
}

function _cover(html) {
  var m = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html);
  return m ? m[1] : null;
}

function _episodesFrom(slug, html) {
  var seasons = _seasonsData(html);
  var eps = [];
  for (var s = 0; s < seasons.length; s++) {
    var se = seasons[s] || {};
    var list = se.episods || [];
    for (var i = 0; i < list.length; i++) {
      var ep = list[i] || {};
      var num = parseInt(ep.num, 10);
      eps.push({
        id: 'nekosama://play/' + slug + '/' + s + '/' + (isNaN(num) ? i : num),
        title: 'E' + (isNaN(num) ? (i + 1) : num) + (ep.name ? ' - ' + _trim(ep.name) : ''),
        url: 'nekosama://play/' + slug + '/' + s + '/' + (isNaN(num) ? i : num),
        number: isNaN(num) ? (i + 1) : num,
        thumbnail: se.preview || null
      });
    }
  }
  return eps;
}

function getDetail(url, opts) {
  var slug = _slugFromUrl(url);
  if (!slug) return Promise.reject(new Error('NekoSama: bad url ' + url));
  return _get(SITE + '/anime/' + slug, SITE + '/').then(function (html) {
    return { id: 'nekosama:' + slug, title: _pageTitle(html, slug),
             url: url, type: 'anime', cover: _cover(html),
             episodes: _episodesFrom(slug, html) };
  });
}

function getEpisodes(url, opts) {
  var slug = _slugFromUrl(url);
  if (!slug) return Promise.reject(new Error('NekoSama: bad url ' + url));
  return _get(SITE + '/anime/' + slug, SITE + '/').then(function (html) {
    return _episodesFrom(slug, html);
  });
}

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
                headers: { 'Referer': ref, 'User-Agent': UA } };
      if (rm) e.quality = rm[1] + 'p';
      out.push(e);
    }
    out.sort(function (a, b) {
      return parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10);
    });
    out.unshift({ url: masterUrl, label: label + ' · Auto', container: 'hls', quality: 'Auto',
                  headers: { 'Referer': ref, 'User-Agent': UA } });
    return out;
  }).catch(function () {
    // Master playlist unreachable from this network (signed media hosts
    // sometimes block datacenter IPs); still hand the app the fresh signed
    // URL — it resolves on real devices.
    return [{ url: masterUrl, label: label + ' · Auto', container: 'hls', quality: 'Auto',
              headers: { 'Referer': ref, 'User-Agent': UA } }];
  });
}

function getVideoSources(episodeUrl) {
  var m = /^nekosama:\/\/play\/([a-z0-9-]+)\/(\d+)\/(\d+)/i.exec(String(episodeUrl));
  if (!m) return Promise.reject(new Error('NekoSama: bad episode url'));
  var slug = m[1], sIdx = parseInt(m[2], 10), num = parseInt(m[3], 10);
  var pageUrl = SITE + '/anime/' + slug;
  return _get(pageUrl, SITE + '/').then(function (html) {
    var seasons = _seasonsData(html);
    var se = seasons[sIdx] || {};
    var list = se.episods || [];
    var ep = null;
    for (var i = 0; i < list.length; i++) {
      if (parseInt(list[i].num, 10) === num) { ep = list[i]; break; }
    }
    if (!ep) ep = list[0];
    if (!ep || !ep.players || !ep.players.length)
      throw new Error('NekoSama: no players for episode');
    // Prefer the ansembed (VidMoly-class HLS) player; fall back to any.
    var src = null, j;
    for (j = 0; j < ep.players.length; j++) {
      if (/ansembed\.net/i.test(ep.players[j].src)) { src = ep.players[j].src; break; }
    }
    if (!src) src = ep.players[0].src;
    return _get(src, pageUrl).then(function (embed) {
      var mm = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i.exec(embed);
      if (!mm) throw new Error('NekoSama: no stream in embed');
      var master = mm[1].replace(/&amp;/g, '&');
      var vf = /vostfr/i.test(embed) ? 'VOSTFR' : 'VF';
      return _expandQualities(master, 'NekoSama · ' + vf, src);
    });
  });
}
