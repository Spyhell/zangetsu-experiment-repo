/*
 * TED Talks — free TED talks via ted.com's server-rendered pages.
 *
 * VERIFIED chain (2026-10-13, plain HTTP, no login, no crypto, no browser):
 *   GET https://www.ted.com/talks            -> __NEXT_DATA__ pageProps.talks
 *   GET https://www.ted.com/topics           -> pageProps.list (topic index)
 *   GET https://www.ted.com/topics/<slug>   -> pageProps.talks (16/server page)
 *   GET https://www.ted.com/talks/<slug>    -> __NEXT_DATA__ pageProps.videoData
 *        .hlsUrl = https://hls.ted.com/project_masters/<id>/manifest.m3u8?...
 *        Master playlist verified HTTP 200 (multivariant); a recent talk's
 *        segment byte-verified: HTTP 200, 601KB, MPEG-TS sync bytes.
 *        (One 2006 talk's segments 404 — stale purge; current talks fine.)
 *   Master manifest also carries in-manifest EN/other subtitle tracks.
 * Search strategy: match query against the topic index, then pull that
 * topic's talks; fall back to client-side filtering of the latest talks.
 * ES5 only.
 */

var _TED_SITE = 'https://www.ted.com';
var _TED_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getInfo() {
  return {
    name: 'TED Talks', lang: 'en', baseUrl: _TED_SITE,
    logo: _TED_SITE + '/favicon.ico', type: 'movie', version: '1.0.0'
  };
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

function _fetchText(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': _TED_UA, 'Accept-Language': 'en-US,en;q=0.9' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('TED: HTTP ' + (r && r.status) + ' for ' + url);
    return r.text();
  }), 15000, null).then(function (t) {
    if (t == null) throw new Error('TED: timeout for ' + url);
    return t;
  });
}

function _nextData(html) {
  var m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) throw new Error('TED: no __NEXT_DATA__');
  return JSON.parse(m[1]);
}

function _pageProps(url) {
  return _fetchText(url).then(function (html) {
    return _nextData(html).props.pageProps;
  });
}

function _cover(t) {
  var imgs = t && t.primaryImageSet;
  if (imgs && imgs.length && imgs[0].url) return imgs[0].url;
  return null;
}

function _talkItem(t) {
  var slug = t && t.slug;
  if (!slug) return null;
  var sp = t.presenterDisplayName ? ' — ' + t.presenterDisplayName : '';
  return {
    id: 'ted-' + slug,
    title: String(t.title || 'Untitled') + sp,
    url: 'ted://talk/' + slug,
    type: 'movie',
    cover: _cover(t)
  };
}

function _talkItems(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    var it = _talkItem(list[i]);
    if (it) out.push(it);
  }
  return out;
}

function getHome(opts) {
  return _pageProps(_TED_SITE + '/talks').then(function (pp) {
    return [{ title: 'Latest talks', items: _talkItems(pp.talks) }];
  });
}

