/*
 * DonghuaNation — Chinese anime (donghua) with multi-language subtitles.
 *
 * VERIFIED chain (2026-10-16, plain HTTP, no login, no browser):
 *   Search : GET /api/search?q=<q>            -> JSON {results:[{title,slug,
 *            cover_image,type,year,status}]}
 *   Home   : GET /                            -> SSR tab panels (new-release /
 *            popular) of .anime-card blocks (img.php cover proxy unwrapped).
 *   Detail : GET /anime/<slug>                -> <h1> title, poster img,
 *            og:description, episode pills (data-ep + /watch/<slug>-episode-N).
 *            NOTE: the site only serves the LATEST ~23 episodes of long
 *            series — older watch pages 302 to the detail page. The pill
 *            list is exactly what the site itself offers; short series and
 *            movies expose their full run.
 *   Watch  : GET /watch/<slug>-episode-N      -> server buttons carry
 *            data-player-config-url="/api/player-config?episode_id=X&server_id=Y"
 *            inside data-mode groups (hard_sub / multi_sub).
 *   Config : GET that URL                     -> {embed_url:"/stream/embed/<b64>"}
 *            b64 JSON .u = https://xianxiaplayer.online/embed/<uuid>
 *            (Rumble returns a rumble.com embed — skipped, and its videos
 *            are sometimes deleted upstream anyway.)
 *   Dailymotion servers (some episodes have ONLY Dailymotion + Rumble — e.g.
 *            The Demon Hunter S3 EP7, caught by the user's phone test):
 *            config returns {provider:"dailymotion", video_id} instead ->
 *            GET dailymotion.com/player/metadata/video/<id> ->
 *            qualities.auto = signed HLS master (cdndirector host 403s this
 *            build VM's IP; phone network is the verdict) + caption tracks.
 *   Player : GET the embed page               -> contains
 *            /api/v1/embed/<uuid>/config?token=... ; GET it ->
 *            {data:{sources:[{src: signed HLS master}], tracks:[{src,
 *            srclang, label}]}} — master has 2160p/1440p/1080p/720p/480p/360p
 *            variants; 20 subtitle tracks incl. Hindi + English.
 *            Master + media playlists HTTP 200; segment byte-verified
 *            MPEG-TS (0x47 sync, Rumble CDN) on Swallowed Star EP242.
 * ES5 only. The app runtime lacks atob/btoa/Buffer — pure-JS base64 below.
 */

var _DN_SITE = 'https://donghuanation.com';
var _DN_PLAYER = 'https://xianxiaplayer.online';
var _DN_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function getInfo() {
  return {
    name: 'DonghuaNation', lang: 'en', baseUrl: _DN_SITE,
    logo: _DN_SITE + '/uploads/series/library/abac4f72a5e3e3bc7cd397eca6eb3876.png', type: 'anime', version: '1.0.1'
  };
}

/* ---------------- helpers ---------------- */

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

function _fetchText(url, headers) {
  var h = { 'User-Agent': _DN_UA, 'Accept-Language': 'en-US,en;q=0.9' };
  if (headers) { for (var k in headers) h[k] = headers[k]; }
  return _raceTimeout(fetch(url, { headers: h }).then(function (r) {
    if (!r || !r.ok) throw new Error('DonghuaNation: HTTP ' + (r && r.status) + ' for ' + url);
    return r.text();
  }), 20000, null).then(function (t) {
    if (t == null) throw new Error('DonghuaNation: timeout for ' + url);
    return t;
  });
}

function _fetchJson(url, headers) {
  return _fetchText(url, headers).then(function (t) {
    try { return JSON.parse(t); }
    catch (e) { throw new Error('DonghuaNation: bad JSON from ' + url); }
  });
}

