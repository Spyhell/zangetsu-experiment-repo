/*
 * NetMirror — movies + TV series from NetMirror's keyless JSON API.
 *
 * Chain: /api/catalog/search -> /api/catalog/title/{movie|tv}/{tmdbId}
 *   -> /api/catalog/season/{tmdbId}/{n} (TV episodes)
 *   -> /api/embed-tmdb/{tmdbId}?type=..&se=..&ep=.. (fresh signed MP4s)
 *
 * Stream URLs are signed and expire (~24h), so getVideoSources always
 * resolves them fresh — never cache them.
 *
 * v1.0.1: the API now answers mode:'proxy', direct:false and the CDN edge
 * refuses direct hits (429). Streams are played through the site's own
 * /api/proxy/video?url=… (302 → streaming worker), exactly like its web
 * player does. Subtitles come from the top-level `captions` array.
 *
 * Home rows mirror the site's OTT platform rails: Trending, Netflix,
 * Prime Video, Crunchyroll (anime).
 */

var DEFAULT_BASE = 'https://net27.cc';

function _base() {
  try {
    var s = (__settings && __settings.netmirror) || {};
    if (s.baseUrl && typeof s.baseUrl === 'string' && s.baseUrl.indexOf('http') === 0) {
      return s.baseUrl.replace(/\/+$/, '');
    }
  } catch (e) {}
  return DEFAULT_BASE;
}

function getInfo() {
  return {
    name: 'NetMirror',
    lang: 'en',
    baseUrl: _base(),
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/netmirror.png',
    type: 'movie',
    version: '1.0.1'
  };
}

function _timeout(ms, what) {
  return new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error('timeout: ' + what)); }, ms);
  });
}

function _race(p, ms, what) {
  if (typeof setTimeout === 'undefined') return p;
  return Promise.race([p, _timeout(ms, what)]);
}

function _getJson(url, what) {
  return _race(
    fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status + ' for ' + what);
      return r.json();
    }),
    12000, what
  );
}

function _abs(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return _base() + (u.charAt(0) === '/' ? u : '/' + u);
}

function _itemKind(t) {
  // contract only allows 'anime' | 'movie' on items; series ride as 'movie'
  return 'movie';
}

function _toItem(it) {
  if (!it || !it.tmdbId || !it.title) return null;
  var kind = (it.type === 'tv') ? 'tv' : 'movie';
  return {
    id: 'netmirror://' + kind + '/' + it.tmdbId,
    title: it.title + (it.year ? ' (' + it.year + ')' : ''),
    url: 'netmirror://' + kind + '/' + it.tmdbId,
    type: _itemKind(),
    cover: it.poster || it.backdrop || undefined
  };
}

function _parseUrl(url) {
  var m = /^netmirror:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(url || '');
  if (!m) return null;
  return {
    kind: m[1],
    tmdbId: m[2],
    season: m[3] ? parseInt(m[3], 10) : null,
    episode: m[4] ? parseInt(m[4], 10) : null
  };
}

// ---- home: OTT platform rails ----
var HOME_TABS = [
  { tab: 'trending',   label: 'Trending Now',      maxRails: 2 },
  { tab: 'Netflix',    label: 'Top on Netflix',    maxRails: 3 },
  { tab: 'PrimeVideo', label: 'Top on Prime Video', maxRails: 3 },
  { tab: 'Crunchyroll', label: 'Top Anime',        maxRails: 2 }
];

function getHome(opts) {
  var jobs = HOME_TABS.map(function (t) {
    return _getJson(_base() + '/api/catalog/curated/' + encodeURIComponent(t.tab), 'home:' + t.tab)
      .then(function (d) { return { tab: t, data: d }; })
      .catch(function () { return { tab: t, data: null }; });
  });
  return Promise.all(jobs).then(function (results) {
    var rows = [];
    results.forEach(function (r) {
      var rails = (r.data && r.data.rails) || [];
      rails.slice(0, r.tab.maxRails).forEach(function (rail) {
        var items = ((rail && rail.items) || []).map(_toItem).filter(function (x) { return !!x; });
        if (!items.length) return;
        rows.push({ title: r.tab.label + (rails.length > 1 && rail.title ? ' · ' + rail.title : ''), items: items.slice(0, 24) });
      });
    });
    if (!rows.length) throw new Error('NetMirror home is empty');
    return rows;
  });
}

function search(query, page, opts) {
  if (!query) return Promise.resolve([]);
  return _getJson(_base() + '/api/catalog/search?q=' + encodeURIComponent(query), 'search')
    .then(function (d) {
      return ((d && d.items) || []).map(_toItem).filter(function (x) { return !!x; }).slice(0, 30);
    });
}

// ---- detail / episodes ----
function _seasonEpisodes(tmdbId, n) {
  return _getJson(_base() + '/api/catalog/season/' + tmdbId + '/' + n, 'season ' + n)
    .then(function (d) {
      return (d && d.episodes) || [];
    })
    .catch(function () { return []; });
}