function _slugify(q) {
  return String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function _findTopicSlug(q, list) {
  var needle = String(q || '').toLowerCase().replace(/^\s+|\s+$/g, '');
  var slugQ = _slugify(q);
  var groups = (list && list.list) || list || [];
  var best = null;
  for (var gi = 0; gi < groups.length; gi++) {
    var items = groups[gi].items || [];
    for (var i = 0; i < items.length; i++) {
      var name = String(items[i].name || '').toLowerCase();
      var slug = String(items[i].slug || '');
      if (!slug) continue;
      if (slug === slugQ || name === needle) return slug;
      if (!best && (name.indexOf(needle) !== -1 || needle.indexOf(name) !== -1)) best = slug;
    }
  }
  return best;
}

function _filterTalks(talks, q) {
  var needle = String(q || '').toLowerCase();
  var out = [];
  for (var i = 0; i < (talks || []).length; i++) {
    var t = talks[i];
    var hay = String(t.title || '').toLowerCase() + ' ' +
      String(t.presenterDisplayName || '').toLowerCase();
    if (hay.indexOf(needle) !== -1) out.push(t);
  }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').replace(/^\s+|\s+$/g, '');
  if (!q) return Promise.resolve([]);
  var latestP = _pageProps(_TED_SITE + '/talks');
  return _pageProps(_TED_SITE + '/topics').then(function (pp) {
    var slug = _findTopicSlug(q, pp.list);
    if (!slug) throw new Error('TED: no topic');
    return _pageProps(_TED_SITE + '/topics/' + slug);
  }).then(function (pp) {
    var items = _talkItems(_filterTalks(pp.talks, q));
    return items.length ? items : _talkItems(pp.talks);
  }).catch(function () {
    return latestP.then(function (pp) {
      var items = _talkItems(_filterTalks(pp.talks, q));
      return items.length ? items : _talkItems(pp.talks);
    });
  });
}

function _parseTalkUrl(url) {
  var m = /^ted:\/\/talk\/(.+)$/.exec(String(url || ''));
  return m ? m[1] : null;
}

function _talkPageUrl(slug) {
  return _TED_SITE + '/talks/' + slug;
}

function getDetail(url, opts) {
  var slug = _parseTalkUrl(url);
  if (!slug) return Promise.reject(new Error('TED: bad url'));
  return _pageProps(_talkPageUrl(slug)).then(function (pp) {
    var vd = pp.videoData || {};
    var sp = vd.presenterDisplayName ? ' — ' + vd.presenterDisplayName : '';
    return {
      id: 'ted-' + slug,
      title: String(vd.title || 'Untitled') + sp,
      url: url,
      type: 'movie',
      cover: _cover(vd),
      description: vd.description || null,
      episodes: [{
        id: 'ted-' + slug + '-full',
        title: 'Full talk',
        url: _talkPageUrl(slug),
        number: 1
      }]
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function _masterDir(masterUrl) {
  var u = String(masterUrl || '');
  var i = u.indexOf('?');
  var base = i === -1 ? u : u.slice(0, i);
  var q = i === -1 ? '' : u.slice(i);
  var slash = base.lastIndexOf('/');
  return { dir: slash === -1 ? '' : base.slice(0, slash + 1), q: q };
}

function _expandQualities(masterUrl, body) {
  var parts = _masterDir(masterUrl);
  var lines = String(body || '').split('\n');
  var out = [{
    url: masterUrl, quality: 'Auto', label: 'Auto',
    container: 'hls', kind: 'sub'
  }];
  var seen = {};
  for (var i = 0; i < lines.length; i++) {
    var m = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
    if (!m) continue;
    var uri = (lines[i + 1] || '').replace(/^\s+|\s+$/g, '');
    if (!uri || uri.charAt(0) === '#') continue;
    var h = parseInt(m[2], 10);
    var q = h >= 700 ? '720p' : (h >= 450 ? '480p' : (h >= 300 ? '360p' : '240p'));
    if (seen[q]) continue;
    seen[q] = true;
    var abs = (/^https?:\/\//i.test(uri)) ? uri
      : (uri.charAt(0) === '/' ? 'https://hls.ted.com' + uri + parts.q : parts.dir + uri);
    out.push({ url: abs, quality: q, label: q, container: 'hls', kind: 'sub' });
  }
  return out;
}

function getVideoSources(episodeUrl) {
  var pageUrl = String(episodeUrl || '');
  if (pageUrl.indexOf(_TED_SITE + '/talks/') !== 0) return Promise.resolve([]);
  return _pageProps(pageUrl).then(function (pp) {
    var vd = pp.videoData || {};
    var master = vd.hlsUrl;
    if (!master || master.indexOf('http') !== 0) return [];
    return _raceTimeout(_fetchText(master), 5000, '').then(function (body) {
      if (!body) return [{ url: master, quality: 'Auto', label: 'Auto', container: 'hls', kind: 'sub' }];
      return _expandQualities(master, body);
    });
  }).catch(function () { return []; });
}
