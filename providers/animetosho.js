// AnimeTosho — anime torrent index for the Zangetsu app.
//
// Backend: animetosho.org's public HTML (search + series pages), no login.
//   search: https://animetosho.org/search?q=<q>
//   home:   https://animetosho.org/  (latest releases)
//   series: https://animetosho.org/series/<slug>.<id>
// Each release entry carries a magnet link, played by Zangetsu's native
// torrent engine. Search/home group releases by their series link.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animetosho';

var _BASE = 'https://animetosho.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return {
    name: 'AnimeTosho', lang: 'en', baseUrl: _BASE,
    logo: 'https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/icons/animetosho.png',
    type: 'anime', version: '1.0.0'
  };
}

// Never hang: 12s race, no-op when the runtime lacks timers (QuickJS-safe).
function _raceTimeout(p, ms) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('AnimeTosho: request timed out')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _getText(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' }
  }).then(function (r) {
    if (!r.ok) throw new Error('AnimeTosho: HTTP ' + r.status);
    return r.text();
  }), 12000);
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _htmlDecode(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'");
}

// One release entry: <div class="link"><a href="VIEW">TITLE</a></div>
// <div class="links">... serieslink ... dllink ... magnet ...</div>
function _parseEntries(html) {
  var out = [];
  var re = /<div class="link"><a href="([^"]+)">([^<]+)<\/a><\/div><div class="links">([\s\S]*?)<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var links = m[3];
    var sm = links.match(/<span class="serieslink"><a href="([^"]+)">([^<]+)<\/a><\/span>/);
    var gm = links.match(/href="(magnet:[^"]+)"/);
    var tm = links.match(/href="(https:\/\/animetosho\.org\/storage\/torrent\/[^"]+)" class="dllink"/);
    out.push({
      viewUrl: _htmlDecode(m[1]),
      title: _trim(_htmlDecode(m[2])),
      seriesUrl: sm ? _htmlDecode(sm[1]) : null,
      seriesName: sm ? _trim(_htmlDecode(sm[2])) : null,
      magnet: gm ? _htmlDecode(gm[1]) : null,
      torrent: tm ? _htmlDecode(tm[1]) : null
    });
  }
  return out;
}

function _seriesItems(entries, query) {
  var seen = {}, items = [];
  entries.forEach(function (en) {
    if (!en.seriesUrl || seen[en.seriesUrl]) return;
    seen[en.seriesUrl] = true;
    items.push({
      id: 'animetosho://series/' + encodeURIComponent(en.seriesUrl),
      title: en.seriesName || 'Unknown',
      url: en.seriesUrl,
      type: 'anime',
      cover: null
    });
  });
  // Rank series whose name matches the query first — some releases are
  // tagged to the wrong series on the site, which would otherwise bury
  // the real match (e.g. "naruto" -> "Samchongsa: Time Machine 001").
  if (query) {
    var words = _trim(query).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
    items.sort(function (a, b) {
      return _matchScore(b.title, words) - _matchScore(a.title, words);
    });
  }
  return items;
}

function _matchScore(title, words) {
  var t = String(title || '').toLowerCase();
  var score = 0;
  words.forEach(function (w) {
    if (t.indexOf(w) !== -1) score += (t === w || t.indexOf(w + ' ') === 0) ? 3 : 1;
  });
  return score;
}

function getHome(opts) {
  return _getText(_BASE + '/').then(function (html) {
    var items = _seriesItems(_parseEntries(html));
    if (!items.length) throw new Error('AnimeTosho: no releases on home');
    return [{ title: 'Latest Releases', items: items.slice(0, 30) }];
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var url = _BASE + '/search?q=' + encodeURIComponent(q);
  if (page && page > 1) url += '&page=' + page;
  return _getText(url).then(function (html) {
    return _seriesItems(_parseEntries(html), q).slice(0, 30);
  });
}

// Best-effort episode number from a release title ("[Group] 012 [1080p]").
function _epNum(title) {
  var t = String(title || '');
  var m = t.match(/(?:^|[\s\[\(_{<-])(?:e|ep|episode)?\s*0*(\d{1,3})(?:v\d+)?(?:[\s\]\)}_.-]|$)/i);
  if (m) {
    var n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function getDetail(url, opts) {
  var seriesUrl = String(url || '');
  if (!/^https?:\/\//i.test(seriesUrl)) {
    var dm = seriesUrl.match(/^animetosho:\/\/series\/(.+)/);
    if (dm) { try { seriesUrl = decodeURIComponent(dm[1]); } catch (e) { } }
  }
  if (!/^https?:\/\//i.test(seriesUrl)) {
    return Promise.reject(new Error('AnimeTosho: bad series url'));
  }
  return _getText(seriesUrl).then(function (html) {
    var tm = html.match(/<title>([^<]*)<\/title>/i);
    var title = tm ? _trim(_htmlDecode(tm[1]).split('|')[0]) : 'Anime';
    var entries = _parseEntries(html);
    var eps = [];
    entries.forEach(function (en, i) {
      if (!en.magnet) return;
      var num = _epNum(en.title);
      eps.push({
        id: 'animetosho://r/' + i + '/' + encodeURIComponent(en.viewUrl),
        title: en.title,
        url: 'animetosho://r/' + encodeURIComponent(en.magnet) + '|' + encodeURIComponent(en.title),
        number: (num != null ? num : (i + 1))
      });
    });
    return {
      id: 'animetosho://series/' + encodeURIComponent(seriesUrl),
      title: title,
      url: seriesUrl,
      type: 'anime',
      cover: null,
      description: null,
      episodes: eps
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) {
    return (d && d.episodes) || [];
  });
}

function getVideoSources(episodeUrl) {
  var m = String(episodeUrl || '').match(/^animetosho:\/\/r\/([^|]+)\|?(.*)$/);
  if (!m) return Promise.reject(new Error('AnimeTosho: bad episode url'));
  var magnet, title;
  try { magnet = decodeURIComponent(m[1]); } catch (e) { magnet = m[1]; }
  try { title = decodeURIComponent(m[2] || ''); } catch (e) { title = m[2] || ''; }
  if (!/^magnet:/i.test(magnet)) {
    return Promise.reject(new Error('AnimeTosho: no magnet for this release'));
  }
  return Promise.resolve([{
    url: magnet,
    label: title ? _trim(title).slice(0, 100) : 'AnimeTosho release'
  }]);
}
