// AnimeWorld — Italian-subbed/dubbed anime from animeworld.ac.
// Chain (all server-side, verified 2026-10-26 from VM, no login, no cookies):
//   GET /search?keyword=<q>            -> poster cards (/play/<slug>.<id>)
//   GET /play/<slug>.<id>             -> all episode anchors server-side:
//        <a data-episode-id="33022" data-id="ZXFbr" data-episode-num="1" ...>
//   GET /api/episode/info?id=<dataId>  -> JSON { grabber: <direct mp4 URL>, ... }
//        (stateless: works with no cookie and no CSRF token)
//   grabber mp4 byte-verified: HTTP 206 on Naruto Shippuden ep 1 + ep 2.
// Entries whose slug ends in '-ita' are the Italian-dub editions; the rest
// carry Italian subtitles (grabber filenames contain SUB_ITA).

var SITE = 'https://www.animeworld.ac';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeWorld', lang: 'it', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

// The site's Cloudflare edge intermittently resets Node/undici connections
// from this VM (curl succeeds every time; Node fails ~1 in 2 on some paths),
// so every fetch retries up to 3 times. This is transport flakiness, not a
// provider bug; the app's Android network stack does not share it.
function _get(url, attempt) {
  attempt = attempt || 0;
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.text();
    })
    .catch(function (e) {
      if (attempt < 2) {
        return new Promise(function (res) {
          setTimeout(function () { res(_get(url, attempt + 1)); }, 800 * (attempt + 1));
        });
      }
      throw e;
    });
}

function _abs(href) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  return SITE + (href.charAt(0) === '/' ? href : '/' + href);
}

// Poster cards: <a href="/play/<slug>.<id>" class="poster" ...>
//   <img ... src="<cover>" alt="<title>" />
function _parseCards(html) {
  var out = [], seen = {}, re, m, slug, cover, title, isDub;
  re = /<a[^>]*href="\/play\/([^"\/]+)"[^>]*class="poster"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/gi;
  while ((m = re.exec(html)) !== null) {
    slug = m[1];
    if (seen[slug]) continue;
    seen[slug] = true;
    cover = m[2];
    title = (m[3] || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    if (!title) continue;
    isDub = /-ita$/i.test(slug);
    out.push({ id: 'animeworld-' + slug, title: title,
      url: 'animeworld://play/' + slug, type: 'anime',
      cover: _abs(cover), dubBadge: isDub ? 'DUB' : 'SUB' });
  }
  return out;
}

function getHome(opts) {
  return _get(SITE + '/').then(function (html) {
    var items = _parseCards(html);
    if (!items.length) throw new Error('home returned no items');
    return [{ title: 'Latest', items: items }];
  });
}

function search(query, page, opts) {
  var q = encodeURIComponent(String(query || ''));
  return _get(SITE + '/search?keyword=' + q).then(function (html) {
    var items = _parseCards(html);
    if (!items.length) throw new Error('search returned no items for: ' + query);
    return items;
  });
}

function _slugOf(url) {
  var m = String(url || '').match(/play\/([^\/\s]+)/);
  return m ? m[1] : null;
}

function _parseDetail(html, slug) {
  var title = null, cover = null, m;
  m = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  if (m) title = m[1];
  if (!title) {
    m = html.match(/<title>([^<]+)<\/title>/i);
    if (m) title = m[1].replace(/\s*-\s*AnimeWorld\s*$/i, '').trim();
  }
  m = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  if (m) cover = m[1];
  title = (title || slug || 'AnimeWorld').replace(/&amp;/g, '&').trim();
  return { id: 'animeworld-' + slug, title: title,
    url: 'animeworld://play/' + slug, type: 'anime',
    cover: cover ? _abs(cover) : undefined };
}

// Episode anchors: <a data-episode-id="33022" data-id="ZXFbr"
//   data-episode-num="1" ... href="/play/<slug>/<token>">
function _parseEpisodes(html, slug) {
  var out = [], seen = {}, re, m, epId, token, num;
  re = /<a[^>]*data-episode-id="(\d+)"[^>]*data-id="([^"]+)"[^>]*data-episode-num="(\d+)"[^>]*>/gi;
  while ((m = re.exec(html)) !== null) {
    epId = m[1]; token = m[2]; num = parseInt(m[3], 10);
    if (seen[token]) continue;
    seen[token] = true;
    out.push({ id: 'animeworld-ep-' + token, title: 'Episode ' + num,
      url: 'animeworld://ep/' + token, number: num });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url: ' + url));
  return _get(SITE + '/play/' + slug).then(function (html) {
    var d = _parseDetail(html, slug);
    d.episodes = _parseEpisodes(html, slug);
    if (!d.episodes.length) throw new Error('detail returned no episodes');
    return d;
  });
}

function getEpisodes(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad episodes url: ' + url));
  return _get(SITE + '/play/' + slug).then(function (html) {
    var eps = _parseEpisodes(html, slug);
    if (!eps.length) throw new Error('episodes returned none');
    return eps;
  });
}

function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/ep\/([^\/\s]+)/);
  if (!m) return Promise.reject(new Error('bad episode url: ' + episodeUrl));
  return _get(SITE + '/api/episode/info?id=' + encodeURIComponent(m[1]))
    .then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) {
        throw new Error('episode/info not JSON');
      }
      if (!j || !j.grabber || !/^https?:\/\//i.test(j.grabber)) {
        throw new Error('episode/info returned no grabber');
      }
      return [{ url: j.grabber, quality: '1080p', label: 'AnimeWorld Server',
        container: 'mp4', kind: 'sub' }];
    });
}
