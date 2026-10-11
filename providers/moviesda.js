/*
 * MoviesDa — South Indian + Hindi-dubbed movies for the Zangetsu app.
 *
 * Backend: https://moviesda.internet.in (DDL index, plain HTML, no login).
 * Chain: /mobile/search?find=<q>&per_page=1 (search) | catlist pages (home)
 *   -> movie page /<id>/download-<slug> (poster, plot, /files/<fid> quality
 *      files with size) -> /download/<fid> -> 302 to a signed CDN mp4.
 *
 * getVideoSources returns the /download/<fid> URL per quality file; the app's
 * player follows the 302 to the fresh signed mp4 (same pattern as NetMirror's
 * /api/proxy/video 302 hop). Returning the /download URL (not the baked CDN
 * URL) means the signature is re-issued on every play request.
 *
 * ES5 only.
 */

var BASE = 'https://moviesda.internet.in';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

var CATS = [
  { id: '53', slug: 'latest-2026-tamil-movies', label: 'Latest 2026 Tamil' },
  { id: '4',  slug: 'tamil-movies',             label: 'Tamil Movies' },
  { id: '3',  slug: 'telugu-movies',            label: 'Telugu Movies' },
  { id: '2',  slug: 'malayalam-movies',         label: 'Malayalam Movies' },
  { id: '1',  slug: 'kannada-movies',           label: 'Kannada Movies' },
  { id: '22', slug: 'tamil-dubbed-movies',      label: 'Tamil Dubbed' },
  { id: '23', slug: 'telugu-dubbed-movies',     label: 'Telugu Dubbed' },
  { id: '24', slug: 'malayalam-dubbed-movies',  label: 'Malayalam Dubbed' },
  { id: '45', slug: 'latest-webseries-download', label: 'Web Series' }
];

function getInfo() {
  return {
    name: 'MoviesDa', lang: 'en', baseUrl: BASE,
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/moviesda.png',
    type: 'movie', version: '1.0.0'
  };
}

function _race(p, ms, what) {
  if (typeof setTimeout === 'undefined') return p;
  var t;
  var timer = new Promise(function (_, reject) {
    t = setTimeout(function () { reject(new Error('timeout: ' + what)); }, ms);
  });
  return Promise.race([p, timer]).finally(function () { clearTimeout(t); });
}

function _get(url, what) {
  return _race(
    fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status + ' for ' + what);
        return r.text();
      }),
    15000, what
  );
}

function _html(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function _cleanTitle(t) {
  t = _html(t);
  t = t.replace(/\s*(WEB-DL|PreDVD|HDRip|HDTS|CAMRip|DVDScr)\s*$/i, '').trim();
  t = t.replace(/\s+(Full Movie|Movie)\s*$/i, '').trim();
  return t;
}

// Parse "/<id>/download-<slug>" anchors with their visible titles.
// The item url is the full page URL — self-contained for detail/episodes.
function _parseMovieLinks(html) {
  var out = [], seen = {};
  var re = /<a\s+href="(https?:\/\/moviesda\.internet\.in\/(\d+)\/download-[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var pageUrl = m[1];
    if (seen[pageUrl]) continue;
    seen[pageUrl] = 1;
    var title = _cleanTitle(m[3]);
    if (!title) continue;
    out.push({ id: pageUrl, title: title, url: pageUrl, type: 'movie' });
  }
  return out;
}

function getHome(opts) {
  var jobs = CATS.map(function (c) {
    return _get(BASE + '/' + c.id + '/catlist/' + c.slug + '/default/1.html', 'home ' + c.label)
      .then(function (html) { return { title: c.label, items: _parseMovieLinks(html).slice(0, 24) }; })
      .catch(function () { return { title: c.label, items: [] }; });
  });
  return Promise.all(jobs).then(function (rows) {
    var out = rows.filter(function (r) { return r.items.length; });
    if (!out.length) throw new Error('MoviesDa: home rows empty');
    return out;
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = BASE + '/mobile/search?find=' + encodeURIComponent(q) + '&per_page=1';
  return _get(url, 'search').then(function (html) {
    return _parseMovieLinks(html).slice(0, 30);
  }).catch(function () { return []; });
}

// Quality files listed on a movie page: /files/<fid> with name + size.
function _fileEntries(html) {
  var out = [], seen = {};
  var re = /<a\s+href="(https?:\/\/moviesda\.internet\.in\/files\/(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var fid = m[2];
    if (seen[fid]) continue;
    seen[fid] = 1;
    var tail = html.slice(m.index + m[0].length, m.index + m[0].length + 500);
    var info = _html(tail);
    var size = '';
    var sm = info.match(/Size:\s*([0-9.]+\s*(?:MB|GB))/i);
    if (sm) size = sm[1];
    out.push({ fid: fid, name: _html(m[3]), size: size });
  }
  return out;
}

function _qualityOf(name) {
  var m = String(name || '').match(/(\d{3,4})p/i);
  return m ? m[1] + 'p' : null;
}

function _detailFromHtml(pageUrl, html) {
  var title = '';
  var tm = html.match(/<title>([^<]+)<\/title>/i);
  if (tm) title = _cleanTitle(tm[1].replace(/\s*Download\s+Moviesda\s*$/i, ''));
  if (!title) {
    var im = html.match(/Movie\s*:\s*([^<]{3,80})/i);
    if (im) title = _cleanTitle(im[1]);
  }
  var cover = null;
  var pm = html.match(/<img[^>]+class="tbl"[^>]+src="([^"]+)"/i) ||
           html.match(/<img[^>]+src="([^"]*files\/images\/[^"]+)"/i);
  if (pm) cover = pm[1].indexOf('http') === 0 ? pm[1] : BASE + pm[1];

  var desc = '';
  var dm = html.match(/<div\s+class="isai"[^>]*>([\s\S]*?)<\/div>/i);
  if (dm) desc = _html(dm[1]).slice(0, 600);

  var files = _fileEntries(html);
  var episodes = files.length ? [{
    id: pageUrl + '#watch', title: 'Watch (' + files.length + ' qualities)',
    url: pageUrl + '#watch', number: 1
  }] : [];

  var d = {
    id: pageUrl, title: title || 'MoviesDa', url: pageUrl, type: 'movie',
    description: desc || undefined, episodes: episodes
  };
  if (cover) d.cover = cover;
  // stash files so getVideoSources can skip re-fetching when called right after
  d._files = files;
  return d;
}

var _detailCache = {};

function getDetail(url, opts) {
  var pageUrl = String(url || '').split('#')[0];
  if (pageUrl.indexOf('moviesda.internet.in/') === -1) {
    return Promise.reject(new Error('MoviesDa: bad movie url'));
  }
  if (_detailCache[pageUrl]) return Promise.resolve(_detailCache[pageUrl]);
  return _get(pageUrl, 'detail').then(function (html) {
    var d = _detailFromHtml(pageUrl, html);
    if (!d.episodes.length) throw new Error('MoviesDa: no quality files found');
    _detailCache[pageUrl] = d;
    return d;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl, opts) {
  return getDetail(episodeUrl, opts).then(function (d) {
    var files = d._files || [];
    var out = files.map(function (f) {
      var q = _qualityOf(f.name);
      var label = f.name + (f.size ? ' • ' + f.size : '');
      var src = {
        url: BASE + '/download/' + f.fid,
        container: 'mp4',
        label: label
      };
      if (q) src.quality = q;
      return src;
    });
    if (!out.length) throw new Error('MoviesDa: no streams found');
    return out;
  });
}
