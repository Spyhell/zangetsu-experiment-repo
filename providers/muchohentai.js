// ─────────────────────────────────────────────────────────────────────────────
// MuchoHentai — adult anime streaming provider for the Zangetsu provider repo.
// Source site: https://muchohentai.com (long-running hentai streaming site).
// Scrapes the site's WordPress HTML: series list / series pages / post pages.
// Video posts self-host HLS (.m3u8) on *.edge.tmncdn.io plus a direct
// download .mkv (served as video/mp4). No extractor needed.
// ─────────────────────────────────────────────────────────────────────────────

var _SITE = 'https://muchohentai.com';
var _UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var _HEADERS = { 'User-Agent': _UA, Referer: _SITE + '/', Accept: 'text/html' };

// category-* classes that are NOT series slugs
var _NOT_SERIES = { pv: 1, raw: 1, 'eng-subbed': 1, subbed: 1, n: 1, so: 1, preview: 1 };

function getInfo() {
  return {
    name: 'MuchoHentai',
    lang: 'en',
    baseUrl: _SITE,
    logo: _SITE + '/wp-content/uploads/mhlogo.png',
    type: 'anime',
    version: '1.0.0'
  };
}

function _getText(url) {
  return fetch(url, { headers: _HEADERS }).then(function (r) {
    if (!r.ok && r.status !== 200) throw new Error('http ' + r.status);
    return r.body;
  });
}

function _str(v, d) {
  if (v === null || v === undefined) return d === undefined ? '' : d;
  return String(v);
}

function _title(t) {
  t = _str(t).replace(/ - MuchoHentai$/i, '').replace(/\s+/g, ' ').trim();
  return t;
}

function _prettify(slug) {
  var s = _str(slug).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Pick the series slug out of a post's "category-*" classes.
function _seriesSlug(classes) {
  var best = '';
  var re = /category-([a-z0-9\-]+)/g, m;
  while ((m = re.exec(classes || '')) !== null) {
    var c = m[1];
    if (_NOT_SERIES[c]) continue;
    if (c.length > best.length) best = c;
  }
  return best;
}

// Parse video-post items from a listing page (home / search).
// Returns [{postId, postUrl, title, thumb, seriesSlug}]
function _parsePosts(html) {
  var out = [], seen = {};
  var re = /<div id="post-(\d+)" class="([^"]*)"[\s\S]*?<a class="clip-link"[^>]*title="([^"]*)"[^>]*href="([^"]*)"[\s\S]*?<img src="([^"]+)"[^>]*>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var postId = m[1];
    if (seen[postId]) continue;
    seen[postId] = 1;
    out.push({
      postId: postId,
      postUrl: m[4],
      title: _title(m[3]),
      thumb: m[5],
      seriesSlug: _seriesSlug(m[2])
    });
  }
  return out;
}

// Group posts by series -> MediaItems
function _postsToSeries(posts) {
  var map = {}, order = [];
  posts.forEach(function (p) {
    var slug = p.seriesSlug;
    var key, item;
    if (slug) {
      key = 's:' + slug;
      if (!map[key]) {
        item = {
          id: 'muchohentai-series-' + slug,
          title: _prettify(slug),
          url: 'muchohentai://series/' + slug,
          type: 'anime',
          cover: p.thumb
        };
        map[key] = item;
        order.push(item);
      } else if (!map[key].cover && p.thumb) {
        map[key].cover = p.thumb;
      }
    } else {
      // No series detected: expose the post itself as a single-episode item.
      key = 'p:' + p.postId;
      item = {
        id: 'muchohentai-post-' + p.postId,
        title: p.title,
        url: 'muchohentai://post/' + p.postId,
        type: 'anime',
        cover: p.thumb
      };
      map[key] = item;
      order.push(item);
    }
  });
  return order;
}

function getHome() {
  var latest = _getText(_SITE + '/home').then(function (html) {
    var posts = _parsePosts(html);
    var items = _postsToSeries(posts).slice(0, 20);
    return items.length ? { title: 'Latest Updates', items: items } : null;
  }).catch(function () { return null; });

  var az = _getText(_SITE + '/hentai-series-list').then(function (html) {
    var items = [], seen = {};
    var re = /<li><a title="([^"]+)" href="([^"]+)"/g, m;
    while ((m = re.exec(html)) !== null && items.length < 24) {
      var slug = _str(m[2]).replace(/\/$/, '').split('/').pop();
      if (!slug || seen[slug]) continue;
      seen[slug] = 1;
      items.push({
        id: 'muchohentai-series-' + slug,
        title: _title(m[1]),
        url: 'muchohentai://series/' + slug,
        type: 'anime'
      });
    }
    return items.length ? { title: 'Series A–Z', items: items } : null;
  }).catch(function () { return null; });

  return Promise.all([latest, az]).then(function (rows) {
    return rows.filter(Boolean);
  });
}

function search(query, page) {
  var q = _str(query).trim();
  if (!q) return Promise.resolve([]);
  var url = _SITE + '/?s=' + encodeURIComponent(q);
  return _getText(url).then(function (html) {
    var posts = _parsePosts(html);
    return _postsToSeries(posts).slice(0, 30);
  });
}

function _seriesSlugOf(url) {
  var m = /muchohentai:\/\/series\/([a-z0-9\-]+)/.exec(_str(url));
  return m ? m[1] : '';
}

function _postIdOf(url) {
  var m = /muchohentai:\/\/post\/(\d+)/.exec(_str(url));
  if (m) return m[1];
  m = /\/avH6Dh\/(\d+)/.exec(_str(url));
  return m ? m[1] : '';
}