function _tvEpisodes(tmdbId, detail) {
  var seasons = detail.seasons || [];
  if (!seasons.length) {
    // fall back to the initial episode list on the title payload
    return Promise.resolve((detail.initialEpisodes || []).map(function (e) {
      return {
        id: 'netmirror://tv/' + tmdbId + '/1/' + e.episode,
        title: 'E' + e.episode + (e.name ? ' · ' + e.name : ''),
        url: 'netmirror://tv/' + tmdbId + '/1/' + e.episode,
        number: e.episode
      };
    }));
  }
  var jobs = seasons.slice(0, 12).map(function (s) {
    return _seasonEpisodes(tmdbId, s.season_number).then(function (eps) {
      return { n: s.season_number, eps: eps };
    });
  });
  return Promise.all(jobs).then(function (all) {
    var out = [];
    all.forEach(function (s) {
      (s.eps || []).forEach(function (e) {
        out.push({
          id: 'netmirror://tv/' + tmdbId + '/' + s.n + '/' + e.episode,
          title: 'S' + s.n + ' E' + e.episode + (e.name ? ' · ' + e.name : ''),
          url: 'netmirror://tv/' + tmdbId + '/' + s.n + '/' + e.episode,
          number: e.episode
        });
      });
    });
    return out;
  });
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  return _getJson(_base() + '/api/catalog/title/' + p.kind + '/' + p.tmdbId, 'detail').then(function (d) {
    if (!d || !d.ok) throw new Error('title not found');
    var detail = {
      id: 'netmirror://' + p.kind + '/' + p.tmdbId,
      title: d.title || 'Unknown',
      url: url,
      type: 'movie',
      cover: d.poster || undefined,
      banner: d.backdrop || undefined,
      description: d.overview || undefined,
      year: d.year != null ? String(d.year) : null
    };
    if (p.kind === 'movie') {
      detail.episodes = [{
        id: 'netmirror://movie/' + p.tmdbId,
        title: d.title || 'Movie',
        url: 'netmirror://movie/' + p.tmdbId,
        number: 1
      }];
      return detail;
    }
    return _tvEpisodes(p.tmdbId, d).then(function (eps) {
      detail.episodes = eps;
      return detail;
    });
  });
}

function getEpisodes(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  if (p.kind === 'movie') {
    return Promise.resolve([{
      id: 'netmirror://movie/' + p.tmdbId,
      title: 'Movie',
      url: 'netmirror://movie/' + p.tmdbId,
      number: 1
    }]);
  }
  return _getJson(_base() + '/api/catalog/title/tv/' + p.tmdbId, 'detail').then(function (d) {
    return _tvEpisodes(p.tmdbId, d || {});
  });
}

// ---- streams ----
function _subs(captions) {
  var out = [];
  (captions || []).forEach(function (c) {
    var u = _abs(c.url);
    if (!u || !c.lang) return;
    out.push({ url: u, lang: String(c.lang), label: c.name || String(c.lang) });
  });
  return out;
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('bad url: ' + episodeUrl));
  var q = '?type=' + p.kind + (p.kind === 'tv' ? '&se=' + p.season + '&ep=' + p.episode : '');
  return _getJson(_base() + '/api/embed-tmdb/' + p.tmdbId + q, 'streams').then(function (d) {
    if (!d || !d.ok) throw new Error('no streams');
    if (d.noSource) throw new Error('NetMirror: ' + (d.error || 'no source for this title yet'));
    var subs = _subs(d.captions);
    var streams = (d.streams || [])
      .filter(function (s) { return s && /^https?:\/\//i.test(s.url); })
      .map(function (s) {
        var res = parseInt(s.resolution, 10) || 0;
        // The API now answers mode:'proxy', direct:false — the CDN edge
        // refuses direct hits (HTTP 429), so play through the site's own
        // proxy exactly like its web player does. The player follows the
        // 302 to the streaming worker.
        var playUrl = _base() + '/api/proxy/video?url=' + encodeURIComponent(s.url);
        return {
          url: playUrl,
          quality: res ? (res + 'p') : undefined,
          label: 'NetMirror · ' + (res ? res + 'p' : 'Auto'),
          container: 'mp4',
          subtitles: subs,
          _res: res
        };
      })
      .sort(function (a, b) { return b._res - a._res; });
    streams.forEach(function (s) { delete s._res; });
    // optional HLS fallback (only when the endpoint actually answers)
    var loffe = d.fallbackHls ? _abs(d.fallbackHls) : null;
    var withHls = loffe
      ? _race(fetch(loffe, { method: 'GET' }).then(function (r) {
          if (!r.ok) throw new Error('hls fallback unavailable');
          return r.text();
        }), 8000, 'hls fallback').then(function (body) {
          if (body && body.indexOf('#EXTM3U') >= 0) {
            streams.push({
              url: loffe, quality: undefined, label: 'NetMirror · Auto (HLS)',
              container: 'hls', subtitles: subs
            });
          }
          return streams;
        }).catch(function () { return streams; })
      : Promise.resolve(streams);
    return withHls.then(function (list) {
      if (!list.length) throw new Error('NetMirror: no playable streams');
      return list;
    });
  });
}
