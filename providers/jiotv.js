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

function getDetail(id) {
  var slug = String(id).replace(/^jiotv:\/\//, '');
  var ch = _chanBySlug[slug];
  if (ch) {
    var d = { id: id, title: ch.name, type: 'movie' };
    if (ch.logo) d.cover = ch.logo;
    if (ch.category) d.genres = [ch.category];
    return Promise.resolve(d);
  }
  // Not seen in this session: try a quick targeted search, else a minimal card.
  return _getJson(API + '/api/jiotv/channels?per_page=10&q=' + encodeURIComponent(slug.replace(/-/g, ' ')))
    .then(function (r) {
      var hit = (r.channels || [])[0];
      if (hit) { _remember(hit); return getDetail('jiotv://' + hit.slug); }
      return { id: id, title: _prettySlug(slug), type: 'movie' };
    })
    .catch(function () { return { id: id, title: _prettySlug(slug), type: 'movie' }; });
}

function getEpisodes(id) {
  return Promise.resolve([{ id: id + '#live', number: 1, title: 'Live' }]);
}

function _resolveStream(slug, st) {
  var url = API + '/api/channels/' + encodeURIComponent(slug) + '/streams/' + st.stream_id + '/resolve';
  var p = _getJson(url).then(function (r) {
    if (!r || !r.resolved_url) return null;
    var playUrl = r.needs_proxy && r.proxy_url ? API + r.proxy_url : r.resolved_url;
    var entry = {
      url: playUrl,
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

function getVideoSources(episodeId) {
  var slug = String(episodeId).replace(/^jiotv:\/\//, '').replace(/#live$/, '');
  return _getJson(API + '/api/channels/' + encodeURIComponent(slug) + '/streams')
    .then(function (d) {
      var hls = (d.streams || []).filter(function (st) {
        return st && st.type === 'hls' && st.stream_id;
      }).slice(0, 3);
      if (!hls.length) throw new Error('JioTV: no playable HLS stream for ' + slug);
      return Promise.all(hls.map(function (st) { return _resolveStream(slug, st); }));
    })
    .then(function (entries) {
      entries = entries.filter(function (e) { return !!e; });
      if (!entries.length) throw new Error('JioTV: all stream mirrors failed for ' + slug);
      return entries;
    });
}

function getSettings() { return []; }
