// AV1Please (av1please.com / AV1EnCodes) — low-size AV1 anime encodes,
// English sub + dual-audio releases, files hosted on the site itself.
// Flow: /anime/<slug> (detail) -> /episodes/<slug>/<season>/<res>
// (episode lists whose anchors point at per-episode download pages).
// The download page itself is HTML behind a captcha — never playable —
// but it hides two usable things: a /watch/ link that maps to a DASH
// manifest (/watch/ -> /dash/ + /manifest.mpd), and a DDL token that
// authorizes the site's /get_ddl/ API for the direct file link. Both
// are plain-HTTP, no captcha — the same two paths the site's other
// app clients use.
// The site IP-blacklists datacenter IPs at its gateway; residential IPs
// (the user's phone) pass. A first hit can land on the block page and a
// plain re-request gets through (the block page's own "Try Again"), so
// every fetch retries a couple of times when it sees the block page.
function getInfo() {
  return {
    id: 'av1please',
    name: 'AV1Please',
    lang: 'en',
    baseUrl: 'https://av1please.com',
    logo: 'https://av1please.com/static/images/favicon.png',
    type: 'anime',
    version: '1.0.2'
  };
}

// The site runs on three mirror domains with identical paths. If one
// domain misbehaves for your connection, switch to another here — or
// paste any other mirror address in the custom field.
function getSettings() {
  return [
    {
      key: 'domain',
      label: 'Domain (site mirror)',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto — try all mirrors' },
        { value: 'https://av1please.com', label: 'av1please.com' },
        { value: 'https://av1encodes.com', label: 'av1encodes.com' },
        { value: 'https://animealpha.cc', label: 'animealpha.cc' }
      ]
    },
    {
      key: 'customDomain',
      label: 'Custom domain (optional — overrides the choice above)',
      type: 'text',
      default: ''
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings.av1please) || {};
    var v = s[key];
    return (v === undefined || v === null || v === '') ? def : v;
  } catch (e) {
    return def;
  }
}

var BASE = 'https://av1please.com';
// Same site, mirror domains (identical paths). If the gateway blocks
// one domain for this connection, the next mirror is tried — the
// working mirror then sticks for the rest of the session.
var MIRRORS = ['https://av1please.com', 'https://av1encodes.com', 'https://animealpha.cc'];
var _activeBase = null;
// When the gateway IP-blacklists this connection it blocks every
// mirror at once, and hammering it only keeps the block alive. Once
// a full round comes back blocked, fail fast for a cooling-off
// window instead of re-requesting.
var _blockedUntil = 0;

function _mirrorOrder() {
  var custom = String(_cfg('customDomain', '') || '').replace(/^\s+|\s+$/g, '');
  if (custom) {
    if (!/^https?:\/\//i.test(custom)) custom = 'https://' + custom;
    return [custom.replace(/\/+$/, '')];
  }
  var d = String(_cfg('domain', 'auto') || 'auto');
  if (d !== 'auto' && MIRRORS.indexOf(d) !== -1) return [d];
  var order = [];
  if (_activeBase) order.push(_activeBase);
  for (var i = 0; i < MIRRORS.length; i++) {
    if (MIRRORS[i] !== _activeBase) order.push(MIRRORS[i]);
  }
  return order;
}

var BLOCKED_MSG = 'AV1Please: the site has temporarily blocked this connection (IP blacklist). Wait a few minutes and try again, or switch the Domain in the AV1Please source settings.';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// The gateway checks a "browser identity": the site issues an
// av1_client_id cookie and expects it back on every request. The
// app's fetch bridge keeps no cookie jar between calls, so the
// source carries the identity itself. Without it, every request
// looks like a brand-new anonymous visitor, and the gateway
// blacklists the connection's IP (all mirrors at once).
var SITE_COOKIES = {};

function _hostOf(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function _setCookieOf(response) {
  var h = response && response.headers;
  if (!h) return '';
  try { if (typeof h.get === 'function') return h.get('set-cookie') || ''; } catch (e) {}
  for (var k in h) {
    if (String(k).toLowerCase() === 'set-cookie') {
      var v = h[k];
      return Object.prototype.toString.call(v) === '[object Array]' ? v.join(', ') : String(v || '');
    }
  }
  return '';
}

function _captureCookie(response, url) {
  var sc = _setCookieOf(response);
  if (!sc) return;
  var m = /(?:^|[,;]\s*)av1_client_id=([^;,\s]+)/i.exec(sc);
  var host = _hostOf(url);
  if (m && host) SITE_COOKIES[host] = 'av1_client_id=' + m[1];
}

function _cookieHeaderFor(url) {
  var host = _hostOf(url);
  return (host && SITE_COOKIES[host]) ? SITE_COOKIES[host] : '';
}

// One coherent browser identity on every request: desktop Chrome
// UA plus the matching client-hint / fetch headers, the page's
// referer, and the site identity cookie once it has been issued.
function _navHeaders(ref) {
  var h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': ref,
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
  var c = _cookieHeaderFor(ref);
  if (c) h.Cookie = c;
  return h;
}
var RES_LIST = ['640 x 360', '854 x 480', '1280 x 720', '1920 x 1080'];
var RES_LABEL = { '640 x 360': '360p', '854 x 480': '480p', '1280 x 720': '720p', '1920 x 1080': '1080p' };

function _raceTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('AV1Please timeout: ' + label)); }, ms);
    })
  ]);
}

