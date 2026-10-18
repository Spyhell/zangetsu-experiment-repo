// MMani (mmani.com) — anime BD/WEB releases, English subbed.
// Catalogue/search/detail run on eng.animeapps.top; episode lists and
// stream pages run on epeng.animeapps.top / play.anien.top.
// Playback chain: api2.php?epid=<anilistId> -> servers + episode links
// -> apilink.php?data=<linkId> -> play page -> PLAYER_CONFIG (HLS + subs).
function getInfo() {
  return {
    id: 'mmani',
    name: 'MMani',
    lang: 'en',
    baseUrl: 'https://mmani.com',
    logo: 'https://mmani.com/favicon.ico',
    type: 'anime',
    version: '1.0.0'
  };
}

var SITE = 'https://mmani.com';
var CATALOG = 'https://eng.animeapps.top';
var EPAPI = 'https://epeng.animeapps.top';
var PLAY = 'https://play.anien.top';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

function _raceTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('MMani timeout: ' + label)); }, ms);
    })
  ]);
}

function _fetchText(url, referer) {
  var p = fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer || (SITE + '/') } })
    .then(function(r) {
      if (!r.ok) throw new Error('MMani HTTP ' + r.status);
      return r.text();
    });
  return _raceTimeout(p, 15000, url);
}

function _json(url) {
  return _fetchText(url, SITE + '/').then(function(t) {
    try { return JSON.parse(t); } catch (e) { throw new Error('MMani: bad JSON'); }
  });
}

function _title(item) {
  return item.english || item.postname || item.romaji || item.native || '';
}

function _mediaType(item) {
  return /MOVIE/i.test(String(item.anitypes || '')) ? 'movie' : 'anime';
}

function _card(item) {
  if (!item || item.postid == null) return null;
  var title = _title(item);
  if (!title) return null;
  var card = {
    id: String(item.postid),
    title: title,
    url: 'mmani://' + item.postid,
    type: _mediaType(item),
    cover: item.ani_cover_large || item.ani_cover_medium || null,
    banner: item.ani_banner || null
  };
  var al = parseInt(item.anilist, 10);
  if (al > 0) card.anilistId = al;
  if (item.postyear) card.year = String(item.postyear);
  return card;
}

function _cards(list) {
  var out = [];
  (list || []).forEach(function(item) {
    var c = _card(item);
    if (c) out.push(c);
  });
  return out;
}

function _filterRow(title, query, limit) {
  return _json(CATALOG + '/api/singlefilter.php?page=1&' + query + '&limit=' + limit)
    .then(function(data) {
      var items = _cards(data && data.data);
      return items.length ? { title: title, items: items } : null;
    })
    .catch(function() { return null; });
}

function getHome(opts) {
  return Promise.all([
    _filterRow('Latest', '', 24),
    _filterRow('BD Releases', 'postseasontypetagid=22258', 18),
    _filterRow('Movies', 'anitypestagid=21341', 18)
  ]).then(function(rows) {
    return rows.filter(Boolean);
  });
}

function search(query, page, opts) {
  page = page || 1;
  return _json(CATALOG + '/api/search3.php?keyword=' + encodeURIComponent(query) + '&page=' + page)
    .then(function(data) { return _cards(data && data.data); });
}

function _postId(url) {
  var m = String(url || '').match(/(\d+)/);
  return m ? m[1] : '';
}

function _detail(postid) {
  return _json(CATALOG + '/api/single.php?postid=' + postid).then(function(res) {
    var d = (res && res.data) || {};
    if (!d.postid) throw new Error('MMani: title not found');
    return d;
  });
}

function _episodesFor(anilistId) {
  return _json(EPAPI + '/api2.php?epid=' + anilistId).then(function(servers) {
    var out = [];
    (servers || []).forEach(function(server) {
      var eps = [];
      (server.server_data || []).forEach(function(ep, i) {
        var n = parseFloat(ep.name);
        if (isNaN(n)) n = i + 1;
        eps.push({
          id: 'mmani://ep/' + anilistId + '/' + encodeURIComponent(server.server_name || 'S-sub') + '/' + ep.link,
          title: 'Episode ' + ep.name,
          url: 'mmani://ep/' + anilistId + '/' + encodeURIComponent(server.server_name || 'S-sub') + '/' + ep.link,
          number: n
        });
      });
      eps.sort(function(a, b) { return a.number - b.number; });
      out = out.concat(eps);
    });
    return out;
  }).catch(function() { return []; });
}

