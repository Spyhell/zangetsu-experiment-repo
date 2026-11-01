// MultiMovies — movies + TV series source for the Zangetsu provider repo.
// Site: m1.multimovies.courses (domains hop; auto-resolved via phisher98's
// public domains.json, same as the CloudStream MultiMoviesProvider).
//
// Chain (all server-side, no crypto, no login):
//   /search?q=                  -> article.poster-card -> /movie/<slug>-<tmdb>
//                                                   | /series/<slug>-<tmdb>
//   / (home)                    -> article.cinema-slide -> /movie/<slug>
//                                                   | /watch/movie/<tmdb>
//   page                        -> og:* meta + vidbolt embed URL (carries tmdb id)
//   vidbolt.xyz/api/episodes    -> seasons/episodes for series (JSON)
//   vidbolt.xyz/api/resolve     -> HLS master: 1080p/720p/480p variants,
//                                  multi-audio (Hindi/Tamil/English/Telugu/...),
//                                  subtitle tracks (English/...)

var SOURCE_ID = 'multimovies';
var FALLBACK_DOMAIN = 'https://m1.multimovies.courses';
var DOMAINS_JSON = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
var VB = 'https://vidbolt.xyz';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'MultiMovies', lang: 'en', baseUrl: FALLBACK_DOMAIN,
    logo: FALLBACK_DOMAIN + '/favicon.ico', type: 'movie', version: '1.0.0' };
}

function getSettings() {
  return [
    { key: 'domain', label: 'Site domain', type: 'enum', 'default': 'auto',
      options: [
        { value: 'auto', label: 'Auto (recommended)' },
        { value: FALLBACK_DOMAIN, label: 'm1.multimovies.courses' },
        { value: 'custom', label: 'Custom domain (set below)' }
      ] },
    { key: 'customDomain', label: 'Custom domain (https://..., used when Domain = Custom)',
      type: 'text', 'default': '' }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings[SOURCE_ID]) || {};
    var v = s[key];
    return (v === undefined || v === null || v === '') ? def : v;
  } catch (e) { return def; }
}