function _rawFetch(url, base) {
  var p = fetch(url, {
    headers: _navHeaders(base + '/')
  }).then(function(r) {
    _captureCookie(r, url);
    return r.text();
  });
  return _raceTimeout(p, 15000, url);
}

function _isBlocked(html) {
  if (!html) return true;
  if (html.indexOf('Connection blacklisted') !== -1) return true;
  if (html.indexOf('Access Blocked') !== -1) return true;
  if (html.indexOf('/home/blocked') !== -1 && html.length < 4000) return true;
  return false;
}

// One mirror, with the gateway-clearance retry: a blocked first
// response is re-requested (same thing the site's "Try Again" does).
// A host is warmed up first (one home-page hit) whenever the
// session holds no identity cookie for it yet.
function _fetchFrom(base, path, tries) {
  var warm = _cookieHeaderFor(base)
    ? Promise.resolve('')
    : _rawFetch(base + '/', base).catch(function() { return ''; });
  return warm.then(function() {
    return _fetchFromWarmed(base, path, tries);
  });
}

function _fetchFromWarmed(base, path, tries) {
  return _rawFetch(base + path, base).then(function(html) {
    if (_isBlocked(html)) {
      if (tries > 1) return _fetchFromWarmed(base, path, tries - 1);
      throw new Error('blocked');
    }
    _activeBase = base;
    _blockedUntil = 0;
    return html;
  });
}

// Fetch a site path ("/anime/x", "/search?q=..") from the chosen
// mirror (or, in Auto mode, the active mirror with fail-over to the
// others). The hrefs inside a page are re-based onto the serving
// mirror, so streams always come from the domain that answered.
function _fetchText(path) {
  if (Date.now() < _blockedUntil) {
    return Promise.reject(new Error(BLOCKED_MSG));
  }
  var order = _mirrorOrder();
  function attempt(idx) {
    if (idx >= order.length) {
      _blockedUntil = Date.now() + 90000;
      throw new Error(BLOCKED_MSG);
    }
    return _fetchFrom(order[idx], path, 2).then(function(html) {
      for (var i = 0; i < MIRRORS.length; i++) {
        if (MIRRORS[i] !== order[idx]) html = html.split(MIRRORS[i]).join(order[idx]);
      }
      return html;
    }).catch(function() { return attempt(idx + 1); });
  }
  return attempt(0);
}

function _text(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function _slugFromHref(href) {
  var m = String(href || '').match(/\/anime\/([a-z0-9\-]+)/i);
  return m ? m[1] : '';
}

// Card parser: anchors to /anime/<slug> with a poster image in the
// surrounding markup (cards nest the img inside or beside the anchor).
function _cards(html) {
  var out = [];
  var seen = {};
  var re = /href="(\/anime\/[a-z0-9\-]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = _slugFromHref(m[1]);
    if (!slug || seen[slug]) continue;
    var start = Math.max(0, m.index - 700);
    var window = html.slice(start, m.index + 900);
    var img = window.match(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|webp|png)[^"]*)"/i);
    // Title: the anchor's own text or the img alt in the window.
    var title = '';
    var anchorText = html.slice(m.index, m.index + 400).match(/>([^<]{2,120})</);
    if (anchorText) title = _text(anchorText[1]);
    if (!title && img) {
      var alt = window.match(/alt="([^"]{2,120})"/i);
      if (alt) title = _text(alt[1]);
    }
    if (!title) title = slug.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    seen[slug] = true;
    out.push({
      id: slug,
      title: title,
      url: 'av1please://' + slug,
      type: 'anime',
      cover: img ? img[1] : null
    });
  }
  return out;
}