function _decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function _stripTags(s) {
  if (typeof htmlText === 'function') return htmlText(String(s || ''));
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Pure-JS base64 decoder (standard + URL-safe alphabets, padding optional).
 * Returns a byte string; the payloads decoded here are ASCII JSON. */
function _b64decode(input) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var lookup = {};
  for (var i = 0; i < alphabet.length; i++) lookup[alphabet.charAt(i)] = i;
  lookup['-'] = 62; lookup['_'] = 63;
  var str = String(input || '').replace(/=+$/, '');
  var out = '';
  var buffer = 0, bits = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charAt(j);
    if (!(c in lookup)) continue;
    buffer = (buffer << 6) | lookup[c];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function _absUrl2(href) {
  href = _decodeEntities(String(href || ''));
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href.charAt(0) === '/') return _DN_SITE + href;
  return _DN_SITE + '/' + href;
}

/* Home/card covers go through /img.php?url=<original>&w=320 — unwrap to the
 * original image when possible, else use the proxy URL itself. */
function _cover(src) {
  src = _decodeEntities(String(src || ''));
  if (!src) return null;
  var m = /[?&]url=([^&]+)/.exec(src);
  if (src.indexOf('img.php') >= 0 && m) {
    try { return decodeURIComponent(m[1]); } catch (e) {}
  }
  return _absUrl2(src);
}

function _slugFromItemUrl(url) {
  var m = /anime\/([a-z0-9-]+)/i.exec(String(url || ''));
  return m ? m[1] : '';
}

function _itemFromCard(href, imgTag) {
  var slug = '';
  var am = /\/anime\/([a-z0-9-]+)/i.exec(href || '');
  var wm = /\/watch\/([a-z0-9-]+?)-episode-\d+/i.exec(href || '');
  if (am) slug = am[1]; else if (wm) slug = wm[1];
  if (!slug) return null;
  var alt = '';
  var cover = null;
  if (imgTag) {
    var altM = /alt="([^"]*)"/.exec(imgTag);
    if (altM) alt = _decodeEntities(altM[1]).trim();
    var srcM = /src="([^"]+)"/.exec(imgTag);
    if (srcM) cover = _cover(srcM[1]);
  }
  var title = alt || slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return {
    id: 'donghuanation-' + slug,
    title: title,
    url: 'donghuanation://anime/' + slug,
    type: 'anime',
    cover: cover
  };
}

function _parseCards(chunk) {
  var items = [];
  var seen = {};
  var parts = String(chunk || '').split('<div class="anime-card">');
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i].substring(0, 2600);
    var hrefM = /href="(\/(?:anime|watch)\/[^"]+)"/.exec(block);
    if (!hrefM) continue;
    var imgM = /<img[^>]+>/.exec(block);
    var item = _itemFromCard(hrefM[1], imgM ? imgM[0] : '');
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    items.push(item);
  }
  return items;
}

/* ---------------- home / search ---------------- */

function getHome() {
  return _fetchText(_DN_SITE + '/').then(function (html) {
    var titles = { 'new-release': 'New Releases', 'popular': 'Popular Now', 'schedule': 'Airing Schedule', 'future': 'Coming Soon', 'all': 'Browse All' };
    var order = { 'new-release': 0, 'popular': 1, 'schedule': 2, 'future': 3, 'all': 4 };
    var rows = [];
    var panelRe = /home-tab-panel"[^>]*data-tab="([a-z-]+)"/g;
    var marks = [];
    var m;
    while ((m = panelRe.exec(html)) !== null) marks.push({ tab: m[1], at: m.index });
    for (var i = 0; i < marks.length; i++) {
      var end = (i + 1 < marks.length) ? marks[i + 1].at : html.length;
      var items = _parseCards(html.substring(marks[i].at, end));
      if (items.length >= 3) rows.push({ title: titles[marks[i].tab] || 'Popular Now', items: items, _ord: (marks[i].tab in order) ? order[marks[i].tab] : 9 });
    }
    rows.sort(function (a, b) { return a._ord - b._ord; });
    for (var r = 0; r < rows.length; r++) delete rows[r]._ord;
    if (!rows.length) {
      var all = _parseCards(html);
      if (all.length) rows.push({ title: 'Popular Now', items: all });
    }
    if (!rows.length) throw new Error('DonghuaNation: home parse found no titles');
    return rows;
  });
}