// ── network helpers (every call rejects with a message, never hangs) ───────
function _raceTimeout(promise, ms, label) {
  var t;
  var timer = new Promise(function (_, rej) {
    t = setTimeout(function () { rej(new Error('MultiMovies: timed out (' + label + ')')); }, ms);
  });
  return Promise.race([promise, timer]).then(function (v) { clearTimeout(t); return v; },
    function (e) { clearTimeout(t); throw e; });
}
function _get(url, ref) {
  var p = fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || FALLBACK_DOMAIN + '/' } })
    .then(function (r) {
      if (!r.ok) throw new Error('MultiMovies: HTTP ' + r.status + ' ' + url);
      return r.text();
    });
  return _raceTimeout(p, 25000, url);
}
function _getJson(url, ref) {
  var p = fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || VB + '/',
      'Accept': 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('MultiMovies: HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  return _raceTimeout(p, 25000, url);
}

// ── domain resolution (auto via public domains.json, cached) ────────────────
var _domainCache = null;
function _domain() {
  var pick = _cfg('domain', 'auto');
  if (pick === 'custom') {
    var c = String(_cfg('customDomain', '')).replace(/\/+$/, '');
    return Promise.resolve(c || FALLBACK_DOMAIN);
  }
  if (pick && pick !== 'auto') return Promise.resolve(String(pick).replace(/\/+$/, ''));
  if (_domainCache) return Promise.resolve(_domainCache);
  return _getJson(DOMAINS_JSON, 'https://github.com/').then(function (j) {
    var d = j && (j.MultiMovies || j.multimovies);
    if (d) _domainCache = String(d).replace(/\/+$/, '');
    return _domainCache || FALLBACK_DOMAIN;
  }).catch(function () { return FALLBACK_DOMAIN; });
}

// ── html helpers ────────────────────────────────────────────────────────────
function _og(html, prop) {
  var m = html.match(new RegExp('<meta[^>]+property="og:' + prop + '"[^>]+>', 'i'));
  if (!m) return null;
  var c = m[0].match(/content="([^"]*)"/i);
  return c ? c[1] : null;
}
function _cleanTitle(t) {
  return String(t || '').replace(/\s*-\s*MultiMovies.*$/i, '').trim();
}
function _yearOf(html) {
  var m = html.match(/<span[^>]*>\s*((?:19|20)\d{2})\s*<\/span>/);
  return m ? m[1] : null;
}
// /movie/foo-123 /series/bar-456 | /watch/movie/123 -> {kind, tmdb}
function _tmdbFromPage(html, path) {
  var m = html.match(/vidbolt\.xyz\/(movie|tv)\/(\d+)/);
  if (m) return { kind: m[1] === 'tv' ? 'series' : 'movie', tmdb: m[2] };
  var s = String(path || '').match(/-(\d+)\/?$/);
  if (s) return { kind: /\/series\//.test(path) ? 'series' : 'movie', tmdb: s[1] };
  return null;
}

function _item(id, title, cover, kind, extra) {
  var it = { id: id, title: title, url: id, type: 'movie' };
  if (cover) it.cover = cover;
  if (kind === 'series') it.dubBadge = undefined;
  return it;
}

// ── search / home ───────────────────────────────────────────────────────────
function _parseCards(html) {
  var out = [], seen = {};
  var re = /<article[^>]*class="poster-card"[^>]*>([\s\S]*?)<\/article>/g, m;
  while ((m = re.exec(html)) !== null) {
    var card = m[1];
    var a = card.match(/<a[^>]*class="poster-art"[^>]*href="([^"]+)"[^>]*aria-label="([^"]*)"/)
      || card.match(/<a[^>]*href="(\/(?:movie|series)\/[^"]+)"[^>]*>/);
    if (!a) continue;
    var href = a[1], title = (a[2] || '').trim();
    if (seen[href]) continue; seen[href] = 1;
    var img = card.match(/<img[^>]*src="([^"]+)"/);
    if (!title) {
      var tm = card.match(/alt="([^"]+)"/);
      title = tm ? tm[1].trim() : href;
    }
    out.push(_item('multimovies://page' + href, title,
      img ? img[1] : null, /\/series\//.test(href) ? 'series' : 'movie'));
  }
  return out;
}
function search(query, page, opts) {
  return _domain().then(function (d) {
    return _get(d + '/search?q=' + encodeURIComponent(query), d + '/');
  }).then(_parseCards);
}
function getHome(opts) {
  return _domain().then(function (d) {
    return _get(d + '/', d + '/').then(function (html) {
      return { domain: d, html: html };
    });
  }).then(function (r) {
    var d = r.domain, html = r.html, out = [], seen = {};
    var re = /<article[^>]*class="cinema-slide[^"]*"[^>]*>([\s\S]*?)<\/article>/g, m;
    while ((m = re.exec(html)) !== null) {
      var s = m[1];
      var hrefs = s.match(/href="(\/(?:movie|series|watch\/(?:movie|tv))\/[^"]+)"/g) || [];
      var href = hrefs.length ? hrefs[0].replace(/^href="/, '').replace(/"$/, '') : null;
      if (!href || seen[href]) continue; seen[href] = 1;
      var t = (s.match(/<h1>([^<]*)<\/h1>/) || [])[1] || 'Untitled';
      var img = (s.match(/class="cinema-backdrop"[^>]*src="([^"]+)"/)
        || s.match(/<img[^>]*src="([^"]+)"/) || [])[1] || null;
      out.push(_item('multimovies://page' + href, t.trim(), img,
        href.indexOf('/watch/tv/') >= 0 || href.indexOf('/series/') >= 0 ? 'series' : 'movie'));
    }
    return [{ title: 'Latest Updates', items: out }];
  });
}

