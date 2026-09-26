// SuperCartoons source for the Zangetsu app.
// Backend: https://www.supercartoons.net — classic cartoons
// (Tom & Jerry, Looney Tunes, Popeye, Pink Panther, Disney, ...).
// Each cartoon page carries a direct mp4 (https://ww.supercartoons.net/...),
// no login, no JS crypto. Search via /?s=<query>, home rows per series.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'supercartoons';

var SITE = 'https://www.supercartoons.net';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

var HOME_SERIES = [
  { slug: 'tom-and-jerry', name: 'Tom & Jerry' },
  { slug: 'looney-tunes', name: 'Looney Tunes' },
  { slug: 'popeye-the-sailor', name: 'Popeye the Sailor' },
  { slug: 'the-pink-panther-show', name: 'The Pink Panther Show' },
  { slug: 'disney', name: 'Disney' }
];

function getInfo() {
  return {
    name: 'SuperCartoons', lang: 'en', baseUrl: SITE,
    logo: SITE + '/wp-content/themes/supercartoons/images/logo.png',
    type: 'movie', version: '1.0.0'
  };
}

function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': SITE + '/' } })
    .then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

function _htmlUnesc(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Parse cartoon cards: <a href=".../cartoon/<slug>/">...<img src thumb alt title>
function _parseCards(html) {
  var out = [], seen = {};
  var re = /<a href="(https:\/\/www\.supercartoons\.net\/cartoon\/[^"]+\/)">[\s\S]*?<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    if (seen[url]) continue;
    seen[url] = true;
    var title = _htmlUnesc(m[3]).trim() || url.split('/').filter(Boolean).pop();
    out.push({
      id: 'supercartoons://cartoon/' + url.split('/').filter(Boolean).pop(),
      title: title, url: url, type: 'movie', cover: m[2]
    });
  }
  return out;
}

function _serieRow(sg, limit) {
  return _get(SITE + '/serie/' + sg.slug + '/').then(function (html) {
    var items = _parseCards(html).slice(0, limit || 12);
    return { title: sg.name, items: items };
  });
}

function getHome(opts) {
  var jobs = [];
  for (var i = 0; i < HOME_SERIES.length; i++) jobs.push(_serieRow(HOME_SERIES[i], 12));
  return Promise.all(jobs).then(function (rows) {
    var out = [];
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].items && rows[j].items.length) out.push(rows[j]);
    }
    if (!out.length) throw new Error('SuperCartoons: empty home');
    return out;
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/?s=' + encodeURIComponent(q)).then(function (html) {
    return _parseCards(html).slice(0, 24);
  });
}

function _detailFromHtml(url, html) {
  var t = (html.match(/<title>([^<]+)/) || [])[1] || '';
  t = _htmlUnesc(t).replace(/\s*-\s*SuperCartoons.*$/i, '').replace(/\s*-\s*[A-Za-z ]+Cartoon.*$/i, '').trim();
  var og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || null;
  var desc = (html.match(/<meta property="og:description" content="([^"]+)"/) || [])[1] || '';
  var slug = String(url).split('/').filter(Boolean).pop() || 'cartoon';
  var id = 'supercartoons://cartoon/' + slug;
  var ep = { id: id + '/watch', title: t || 'Watch', url: url, number: 1 };
  var d = { id: id, title: t || slug, url: url, type: 'movie', episodes: [ep] };
  if (og) d.cover = og;
  if (desc) d.description = _htmlUnesc(desc);
  return d;
}

function getDetail(url, opts) {
  return _get(url).then(function (html) {
    if (!html) throw new Error('SuperCartoons: empty detail page');
    return _detailFromHtml(url, html);
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var url = String(episodeUrl || '');
  if (url.indexOf('http') !== 0) return Promise.reject(new Error('SuperCartoons: bad episode url'));
  return _get(url).then(function (html) {
    var out = [];
    var re = /(https:\/\/ww\.supercartoons\.net\/[a-z0-9-]+\/[a-z0-9-]+\.mp4)/g;
    var m, seen = {};
    while ((m = re.exec(html)) !== null) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      out.push({
        url: m[1], quality: '480p', container: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
        label: 'SuperCartoons'
      });
    }
    if (!out.length) throw new Error('SuperCartoons: no mp4 found');
    return out;
  });
}