function search(query) {
  var url = _DN_SITE + '/api/search?q=' + encodeURIComponent(String(query || ''));
  return _fetchJson(url).then(function (data) {
    var results = (data && data.results) || [];
    var items = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r || !r.slug) continue;
      items.push({
        id: 'donghuanation-' + r.slug,
        title: String(r.title || r.slug),
        url: 'donghuanation://anime/' + r.slug,
        type: (r.type && /movie/i.test(String(r.type))) ? 'movie' : 'anime',
        cover: _absUrl2(r.cover_image)
      });
    }
    return items;
  });
}

/* ---------------- detail / episodes ---------------- */

function _parseEpisodes(html) {
  var byNum = {};
  var re = /href="\/watch\/([a-z0-9-]+)"[^>]*data-ep="(\d+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[2], 10);
    if (!n || byNum[n]) continue;
    byNum[n] = {
      id: 'donghuanation-ep-' + m[1],
      title: 'Episode ' + n,
      url: 'donghuanation://watch/' + m[1],
      number: n
    };
  }
  var eps = [];
  for (var k in byNum) eps.push(byNum[k]);
  eps.sort(function (a, b) { return a.number - b.number; });
  return eps;
}

function _detailPage(slug) {
  return _fetchText(_DN_SITE + '/anime/' + slug);
}

function getDetail(url) {
  var slug = _slugFromItemUrl(url);
  if (!slug) return Promise.reject(new Error('DonghuaNation: bad detail url ' + url));
  return _detailPage(slug).then(function (html) {
    var titleM = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    var title = titleM ? _stripTags(_decodeEntities(titleM[1])) : slug.replace(/-/g, ' ');
    var cover = null;
    var posterM = /poster[^>]*>[\s\S]{0,500}?<img[^>]+src="([^"]+)"/.exec(html);
    if (posterM) cover = _cover(posterM[1]);
    if (!cover) {
      var respM = /<img[^>]+src="([^"]*cache\/images\/responsive[^"]*)"/.exec(html);
      if (respM) cover = _cover(respM[1]);
    }
    var desc = '';
    var descM = /property="og:description" content="([^"]*)"/.exec(html);
    if (descM) desc = _decodeEntities(descM[1]);
    return {
      id: 'donghuanation-' + slug,
      title: title,
      url: 'donghuanation://anime/' + slug,
      type: /badge-type-movie/i.test(html) ? 'movie' : 'anime',
      cover: cover,
      description: desc,
      episodes: _parseEpisodes(html)
    };
  });
}

function getEpisodes(url) {
  var slug = _slugFromItemUrl(url);
  if (!slug) return Promise.reject(new Error('DonghuaNation: bad episodes url ' + url));
  return _detailPage(slug).then(function (html) {
    var eps = _parseEpisodes(html);
    if (!eps.length) throw new Error('DonghuaNation: no episodes parsed for ' + slug);
    return eps;
  });
}

/* ---------------- video sources ---------------- */

function _parseServers(html) {
  var modes = [];
  var modeRe = /data-mode="([a-z_]+)"/g;
  var m;
  while ((m = modeRe.exec(html)) !== null) modes.push({ mode: m[1], at: m.index });
  var servers = [];
  var btnRe = /<button[^>]*data-player-config-url="([^"]+)"[^>]*>([^<]+)</g;
  while ((m = btnRe.exec(html)) !== null) {
    var mode = 'sub';
    for (var i = 0; i < modes.length; i++) {
      if (modes[i].at < m.index) mode = modes[i].mode; else break;
    }
    servers.push({
      name: _stripTags(_decodeEntities(m[2])).replace(/\s+/g, ' ').trim(),
      cfgPath: _decodeEntities(m[1]),
      mode: mode,
      rank: /multi/.test(mode) ? 0 : 1
    });
  }
  servers.sort(function (a, b) { return a.rank - b.rank; });
  return servers;
}

/* Resolve one server button to a descriptor:
 *   {type:'player', embedUrl}  — xianxiaplayer chain (Myplayer family)
 *   {type:'dm', videoId}       — Dailymotion web-sdk servers
 *   null                       — rumble embeds / empty / unknown (skipped) */