function _parseSeriesPage(slug, html) {
  var title = _prettify(slug);
  var tm = /<title>([^<]*)<\/title>/i.exec(html);
  if (tm) title = _title(tm[1]);

  // Cover: first episode thumbnail (skip the site logo).
  var cover = '';
  var im = /<img src="([^"]+)"[^>]*alt="[^"]*Episode[^"]*"/i.exec(html);
  if (im) cover = im[1];

  var desc = '';
  var dm = /<meta[^>]+name="description"[^>]+content="([^"]*)"/i.exec(html) ||
           /<meta[^>]+content="([^"]*)"[^>]+name="description"/i.exec(html);
  if (dm) desc = _str(dm[1]);

  var episodes = [], seen = {};
  var re = /<a class="clip-link"[^>]*title="([^"]*)"[^>]*href="([^"]*)"[\s\S]*?<img src="([^"]+)"[^>]*>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var postUrl = m[2];
    var pm = /\/avH6Dh\/(\d+)/.exec(postUrl);
    if (!pm || seen[pm[1]]) continue;
    seen[pm[1]] = 1;
    var et = _title(m[1]);
    var nm = /episode\s+(\d+)/i.exec(et);
    var n = nm ? parseInt(nm[1], 10) : 0;
    episodes.push({
      id: 'muchohentai-ep-' + pm[1],
      title: et,
      url: postUrl,
      number: n,
      thumbnail: m[3]
    });
  }
  episodes.sort(function (a, b) { return a.number - b.number; });

  return {
    id: 'muchohentai-series-' + slug,
    title: title,
    url: 'muchohentai://series/' + slug,
    type: 'anime',
    cover: cover,
    description: desc,
    year: null,
    episodes: episodes
  };
}

function getDetail(url) {
  var slug = _seriesSlugOf(url);
  if (slug) {
    return _getText(_SITE + '/series/' + slug).then(function (html) {
      return _parseSeriesPage(slug, html);
    });
  }
  // Single-post item: resolve its series via the post page, fall back to the post itself.
  var postId = _postIdOf(url);
  if (!postId) return Promise.reject(new Error('bad url'));
  return _getText(_SITE + '/avH6Dh/' + postId).then(function (html) {
    var sm = /href="(https?:\/\/muchohentai\.com\/series\/([a-z0-9\-]+))"/i.exec(html);
    if (sm) {
      return _getText(sm[1]).then(function (shtml) {
        return _parseSeriesPage(sm[2], shtml);
      });
    }
    var tm = /<title>([^<]*)<\/title>/i.exec(html);
    var t = tm ? _title(tm[1]) : 'Episode ' + postId;
    return {
      id: 'muchohentai-post-' + postId,
      title: t,
      url: 'muchohentai://post/' + postId,
      type: 'anime',
      cover: '',
      description: '',
      year: null,
      episodes: [{
        id: 'muchohentai-ep-' + postId,
        title: t,
        url: _SITE + '/avH6Dh/' + postId,
        number: 1,
        thumbnail: ''
      }]
    };
  });
}

function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d.episodes || []; });
}

function _unescape(s) {
  return _str(s).replace(/\\\//g, '/').replace(/\\"/g, '"');
}

function getVideoSources(episodeUrl) {
  var postId = _postIdOf(episodeUrl);
  var pageUrl = /\/avH6Dh\//.test(_str(episodeUrl)) ? _str(episodeUrl) : (_SITE + '/avH6Dh/' + postId);
  if (!postId) return Promise.resolve([]);
  return _getText(pageUrl).then(function (html) {
    var sources = [];

    var servers = [];
    var srvM = /var servers = \[([^\]]+)\]/.exec(html);
    if (srvM) {
      var q = /'([a-z0-9]+)'/g, qm;
      while ((qm = q.exec(srvM[1])) !== null) servers.push(qm[1]);
    }

    var fM = /var files = \[{"file":"((?:\\.|[^"\\])*)"\}\]/g;
    var files = [], fm;
    while ((fm = fM.exec(html)) !== null) files.push(_unescape(fm[1]));

    var subs = '', subName = '';
    var sM = /var subs = (?:"((?:\\.|[^"\\])*)"|null)/.exec(html);
    if (sM && sM[1]) subs = _unescape(sM[1]);
    var nM = /var subName = "([^"]*)"/.exec(html);
    if (nM) subName = nM[1];

    var subLang = 'en';
    if (/spanish|espa/i.test(subName)) subLang = 'es';
    else if (/portuguese/i.test(subName)) subLang = 'pt';

    files.forEach(function (f, fi) {
      servers.forEach(function (srv, si) {
        var u = 'https://' + srv + '.edge.tmncdn.io' + f;
        var src = {
          url: u,
          container: /\.m3u8($|\?)/i.test(f) ? 'hls' : 'mp4',
          quality: 'auto',
          label: 'MuchoHentai HLS' + (servers.length > 1 ? ' S' + (si + 1) : ''),
          headers: { 'User-Agent': _UA, Referer: _SITE + '/' }
        };
        if (subs && fi === 0 && si === 0) {
          src.subtitles = [{ url: 'https://' + srv + '.edge.tmncdn.io' + subs, lang: subLang, label: subName || 'Subtitles' }];
        }
        sources.push(src);
      });
    });

    // Direct download file (served as video/mp4) as a fallback source.
    var dM = /(https:\/\/downloads\.muchohentai\.com\/[^"'\s\\]+\.mkv)/.exec(html);
    if (dM) {
      sources.push({
        url: dM[1],
        container: 'mp4',
        quality: '1080p',
        label: 'MuchoHentai MP4',
        headers: { 'User-Agent': _UA, Referer: _SITE + '/' }
      });
    }

    return sources;
  }).catch(function () { return []; });
}
