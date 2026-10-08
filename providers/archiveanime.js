// Archive Anime source for the Zangetsu app.
// Backend: the Internet Archive's public anime collection (user-uploaded
// anime rips, ~37k items), via the public advancedsearch + metadata APIs:
//   https://archive.org/advancedsearch.php?q=mediatype:movies+AND+collection:anime&...
//   https://archive.org/metadata/<identifier>
// Streams are direct mp4 downloads from archive.org (verified: HTTP 206
// partial content, real video/mp4 bytes). Items carry per-episode files
// (e.g. 'E01 - Rebirth.mp4') which become the episode list; items with a
// single file get one 'Watch' episode. Posters come from the archive.org
// item thumbnail service.
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'archiveanime';

var _SEARCH = 'https://archive.org/advancedsearch.php';
var _META = 'https://archive.org/metadata/';
var _DL = 'https://archive.org/download/';
var _Q = 'mediatype:movies AND collection:anime';

var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function getInfo() {
  return {
    name: 'Archive Anime', lang: 'en', baseUrl: 'https://archive.org',
    logo: 'https://archive.org/images/glogo.jpg',
    type: 'anime', version: '1.0.0'
  };
}

function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA } }).then(function (r) {
    if (!r.ok) throw new Error('Archive Anime: HTTP ' + r.status);
    return r.json();
  });
}

function _qstr(params) {
  var parts = [];
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  return parts.join('&');
}

// Query the anime collection; returns [{identifier,title,downloads}].
function _searchCollection(query, rows, sort) {
  var params = {
    q: _Q + (query ? ' AND title:(' + query + ')' : ''),
    'fl[]': 'identifier,title,downloads',
    rows: String(rows || 24), page: '1', output: 'json'
  };
  if (sort) params['sort[]'] = sort;
  return _get(_SEARCH + '?' + _qstr(params).replace(/%5B%5D/g, '[]')).then(function (j) {
    var docs = ((j.response || {}).docs) || [];
    var out = [];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (d.identifier && d.title) {
        out.push({ identifier: d.identifier, title: String(d.title), downloads: d.downloads || 0 });
      }
    }
    return out;
  });
}

// Strip Solr-reserved characters from a user query.
function _cleanQuery(q) {
  return String(q || '').replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _cover(id) { return 'https://archive.org/services/img/' + id; }

function _item(d) {
  var it = {
    id: 'aanime://item/' + d.identifier,
    title: d.title,
    url: 'aanime://item/' + d.identifier,
    type: 'anime',
    cover: _cover(d.identifier)
  };
  return it;
}

function getHome(opts) {
  var rows = [
    { title: 'Most Downloaded Anime', sort: 'downloads desc' },
    { title: 'Recently Added', sort: 'addeddate desc' },
    { title: 'Highest Rated', sort: 'avg_rating desc' }
  ];
  var out = [];
  var chain = Promise.resolve();
  rows.forEach(function (row) {
    chain = chain.then(function () {
      return _searchCollection('', 24, row.sort).then(function (docs) {
        var items = [];
        for (var i = 0; i < docs.length; i++) items.push(_item(docs[i]));
        if (items.length) out.push({ title: row.title, items: items });
      }).catch(function () {});
    });
  });
  return chain.then(function () {
    if (!out.length) throw new Error('Archive Anime: home catalog empty');
    return out;
  });
}

function search(query, page, opts) {
  var q = _cleanQuery(query);
  if (!q) return Promise.resolve([]);
  return _searchCollection(q, 30, 'downloads desc').then(function (docs) {
    var items = [];
    for (var i = 0; i < docs.length; i++) items.push(_item(docs[i]));
    return items;
  });
}

function _idFromUrl(url) {
  var m = String(url || '').match(/^aanime:\/\/item\/([A-Za-z0-9_\-\.]+)/);
  return m ? m[1] : null;
}

function _stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// Video files in metadata, best-effort mp4 filter.
function _mp4s(meta) {
  var files = (meta && meta.files) || [];
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var name = String(f.name || '');
    if (!/\.mp4$/i.test(name)) continue;
    var fmt = String(f.format || '');
    // Skip thumbnails/previews masquerading as mp4; keep real video.
    if (/thumb|preview|sprite/i.test(name)) continue;
    out.push({ name: name, format: fmt, height: f.height || 0, size: f.size || 0 });
  }
  return out;
}

