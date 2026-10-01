/* Orphaned Films (orphanedfilms.com) - curated public-domain / forgotten films.
 * Home rows + search over the site's curated archive.org collections; direct MP4 streams.
 * type: movie, lang: en, version 1.0.0 */
'use strict';

var _SITE = 'https://archive.org';
var _HOME = 'https://www.orphanedfilms.com';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Curated collections from orphanedfilms.com/collections.json (built 2026-09-24).
var _ROWS = [["Feature Films","feature_films"],["Movies","moviesandfilms"],["Sci-Fi / Horror","SciFi_Horror"],["Film Noir","Film_Noir"],["Silent Films","silent_films"],["Comedy Films","Comedy_Films"]];
var _PICKS = ["metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev","Nosferatu_most_complete_version_93_mins.","DasKabinettdesDoktorCaligariTheCabinetofDrCaligari","frankenstein-1931-restored-movie-720p-hd","metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev","Nosferatu_most_complete_version_93_mins.","dr-strangelove-or-how-i-learned-to-stop-worrying-and-love-the-bomb","frankenstein-1931-restored-movie-720p-hd","frankenstein-1931-english","invasion-of-the-body-snatchers-1956_202511","night_of_the_living_dead_dvd","the-invisible-man-1933_202105","Double.Indemnity.1944.720p.BrRip.x265.HEVCBay.com.mkv","gilda-1080p","the-third-man-1949_202511","notorious-1946-restored-movie-720p-hd","metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev","Nosferatu_most_complete_version_93_mins.","DasKabinettdesDoktorCaligariTheCabinetofDrCaligari","ChelovekskinoapparatomManWithAMovieCamera","The_General_Buster_Keaton","dr-strangelove-or-how-i-learned-to-stop-worrying-and-love-the-bomb","his_girl_friday","sherlock-jr_202506"];
var _ROW_FILMS = {"feature_films":["metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev","Nosferatu_most_complete_version_93_mins.","DasKabinettdesDoktorCaligariTheCabinetofDrCaligari","frankenstein-1931-restored-movie-720p-hd","Night.Of.The.Living.Dead_1080p","Double.Indemnity.1944.720p.BrRip.x265.HEVCBay.com.mkv","dr-strangelove-or-how-i-learned-to-stop-worrying-and-love-the-bomb","SunsetBoulevard1950","the-seventh-seal-1957","m.-1931","all.-about.-eve.-1950.720p","the-third-man-1949_202511","breathless-1960","the-bridge-on-the-river-kwai-1957_202511","the-silence-of-the-lambs-1991_202405","ROBOCOPCC","mad.-max.-1979.1080p.-blu-ray.x-265-rarbg","laputa.-castle.in.the.-sky.-1986.1080p.-bdrip.-dual.-audio.-10bits.x-265-rapta","rosemarys-baby_202105","carrie-1976_202409"],"moviesandfilms":["metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev","Nosferatu_most_complete_version_93_mins.","dr-strangelove-or-how-i-learned-to-stop-worrying-and-love-the-bomb","frankenstein-1931-restored-movie-720p-hd","the-seventh-seal-1957","SunsetBoulevard1950","Night.Of.The.Living.Dead_1080p","4964CS","1236cs_202209","breathless-1960","m.-1931","Double.Indemnity.1944.720p.BrRip.x265.HEVCBay.com.mkv","the-third-man-1949_202511","pulp-fiction-1994","8847CS","side-6-laserdisc","the-silence-of-the-lambs-1991_202405","ROBOCOPCC","13971CS","mad.-max.-1979.1080p.-blu-ray.x-265-rarbg"],"SciFi_Horror":["frankenstein-1931-english","invasion-of-the-body-snatchers-1956_202511","night_of_the_living_dead_dvd","the-invisible-man-1933_202105","lp-473-pl_202403","dawn-of-the-dead-1978_202512","king-kong-1933-espanol_202401","the.-blob.-1958","carrie-1976_202409","Nosferatu_most_complete_version_93_mins.","DasKabinettdesDoktorCaligariTheCabinetofDrCaligari","brotherhood-of-the-wolf","flatliners-1990","the.-wicker.-man.-1973","DeepRed1975","dra-cula.-eng.-mp-4.","pagkasuklam","diabolique.-1955","black-christmas-1974_202405","the-howling-1981_202512"],"Film_Noir":["Double.Indemnity.1944.720p.BrRip.x265.HEVCBay.com.mkv","gilda-1080p","the-third-man-1949_202511","notorious-1946-restored-movie-720p-hd","lajungladeasfalto","the-lady-from-shanghai-1947","laura-1944","1953thebigheatlossobornadosfritzlang","strangers-on-a-train-720p","thekilling1956","SunsetBoulevard1950","shadowofadoubt1943_202003","ScarletStreet","1950-in-a-lonely-place-en-un-lugar-solitario-nicholas-ray-vose","breathless-1960","rebecca-1940-film-noir-thirller-hitchcock","1955-the-night-of-the-hunter-la-noche-del-cazador-charles-laughton","1957-witness-for-the-prosecution-testigo-de-cargo-billy-wilder","1959-anatomy-of-a-murder-anatomia-de-un-asesinato-otto-preminger-vose","high-and-low"],"silent_films":["metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev","Nosferatu_most_complete_version_93_mins.","DasKabinettdesDoktorCaligariTheCabinetofDrCaligari","ChelovekskinoapparatomManWithAMovieCamera","BattleshipPotemkin","The_General_Buster_Keaton","sunrise.-a.-song.-of.-two.-humans.-1927.720p.-blu-ray.x-264-hdclub-public-hd","Intolerance","MyMovie_20190318","wings.1927.1080p.bluray.x264-cinefile","ThePhantomoftheOpera","ThePhantomCarriage","silent-the-big-parade","Dr.MabuseTheGamblerdr.MabuseDerSpieler1922Part1","ThiefOfBagdad1924","Haxan_tinted_and_subtitled","TheGolem_893","Cabiria","faust.-1926","the.-lost.-world.-1925.1080p.-blu-ray.x-264-sadpanda"],"Comedy_Films":["The_General_Buster_Keaton","dr-strangelove-or-how-i-learned-to-stop-worrying-and-love-the-bomb","his_girl_friday","sherlock-jr_202506","SteamboatBillJr","OurHospitality_29","the-cameraman-1928_202507","monty-python__the-meaning-of-life__1983","bad-taste-1987-full-movie","sanjuro_202012","little-big-man-1970_202511","throw.momma.from.the.train.1987","creepshow-2-1983","kind-hearts-and-coronets","the-ladykillers_202105","Little_ShopOf_Horrors.avi","daisies_202103","one.-two.-three.-1961.720p.-billy-wilder-film-james-cagney-howard-st.-john-pamel","uhf.-1989","MyManGodfrey1936"]};
var _ALL_COLLECTIONS = ["moviesandfilms","feature_films","vhsvault","SciFi_Horror","short_films","silent_films","Comedy_Films","Film_Noir","TheVideoCellarCollection","feature_films_picfixer","vhsmovies","silenthalloffame","laserdiscs","colorized-movies"];

