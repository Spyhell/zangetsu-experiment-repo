// Odysee source for the Zangetsu app.
// Backend: Odysee's public JSON-RPC API (no login, no API key):
//   claim_search: POST https://api.na-backend.odysee.com/api/v1/proxy
//     {"method":"claim_search","params":{"text":"...","claim_type":["stream"],...}}
//   get: {"method":"get","params":{"uri":"lbry://...#...","save_file":false}}
//     -> {"streaming_url": "https://player.odycdn.com/v6/streams/<id>/<hash>.mp4"}
// The streaming_url is a direct mp4 (verified: HTTP 206 + ftypisom/avc1 bytes
// with a browser UA + Referer: https://odysee.com/; bare datacenter UA gets
// CDN 401/429, so playback carries those headers). Catalog is user-uploaded
// movies / series / anime / docs — home rows lean on trending + new releases
// rather than raw text search (spam-prone).
// ES5 only.

var _API = 'https://api.na-backend.odysee.com/api/v1/proxy';
var _SITE = 'https://odysee.com';

var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var _STREAM_HEADERS = { 'User-Agent': UA, 'Referer': _SITE + '/' };

function getInfo() {
  return {
    name: 'Odysee', lang: 'en', baseUrl: _SITE,
    logo: _SITE + '/favicon.ico',
    type: 'movie', version: '1.0.0'
  };
}

// Never hang: 12s race, no-op when the runtime lacks timers (QuickJS-safe).
function _raceTimeout(p, ms) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('Odysee: request timed out')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _rpc(method, params) {
  var body = JSON.stringify({ method: method, params: params || {} });
  return _raceTimeout(fetch(_API, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: body
  }).then(function (r) {
    if (!r.ok) throw new Error('Odysee: HTTP ' + r.status);
    return r.json();
  }).then(function (j) {
    if (j && j.error) throw new Error('Odysee: ' + (j.error.message || 'API error'));
    return (j && j.result) || {};
  }), 12000);
}

function _claimSearch(params) {
  params = params || {};
  params.claim_type = ['stream'];
  params.no_totals = true;
  return _rpc('claim_search', params).then(function (res) {
    return res.items || [];
  });
}

function _titleOf(it) {
  var v = it.value || {};
  return v.title || it.name || 'Untitled';
}

function _coverOf(it) {
  var v = it.value || {};
  var t = v.thumbnail || {};
  return t.url || null;
}

function _toItem(it) {
  if (!it || !it.claim_id) return null;
  return {
    id: 'odysee:' + it.claim_id,
    title: _titleOf(it),
    url: 'odysee://claim/' + it.claim_id,
    type: 'movie',
    cover: _coverOf(it)
  };
}

function _mapItems(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    try { var it = _toItem(list[i]); if (it) out.push(it); } catch (e) {}
  }
  return out;
}

function _claimById(claimId) {
  return _claimSearch({ claim_ids: [claimId], page_size: 1 }).then(function (items) {
    if (!items.length) throw new Error('Odysee: claim not found');
    return items[0];
  });
}

function getHome(opts) {
  var trending = _claimSearch({ order_by: ['trending_group', 'trending_mixed'], page: 1, page_size: 20 })
    .then(_mapItems).catch(function () { return []; });
  var fresh = _claimSearch({ order_by: ['release_time'], page: 1, page_size: 20 })
    .then(_mapItems).catch(function () { return []; });
  return Promise.all([trending, fresh]).then(function (rows) {
    var out = [];
    if (rows[0].length) out.push({ title: 'Trending Now', items: rows[0] });
    if (rows[1].length) out.push({ title: 'New Releases', items: rows[1] });
    return out;
  });
}

function search(query, page, opts) {
  var q = String(query == null ? '' : query).replace(/^\s+|\s+$/g, '');
  if (!q) return Promise.resolve([]);
  var p = parseInt(page, 10) || 1;
  return _claimSearch({ text: q, page: p, page_size: 24 }).then(_mapItems);
}

function _detailFromClaim(it) {
  var v = it.value || {};
  var uri = it.canonical_url || ('lbry://' + it.name + '#' + it.claim_id);
  var desc = v.description || '';
  var dur = (v.video && v.video.duration) ? Math.round(v.video.duration / 60) + ' min' : '';
  return {
    id: 'odysee:' + it.claim_id,
    title: _titleOf(it),
    url: 'odysee://claim/' + it.claim_id,
    type: 'movie',
    cover: _coverOf(it),
    description: dur ? (desc + (desc ? ' ' : '') + '(' + dur + ')') : desc,
    episodes: [{
      id: 'odysee:ep:' + it.claim_id,
      title: _titleOf(it),
      url: 'odysee://play/' + it.claim_id + '/' + encodeURIComponent(uri),
      number: 1,
      thumbnail: _coverOf(it)
    }]
  };
}

function getDetail(url, opts) {
  var m = String(url || '').match(/^odysee:\/\/claim\/([0-9a-f]+)/i);
  if (!m) return Promise.reject(new Error('Odysee: bad item url'));
  return _claimById(m[1]).then(_detailFromClaim);
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^odysee:\/\/play\/([0-9a-f]+)\/(.+)$/i);
  if (!m) return Promise.reject(new Error('Odysee: bad episode url'));
  var uri = decodeURIComponent(m[2]);
  return _rpc('get', { uri: uri, save_file: false }).then(function (res) {
    var su = res.streaming_url;
    if (!su || !/^https?:\/\//i.test(su)) throw new Error('Odysee: no stream URL');
    return [{
      url: su,
      container: 'mp4',
      label: 'Odysee',
      headers: _STREAM_HEADERS
    }];
  });
}