function _section(html, heading) {
  var idx = html.indexOf(heading);
  if (idx === -1) return '';
  var rest = html.slice(idx);
  // Cut at the next section heading (h2-ish) after this one.
  var heads = ['Latest Episodes', 'Dub Releases', 'Recently Added', 'Top Airing', 'Popular'];
  var end = rest.length;
  for (var i = 0; i < heads.length; i++) {
    if (heads[i] === heading) continue;
    var j = rest.indexOf(heads[i], 10);
    if (j > 10 && j < end) end = j;
  }
  return rest.slice(0, end);
}

function getHome(opts) {
  return _fetchText('/').then(function(html) {
    var rows = [];
    var names = ['Latest Episodes', 'Dub Releases', 'Recently Added'];
    for (var i = 0; i < names.length; i++) {
      var seg = _section(html, names[i]);
      if (!seg) continue;
      var items = _cards(seg).slice(0, 24);
      if (items.length) rows.push({ title: names[i], items: items });
    }
    if (!rows.length) {
      var all = _cards(html).slice(0, 24);
      if (all.length) rows.push({ title: 'Latest Episodes', items: all });
    }
    return rows;
  });
}

function search(query, page, opts) {
  return _fetchText('/search?q=' + encodeURIComponent(query)).then(function(html) {
    return _cards(html).slice(0, 40);
  });
}

function _detailPage(slug) {
  return _fetchText('/anime/' + slug).then(function(html) {
    var title = '';
    var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = _text(h1[1]);
    if (!title) {
      var og = html.match(/property="og:title"\s+content="([^"]+)"/i);
      if (og) title = _text(og[1]).replace(/\s*[-|].*$/, '');
    }
    var poster = html.match(/<img[^>]+src="(https:\/\/image\.tmdb\.org\/[^"]+)"/i);
    var genres = [];
    var gm = html.match(/Genre:\s*([^<]+)</i);
    if (gm) genres = _text(gm[1]).split(/\s*,\s*/).filter(Boolean);
    var desc = '';
    var pm = html.match(/<p[^>]*>([\s\S]{60,1200}?)<\/p>/i);
    if (pm) desc = _text(pm[1]);
    return {
      id: slug,
      title: title || slug.replace(/-/g, ' '),
      url: 'av1please://' + slug,
      type: 'anime',
      cover: poster ? poster[1] : null,
      banner: poster ? poster[1] : null,
      description: desc || null,
      year: null,
      genres: genres
    };
  });
}

// One season's episode list at one resolution. Returns [] when the page
// has no episode links (no such season / resolution).
function _seasonEpisodes(slug, season, res) {
  return _fetchText('/episodes/' + slug + '/' + season + '/' + encodeURIComponent(res)).then(function(html) {
    var out = [];
    var re = /href="(https:\/\/[a-z0-9.]+\/download\/[^"]+)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1].replace(/&amp;/g, '&');
      var decoded = href;
      try { decoded = decodeURIComponent(href); } catch (e) {}
      var em = decoded.match(/\[E(\d+)\]/i);
      if (!em) continue;
      var n = parseInt(em[1], 10);
      var badge = /\[Dual\]/i.test(decoded) ? 'Dual' : (/\[Sub\]/i.test(decoded) ? 'Sub' : '');
      out.push({ n: n, href: href, badge: badge });
    }
    out.sort(function(a, b) { return a.n - b.n; });
    return out;
  }).catch(function() { return []; });
}

// Run fn over items in small sequential batches — parallel enough
// to stay fast, gentle enough not to trip the site's rate limits.
function _inBatches(items, size, fn) {
  var results = [];
  var chain = Promise.resolve();
  for (var i = 0; i < items.length; i += size) {
    (function(slice) {
      chain = chain.then(function() {
        return Promise.all(slice.map(fn)).then(function(rs) {
          rs.forEach(function(r) { results.push(r); });
        });
      });
    })(items.slice(i, i + size));
  }
  return chain.then(function() { return results; });
}

