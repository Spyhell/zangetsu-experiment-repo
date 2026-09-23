// Oppai Stream — anime source for the Zangetsu provider repo (oppai.stream).
//
// Hentai streaming site. Everything comes from the site's own actions:
//   /actions/search.php?text=<q>&page=<p>&limit=<n>  -> episode cards (search)
//   /actions/results.php?sc=<section>&am=<n>&of=0    -> home rows
//   /watch?e=<slug>-<ep>                            -> availableres {720,1080,4k}
//
// Cards are per-episode:
//   <div class='in-grid episode-shown' idgt='<show id>' folder='<folder>'
//        ep='<n>' tags='a,b,c' name='<show>' desc='...'>
// with a watch link (watch?e=...) and a cover-img-in thumbnail. Search/home
// dedupe cards by idgt into show cards; getDetail re-searches the show's
// folder name to list its episodes. The watch page carries an `availableres`
// JSON map of direct mp4/webm files, so no embed chain is needed.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'oppaistream';

var SITE = 'https://oppai.stream';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'Oppai Stream', lang: 'en', baseUrl: SITE,
    logo: SITE + '/assets/logo.png', type: 'anime', version: '1.0.1' };
}

function _get(url, ref) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/' } })
    .then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

// Parse the key='value' attributes off an episode card div tag.
function _attrs(tag) {
  var o = {}, m, re = /(\w[\w-]*)='([^']*)'/g;
  while ((m = re.exec(tag)) !== null) o[m[1]] = m[2];
  return o;
}

// Split the results/search HTML into episode cards.
function _parseCards(html) {
  var out = [], chunks = String(html || '').split("<div class='in-grid episode-shown'");
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i];
    var tagEnd = c.indexOf('>');
    var a = _attrs(tagEnd < 0 ? '' : c.substring(0, tagEnd));
    if (!a.idgt || !a.folder) continue;
    var href = (c.match(/<a[^>]+href='([^']*watch\?e=[^']*)'/) || [])[1];
    // The img tag carries an onError fallback (this.src='.../maintenanceN.png'):
    // strip it first or the fallback URL wins over the real thumbnail.
    var imgTag = (c.match(/<img[^>]*class='cover-img-in'[^>]*>/) || [])[0] || '';
    imgTag = imgTag.replace(/onError="[^"]*"/g, '');
    var cover = (imgTag.match(/\ssrc='([^']+)'/) || [])[1];
    out.push({
      showId: a.idgt,
      folder: a.folder,
      ep: parseInt(a.ep || '1', 10) || 1,
      title: a.name || a.folder,
      desc: a.desc || '',
      tags: (a.tags || '').split(',').filter(function (t) { return t; }),
      cover: cover ? cover.split(' ').join('%20') : null,
      watch: href || null
    });
  }
  return out;
}

function _showUrl(c) {
  return 'oppaistream://show/' + c.showId + '/' + encodeURIComponent(c.folder);
}

function _showCard(c) {
  return { id: 'oppaistream:' + c.showId, title: htmlText(c.title).trim(),
    url: _showUrl(c), cover: c.cover, type: 'anime', sourceId: SOURCE_ID };
}

// One show per idgt; keep the first (newest) card's cover/metadata.
function _dedupe(cards) {
  var seen = {}, out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (seen[c.showId]) continue;
    seen[c.showId] = 1;
    out.push(_showCard(c));
  }
  return out;
}

// ── Search ──────────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/actions/search.php?text=' + encodeURIComponent(q)
    + '&order=&page=' + (page || 1) + '&limit=24'
    + '&genres=&blacklist=&studio=&ibt=0';
  return _get(url, SITE + '/search').then(function (html) {
    return _dedupe(_parseCards(html));
  }).catch(function () { return []; });
}

// ── Home ────────────────────────────────────────────────────────────────────
var _SECTIONS = [
  ['uploaded', 'New Episodes'],
  ['weekly-views', 'Trending'],
  ['recent', 'Recently Added'],
  ['random', 'Random']
];

function _homeSection(sc) {
  var url = SITE + '/actions/results.php?sc=' + sc + '&am=12&of=0&sts=1&ibt=0';
  return _get(url, SITE + '/').then(function (html) {
    return _dedupe(_parseCards(html));
  }).catch(function () { return []; });
}

