// Oppai Stream — anime source for the Zangetsu provider repo (oppai.stream).
//
// 2026-10-31: site came back from its "maintenance" outage on a new stack.
// Old routes are gone (/actions/search.php and /actions/results.php 404).
// New routes:
//   POST /api/search.php {text,tags,blacklist,studios,order,limit,page,
//        classes,character_filters} -> episode cards (search)
//   GET /                                          -> home rows (server-rendered
//        episode cards in #recent / #trending / #random sections)
//   /watch/<Folder>-<ep>                            -> inline JS vars
//        (folder, res like "4k-2", storageBase) + <track> subtitles
// New card shape (per-episode):
//   <a href=".../watch/<Folder>-<ep>/from/<src>" class="episode"
//      epid="<ep>" data-folder="<Folder>-<ep>">
//     <img class="cover" src="<thumb>" alt="<Title> Episode <ep> thumbnail">
//     <p class="episode-title"><Title></p><p class="episode-number"><ep></p>
// Video file: <storageBase>/<Folder>/ep.<ext>  (ext from res map: 1=mp4,2=webm)
// DASH:       <storageBase>/<Folder>/dash/manifest.mpd (app can't play DASH,
//             so we ship the direct file URL)
// Shows are grouped by data-folder minus the trailing -<ep>.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'oppaistream';

var SITE = 'https://oppai.stream';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'Oppai Stream', lang: 'en', baseUrl: SITE,
    logo: SITE + '/assets/logo.png', type: 'anime', version: '1.0.4' };
}

function _get(url, ref) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/' } })
    .then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

function _post(url, ref, fields) {
  var body = Object.keys(fields).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]);
  }).join('&');
  return fetch(url, { method: 'POST',
    headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest' },
    body: body })
    .then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

function _searchFields(q, page, limit) {
  return { text: q, tags: '', blacklist: '', studios: '', order: '',
    limit: String(limit || 24), page: String(page || 1),
    classes: 'smaller-episode-gap', character_filters: '{}' };
}

// Split the search/home HTML into episode cards (new 2026-10-31 shape).
function _parseCards(html) {
  var out = [], m;
  var re = /<a href="(https:\/\/oppai\.stream\/watch\/[^"]+)" class="episode[^"]*" epid="(\d+)" data-folder="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = re.exec(html))) {
    var ep = parseInt(m[2], 10) || 0;
    var folder = m[3];
    var inner = m[4];
    var t = inner.match(/episode-title">([^<]+)</);
    var title = (t ? t[1] : folder).trim();
    var c = inner.match(/<img class="cover"[^>]*src="([^"]+)"/);
    var cover = c ? c[1] : null;
    // show folder: data-folder minus the trailing -<ep>
    var showFolder = folder;
    var tail = '-' + ep;
    if (ep && showFolder.slice(-tail.length) === tail)
      showFolder = showFolder.slice(0, -tail.length);
    var watch = m[1].split('/from/')[0];
    out.push({ showTitle: title, showFolder: showFolder, ep: ep, title: title,
      cover: cover ? cover.split(' ').join('%20') : null,
      watch: watch.split(' ').join('%20') });
  }
  return out;
}

function _showUrl(c) {
  return 'oppaistream://show/' + encodeURIComponent(c.showFolder)
    + '/' + encodeURIComponent(c.showTitle);
}

function _showCard(c) {
  return { id: 'oppaistream:' + encodeURIComponent(c.showFolder),
    title: htmlText(c.showTitle).trim(), url: _showUrl(c),
    cover: c.cover, type: 'anime', sourceId: SOURCE_ID };
}

// One show per showFolder; keep the first (newest) card's cover/metadata.
function _dedupe(cards) {
  var seen = {}, out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (seen[c.showFolder]) continue;
    seen[c.showFolder] = 1;
    out.push(_showCard(c));
  }
  return out;
}

// ── Search ──────────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _post(SITE + '/api/search.php', SITE + '/search',
    _searchFields(q, page, 24)).then(function (html) {
    return _dedupe(_parseCards(html));
  }).catch(function () { return []; });
}

// ── Home ────────────────────────────────────────────────────────────────────
var _SECTIONS = [
  ['recent', 'New Episodes'],
  ['trending', 'Trending'],
  ['random', 'Random']
];

function _homeSection(html, sid) {
  var re = new RegExp('<div class="episode-box[^"]*" id="' + sid + '"'
    + '([\\s\\S]*?)(?=<div class="episode-box|</body|$)');
  var m = html.match(re);
  return m ? _dedupe(_parseCards(m[1])) : [];
}

