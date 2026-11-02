/*
 * NHK World (nhkworld) v1.0.0
 * Free documentary/travel/culture VOD from NHK WORLD-JAPAN.
 * Chain: https://api.nhkworld.jp/showsapi/v1/en
 *   programs -> /video_programs?limit=N
 *   program  -> /video_programs/{slug}
 *   episodes -> /video_programs/{slug}/video_episodes?sort=-date
 *   episode  -> /video_episodes/{id} -> video.url (direct HLS master.m3u8)
 * Streams: masterpl.hls.nhkworld.jp / media-tyo.hls.nhkworld.jp (multi-quality
 * HLS, EN audio). No login, no JS crypto, VM-reachable.
 */

var SITE = 'https://www3.nhk.or.jp';
var API = 'https://api.nhkworld.jp/showsapi/v1/en';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function get(url) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': SITE + '/nhkworld/en/shows/',
      'Accept': 'application/json'
    }
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function getText(url) {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': SITE + '/nhkworld/en/shows/' }
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function pickImage(images) {
  var best = null;
  var list = (images && images.landscape) || [];
  for (var i = 0; i < list.length; i++) {
    var im = list[i];
    if (im && im.url && (!best || (im.width || 0) > (best.width || 0))) best = im;
  }
  return best ? absUrl(best.url, SITE) : null;
}

function programToItem(p) {
  return {
    id: 'nhkworld:' + p.id,
    title: String(p.title || p.html_title || 'Untitled'),
    url: 'nhkworld://program/' + p.id,
    type: 'movie',
    cover: pickImage(p.images)
  };
}

function getInfo() {
  return Promise.resolve({
    name: 'NHK World',
    lang: 'en',
    baseUrl: SITE,
    logo: SITE + '/nhkworld/common/site_images/nw_webapp_152x152.png',
    type: 'movie',
    version: '1.0.0'
  });
}

function getHome(opts) {
  var rows = [];
  function addRow(title, promise) {
    return promise.then(function (d) {
      var items = [];
      var list = (d && d.items) || [];
      for (var i = 0; i < list.length; i++) items.push(programToItem(list[i]));
      if (items.length) rows.push({ title: title, items: items });
    }).catch(function () { /* one bad row must not kill home */ });
  }
  return addRow('Anime & Manga', get(API + '/categories/31/video_programs?limit=24'))
    .then(function () { return addRow('Featured Programs', get(API + '/video_programs?limit=24')); })
    .then(function () { return addRow('Art & Design', get(API + '/categories/19/video_programs?limit=24')); })
    .then(function () { return addRow('Music', get(API + '/categories/30/video_programs?limit=24')); })
    .then(function () { return rows; });
}

function search(query, page, opts) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return Promise.resolve([]);
  var all = [];
  var offset = 0;
  function fetchPage() {
    return get(API + '/video_programs?limit=100&offset=' + offset).then(function (d) {
      var items = (d && d.items) || [];
      for (var i = 0; i < items.length; i++) all.push(items[i]);
      var total = (d && d.pagination && d.pagination.total) || 0;
      offset += 100;
      if (offset < total && offset < 600) return fetchPage();
      return null;
    });
  }
  return fetchPage().then(function () {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      var hay = ((p.title || '') + ' ' + (p.description || '')).toLowerCase();
      if (hay.indexOf(q) !== -1) {
        out.push(programToItem(p));
        if (out.length >= 50) break;
      }
    }
    return out;
  });
}

function getDetail(url, opts) {
  var slug = String(url || '').replace('nhkworld://program/', '');
  if (!slug) return Promise.reject(new Error('bad program url'));
  return get(API + '/video_programs/' + encodeURIComponent(slug)).then(function (p) {
    return {
      id: 'nhkworld:' + p.id,
      title: String(p.title || p.html_title || 'Untitled'),
      url: url,
      type: 'movie',
      cover: pickImage(p.images),
      description: p.description ? String(p.description) : null,
      year: null
    };
  });
}

function getEpisodes(url, opts) {
  var slug = String(url || '').replace('nhkworld://program/', '');
  if (!slug) return Promise.reject(new Error('bad program url'));
  var eps = [];
  var offset = 0;
  function fetchPage() {
    return get(API + '/video_programs/' + encodeURIComponent(slug) +
      '/video_episodes?sort=-date&limit=100&offset=' + offset).then(function (d) {
      var items = (d && d.items) || [];
      for (var i = 0; i < items.length; i++) {
        var e = items[i];
        var n = offset + i + 1;
        eps.push({
          id: 'nhkworld:ep:' + e.id,
          title: String(e.title || e.html_title || ('Episode ' + n)),
          url: 'nhkworld://episode/' + e.id,
          number: n,
          thumbnail: pickImage(e.images)
        });
      }
      var total = (d && d.pagination && d.pagination.total) || 0;
      offset += 100;
      if (offset < total && eps.length < 500) return fetchPage();
      return null;
    });
  }
  return fetchPage().then(function () {
    if (eps.length) return eps;
    // fallback: some specials carry clips instead of episodes
    return get(API + '/video_programs/' + encodeURIComponent(slug) +
      '/video_clips?sort=-date&limit=100').then(function (d) {
      var items = (d && d.items) || [];
      for (var i = 0; i < items.length; i++) {
        var e = items[i];
        var n = i + 1;
        eps.push({
          id: 'nhkworld:ep:' + e.id,
          title: String(e.title || e.html_title || ('Clip ' + n)),
          url: 'nhkworld://episode/' + e.id,
          number: n,
          thumbnail: pickImage(e.images)
        });
      }
      return eps;
    });
  });
}

function parseMaster(masterText, masterUrl) {
  var lines = String(masterText || '').split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
      var res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      var h = res ? parseInt(res[2], 10) : 0;
      var uri = (lines[i + 1] || '').trim();
      if (uri && uri.charAt(0) !== '#') {
        var abs = absUrl(uri, masterUrl);
        var q = h ? (h + 'p') : 'auto';
        out.push({ url: abs, quality: q, label: 'NHK World', container: 'hls' });
      }
    }
  }
  return out;
}

function getVideoSources(episodeUrl) {
  var epId = String(episodeUrl || '').replace('nhkworld://episode/', '');
  if (!epId) return Promise.reject(new Error('bad episode url'));
  return get(API + '/video_episodes/' + encodeURIComponent(epId)).then(function (e) {
    var vurl = (e && e.video && e.video.url) || null;
    if (!vurl || !/^https?:\/\//i.test(vurl)) throw new Error('no stream url for episode ' + epId);
    return getText(vurl).then(function (master) {
      var srcs = parseMaster(master, vurl);
      if (srcs.length) return srcs;
      // master without variants (single rendition): hand it over as-is
      return [{ url: vurl, quality: 'auto', label: 'NHK World', container: 'hls' }];
    });
  });
}