function _epNum(name) {
  var m = String(name).match(/(?:^|[\s_\-\.\[\(])(?:e|ep|episode)[\s_\-\.]*(\d{1,3})/i);
  if (m) return parseInt(m[1], 10);
  m = String(name).match(/(?:^|[\s_\-\.])(?:s\d{1,2})?[eE](\d{1,3})(?:[\s_\-\.]|$)/);
  return m ? parseInt(m[1], 10) : 0;
}

function _fileTitle(name) {
  return String(name).replace(/\.mp4$/i, '').replace(/[_\.]+/g, ' ').trim();
}

function getDetail(url, opts) {
  var id = _idFromUrl(url);
  if (!id) return Promise.reject(new Error('Archive Anime: bad url'));
  return _get(_META + id).then(function (meta) {
    var md = meta.metadata || {};
    var files = _mp4s(meta);
    if (!files.length) throw new Error('Archive Anime: no playable files');
    var numbered = [];
    for (var i = 0; i < files.length; i++) {
      var n = _epNum(files[i].name);
      if (n > 0) numbered.push({ file: files[i], num: n });
    }
    var episodes = [];
    if (numbered.length >= 2) {
      // Series with per-episode files.
      numbered.sort(function (a, b) { return a.num - b.num; });
      var seen = {};
      for (var j = 0; j < numbered.length; j++) {
        if (seen[numbered[j].num]) continue;
        seen[numbered[j].num] = 1;
        episodes.push({
          id: 'aanime://watch/' + id + '/' + encodeURIComponent(numbered[j].file.name),
          title: _fileTitle(numbered[j].file.name),
          url: 'aanime://watch/' + id + '/' + encodeURIComponent(numbered[j].file.name),
          number: numbered[j].num
        });
      }
    } else {
      // Movie / single file (or ambiguous multi-file): one Watch episode.
      episodes.push({
        id: 'aanime://watch/' + id + '/' + encodeURIComponent(files[0].name),
        title: 'Watch', url: 'aanime://watch/' + id + '/' + encodeURIComponent(files[0].name),
        number: 1
      });
    }
    var title = _stripHtml(md.title) || id;
    var d = {
      id: 'aanime://item/' + id, title: title, url: 'aanime://item/' + id,
      type: 'anime', cover: _cover(id), episodes: episodes,
      description: _stripHtml(md.description || '').slice(0, 1500)
    };
    if (md.year) d.year = String(md.year);
    else if (md.date) d.year = String(md.date).slice(0, 4);
    return d;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl, opts) {
  var m = String(episodeUrl || '').match(/^aanime:\/\/watch\/([A-Za-z0-9_\-\.]+)\/(.+)$/);
  if (!m) return Promise.reject(new Error('Archive Anime: bad url'));
  var id = m[1];
  var fname = decodeURIComponent(m[2]);
  return _get(_META + id).then(function (meta) {
    var files = _mp4s(meta);
    if (!files.length) throw new Error('Archive Anime: no playable files');
    var target = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].name === fname) { target = files[i]; break; }
    }
    if (!target) target = files[0];
    var out = [];
    // If this episode has multiple quality files, list them all.
    var base = _fileTitle(target.name).replace(/\s*\d{3,4}p\s*/i, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    var related = [];
    for (var j = 0; j < files.length; j++) {
      var b2 = _fileTitle(files[j].name).replace(/\s*\d{3,4}p\s*/i, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (b2 === base) related.push(files[j]);
    }
    if (!related.length) related = [target];
    related.sort(function (a, b) { return (b.height || 0) - (a.height || 0); });
    for (var k = 0; k < related.length; k++) {
      var f = related[k];
      var h = f.height || 0;
      var qp = h ? (h + 'p') : '';
      var entry = {
        url: _DL + id + '/' + encodeURIComponent(f.name),
        container: 'mp4',
        label: 'MP4' + (qp ? ' ' + qp : '')
      };
      if (qp) entry.quality = qp;
      out.push(entry);
    }
    if (!out.length) throw new Error('Archive Anime: no playable streams');
    return out;
  });
}