function _resolveServer(cfgPath) {
  return _fetchJson(_DN_SITE + cfgPath, { 'Referer': _DN_SITE + '/' }).then(function (cfg) {
    if (!cfg) return null;
    if (cfg.provider === 'dailymotion' && cfg.video_id) {
      return { type: 'dm', videoId: String(cfg.video_id) };
    }
    var eu = cfg.embed_url ? String(cfg.embed_url) : '';
    if (!eu) return null;
    var candidate = null;
    if (eu.indexOf('/stream/embed/') >= 0) {
      var b64 = eu.substring(eu.lastIndexOf('/') + 1);
      try {
        var payload = JSON.parse(_b64decode(b64));
        candidate = payload && payload.u ? String(payload.u) : null;
      } catch (e) { return null; }
    } else if (/^https?:\/\//i.test(eu)) {
      candidate = eu;
    }
    return (candidate && /xianxiaplayer\.online/i.test(candidate)) ? { type: 'player', embedUrl: candidate } : null;
  }).then(function (d) { return d; }, function () { return null; });
}

/* Dailymotion: the public player metadata endpoint returns the signed HLS
 * manifest (qualities.auto) + any caption tracks. The manifest host
 * (cdndirector) refuses this build VM's datacenter IP with a Cloudflare 403
 * under every header combo, so variant expansion may come back empty here —
 * the lone Auto entry is still returned and the phone's network is the real
 * verdict (same pattern as MP4Upload/AniLibria VM blocks). */
function _dmStreams(server, videoId) {
  var metaUrl = 'https://www.dailymotion.com/player/metadata/video/' + videoId;
  return _fetchJson(metaUrl, { 'Referer': _DN_SITE + '/' }).then(function (meta) {
    if (!meta) throw new Error('DonghuaNation: empty Dailymotion metadata');
    var subs = [];
    var subData = (meta.subtitles && meta.subtitles.data) || {};
    for (var key in subData) {
      var entry = subData[key];
      if (entry && entry.urls && entry.urls.length) {
        subs.push({ url: String(entry.urls[0]), lang: key.split('-')[0], label: String(entry.label || key) });
      }
    }
    var qualities = meta.qualities || {};
    var autoUrl = null;
    var direct = [];
    for (var q in qualities) {
      var list = qualities[q] || [];
      for (var i = 0; i < list.length; i++) {
        if (!list[i] || !list[i].url) continue;
        if (q === 'auto') { if (!autoUrl) autoUrl = String(list[i].url); }
        else if (/^\d+$/.test(q)) direct.push({ h: parseInt(q, 10), url: String(list[i].url) });
      }
    }
    var headers = { 'Referer': 'https://www.dailymotion.com/', 'User-Agent': _DN_UA };
    var kind = /dub/.test(server.mode) ? 'dub' : 'sub';
    var finish = function (variants) {
      var out = [];
      var seenH = {};
      var all = direct.concat(variants);
      all.sort(function (a, b) { return a.h - b.h; });
      for (var i = 0; i < all.length; i++) {
        if (seenH[all[i].h]) continue;
        seenH[all[i].h] = true;
        var lbl = all[i].h + 'p';
        out.push({
          url: all[i].url, quality: lbl,
          label: server.name + ' · ' + lbl,
          container: 'hls', headers: headers,
          subtitles: subs, kind: kind
        });
      }
      if (autoUrl) {
        out.push({
          url: autoUrl, quality: 'auto',
          label: server.name + ' · Auto',
          container: 'hls', headers: headers,
          subtitles: subs, kind: kind
        });
      }
      return out;
    };
    if (!autoUrl && !direct.length) throw new Error('DonghuaNation: Dailymotion metadata has no stream');
    if (!autoUrl) return finish([]);
    return _expandQualities(autoUrl, headers).then(finish);
  });
}