function getInfo() {
  return {
    name: 'Orphaned Films',
    lang: 'en',
    baseUrl: _HOME,
    logo: _HOME + '/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

function _getJson(url) {
  return fetch(url, { headers: { 'User-Agent': _UA, 'Accept': 'application/json' } }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function _idOf(url) {
  var m = /^of:\/\/(?:movie|watch)\/(.+)$/.exec(url || '');
  return m ? m[1] : null;
}

function _cover(identifier) {
  return _SITE + '/download/' + identifier + '/__ia_thumb.jpg';
}

function _yearStr(v) {
  if (v == null) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') { var t = v.trim(); return t ? t : null; }
  return null;
}

function _descStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Array) return v.join('\n\n');
  return String(v);
}

function _docToItem(doc) {
  var identifier = doc.identifier;
  if (!identifier) return null;
  return {
    id: 'of://' + identifier,
    title: doc.title || identifier,
    url: 'of://movie/' + identifier,
    type: 'movie',
    cover: _cover(identifier),
    year: _yearStr(doc.year)
  };
}

function _advSearch(q, rows, sort) {
  var url = _SITE + '/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl[]=identifier&fl[]=title&fl[]=year' +
    '&rows=' + rows + '&output=json';
  if (sort) url += '&sort[]=' + encodeURIComponent(sort);
  return _getJson(url).then(function (d) {
    var docs = (((d || {}).response || {}).docs) || [];
    var items = [];
    for (var i = 0; i < docs.length; i++) {
      var it = _docToItem(docs[i]);
      if (it) items.push(it);
    }
    return items;
  });
}

function _picksRow() {
  var ors = [];
  for (var i = 0; i < _PICKS.length; i++) ors.push('"' + _PICKS[i] + '"');
  var q = 'identifier:(' + ors.join(' OR ') + ')';
  return _advSearch(q, _PICKS.length, null).then(function (items) {
    return { title: "Curator's Picks", items: items };
  });
}

function _collectionRow(title, collection) {
  // Curated highlight identifiers from orphanedfilms.com (no junk batch uploads).
  var ids = _ROW_FILMS[collection] || [];
  var ors = [];
  for (var i = 0; i < ids.length; i++) ors.push('"' + ids[i] + '"');
  var q = ors.length ? 'identifier:(' + ors.join(' OR ') + ')' : ('collection:' + collection + ' AND mediatype:movies');
  return _advSearch(q, ids.length || 12, null).then(function (items) {
    return { title: title, items: items };
  });
}

function getHome(opts) {
  var jobs = [_picksRow()];
  for (var i = 0; i < _ROWS.length; i++) {
    jobs.push(_collectionRow(_ROWS[i][0], _ROWS[i][1]));
  }
  return Promise.all(jobs);
}

function _searchScope() {
  var parts = [];
  for (var i = 0; i < _ALL_COLLECTIONS.length; i++) parts.push('collection:' + _ALL_COLLECTIONS[i]);
  return '(' + parts.join(' OR ') + ')';
}

function search(query, page, opts) {
  var p = page && page > 0 ? page : 1;
  var rows = 20;
  var q = 'title:(' + query + ') AND mediatype:movies AND ' + _searchScope();
  var url = _SITE + '/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl[]=identifier&fl[]=title&fl[]=year' +
    '&rows=' + rows + '&start=' + ((p - 1) * rows) + '&output=json';
  return _getJson(url).then(function (d) {
    var docs = (((d || {}).response || {}).docs) || [];
    var items = [];
    for (var i = 0; i < docs.length; i++) {
      var it = _docToItem(docs[i]);
      if (it) items.push(it);
    }
    return items;
  });
}

function _metadata(identifier) {
  return _getJson(_SITE + '/metadata/' + encodeURIComponent(identifier));
}

function getDetail(url, opts) {
  var identifier = _idOf(url);
  if (!identifier) return Promise.reject(new Error('bad url: ' + url));
  return _metadata(identifier).then(function (d) {
    var meta = (d || {}).metadata || {};
    var title = meta.title || identifier;
    var epUrl = 'of://watch/' + identifier;
    return {
      id: 'of://' + identifier,
      title: title,
      url: 'of://movie/' + identifier,
      type: 'movie',
      year: _yearStr(meta.year),
      cover: _cover(identifier),
      description: _descStr(meta.description),
      episodes: [{ id: epUrl, title: title, url: epUrl, number: 1 }]
    };
  });
}

function getEpisodes(url, opts) {
  var identifier = _idOf(url);
  if (!identifier) return Promise.reject(new Error('bad url: ' + url));
  return _metadata(identifier).then(function (d) {
    var meta = (d || {}).metadata || {};
    var epUrl = 'of://watch/' + identifier;
    return [{ id: epUrl, title: meta.title || identifier, url: epUrl, number: 1 }];
  });
}

function _guessQuality(name) {
  var n = (name || '').toLowerCase();
  if (/2160|4k|uhd/.test(n)) return '2160p';
  if (/1080/.test(n)) return '1080p';
  if (/720/.test(n)) return '720p';
  if (/480/.test(n)) return '480p';
  if (/360/.test(n)) return '360p';
  return undefined;
}

/* File ranking mirrors the site's player: h.264-derived first, then the
 * original upload, then other derivatives; tiny 512kb / .ia.mp4 previews last. */
var _VID_EXT = /\.(mp4|m4v|mkv|avi|ogv|mpeg|mpg|mov|wmv)$/i;
function _fileRank(f) {
  var format = String(f.format || '').toLowerCase();
  var name = String(f.name || '').toLowerCase();
  var mp4 = /\.(mp4|m4v)$/i.test(name) ? 0 : 1; // mp4 containers always first
  var base;
  if (format.indexOf('h.264') === 0 || format.indexOf('h264') === 0) base = 0;
  else if (f.source === 'original') base = 1;
  else if (name.indexOf('512kb') !== -1 || /\.ia\.mp4$/i.test(name)) base = 3;
  else base = 2;
  return mp4 * 10 + base;
}

/* archive.org/download/<id>/<file> answers 302 -> a dn*.archive.org node.
 * Resolve it here with a 2-byte ranged request and hand the player the
 * direct CDN URL. Falls back to the plain download URL on failure. */
function _resolveDirect(dlUrl) {
  return fetch(dlUrl, {
    headers: { 'User-Agent': _UA, 'Range': 'bytes=0-1' }
  }).then(function (r) {
    return (r && r.url) ? r.url : dlUrl;
  }, function () { return dlUrl; });
}

function getVideoSources(episodeUrl) {
  var identifier = _idOf(episodeUrl);
  if (!identifier) return Promise.reject(new Error('bad url: ' + episodeUrl));
  return _metadata(identifier).then(function (d) {
    var files = (d || {}).files || [];
    var vids = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = f.name || '';
      if (!_VID_EXT.test(name)) continue;
      vids.push({ name: name, rank: _fileRank(f), size: parseInt(f.size || '0', 10) || 0 });
    }
    if (!vids.length) throw new Error('no video files for ' + identifier);
    vids.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.size - a.size;
    });
    var jobs = [];
    var n = Math.min(vids.length, 3);
    for (var j = 0; j < n; j++) {
      (function (v) {
        var q = _guessQuality(v.name);
        var dlUrl = _SITE + '/download/' + identifier + '/' +
          encodeURIComponent(v.name).replace(/%2F/g, '/');
        jobs.push(_resolveDirect(dlUrl).then(function (directUrl) {
          var src = { url: directUrl, label: 'Orphaned Films' };
          if (/\.(mp4|m4v)$/i.test(v.name)) src.container = 'mp4';
          if (q) src.quality = q;
          return src;
        }));
      })(vids[j]);
    }
    return Promise.all(jobs);
  });
}
