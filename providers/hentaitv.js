// ─────────────────────────────────────────────────────────────────────────────
// HentaiTV — adult anime streaming provider for the Zangetsu provider repo.
// Source site: https://hentaitv.top (Next.js; episode pages embed a
// pixeldrain download which resolves to a direct mp4 via
// https://pixeldrain.com/api/file/<id>).
// Listing cards are plain HTML; per-episode download URLs come from the
// page's React Flight data (__next_f payloads).
// ─────────────────────────────────────────────────────────────────────────────

var _SITE = 'https://hentaitv.top';
var _UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var _HEADERS = { 'User-Agent': _UA, Referer: _SITE + '/', Accept: 'text/html' };

function getInfo() {
  return {
    name: 'HentaiTV',
    lang: 'en',
    baseUrl: _SITE,
    logo: _SITE + '/logo-100.png',
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

function _seriesSlug(epSlug) {
  return _str(epSlug).replace(/-episode-\d+$/i, '');
}

function _epNum(epSlug) {
  var m = /-episode-(\d+)$/i.exec(_str(epSlug));
  return m ? parseInt(m[1], 10) : 0;
}

function _seriesTitle(epTitle) {
  return _str(epTitle).replace(/\s*episode\s*\d+.*$/i, '').replace(/\s+/g, ' ').trim();
}

// Decode Next.js flight payloads into one searchable blob.
function _flight(html) {
  var out = [];
  var re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g, m;
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(m[1])); } catch (e) { /* skip */ }
  }
  return out.join('\n');
}

// Parse episode cards from listing HTML (home / search / tag pages).
// Returns [{epSlug, title, thumb}]
function _parseCards(html) {
  var out = [], seen = {};
  var re = /<a[^>]+href="\/([a-z0-9\-]+-episode-\d+)"[^>]*>[\s\S]*?<img[^>]+alt="([^"]*)"[^>]+src="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[1]]) continue;
    seen[m[1]] = 1;
    out.push({ epSlug: m[1], title: _str(m[2]).replace(/\s+/g, ' ').trim(), thumb: m[3] });
  }
  return out;
}

function _cardsToSeries(cards) {
  var map = {}, order = [];
  cards.forEach(function (c) {
    var slug = _seriesSlug(c.epSlug);
    if (!slug) return;
    if (!map[slug]) {
      var item = {
        id: 'hentaitv-series-' + slug,
        title: _seriesTitle(c.title) || slug.replace(/-/g, ' '),
        url: 'hentaitv://series/' + slug,
        type: 'anime',
        cover: c.thumb
      };
      map[slug] = item;
      order.push(item);
    }
  });
  return order;
}

function getHome() {
  return _getText(_SITE + '/').then(function (html) {
    var cards = _parseCards(html);
    var items = _cardsToSeries(cards).slice(0, 20);
    return items.length ? [{ title: 'Latest Episodes', items: items }] : [];
  });
}

function search(query, page) {
  var q = _str(query).trim();
  if (!q) return Promise.resolve([]);
  return _getText(_SITE + '/search?q=' + encodeURIComponent(q)).then(function (html) {
    return _cardsToSeries(_parseCards(html)).slice(0, 30);
  });
}

function _seriesOf(url) {
  var m = /hentaitv:\/\/series\/([a-z0-9\-]+)/.exec(_str(url));
  return m ? m[1] : '';
}

function getDetail(url) {
  var slug = _seriesOf(url);
  if (!slug) return Promise.reject(new Error('bad url'));
  return _getText(_SITE + '/tag/' + slug).then(function (html) {
    var title = slug.replace(/-/g, ' ');
    var tm = /<title>([^<]*)<\/title>/i.exec(html);
    if (tm) title = _str(tm[1]).split('|')[0].replace(/\s*Hentai\s*$/i, '').replace(/\s+/g, ' ').trim() || title;

    var cards = _parseCards(html);
    var episodes = [], seen = {};
    cards.forEach(function (c) {
      if (_seriesSlug(c.epSlug) !== slug || seen[c.epSlug]) return;
      seen[c.epSlug] = 1;
      episodes.push({
        id: 'hentaitv-ep-' + c.epSlug,
        title: c.title,
        url: 'hentaitv://ep/' + c.epSlug,
        number: _epNum(c.epSlug),
        thumbnail: c.thumb
      });
    });
    episodes.sort(function (a, b) { return a.number - b.number; });

    // Fallback: if the tag page lists nothing, treat the slug as a single episode.
    if (!episodes.length) {
      episodes.push({
        id: 'hentaitv-ep-' + slug,
        title: title,
        url: 'hentaitv://ep/' + slug,
        number: _epNum(slug) || 1,
        thumbnail: ''
      });
    }

    return {
      id: 'hentaitv-series-' + slug,
      title: title,
      url: 'hentaitv://series/' + slug,
      type: 'anime',
      cover: cards.length ? cards[0].thumb : '',
      description: '',
      year: null,
      episodes: episodes
    };
  });
}

function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d.episodes || []; });
}

function _epSlugOf(url) {
  var m = /hentaitv:\/\/ep\/([a-z0-9\-]+)/.exec(_str(url));
  if (m) return m[1];
  m = /hentaitv\.top\/([a-z0-9\-]+-episode-\d+)/.exec(_str(url));
  return m ? m[1] : '';
}

function getVideoSources(episodeUrl) {
  var slug = _epSlugOf(episodeUrl);
  if (!slug) return Promise.resolve([]);
  return _getText(_SITE + '/' + slug).then(function (html) {
    var blob = _flight(html);
    var m = /"external_download_url":"(https:\/\/pixeldrain\.com\/u\/([a-zA-Z0-9]+))"/.exec(blob);
    if (!m) return [];
    return [{
      url: 'https://pixeldrain.com/api/file/' + m[2],
      container: 'mp4',
      quality: '1080p',
      label: 'HentaiTV MP4',
      headers: { 'User-Agent': _UA, Referer: _SITE + '/' }
    }];
  }).catch(function () { return []; });
}