// ── detail / episodes ───────────────────────────────────────────────────────
function getDetail(url, opts) {
  var raw = String(url || '').replace(/^multimovies:\/\/page/, '');
  return _domain().then(function (d) {
    return _get(d + raw, d + '/').then(function (html) {
      return { d: d, html: html };
    });
  }).then(function (r) {
    var html = r.html, d = r.d;
    var title = _cleanTitle(_og(html, 'title')) || 'Unknown';
    var desc = _og(html, 'description') || null;
    var cover = _og(html, 'image') || null;
    var info = _tmdbFromPage(html, raw);
    if (!info) throw new Error('MultiMovies: no tmdb id on page');
    var id = 'multimovies://play/' + info.kind + '/' + info.tmdb;
    return { id: id, title: title, url: id, type: 'movie', cover: cover,
      description: desc ? desc.split('\r\n')[0] : null,
      year: _yearOf(html) };
  });
}
function _vbEpisodes(tmdb) {
  return _getJson(VB + '/api/episodes?id=' + encodeURIComponent(tmdb) + '&season=1',
    VB + '/tv/' + tmdb + '/1/1').then(function (first) {
    var seasons = (first && first.seasons) || [{ season: 1 }];
    var jobs = seasons.map(function (s) {
      var sn = s.season;
      if (sn === 1) return Promise.resolve(first);
      return _getJson(VB + '/api/episodes?id=' + encodeURIComponent(tmdb) + '&season=' + sn,
        VB + '/tv/' + tmdb + '/' + sn + '/1').catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (pages) {
      var out = [];
      pages.forEach(function (pg, i) {
        var sn = seasons[i].season;
        var eps = (pg && pg.episodes) || [];
        eps.forEach(function (e) {
          var en = Number(e.episode);
          out.push({ id: 'multimovies://play/series/' + tmdb + '/' + sn + '/' + en,
            title: 'S' + sn + ' E' + en + (e.name ? ' · ' + e.name : ''),
            url: 'multimovies://play/series/' + tmdb + '/' + sn + '/' + en,
            number: en });
        });
      });
      return out;
    });
  });
}
function getEpisodes(url, opts) {
  var m = String(url || '').match(/^multimovies:\/\/play\/(movie|series)\/(\d+)(?:\/(\d+)\/(\d+))?/);
  if (!m) return Promise.reject(new Error('MultiMovies: bad episode url'));
  if (m[1] === 'movie') {
    var id = 'multimovies://play/movie/' + m[2];
    return Promise.resolve([{ id: id, title: 'Movie', url: id, number: 1 }]);
  }
  return _vbEpisodes(m[2]);
}

// ── video sources (VidBolt: HLS master + multi-audio + subtitles) ───────────
var _LANG = { eng: 'en', ind: 'id', tha: 'th', ara: 'ar', hin: 'hi', tam: 'ta',
  tel: 'te', spa: 'es', por: 'pt', fre: 'fr', ger: 'de', vie: 'vi', msa: 'ms',
  fil: 'fil', ita: 'it', rus: 'ru', kor: 'ko', jpn: 'ja', zho: 'zh', dut: 'nl' };
function _absUrl(rel, base) {
  rel = String(rel || '');
  if (/^https?:\/\//i.test(rel)) return rel;
  return base.replace(/\/[^/]*$/, '/') + rel;
}
function _parseMaster(master, base) {
  var lines = master.split('\n'), variants = [], subs = [], audios = [], i;
  for (i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    var sm = ln.match(/^#EXT-X-MEDIA:TYPE=SUBTITLES,(.*)$/);
    if (sm) {
      var uri = (sm[1].match(/URI="([^"]+)"/) || [])[1];
      var lang = (sm[1].match(/LANGUAGE="([^"]+)"/) || [])[1] || '';
      var name = (sm[1].match(/NAME="([^"]+)"/) || [])[1] || lang;
      if (uri) subs.push({ url: _absUrl(uri, base),
        lang: _LANG[lang.toLowerCase()] || lang.toLowerCase() || 'und',
        label: name, format: /\.srt(\?|$)/i.test(uri) ? 'srt' : 'vtt' });
      continue;
    }
    var am = ln.match(/^#EXT-X-MEDIA:TYPE=AUDIO,(.*)$/);
    if (am) {
      var aname = (am[1].match(/NAME="([^"]+)"/) || [])[1];
      if (aname) audios.push(aname);
      continue;
    }
    var vm = ln.match(/^#EXT-X-STREAM-INF:.*RESOLUTION=\d+x(\d+)/);
    if (vm) {
      var q = vm[1] + 'p';
      var uri2 = null, j;
      for (j = i + 1; j < lines.length; j++) {
        var l2 = lines[j].trim();
        if (!l2) continue;
        if (l2.charAt(0) !== '#') uri2 = l2;
        break;
      }
      variants.push({ q: q, uri: uri2 ? _absUrl(uri2, base) : null });
    }
  }
  return { variants: variants, subs: subs, audios: audios };
}
function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^multimovies:\/\/play\/(movie|series)\/(\d+)(?:\/(\d+)\/(\d+))?/);
  if (!m) return Promise.reject(new Error('MultiMovies: bad episode url'));
  var qs = 'type=' + (m[1] === 'series' ? 'tv' : m[1]) + '&id=' + m[2];
  if (m[1] === 'series') qs += '&season=' + m[3] + '&episode=' + m[4];
  var ref = VB + '/' + (m[1] === 'series' ? 'tv' : m[1]) + '/' + m[2];
  return _getJson(VB + '/api/resolve?' + qs, ref).then(function (j) {
    var srcs = j && j.stream && j.stream.sources;
    if (!srcs || !srcs.length || !srcs[0].url)
      throw new Error('MultiMovies: VidBolt returned no stream');
    var master = srcs[0].url;
    // Validate the master playlist resolves before returning entries.
    return _get(master, VB + '/').then(function (body) {
      if (body.indexOf('#EXTM3U') < 0) throw new Error('MultiMovies: bad master playlist');
      var parsed = _parseMaster(body, master);
      var subs = parsed.subs;
      var audioNote = parsed.audios.length ? ' [' + parsed.audios.join('/') + ' audio]' : '';
      var hdrs = { 'User-Agent': UA, 'Referer': VB + '/', 'Origin': VB };
      var out = [];
      // Master first (Auto = app default), then per-quality variants.
      out.push({ url: master, container: 'hls', label: 'Auto HLS' + audioNote,
        quality: '1080p', headers: hdrs, subtitles: subs });
      var seen = {};
      parsed.variants.forEach(function (v) {
        if (!v.uri || seen[v.q]) return; seen[v.q] = 1;
        out.push({ url: v.uri, container: 'hls', label: v.q + ' HLS' + audioNote,
          quality: v.q, headers: hdrs, subtitles: subs });
      });
      if (!out.length) throw new Error('MultiMovies: no playable variants');
      return out;
    });
  });
}