function getDetail(url, opts) {
  var postid = _postId(url);
  return _detail(postid).then(function(d) {
    var detail = {
      id: String(d.postid),
      title: _title(d),
      url: 'mmani://' + d.postid,
      type: _mediaType(d),
      cover: d.ani_cover_large || d.ani_cover_medium || null,
      banner: d.ani_banner || null,
      description: String(d.postcontent || '').replace(/\s+/g, ' ').trim() || null,
      year: d.postyear != null && d.postyear !== '' ? String(d.postyear) : null,
      genres: d.postanigenres ? String(d.postanigenres).split(/,\s*/) : []
    };
    var al = parseInt(d.anilist, 10);
    if (al > 0) detail.anilistId = al;
    if (!al) { detail.episodes = []; return detail; }
    return _episodesFor(al).then(function(eps) {
      detail.episodes = eps;
      detail.subCount = eps.length;
      detail.dubCount = 0;
      return detail;
    });
  });
}

function getEpisodes(url, opts) {
  var postid = _postId(url);
  return _detail(postid).then(function(d) {
    var al = parseInt(d.anilist, 10);
    if (!al) return [];
    return _episodesFor(al);
  });
}

function _qualityOf(entry) {
  // The play URL embeds the quality inside a long digit string
  // ("...756720p7403..."), so a loose \d{3,4}p match can grab the wrong
  // digits ("6720p"). Match only real quality heights.
  var m = String(entry.link || '').match(/(2160|1440|1080|720|480|360|240)p/);
  if (m) return parseInt(m[1], 10);
  if (/HD/i.test(entry.server || '')) return 1080;
  return 720;
}

function _playConfig(playUrl) {
  return _fetchText(playUrl, SITE + '/').then(function(html) {
    var m = html.match(/window\.PLAYER_CONFIG\s*=\s*(\{[\s\S]*?\});/);
    if (!m) throw new Error('MMani: player config missing');
    var cfg = JSON.parse(m[1]);
    if (!cfg.videoUrl) throw new Error('MMani: no video in player config');
    var video = cfg.videoUrl;
    if (video.charAt(0) === '/') video = PLAY + video;
    var subs = (cfg.tracks || []).map(function(t) {
      var label = t.label || 'English';
      return { url: t.file, lang: /english/i.test(label) ? 'en' : label.slice(0, 2).toLowerCase(), label: label };
    }).filter(function(s) { return s.url; });
    return { url: video, subtitles: subs };
  });
}

function getVideoSources(episodeUrl) {
  var parts = String(episodeUrl || '').split('/');
  // mmani://ep/<anilistId>/<server>/<linkId>
  var linkId = parts[parts.length - 1];
  var serverName = decodeURIComponent(parts[parts.length - 2] || '');
  if (!linkId) return Promise.reject(new Error('MMani: bad episode url'));
  return _json(EPAPI + '/apilink.php?data=' + encodeURIComponent(linkId)).then(function(entries) {
    var list = (entries || []).filter(function(e) { return e && e.link; });
    if (!list.length) throw new Error('MMani: no stream links');
    return Promise.all(list.map(function(entry) {
      return _playConfig(entry.link).then(function(cfg) {
        return {
          url: cfg.url,
          quality: _qualityOf(entry) + 'p',
          label: 'MMani ' + (entry.server || serverName),
          container: 'hls',
          kind: 'sub',
          headers: { 'User-Agent': UA, 'Referer': PLAY + '/' },
          subtitles: cfg.subtitles
        };
      }).catch(function() { return null; });
    })).then(function(rows) {
      var out = rows.filter(Boolean);
      if (!out.length) throw new Error('MMani: streams failed to resolve');
      // Ascending quality: the app auto-plays the last link, so the best
      // quality must sit at the end.
      out.sort(function(a, b) { return parseInt(a.quality, 10) - parseInt(b.quality, 10); });
      return out;
    });
  });
}
