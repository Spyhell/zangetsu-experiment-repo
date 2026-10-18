// Re:Anime — ported from the maintained Yuzono Aniyomi extension.
// Upstream: https://github.com/yuzono/anime-extensions/tree/master/src/en/reanime
// Catalogue and episode API follow upstream's /api/v1 contract. No AniList query is
// made: the site's own anime detail response supplies anilist_id for /api/flix.
// FlixCloud embeds are not playable URLs; resolve the site's direct-download path
// when possible rather than returning an HTML iframe as a fake stream.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'reanime';
var SITE = 'https://reanime.to';
var API = SITE + '/api/v1';
var FLIX_API = SITE + '/api/flix';
var FLIX = 'https://flixcloud.cc';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'Re:Anime', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=reanime.to',
    type: 'anime', version: '1.2.4' };
}
function getSettings() { return []; }

function _headers(referer, accept) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || SITE + '/home'
  };
}
// Yuzono's maintained Re:Anime extension supports these domains. Rotate only
// when a host is down, rate-limited, blocked, or serving a Cloudflare interstitial.
var SITE_DOMAINS = ['https://reanime.to', 'https://reanime.cz', 'https://reanime.wtf'];
function _isMomentPage(response) {
  var body = String(response && response.body || '').toLowerCase();
  var headers = response && response.headers || {};
  var cfMitigated = String(headers['cf-mitigated'] || headers['CF-Mitigated'] || '').toLowerCase();
  return cfMitigated.indexOf('challenge') >= 0 ||
    body.indexOf('just a moment') >= 0 ||
    body.indexOf('cf-chl-') >= 0 ||
    body.indexOf('challenge-platform') >= 0 ||
    body.indexOf('checking your browser') >= 0 ||
    body.indexOf('checking if the site connection is secure') >= 0 ||
    body.indexOf('attention required') >= 0 ||
    body.indexOf('enable javascript and cookies') >= 0;
}
function _fetchOnce(url, referer, timeoutMs, accept, browser) {
  return fetch(url, {
    headers: _headers(referer, accept),
    timeoutMs: timeoutMs || 12000,
    browser: browser === true
  }).then(function (r) {
    var response = {
      body: String(r && r.body || ''),
      headers: r && r.headers || {},
      status: r && r.status || 200
    };
    if (!r || (response.status >= 400 && !_isMomentPage(response))) {
      var err = new Error('HTTP ' + response.status);
      err.response = response;
      throw err;
    }
    return response;
  });
}
function _fetch(url, referer, timeoutMs, accept) {
  var sourceDomain = SITE_DOMAINS.filter(function (domain) {
    return String(url).indexOf(domain) === 0;
  })[0];
  var domains = sourceDomain ? SITE_DOMAINS : [''];
  var lastError = null;
  function tryDomain(i) {
    if (i >= domains.length) {
      return Promise.reject(lastError || new Error('Re:Anime: all supported domains failed'));
    }
    var domain = domains[i];
    var targetUrl = sourceDomain ? domain + String(url).slice(sourceDomain.length) : url;
    var targetReferer = sourceDomain && referer && String(referer).indexOf(sourceDomain) === 0
      ? domain + String(referer).slice(sourceDomain.length)
      : (referer || (domain || SITE) + '/home');
    return _fetchOnce(targetUrl, targetReferer, Math.min(timeoutMs || 12000, 7000), accept, false)
      .then(function (response) {
        if (!_isMomentPage(response)) return response;
        // Ask Zangetsu's native browser/Cloudflare lane to retry the challenge.
        return _fetchOnce(targetUrl, targetReferer, Math.min(timeoutMs || 12000, 7000), accept, true)
          .then(function (cleared) {
            if (_isMomentPage(cleared)) {
              var err = new Error('Re:Anime Cloudflare challenge remained after browser retry');
              err.response = cleared;
              throw err;
            }
            return cleared;
          });
      })
      .catch(function (err) {
        lastError = err;
        var response = err && err.response;
        if (response && !_isMomentPage(response) &&
            response.status < 500 && response.status !== 403 && response.status !== 429) {
          // A real client error (e.g. unknown anime slug) is not a domain outage.
          throw err;
        }
        return tryDomain(i + 1);
      });
  }
  return tryDomain(0);
}
function _json(url, referer) {
  return _fetch(url, referer).then(function (r) {
    var j = JSON.parse(r.body || 'null');
    if (!j || j.success === false) throw new Error('Re:Anime API request failed');
    return j;
  });
}
function _first(o, keys) {
  for (var i = 0; o && i < keys.length; i++) {
    var v = o[keys[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}
 
// Preserve the upstream AniList ID verbatim. Never offset, increment, decrement,
// or coerce it through numeric arithmetic before calling /api/flix.
function _anilistId(o) {
  var raw = _first(o, ['anilist_id', 'anilistId', 'anilist']);
  var id = raw == null ? '' : String(raw).trim();
  return /^\d+$/.test(id) && id !== '0' ? id : '';
}

function _arr(o) {
  if (Array.isArray(o)) return o;
  if (!o || typeof o !== 'object') return [];
  if (Array.isArray(o.results)) return o.results;
  if (Array.isArray(o.data)) return o.data;
  if (Array.isArray(o.episodes)) return o.episodes;
  if (Array.isArray(o.servers)) return o.servers;
  return [];
}
function _slug(o) {
  var s = _first(o, ['anime_id', 'animeId', 'slug', 'id']);
  if (s != null && String(s).indexOf('/') < 0) return String(s);
  var u = String(_first(o, ['url', 'href', 'link']) || '');
  var m = u.match(/\/anime\/([^/?#]+)/);
  return m ? m[1] : '';
}
function _title(o) {
  var t = _first(o, ['title', 'name', 'anime_title']);
  if (t && typeof t === 'object') return String(_first(t, ['romaji', 'english', 'native']) || 'Untitled anime');
  return String(t || 'Untitled anime');
}
function _cover(o) {
  var c = _first(o, ['cover_image', 'cover', 'poster', 'image', 'thumbnail']);
  if (c && typeof c === 'object') c = _first(c, ['extra_large', 'large', 'medium', 'url']);
  if (typeof c !== 'string' || !c) return null;
  if (c.indexOf('//') === 0) return 'https:' + c;
  return c;
}
function _item(o) {
  var slug = _slug(o);
  if (!slug) return null;
  return {
    id: slug, url: slug, title: _title(o), name: _title(o),
    cover: _cover(o), poster: _cover(o), type: 'anime', sourceId: SOURCE_ID,
    anilistId: Number(_anilistId(o)) || undefined,
    subCount: Number(o.subbed || 0), dubCount: Number(o.dubbed || 0)
  };
}
function _dedupeItems(list) {
  var out = [], seen = {};
  _arr(list).forEach(function (o) {
    var it = _item(o);
    if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
  });
  return out;
}
// Some list entries ship anilist_id 0 (e.g. Blue Box Season 2) even though the
// title's detail payload carries the real ID. A card without anilistId sends
// the app down its AniList re-resolution path, where this source's episodes
// never load and the "AniList is having a moment" banner appears. Fill the
// missing IDs from the detail endpoint (bounded, best-effort).
function _fillAnilistIds(items) {
  var missing = items.filter(function (it) { return !it.anilistId; }).slice(0, 8);
  if (!missing.length) return Promise.resolve(items);
  return Promise.all(missing.map(function (it) {
    return _detailData(it.id).then(function (d) {
      var data = d && (d.data || d.anime || d);
      var aid = Number(_anilistId(data));
      if (aid) it.anilistId = aid;
    }).catch(function () { return null; });
  })).then(function () { return items; });
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var url = API + '/search?limit=36&offset=' + ((p - 1) * 36) + '&q=' + encodeURIComponent(q);
  return _json(url, SITE + '/search').then(_dedupeItems).then(_fillAnilistIds).catch(function () { return []; });
}
function getHome() {
  var latestUrl = API + '/home/latest-aired?limit=12';
  var popularUrl = API + '/search?sort=popularity_desc&limit=36&offset=0';
  return Promise.all([
    _json(latestUrl, SITE + '/home').catch(function () { return null; }),
    _json(popularUrl, SITE + '/search').catch(function () { return null; })
  ]).then(function (data) {
    return Promise.all([_fillAnilistIds(_dedupeItems(data[0])), _fillAnilistIds(_dedupeItems(data[1]))])
      .then(function (filled) {
        var rows = [];
        if (filled[0].length) rows.push({ title: 'Latest Aired', items: filled[0] });
        if (filled[1].length) rows.push({ title: 'Popular Anime', items: filled[1] });
        return rows;
      });
  });
}
function popular() {
  return _json(API + '/search?sort=popularity_desc&limit=36&offset=0', SITE + '/search')
    .then(_dedupeItems).then(_fillAnilistIds).catch(function () { return []; });
}
function _episode(ep, index, slug, anilistId) {
  var num = Number(_first(ep, ['episode_number', 'episodeNumber', 'number', 'episode']) || index + 1);
  var safeNum = isFinite(num) && num > 0 ? num : index + 1;
  var epId = String(_first(ep, ['episodeId', 'episode_id', 'id']) || ('ep-' + safeNum));
  var title = String(_first(ep, ['title', 'title_romanji', 'title_japanese']) || '');
  return {
    id: slug + '|' + safeNum + '|' + epId + '|' + String(anilistId || ''),
    url: slug + '|' + safeNum + '|' + epId + '|' + String(anilistId || ''),
    number: safeNum,
    title: title && !/episode/i.test(title) ? 'Episode ' + safeNum + ' - ' + title : 'Episode ' + safeNum
  };
}
function _detailData(slug) {
  return _json(API + '/anime/' + encodeURIComponent(slug), SITE + '/anime/' + encodeURIComponent(slug));
}
function _episodesData(slug) {
  return _json(API + '/anime/' + encodeURIComponent(slug) + '/episodes?limit=2000',
    SITE + '/anime/' + encodeURIComponent(slug));
}
function getDetail(url) {
  var slug = String(url || '').replace(/^.*\/anime\//, '').split(/[?#/|]/)[0];
  if (!slug) return Promise.reject(new Error('Re:Anime: missing anime slug'));
  return Promise.all([
    _detailData(slug),
    _episodesData(slug).catch(function () { return { data: [] }; })
  ]).then(function (res) {
    var d = res[0] && (res[0].data || res[0].anime || res[0]);
    var episodes = _arr(res[1]);
    var anilistId = _anilistId(d);
    var item = _item(d) || { id: slug, url: slug, title: slug, type: 'anime', sourceId: SOURCE_ID };
    item.id = slug; item.url = slug;
    item.description = String(d.description || '');
    item.status = String(d.status || 'unknown').toLowerCase();
    item.genres = Array.isArray(d.genres) ? d.genres : [];
    var _yr = d.season_year || (d.start_date && d.start_date.year) || null;
    item.year = _yr ? String(_yr) : null; // app model wants year as String?; a numeric year crashes MediaDetail.fromJson
    item.malId = Number(d.mal_id || 0) || undefined;
    item.anilistId = Number(anilistId) || item.anilistId;
    item.episodes = episodes.map(function (ep, i) { return _episode(ep, i, slug, anilistId); });
    item.subCount = Number(d.subbed || 0) || item.episodes.length;
    item.dubCount = Number(d.dubbed || 0);
    return item;
  });
}
function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d.episodes || []; });
}

function _directMedia(url, label, kind) {
  if (!/^https?:\/\//i.test(url) || !/\.(m3u8|mp4|m4v|mkv|webm)(?:[?#]|$)/i.test(url)) return null;
  var ext = (url.match(/\.([a-z0-9]+)(?:[?#]|$)/i) || [,''])[1].toLowerCase();
  return {
    url: url, quality: 'Auto', label: label || 'Re:Anime',
    container: ext === 'm3u8' ? 'hls' : ext,
    headers: _headers(FLIX + '/'), kind: kind || 'sub',
    audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: []
  };
}
function _parseJson5(raw) {
  var s = String(raw || '');
  // ReAnime's Svelte payload is JSON5-like: quote bare keys, drop trailing commas,
  // and normalize undefined values without evaluating page JavaScript.
  s = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/:\s*undefined\b/g, ': null');
  return JSON.parse(s);
}
function _flixApiHeaders(referer, accept) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': FLIX,
    'Referer': referer || FLIX + '/'
  };
}
function _postJson(url, payload, referer) {
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, _flixApiHeaders(referer), {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(payload),
    timeoutMs: 15000
  }).then(function (r) {
    if (!r || (r.status && r.status >= 400)) throw new Error('HTTP ' + (r && r.status));
    var j = JSON.parse(String(r.body || 'null'));
    if (!j) throw new Error('Empty FlixCloud response');
    return j;
  });
}
function _resolveFlixStream(dataLink, label, kind) {
  if (!/\/e\/[a-z0-9]+/i.test(String(dataLink || ''))) return Promise.resolve([]);
  var embedHeaders = _flixApiHeaders(FLIX + '/');
  return fetch(dataLink, { headers: embedHeaders, timeoutMs: 15000 })
    .then(function (r) {
      if (!r || (r.status && r.status >= 400)) throw new Error('FlixCloud embed HTTP ' + (r && r.status));
      return String(r.body || '');
    })
    .then(function (html) {
      var dataMatch = html.match(/type:\s*["']data["']\s*,\s*data:\s*(\{[\s\S]*?\})\s*,\s*uses:/);
      if (!dataMatch) throw new Error('FlixCloud embed data not found');
      var embedData = _parseJson5(dataMatch[1]);
      // The current decoder does not need subtitle/chapter metadata in its payload.
      delete embedData.subtitles;
      delete embedData.intro_chapter;
      delete embedData.outro_chapter;
      return embedData;
    })
    .then(function (embedData) {
      return _postJson('https://enc-dec.app/api/dec-flixcloud?type=token', { data: embedData }, FLIX + '/')
        .then(function (tokenDto) {
          if (Number(tokenDto.status) !== 200 || !tokenDto.result || !tokenDto.result.token) {
            throw new Error('FlixCloud token decode failed');
          }
          return _fetch(FLIX + '/api/m3u8/' + encodeURIComponent(tokenDto.result.token), FLIX + '/', 15000, '*/*')
            .then(function (r) {
              var streamResponse = JSON.parse(r.body || 'null');
              if (!streamResponse || typeof streamResponse !== 'object') throw new Error('FlixCloud stream response was not JSON');
              return _postJson('https://enc-dec.app/api/dec-flixcloud?type=stream', {
                data: { context: tokenDto.result.context, stream_response: streamResponse }
              }, FLIX + '/');
            });
        });
    })
    .then(function (streamDto) {
      if (Number(streamDto.status) !== 200 || !streamDto.result || !streamDto.result.stream) {
        throw new Error('FlixCloud stream decode failed');
      }
      var streamUrl = String(streamDto.result.stream);
      var wPayload = streamDto.result.context && streamDto.result.context.w_payload;
      if (wPayload == null) throw new Error('FlixCloud stream payload missing');
      // Use the upstream decoder's HTTP endpoint. Unlike the Aniyomi port, this
      // runtime cannot host the local loopback proxy that rewrites/decrypts HLS
      // segments, so the remote parser endpoint is the compatible bridge.
      var playable = 'https://enc-dec.app/api/parse-flixcloud?url=' +
        encodeURIComponent(streamUrl) + '&w_payload=' + encodeURIComponent(String(wPayload));
      return [{
        url: playable, quality: 'Auto', label: label || 'Re:Anime',
        container: 'hls', headers: _flixApiHeaders(FLIX + '/'),
        kind: kind || 'sub', audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: []
      }];
    })
    .catch(function () { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var parts = String(episodeUrl || '').split('|');
  var slug = parts[0] || '';
  var epNum = Number(parts[1] || 0);
  var aid = String(parts[3] || '').trim();
  if (!slug || !(epNum > 0)) return Promise.resolve([]);
  var audio = opts && String(opts.category || '').toLowerCase() === 'dub' ? 'dub' : 'sub';
  var getAid = /^\d+$/.test(aid) && aid !== '0' ? Promise.resolve(aid) :
    _detailData(slug).then(function (d) {
      var data = d && (d.data || d.anime || d);
      return _anilistId(data);
    });
  return getAid.then(function (anilistId) {
    if (!/^\d+$/.test(String(anilistId || '')) || String(anilistId) === '0') return [];
    return _json(FLIX_API + '/' + String(anilistId) + '/' + epNum, SITE + '/watch/' + slug + '?ep=' + epNum)
      .then(function (data) {
        var servers = _arr(data);
        var tasks = [];
        servers.forEach(function (server) {
          var serverType = String(server.dataType || '').toLowerCase();
          if (serverType && serverType !== audio) return;
          var label = '[' + (serverType || audio).toUpperCase() + '] ' + String(server.serverName || 'Re:Anime');
          var link = String(server.dataLink || server.url || '');
          var direct = _directMedia(link, label, audio);
          if (direct) tasks.push(Promise.resolve([direct]));
          else if (/flixcloud/i.test(link) && /\/e\//i.test(link)) tasks.push(_resolveFlixStream(link, label, audio));
        });
        return Promise.all(tasks).then(function (groups) {
          var out = [], seen = {};
          groups.forEach(function (group) {
            (group || []).forEach(function (s) {
              if (!s || !s.url || seen[s.url]) return;
              seen[s.url] = 1;
              out.push(s);
            });
          });
          return out;
        });
      });
  }).catch(function () {
    // A provider/network failure must not bubble into Zangetsu's generic
    // "source is having a moment" state. Report no streams and let other sources run.
    return [];
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.2.4', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
  };
}