// Probe seasons 1..N: fetch the 720p episode list per season in
// small batches; seasons are contiguous, stop at the first gap
// (allowing one empty page of slack for a missing resolution).
function _allEpisodes(slug) {
  var LIST_RES = '1280 x 720';
  function probe(season) {
    return _seasonEpisodes(slug, season, LIST_RES).then(function(eps) {
      if (eps.length) return { season: season, eps: eps };
      // 720p missing for this season does not mean the season is
      // missing — try the other resolutions before giving up.
      return _seasonEpisodes(slug, season, '1920 x 1080').then(function(e2) {
        if (e2.length) return { season: season, eps: e2 };
        return _seasonEpisodes(slug, season, '854 x 480').then(function(e3) {
          return e3.length ? { season: season, eps: e3 } : null;
        });
      });
    });
  }
  var seasons = [1, 2, 3, 4, 5, 6];
  return _inBatches(seasons, 2, probe).then(function(found) {
    var good = found.filter(Boolean);
    if (good.length && good[good.length - 1].season === 6) {
      var more = [7, 8, 9, 10, 11, 12];
      return _inBatches(more, 2, probe).then(function(extra) {
        return good.concat(extra.filter(Boolean));
      });
    }
    return good;
  }).then(function(foundSeasons) {
    var out = [];
    var overall = 0;
    foundSeasons.sort(function(a, b) { return a.season - b.season; });
    foundSeasons.forEach(function(s) {
      s.eps.forEach(function(ep) {
        overall++;
        out.push({
          id: 'av1please://ep/' + slug + '/' + s.season + '/' + ep.n,
          title: (s.season > 1 ? 'Season ' + s.season + ' ' : '') + 'Episode ' + ep.n,
          url: 'av1please://ep/' + slug + '/' + s.season + '/' + ep.n,
          number: overall
        });
      });
    });
    return out;
  });
}

function getDetail(url, opts) {
  var slug = String(url || '').replace('av1please://', '').split('/')[0];
  return _detailPage(slug).then(function(detail) {
    return _allEpisodes(slug).then(function(eps) {
      detail.episodes = eps;
      detail.subCount = eps.length;
      detail.dubCount = 0;
      return detail;
    });
  });
}

function getEpisodes(url, opts) {
  var slug = String(url || '').replace('av1please://', '').split('/')[0];
  return _allEpisodes(slug);
}

// Fetch an absolute URL (a download page on the active mirror) with
// the same block-retry as path fetches.
function _fetchAbs(url, tries) {
  tries = tries || 2;
  var base = (url.match(/^https?:\/\/[a-z0-9.]+/i) || [BASE])[0];
  return _rawFetch(url, base).then(function(html) {
    if (_isBlocked(html) && tries > 1) return _fetchAbs(url, tries - 1);
    if (_isBlocked(html)) throw new Error('blocked');
    return html;
  });
}