function getHome(opts) {
  return _get(SITE + '/').then(function (html) {
    if (!html) throw new Error('OppaiStream: home fetch failed');
    var rows = [];
    for (var i = 0; i < _SECTIONS.length; i++) {
      var items = _homeSection(html, _SECTIONS[i][0]);
      if (items.length) rows.push({ title: _SECTIONS[i][1], items: items });
    }
    if (!rows.length) throw new Error('OppaiStream: no home items');
    return rows;
  });
}

// ── Detail + episodes ───────────────────────────────────────────────────────
function _parseShowUrl(url) {
  var m = String(url || '').match(/^oppaistream:\/\/show\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { folder: decodeURIComponent(m[1]), title: decodeURIComponent(m[2]) };
}

function getDetail(url, opts) {
  var ref = _parseShowUrl(url);
  var base = { id: null, title: '', url: url, cover: null, description: '',
    type: 'anime', sourceId: SOURCE_ID, episodes: [], year: null };
  if (!ref) return Promise.resolve(base);
  return _post(SITE + '/api/search.php', SITE + '/',
    _searchFields(ref.title, 1, 60)).then(function (html) {
    var cards = _parseCards(html).filter(function (c) {
      return c.showFolder === ref.folder ||
        c.showTitle.toLowerCase() === ref.title.toLowerCase();
    });
    if (!cards.length) return base;
    var first = cards[0];
    base.id = 'oppaistream:' + encodeURIComponent(ref.folder);
    base.title = htmlText(first.showTitle).trim();
    base.cover = first.cover;
    var eps = [], seenEp = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c.ep || seenEp[c.ep] || !c.watch) continue;
      seenEp[c.ep] = 1;
      eps.push({ id: 'ep:' + c.ep, number: c.ep,
        title: htmlText(first.showTitle).trim() + ' Episode ' + c.ep,
        url: c.watch });
    }
    eps.sort(function (a, b) { return a.number - b.number; });
    base.episodes = eps;
    return base;
  }).catch(function () { return base; });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// ── Streams ─────────────────────────────────────────────────────────────────
var _Q_LABEL = { '720': '720p', '1080': '1080p', '4k': '4K' };

// res strings look like "4k-2" or "720-1,1080-1,4k-2" (1=mp4, 2=webm).
function _parseRes(res) {
  var map = {}, parts = String(res || '').split(',');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].split('-');
    if (p.length === 2 && p[0]) map[p[0]] = (p[1] === '2') ? 'webm' : 'mp4';
  }
  return map;
}
function _topRes(map) {
  if (map['4k']) return '4k';
  if (map['1080']) return '1080';
  if (map['720']) return '720';
  return null;
}

function _headOk(u) {
  return fetch(u, { method: 'HEAD',
    headers: { 'User-Agent': UA, 'Referer': SITE + '/' } }).then(function (r) {
    if (!r || !r.ok) return false;
    var ct = '';
    try { ct = String((r.headers && r.headers.get('content-type')) || ''); } catch (e) {}
    return /^video\//i.test(ct);
  }, function () { return false; });
}

// 2026-09-26 fallback: media on an ungated CDN with a stable pattern:
//   https://myspacecat.pictures/<Folder>/<res>/E<NN>.<ext>
// (also mirrored on s2.myspacecat.pictures). Kept as a last resort.
var _CDN_HOSTS = ['https://myspacecat.pictures', 'https://s2.myspacecat.pictures'];
var _CDN_VARIANTS = [['720', 'mp4'], ['1080', 'mp4'], ['1080', 'webm'], ['4k', 'webm']];