function _playerConfig(embedUrl) {
  return _fetchText(embedUrl, { 'Referer': _DN_SITE + '/' }).then(function (html) {
    var m = /https:\/\/xianxiaplayer\.online\/api\/v1\/embed\/[A-Za-z0-9-]+\/config\?token=[^"'<>\s]+/.exec(html);
    if (!m) throw new Error('DonghuaNation: player config URL not found');
    return _fetchJson(_decodeEntities(m[0]), { 'Referer': embedUrl });
  }).then(function (cfg) {
    var data = cfg && cfg.data ? cfg.data : null;
    if (!data || !data.sources || !data.sources.length) throw new Error('DonghuaNation: player config has no sources');
    var master = null;
    for (var i = 0; i < data.sources.length; i++) {
      if (data.sources[i] && data.sources[i].src) { master = String(data.sources[i].src); break; }
    }
    if (!master) throw new Error('DonghuaNation: player config has no stream');
    var subs = [];
    var tracks = data.tracks || [];
    for (var j = 0; j < tracks.length; j++) {
      var t = tracks[j];
      if (t && t.src && t.srclang) subs.push({ url: String(t.src), lang: String(t.srclang), label: String(t.label || t.srclang) });
    }
    return { master: master, subtitles: subs };
  });
}

function _expandQualities(masterUrl, headers) {
  return _fetchText(masterUrl, headers || { 'Referer': _DN_PLAYER + '/' }).then(function (text) {
    var variants = [];
    var seenH = {};
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var rm = /RESOLUTION=\d+x(\d+)/.exec(lines[i]);
      if (rm && i + 1 < lines.length) {
        var u = lines[i + 1].trim();
        var h = parseInt(rm[1], 10);
        /* Master lists two 360p renditions (different bandwidths); keep the
         * first per height — the master is bandwidth-descending. */
        if (/^https?:\/\//i.test(u) && !seenH[h]) { seenH[h] = true; variants.push({ h: h, url: u }); }
      }
    }
    variants.sort(function (a, b) { return a.h - b.h; });
    return variants;
  }).then(function (v) { return v; }, function () { return []; });
}

function _serverStreams(server, resolved) {
  return _expandQualities(resolved.master).then(function (variants) {
    var headers = { 'Referer': _DN_PLAYER + '/', 'User-Agent': _DN_UA };
    var kind = /dub/.test(server.mode) ? 'dub' : 'sub';
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var q = variants[i].h + 'p';
      out.push({
        url: variants[i].url, quality: q,
        label: server.name + ' · ' + q,
        container: 'hls', headers: headers,
        subtitles: resolved.subtitles, kind: kind
      });
    }
    out.push({
      url: resolved.master, quality: 'auto',
      label: server.name + ' · Auto',
      container: 'hls', headers: headers,
      subtitles: resolved.subtitles, kind: kind
    });
    return out;
  });
}

function getVideoSources(episodeUrl) {
  var wm = /watch\/([a-z0-9-]+)/i.exec(String(episodeUrl || ''));
  if (!wm) return Promise.reject(new Error('DonghuaNation: bad episode url ' + episodeUrl));
  var watchUrl = _DN_SITE + '/watch/' + wm[1];
  return _fetchText(watchUrl).then(function (html) {
    var servers = _parseServers(html);
    if (!servers.length) throw new Error('DonghuaNation: no servers found on watch page');
    var seenEmbed = {};
    var dmAll = [];
    var playerAll = [];
    var chain = Promise.resolve();
    servers.forEach(function (server) {
      chain = chain.then(function () {
        return _resolveServer(server.cfgPath).then(function (desc) {
          if (!desc) return null;
          var key = desc.type === 'dm' ? 'dm:' + desc.videoId : 'player:' + desc.embedUrl;
          if (seenEmbed[key]) return null;
          seenEmbed[key] = true;
          var built = (desc.type === 'dm')
            ? _dmStreams(server, desc.videoId)
            : _playerConfig(desc.embedUrl).then(function (resolved) { return _serverStreams(server, resolved); });
          return built.then(function (entries) {
            var bucket = (desc.type === 'dm') ? dmAll : playerAll;
            for (var i = 0; i < entries.length; i++) bucket.push(entries[i]);
          });
        }).then(function () {}, function () {});
      });
    });
    return chain.then(function () {
      /* Dailymotion groups first, Myplayer groups last: the app auto-plays
       * the LAST link, and the Myplayer chain (20 subs, up to 4K) is the
       * strongest — it must stay the final entry whenever it exists. */
      var all = dmAll.concat(playerAll);
      if (!all.length) throw new Error('DonghuaNation: no playable server resolved for ' + wm[1]);
      return all;
    });
  });
}