function getHome(opts) {
  var jobs = _SECTIONS.map(function (s) {
    return _homeSection(s[0]).then(function (items) {
      return { title: s[1], items: items };
    });
  });
  return Promise.all(jobs).then(function (rows) {
    return rows.filter(function (r) { return r.items.length; });
  }).catch(function () { return []; });
}

// ── Detail + episodes ───────────────────────────────────────────────────────
function _parseShowUrl(url) {
  var m = String(url || '').match(/^oppaistream:\/\/show\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { id: m[1], folder: decodeURIComponent(m[2]) };
}

function getDetail(url, opts) {
  var ref = _parseShowUrl(url);
  var base = { id: null, title: '', url: url, cover: null, description: '',
    status: 'unknown', genres: [], studios: [], type: 'anime',
    sourceId: SOURCE_ID, episodes: [], year: null, malId: null,
    subCount: 0, dubCount: 0 };
  if (!ref) return Promise.resolve(base);
  var q = SITE + '/actions/search.php?text=' + encodeURIComponent(ref.folder)
    + '&order=&page=1&limit=60&genres=&blacklist=&studio=&ibt=0';
  return _get(q, SITE + '/').then(function (html) {
    var cards = _parseCards(html).filter(function (c) {
      return String(c.showId) === String(ref.id);
    });
    if (!cards.length) return base;
    var first = cards[0];
    base.id = 'oppaistream:' + ref.id;
    base.title = htmlText(first.title).trim();
    base.cover = first.cover;
    base.description = htmlText(first.desc).trim();
    base.genres = first.tags;
    var eps = [], seenEp = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (seenEp[c.ep] || !c.watch) continue;
      seenEp[c.ep] = 1;
      eps.push({ id: 'ep:' + c.ep, number: c.ep,
        title: htmlText(first.title).trim() + ' Episode ' + c.ep,
        url: c.watch });
    }
    eps.sort(function (a, b) { return a.number - b.number; });
    base.episodes = eps;
    base.subCount = eps.length;
    return base;
  }).catch(function () { return base; });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// ── Streams: watch page -> availableres {720,1080,4k} direct files ───────────
var _Q_LABEL = { '720': '720p', '1080': '1080p', '4k': '4K' };

function getVideoSources(episodeUrl) {
  var url = String(episodeUrl || '');
  if (url.indexOf('http') !== 0) {
    return Promise.reject(new Error('OppaiStream: bad episode url'));
  }
  // Keep only the ?e= slug: extra params (e.g. &for=search) sometimes 404.
  var em = url.match(/^([^?]+\/watch\?e=[^&]+)/);
  if (em) url = em[1];
  return _get(url, SITE + '/').then(function (html) {
    var out = [];
    // Subtitle tracks, e.g. <track src='...vtt' label='en' kind='subtitles'>.
    var subs = [], tm, trackRe = /<track[^>]*>/g;
    while ((tm = trackRe.exec(html)) !== null) {
      var tag = tm[0];
      if (!/kind='(captions|subtitles)'/.test(tag)) continue;
      var tsrc = (tag.match(/\ssrc='([^']+)'/) || [])[1];
      if (!tsrc) continue;
      var tlabel = (tag.match(/\slabel='([^']+)'/) || [])[1]
        || (tag.match(/\ssrclang='([^']+)'/) || [])[1] || 'sub';
      subs.push({ url: tsrc.split(' ').join('%20'), label: tlabel });
    }
    var m = html.match(/availableres\s*=\s*(\{[^}]*\})/);
    if (m) {
      var map = null;
      try { map = JSON.parse(m[1]); } catch (e) { map = null; }
      if (map) {
        Object.keys(map).forEach(function (k) {
          var u = String(map[k] || '').split(' ').join('%20');
          if (!u) return;
          out.push({ url: u,
            quality: _Q_LABEL[k] || k,
            container: /\.webm(\?|$)/i.test(u) ? 'webm' : 'mp4',
            headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
            kind: 'sub', audioLang: 'ja', subtitles: subs });
        });
      }
    }
    if (!out.length) {
      // Fallback: the plain <source> tag the player starts from.
      var s = (html.match(/<source[^>]+src="([^"]+)"/) || [])[1];
      if (s) {
        var u2 = s.split(' ').join('%20');
        out.push({ url: u2, quality: '720p',
          container: /\.webm(\?|$)/i.test(u2) ? 'webm' : 'mp4',
          headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
          kind: 'sub', audioLang: 'ja', subtitles: subs });
      }
    }
    if (!out.length) throw new Error('OppaiStream: no streams found');
    return out;
  });
}