function _slugParts(watchUrl) {
  var m = String(watchUrl || '').match(/[?&]e=([^&]+)/);
  var slug = m ? m[1] : null;
  if (!slug) {
    var m2 = String(watchUrl || '').match(/\/watch\/([^\/\?#]+)/);
    if (m2) slug = m2[1];
  }
  if (!slug) return null;
  slug = slug.replace(/\+/g, ' ');
  var cut = slug.lastIndexOf('-');
  if (cut < 1) return null;
  var ep = parseInt(slug.slice(cut + 1), 10);
  if (!ep) return null;
  var folder;
  try { folder = decodeURIComponent(slug.slice(0, cut)); }
  catch (e) { folder = slug.slice(0, cut); }
  if (!folder) return null;
  return { folder: folder, ep: ep };
}

function _cdnFallback(watchUrl) {
  var sp = _slugParts(watchUrl);
  if (!sp) return Promise.resolve([]);
  var epTag = 'E' + (sp.ep < 10 ? '0' + sp.ep : '' + sp.ep);
  var folderEnc = encodeURIComponent(sp.folder);
  var jobs = [];
  _CDN_VARIANTS.forEach(function (v) {
    jobs.push({ res: v[0], ext: v[1] });
  });
  var out = [];
  function probeHost(host, i) {
    if (i >= jobs.length) return Promise.resolve(out);
    var j = jobs[i];
    var u = host + '/' + folderEnc + '/' + j.res + '/' + epTag + '.' + j.ext;
    return _headOk(u).then(function (ok) {
      if (ok) {
        out.push({ url: u,
          quality: _Q_LABEL[j.res] || j.res,
          container: j.ext === 'webm' ? 'webm' : 'mp4',
          headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
          kind: 'sub', audioLang: 'ja', subtitles: [] });
      }
      return probeHost(host, i + 1);
    });
  }
  return probeHost(_CDN_HOSTS[0], 0).then(function () {
    if (out.length) return out;
    return probeHost(_CDN_HOSTS[1], 0);
  });
}

function getVideoSources(episodeUrl) {
  var url = String(episodeUrl || '');
  if (url.indexOf('http') !== 0) {
    return Promise.reject(new Error('OppaiStream: bad episode url'));
  }
  // Normalize: keep only the watch path (strip /from/<src> and query args).
  var em = url.match(/^(https?:\/\/[^\/]+\/watch\/[^\/\?#]+)/);
  if (em) url = em[1];
  return _get(url, SITE + '/').then(function (html) {
    if (!html) throw new Error('OppaiStream: watch page fetch failed');
    var out = [];
    // Subtitle tracks, e.g. <track id="sub-en" label="EN"
    // src=".../sub_en.vtt" kind="subtitles" srclang="en">.
    var subs = [], tm, trackRe = /<track[^>]*>/g;
    while ((tm = trackRe.exec(html)) !== null) {
      var tag = tm[0];
      if (!/kind=["'](captions|subtitles)["']/.test(tag)) continue;
      var tsrc = (tag.match(/\ssrc=["']([^"']+)["']/) || [])[1];
      if (!tsrc) continue;
      if (tsrc.indexOf('http') !== 0) {
        tsrc = SITE + (tsrc.charAt(0) === '/' ? '' : '/') + tsrc;
      }
      var tlabel = (tag.match(/\slabel=["']([^"']+)["']/) || [])[1]
        || (tag.match(/\ssrclang=["']([^"']+)["']/) || [])[1] || 'sub';
      // `lang` is required by the app's Subtitle model — without it the whole
      // VideoSource fails to parse and the player ends up with a null URL.
      subs.push({ url: tsrc.split(' ').join('%20'), lang: tlabel,
        label: tlabel,
        format: /\.srt(\?|$)/i.test(tsrc) ? 'srt' : 'vtt' });
    }
    // New player scheme: inline vars -> <storageBase>/<Folder>/ep.<ext>.
    var folder = (html.match(/var folder\s*=\s*"([^"]+)"/) || [])[1];
    var res = (html.match(/var res\s*=\s*"([^"]+)"/) || [])[1] || '';
    var storageBase = (html.match(/var storageBase\s*=\s*"([^"]+)"/) || [])[1]
      || (SITE + '/videos');
    storageBase = storageBase.split('\\/').join('/');
    var rmap = _parseRes(res);
    var top = _topRes(rmap);
    if (folder && top) {
      var ext = rmap[top];
      var u = (storageBase + '/' + encodeURIComponent(folder)
        + '/ep.' + ext).split(' ').join('%20');
      return _headOk(u).then(function (ok) {
        if (!ok) {
          var alt = ext === 'mp4' ? 'webm' : 'mp4';
          var u2 = (storageBase + '/' + encodeURIComponent(folder)
            + '/ep.' + alt).split(' ').join('%20');
          return _headOk(u2).then(function (ok2) {
            if (!ok2) return [];
            return [{ url: u2, quality: _Q_LABEL[top] || top,
              container: alt,
              headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
              kind: 'sub', audioLang: 'ja', subtitles: subs }];
          });
        }
        return [{ url: u, quality: _Q_LABEL[top] || top,
          container: ext,
          headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
          kind: 'sub', audioLang: 'ja', subtitles: subs }];
      });
    }
    return out;
  }).then(function (out) {
    if (out.length) return out;
    // Watch page gated or scheme changed: try the legacy CDN pattern.
    return _cdnFallback(url).then(function (cdn) {
      if (!cdn.length) throw new Error('OppaiStream: no streams found');
      return cdn;
    });
  });
}
