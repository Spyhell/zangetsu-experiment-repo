// JioTV — 1000+ live Indian TV channels (News, Entertainment, Movies, Kids,
// Music and more). Channel list, search and per-channel streams come from a
// public API; each stream URL is resolved at play time (some via the API's
// proxy). No login needed. HLS mirrors are preferred; DRM DASH streams are
// skipped. ES5 / QuickJS compatible.

var API = 'https://api.freeforall.dev';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var HOME_CATS = ['News', 'Entertainment', 'Movies', 'Kids', 'Music', 'Documentary'];

var _chanBySlug = {};

function _getJson(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }).then(function (r) {
    if (!r || !r.ok) throw new Error('JioTV: HTTP ' + (r && r.status));
    return r.json();
  });
}

function _remember(ch) {
  if (ch && ch.slug) _chanBySlug[ch.slug] = ch;
}

function _item(ch) {
  _remember(ch);
  var it = { id: 'jiotv://' + ch.slug, title: ch.name, url: 'jiotv://' + ch.slug, type: 'movie' };
  if (ch.logo) it.cover = ch.logo;
  return it;
}

function _row(title, channels) {
  return { title: title, items: channels.map(_item) };
}

// Race a promise against a timer so a hanging resolve can never stall the
// stream list. Falls back to null on expiry.
function _raceTimeout(promise, ms) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) {
    t = setTimeout(function () { resolve(null); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}

function getHome() {
  var jobs = HOME_CATS.map(function (cat) {
    return _getJson(API + '/api/jiotv/channels?per_page=30&category=' + encodeURIComponent(cat))
      .then(function (d) { return _row(cat, d.channels || []); })
      .catch(function () { return null; });
  });
  return Promise.all(jobs).then(function (rows) {
    return rows.filter(function (r) { return r && r.items.length; });
  });
}

function search(query) {
  return _getJson(API + '/api/jiotv/channels?per_page=60&q=' + encodeURIComponent(query))
    .then(function (d) { return (d.channels || []).map(_item); })
    .catch(function () { return []; });
}

function _prettySlug(slug) {
  return String(slug).split('-').map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function _detailFor(id, ch) {
  var d = {
    id: id, title: ch.name, url: id, type: 'movie',
    description: 'Live TV' + (ch.category ? ' • ' + ch.category : '') +
      (ch.language ? ' • ' + ch.language.toUpperCase() : ''),
    episodes: [{ id: id + '/live', title: 'Live', url: id + '/live', number: 1 }]
  };
  if (ch.logo) d.cover = ch.logo;
  if (ch.category) d.genres = [ch.category];
  return d;
}

function getDetail(id) {
  var slug = String(id).replace(/^jiotv:\/\//, '').replace(/\/live$/, '');
  id = 'jiotv://' + slug;
  var ch = _chanBySlug[slug];
  if (ch) return Promise.resolve(_detailFor(id, ch));
  // Not seen in this session: try a quick targeted search, else a minimal card.
  return _getJson(API + '/api/jiotv/channels?per_page=10&q=' + encodeURIComponent(slug.replace(/-/g, ' ')))
    .then(function (r) {
      var hit = (r.channels || [])[0];
      if (hit) { _remember(hit); return _detailFor('jiotv://' + hit.slug, hit); }
      return _detailFor(id, { name: _prettySlug(slug), slug: slug });
    })
    .catch(function () { return _detailFor(id, { name: _prettySlug(slug), slug: slug }); });
}

function getEpisodes(id) {
  return getDetail(id).then(function (d) { return d.episodes || []; });
}

function _resolveStream(slug, st) {
  var url = API + '/api/channels/' + encodeURIComponent(slug) + '/streams/' + st.stream_id + '/resolve';
  var p = _getJson(url).then(function (r) {
    if (!r || !r.resolved_url) return null;
    // proxy_url is usually a full absolute URL already — only prefix the API
    // host when it is a bare path, otherwise the URL comes out malformed.
    var playUrl = r.resolved_url;
    if (r.needs_proxy && r.proxy_url) {
      playUrl = /^https?:\/\//i.test(r.proxy_url) ? r.proxy_url : API + r.proxy_url;
    }
    var entry = {
      url: playUrl,
      proxy: !!(r.needs_proxy && r.proxy_url),
      container: 'hls',
      quality: 'auto',
      label: 'Live' + (st.label ? ' ' + st.label.replace(/^Stream\s*/i, '') : '')
    };
    var hdrs = {};
    if (r.headers) {
      if (r.headers.Referer) hdrs.Referer = r.headers.Referer;
      if (r.headers['User-Agent']) hdrs['User-Agent'] = r.headers['User-Agent'];
    }
    if (!hdrs['User-Agent']) hdrs['User-Agent'] = UA;
    entry.headers = hdrs;
    return entry;
  }).catch(function () { return null; });
  return _raceTimeout(p, 8000);
}

// Probe a mirror's playlist: 'ok' (HTTP 2xx + playlist body), 'dead'
// (HTTP error or 200-but-not-a-playlist), 'unknown' (timeout / network
// failure — the phone's network may reach what this runtime cannot, so
// unknown mirrors are kept, never dropped).
function _probePlaylist(url, headers) {
  var p = fetch(url, { headers: headers || {} }).then(function (res) {
    if (!res || !res.ok) return 'dead';
    return res.text().then(function (t) {
      return /#EXTM3U/i.test(String(t).slice(0, 400)) ? 'ok' : 'dead';
    }, function () { return 'unknown'; });
  }, function () { return 'unknown'; });
  return _raceTimeout(p, 6000).then(function (v) { return v || 'unknown'; });
}

function getVideoSources(episodeId) {
  var slug = String(episodeId).replace(/^jiotv:\/\//, '').replace(/\/live$/, '');
  return _getJson(API + '/api/channels/' + encodeURIComponent(slug) + '/streams')
    .then(function (d) {
      var streams = d.streams || [];
      var hls = streams.filter(function (st) {
        return st && st.type === 'hls' && st.stream_id;
      }).slice(0, 3);
      if (!hls.length) throw new Error('JioTV: no playable HLS stream for ' + slug);
      return Promise.all(hls.map(function (st) { return _resolveStream(slug, st); }));
    })
    .then(function (entries) {
      entries = entries.filter(function (e) { return !!e; });
      if (!entries.length) throw new Error('JioTV: all stream mirrors failed for ' + slug);
      // Drop definitively-dead mirrors (HTTP errors, non-playlist bodies) so
      // the player never opens them first. 'unknown' mirrors are kept.
      return Promise.all(entries.map(function (e) {
        return _probePlaylist(e.url, e.headers).then(function (st) { e._probe = st; return e; });
      }));
    })
    .then(function (entries) {
      var live = entries.filter(function (e) { return e._probe !== 'dead'; });
      if (!live.length) throw new Error('JioTV: all stream mirrors failed for ' + slug);
      live.sort(function (a, b) {
        return (a._probe === 'ok' ? 0 : 1) - (b._probe === 'ok' ? 0 : 1);
      });
      var dc = 0, pc = 0;
      return live.map(function (e) {
        var tag = e.proxy ? 'Proxy ' + (++pc) : 'Direct ' + (++dc);
        return {
          url: e.url, label: tag, quality: 'auto', kind: 'hls',
          headers: e.headers || {}, audioLang: null, subtitles: []
        };
      });
    });
}

function getSettings() { return []; }
