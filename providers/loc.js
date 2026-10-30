// LOC Screening Room — Library of Congress National Screening Room.
// Public-domain historic films (1890s-1990s), no login. Search via the
// public loc.gov JSON API, filtered client-side to the National Screening
// Room collection (the fa=partof: filter returns nothing server-side).
// Item pages expose direct tile.loc.gov MP4 + HLS URLs.
var BASE = 'https://www.loc.gov';

function getInfo() {
  return { name: 'Library of Congress', lang: 'en', baseUrl: BASE,
           logo: 'https://www.loc.gov/favicon.ico', type: 'movie', version: '1.0.0' };
}

function enc(s) {
  return encodeURIComponent(String(s || ''));
}

function isCF(body) {
  return body && (body.indexOf('Just a moment...') !== -1 || body.indexOf('challenges.cloudflare.com') !== -1);
}

function fetchRetry(url) {
  return fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': 'application/json, text/html' } })
    .then(function (r) {
      if (!r.ok) throw new Error('LOC HTTP ' + r.status);
      return r.text().then(function (t) {
        if (isCF(t)) {
          return fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } })
            .then(function (r2) { return r2.text(); });
        }
        return t;
      });
    });
}

function isNSR(r) {
  var p = r.partof || [];
  for (var i = 0; i < p.length; i++) {
    if (String(p[i]).toLowerCase().indexOf('national screening room') !== -1) return true;
  }
  return false;
}

function toItem(r) {
  var url = r.url || '';
  var m = url.match(/\/item\/([^\/]+)\//);
  var id = m ? m[1] : enc(r.title);
  var cover = r.image_url || null;
  if (!cover && r.resources && r.resources.length) cover = r.resources[0].image || null;
  var year = null;
  if (r.date) { var y = String(r.date).match(/(\d{4})/); if (y) year = y[1]; }
  return { id: 'loc://' + id, title: r.title || 'Untitled', url: url,
           type: 'movie', cover: cover, year: year };
}

function searchNSR(query, count) {
  var url = BASE + '/search/?q=' + enc(query) + '&fo=json&c=' + (count || 30);
  return fetchRetry(url).then(function (t) {
    var d = JSON.parse(t);
    var out = [];
    var res = d.results || [];
    for (var i = 0; i < res.length; i++) {
      if (isNSR(res[i])) out.push(toItem(res[i]));
    }
    return out;
  });
}

function search(query, page, opts) {
  return searchNSR(query, 30);
}

function getHome(opts) {
  return searchNSR('film', 30).then(function (items) {
    if (!items.length) return [];
    return [{ title: 'National Screening Room', items: items.slice(0, 20) }];
  });
}

function titleFromHtml(html) {
  var m = html.match(/<title>([^<|]+)/);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  return 'Library of Congress film';
}

function getDetail(url, opts) {
  return fetchRetry(url).then(function (html) {
    var title = titleFromHtml(html);
    var m = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/);
    var desc = m ? m[1] : null;
    var cm = html.match(/https:\/\/tile\.loc\.gov\/[^"'\s]+\.jpg/);
    var idm = url.match(/\/item\/([^\/]+)\//);
    var id = idm ? idm[1] : 'loc';
    var ep = { id: '1', title: title, url: url, number: 1 };
    return { id: 'loc://' + id, title: title, url: url, type: 'movie',
             cover: cm ? cm[0] : null, description: desc, episodes: [ep] };
  });
}

function getEpisodes(url, opts) {
  return fetchRetry(url).then(function (html) {
    return [{ id: '1', title: titleFromHtml(html), url: url, number: 1 }];
  });
}

function uniq(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]); }
  }
  return out;
}

function getVideoSources(episodeUrl) {
  return fetchRetry(episodeUrl).then(function (html) {
    var out = [];
    var mp4s = uniq(html.match(/https:\/\/tile\.loc\.gov\/[^"'\s]+\.mp4/g) || []);
    var hls = uniq(html.match(/https:\/\/tile\.loc\.gov\/[^"'\s]+\.m3u8/g) || []);
    for (var i = 0; i < hls.length; i++) {
      out.push({ url: hls[i], quality: '720p', label: 'HLS', container: 'hls' });
    }
    for (var j = 0; j < mp4s.length; j++) {
      out.push({ url: mp4s[j], quality: '720p', label: 'MP4', container: 'mp4' });
    }
    if (!out.length) throw new Error('LOC: no playable stream found on item page');
    return out;
  });
}