// The episode page hides a DDL token in its markup: a long quoted
// string starting with several "A"s (the same pattern the site's own
// API clients extract). It authorizes the /get_ddl/ API, which hands
// out the real file link with no captcha in between.
function _ddlToken(pageHtml) {
  var m = String(pageHtml || '').match(/['"](A{4,}[A-Za-z0-9_\-]{10,})['"]/);
  return m ? m[1] : null;
}

function _watchLink(pageHtml) {
  var m = String(pageHtml || '').match(/(https?:\/\/[^\s"'<>]+\/watch\/[^\s"'<>]+)/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

// The /get_ddl/ answer is a flat object with snake_case link
// fields: stream_link (direct stream), download_link (the file),
// watch_link (maps to the DASH manifest), torrent_link, subtitles.
function _ddlLinks(text) {
  var data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || typeof data !== 'object') return null;
  if (data.ddl && typeof data.ddl === 'object') data = data.ddl;
  function pick(keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = data[keys[i]];
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    }
    return null;
  }
  var stream = pick(['stream_link', 'streamLink', 'stream']);
  var download = pick(['download_link', 'downloadLink', 'ddl', 'url', 'link', 'file']);
  var watch = pick(['watch_link', 'watchLink', 'watch']);
  if (!stream && !download) {
    for (var k in data) {
      var v = data[k];
      if (typeof v === 'string' && /^https?:\/\//i.test(v) && /(\.mkv|\.mp4|\/download\/|\/file\/|\/stream\/|manifest)/i.test(v)) { download = v; break; }
    }
  }
  if (!stream && !download && !watch) return null;
  return { stream: stream, download: download, watch: watch };
}

// Ask the site's /get_ddl/ API for the direct file link of one
// episode page. The path segment after /get_ddl/ is tried in the
// shapes the site's own clients use: the file name, the download
// path after /download/, and the full download path.
function _getDdl(downloadHref, token) {
  var base = (downloadHref.match(/^https?:\/\/[a-z0-9.]+/i) || [BASE])[0];
  var decoded = downloadHref;
  try { decoded = decodeURIComponent(downloadHref); } catch (e) {}
  var pathPart = decoded.replace(/^https?:\/\/[a-z0-9.]+\//i, '').split('?')[0];
  var file = pathPart.split('/').pop();
  var afterDownload = pathPart.replace(/^download\//i, '');
  var candidates = [file, afterDownload, pathPart];
  function encodePath(p) {
    return p.split('/').map(function(seg) { return encodeURIComponent(seg); }).join('/');
  }
  function attempt(idx) {
    if (idx >= candidates.length) return Promise.resolve(null);
    var url = base + '/get_ddl/' + encodePath(candidates[idx]);
    var hdrs = {
      'User-Agent': UA,
      'Accept': 'application/json',
      'X-Ddl-Token': token,
      'Referer': downloadHref
    };
    var ck = _cookieHeaderFor(downloadHref);
    if (ck) hdrs.Cookie = ck;
    var p = fetch(url, {
      headers: hdrs
    }).then(function(r) {
      _captureCookie(r, url);
      return r.text();
    }).catch(function() { return ''; });
    return _raceTimeout(p, 12000, url).then(function(text) {
      var links = _ddlLinks(text || '');
      return links || attempt(idx + 1);
    }).catch(function() { return attempt(idx + 1); });
  }
  return attempt(0);
}

// Resolve one episode page into playable entries via /get_ddl/:
// the DASH manifest (from the watch link), the direct stream link,
// and the direct file link. The page's own /watch/ link is the
// fallback for the manifest when the API gives no watch_link.
function _resolveEpisodePage(hit, resLabel) {
  return _fetchAbs(hit.href).then(function(page) {
    var token = _ddlToken(page);
    var pageWatch = _watchLink(page);
    if (!token) {
      if (!pageWatch) return [];
      return [_dashEntry(pageWatch, hit, resLabel)];
    }
    return _getDdl(hit.href, token).then(function(links) {
      var out = [];
      var watch = (links && links.watch) || pageWatch;
      if (watch) out.push(_dashEntry(watch, hit, resLabel));
      if (links && links.stream) {
        out.push({
          url: links.stream,
          quality: resLabel,
          label: 'AV1 ' + resLabel + (hit.badge ? ' · ' + hit.badge : '') + ' · Stream',
          container: 'mp4',
          kind: hit.badge === 'Dual' ? 'dub' : 'sub',
          headers: { 'User-Agent': UA, 'Referer': hit.href },
          _rank: 1
        });
      }
      var direct = links && (links.download || links.stream);
      if (direct) {
        out.push({
          url: direct,
          quality: resLabel,
          label: 'AV1 ' + resLabel + (hit.badge ? ' · ' + hit.badge : '') + ' · Direct',
          container: 'mp4',
          kind: hit.badge === 'Dual' ? 'dub' : 'sub',
          headers: { 'User-Agent': UA, 'Referer': hit.href },
          _rank: 2
        });
      }
      return out;
    }).catch(function() {
      return pageWatch ? [_dashEntry(pageWatch, hit, resLabel)] : [];
    });
  }).catch(function() { return []; });
}

function _dashEntry(watch, hit, resLabel) {
  var dash = watch.split('?')[0].replace('/watch/', '/dash/') + '/manifest.mpd';
  return {
    url: dash,
    quality: resLabel,
    label: 'AV1 ' + resLabel + (hit.badge ? ' · ' + hit.badge : '') + ' · DASH',
    container: 'mp4',
    kind: hit.badge === 'Dual' ? 'dub' : 'sub',
    headers: { 'User-Agent': UA, 'Referer': (_activeBase || BASE) + '/' },
    _rank: 0
  };
}

function getVideoSources(episodeUrl) {
  var parts = String(episodeUrl || '').replace('av1please://ep/', '').split('/');
  var slug = parts[0];
  var season = parseInt(parts[1], 10);
  var epNum = parseInt(parts[2], 10);
  if (!slug || isNaN(season) || isNaN(epNum)) {
    return Promise.reject(new Error('AV1Please: bad episode url'));
  }
  return Promise.all(RES_LIST.map(function(res) {
    return _seasonEpisodes(slug, season, res).then(function(eps) {
      var hit = null;
      for (var i = 0; i < eps.length; i++) if (eps[i].n === epNum) { hit = eps[i]; break; }
      if (!hit) return [];
      return _resolveEpisodePage(hit, RES_LABEL[res]);
    });
  })).then(function(groups) {
    var out = [];
    groups.forEach(function(g) { out = out.concat(g); });
    if (!out.length) throw new Error('AV1Please: no playable link found for this episode');
    // Ascending quality; within one quality the Direct file goes
    // last (the app auto-plays the last link overall).
    out.sort(function(a, b) {
      var dq = parseInt(a.quality, 10) - parseInt(b.quality, 10);
      return dq !== 0 ? dq : (a._rank - b._rank);
    });
    out.forEach(function(s) { delete s._rank; });
    return out;
  });
}
