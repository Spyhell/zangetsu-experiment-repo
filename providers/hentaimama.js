// HentaiMama provider for the Zangetsu app.
// Site: https://hentaimama.io (DooPlay-based WordPress).
// Episode pages lazy-load their mirrors through
//   POST /wp-admin/admin-ajax.php  action=get_player_contents&a=<postId>&i=<mirror#>
// each mirror returns an iframe to /?dt_embed=hls&p=<b64>&ep=<postId>,
// whose JWPlayer page carries the direct HLS master URL ("file").
// ES5 only.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'hentaimama';

var SITE = 'https://hentaimama.io';
var UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var AJAX = SITE + '/wp-admin/admin-ajax.php';

function _get(url, ref) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  return fetch(url, { headers: h }).then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}

function _postForm(url, body, ref) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Referer': ref || SITE + '/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: body
  }).then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}

// Decode HTML entities: &#123; &#x1F; &amp; &quot; &lt; &gt; &#039; &nbsp;
function _decode(s) {
  s = String(s == null ? '' : s);
  s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
    try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; }
  });
  s = s.replace(/&#(\d+);/g, function (m, d) {
    try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; }
  });
  s = s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  return s;
}

function _abs(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) return u.split(' ').join('%20');
  if (u.indexOf('//') === 0) return ('https:' + u).split(' ').join('%20');
  if (u.charAt(0) === '/') return (SITE + u).split(' ').join('%20');
  return (SITE + '/' + u).split(' ').join('%20');
}

function _text(html) {
  try { return _decode(htmlText(html)).replace(/\s+/g, ' ').trim(); }
  catch (e) { return _decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
}

function _meta(html, prop) {
  var m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + prop + '"[^>]+content="([^"]+)"', 'i')) ||
    html.match(new RegExp('<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="' + prop + '"', 'i'));
  return m ? _decode(m[1]) : null;
}

function _item(id, title, url, cover) {
  return { id: id, title: title, url: url, cover: cover || null, type: 'anime', sourceId: SOURCE_ID };
}

// Parse one <article class="item"> series card (home rows).
function _parseItemCard(card) {
  var a = card.match(/<a[^>]+href="([^"]+)"[^>]*>/i);
  var img = card.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  var t = card.match(/<h3[^>]*class="title"[^>]*>([\s\S]*?)<\/h3>/i) ||
    (img && img[0].match(/alt="([^"]*)"/i));
  var url = a && _abs(a[1]);
  if (!url) return null;
  var title = _text(t ? t[1] : '');
  if (!title) return null;
  var cover = img ? _abs(img[1]) : null;
  return _item(url, title, url, cover);
}

// Parse one <article class="series-card"> search result.
function _parseSeriesCard(card) {
  var a = card.match(/<a[^>]+class="sc-poster"[^>]+href="([^"]+)"/i) ||
    card.match(/<a[^>]+href="(https?:\/\/[^"]+\/tvshows\/[^"]+)"[^>]*>/i);
  var img = card.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  var t = card.match(/<h3[^>]*class="sc-title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
  var url = a && _abs(a[1]);
  if (!url) return null;
  var title = _text(t ? t[1] : (img ? (img[0].match(/alt="([^"]*)"/i) || [])[1] || '' : ''));
  if (!title) return null;
  return _item(url, title, url, img ? _abs(img[1]) : null);
}

// Parse one dt-pop-item card (home "recently added" / "popular" rows).
// Recently-added cards are <div data-href="EPISODE_URL">; popular cards are
// <a href="SERIES_URL">. getDetail() resolves episode URLs to the series.
function _parsePopCard(card) {
  var outer = (String(card).match(/^<(div|a)[^>]*>/i) || [])[0] || '';
  var href = outer.match(/(?:data-href|href)="([^"]+)"/i) ||
    card.match(/data-href="([^"]+)"/i) ||
    card.match(/<a[^>]+class="dt-pop-title"[^>]+href="([^"]+)"/i);
  var img = card.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  var t = card.match(/<[^>]+class="dt-pop-title"[^>]*>([\s\S]*?)<\/(?:a|span)>/i);
  var url = href && _abs(href[1]);
  if (!url) return null;
  var title = _text(t ? t[1] : (img ? (img[0].match(/alt="([^"]*)"/i) || [])[1] || '' : ''));
  if (!title) return null;
  return _item(url, title, url, img ? _abs(img[1]) : null);
}

function getInfo() {
  return {
    name: 'HentaiMama', lang: 'en', baseUrl: SITE,
    logo: SITE + '/wp-content/themes/dooplay/assets/img/large-logo.png?v=2',
    type: 'anime', version: '1.0.0'
  };
}

function search(query, page, opts) {
  var p = parseInt(page, 10) || 1;
  var url = SITE + (p > 1 ? '/page/' + p + '/' : '/') + '?s=' + encodeURIComponent(query || '');
  return _get(url).then(function (html) {
    var out = [], re = /<article[^>]+class="series-card"[^>]*>([\s\S]*?)<\/article>/gi, m;
    while ((m = re.exec(html)) !== null) {
      try { var it = _parseSeriesCard(m[1]); if (it) out.push(it); } catch (e) {}
    }
    return out;
  });
}

function _parseHomeRow(html, headingRe, parser) {
  // Split the page into dt-pop rows by their headings, then take the named one.
  var rows = String(html).split(/<div[^>]+class="dt-pop-head"[^>]*>/i);
  for (var i = 1; i < rows.length; i++) {
    var head = (rows[i].match(/<span[^>]+class="dt-pop-heading"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '';
    if (!headingRe.test(_text(head))) continue;
    var out = [], re = /<(div|a)[^>]+class="[^"]*dt-pop-item[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi, m;
    while ((m = re.exec(rows[i])) !== null) {
      try { var it = parser(m[0]); if (it) out.push(it); } catch (e) {}
      if (out.length >= 24) break;
    }
    return out;
  }
  return [];
}

function getHome(opts) {
  return _get(SITE + '/').then(function (html) {
    var rows = [];
    // Row 1: latest series cards.
    var latest = [], re = /<article[^>]+class="item"[^>]*>([\s\S]*?)<\/article>/gi, m;
    while ((m = re.exec(html)) !== null) {
      try { var it = _parseItemCard(m[1]); if (it) latest.push(it); } catch (e) {}
      if (latest.length >= 24) break;
    }
    if (latest.length) rows.push({ title: 'Latest Series', items: latest });
    // Row 2/3: recently added + popular episode rows.
    var added = _parseHomeRow(html, /recently added/i, _parsePopCard);
    if (added.length) rows.push({ title: 'Recently Added', items: added });
    var pop = _parseHomeRow(html, /popular/i, _parsePopCard);
    if (pop.length) rows.push({ title: 'Popular', items: pop });
    return rows;
  });
}

// Resolve an episode-page URL to its parent series URL (via the "Episodes list" link).
function _resolveSeriesUrl(url) {
  if (url.indexOf('/episodes/') === -1) return Promise.resolve(url);
  return _get(url).then(function (html) {
    var m = html.match(/<a[^>]+href="([^"]+)"[^>]+aria-label="Episodes list"/i) ||
      html.match(/<a[^>]+aria-label="Episodes list"[^>]+href="([^"]+)"/i);
    var series = m && _abs(m[1]);
    return series || url;
  });
}

function _parseDetail(html, url) {
  var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  var title = _text(h1 ? h1[1] : '') || _meta(html, 'og:title') || 'Unknown';
  var cover = _abs(_meta(html, 'og:image'));
  var dsc = html.match(/<div[^>]+class="dsc-desc"[^>]*>([\s\S]*?)<\/div>/i);
  var description = dsc ? _text(dsc[1]) : (_meta(html, 'og:description') || _meta(html, 'description'));
  var genres = [], gre = /<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]+rel="tag"[^>]*>([^<]+)<\/a>/gi, gm;
  while ((gm = gre.exec(html)) !== null) {
    var g = _text(gm[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  var status = null;
  var sm = (_meta(html, 'og:description') || '').match(/(Completed|Ongoing)/i);
  if (sm) status = sm[1].charAt(0).toUpperCase() + sm[1].slice(1).toLowerCase();

  var episodes = [], ere = /<a[^>]+class="dt-se-item"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, em;
  while ((em = ere.exec(html)) !== null) {
    try {
      var epUrl = _abs(em[1]);
      if (!epUrl) continue;
      var numM = em[2].match(/<b[^>]+class="dt-se-num"[^>]*>([^<]*)<\/b>/i);
      var titleM = em[2].match(/<b[^>]+class="dt-se-title"[^>]*>([^<]*)<\/b>/i);
      var numTxt = _text(numM ? numM[1] : '');
      var num = parseInt((numTxt.match(/(\d+)/) || [])[1] || '0', 10) || episodes.length + 1;
      var epTitle = _text(titleM ? titleM[1] : '') || ('Episode ' + num);
      episodes.push({ id: epUrl, number: num, title: epTitle, url: epUrl });
    } catch (e) {}
  }
  if (!episodes.length) {
    // Single-video posts: fall back to the play button or the page itself.
    var play = html.match(/<a[^>]+class="dsc-play"[^>]+href="([^"]+)"/i);
    var one = play ? _abs(play[1]) : (url.indexOf('/episodes/') !== -1 ? url : null);
    if (one) episodes.push({ id: one, number: 1, title: title, url: one });
  }
  // Oldest episode first looks odd; site lists EP1..N in order already.
  return {
    id: url, title: title, url: url, cover: cover, description: description || null,
    status: status, genres: genres, studios: [], type: 'anime', sourceId: SOURCE_ID,
    episodes: episodes, subCount: episodes.length, dubCount: 0
  };
}

function getDetail(url, opts) {
  var u = String(url || '');
  return _resolveSeriesUrl(u).then(function (seriesUrl) {
    return _get(seriesUrl).then(function (html) {
      if (!html) throw new Error('HentaiMama: failed to load detail page');
      return _parseDetail(html, seriesUrl);
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

// ---- video extraction ----

function _mirrorNumbers(html) {
  var nums = [];
  var nav = (html.match(/<ul[^>]+class="[^"]*dt-mi-tabs[^"]*"[^>]*>([\s\S]*?)<\/ul>/i) || [])[1] || html;
  var re = /#option-(\d+)/gi, m;
  while ((m = re.exec(nav)) !== null) {
    var n = parseInt(m[1], 10);
    if (n && nums.indexOf(n) === -1) nums.push(n);
  }
  return nums.length ? nums : [1, 2, 3, 4];
}

// POST the mirror ajax; return the raw iframe html for mirror n ('' when empty).
function _mirrorIframe(postId, n, ref) {
  var body = 'action=get_player_contents&a=' + encodeURIComponent(postId) +
    '&i=' + encodeURIComponent(String(n));
  return _postForm(AJAX, body, ref).then(function (t) {
    var arr = null;
    try { arr = JSON.parse(t); } catch (e) { return ''; }
    if (!arr || !arr.length) return '';
    var item = arr[n - 1] || '';
    var m = String(item).match(/<iframe[\s\S]*?<\/iframe>/i) || String(item).match(/<iframe[^>]*>/i);
    return m ? m[0] : '';
  });
}

function _embedFileUrl(embedUrl, ref) {
  return _get(embedUrl, ref).then(function (html) {
    var m = html.match(/"file"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    if (!m) return '';
    return m[1].replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  });
}

function _resolveUrl(base, rel) {
  rel = String(rel || '').trim();
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel.split(' ').join('%20');
  if (rel.charAt(0) === '/') {
    var host = (base.match(/^(https?:\/\/[^/]+)/i) || [])[1] || '';
    return (host + rel).split(' ').join('%20');
  }
  var dir = base.slice(0, base.lastIndexOf('/') + 1);
  return (dir + rel).split(' ').join('%20');
}

// Parse a master m3u8 into [{quality, url}]; falls back to the master itself.
function _parseMaster(masterUrl, ref) {
  return _get(masterUrl, ref).then(function (body) {
    var out = [];
    var lines = String(body || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (ln.indexOf('#EXT-X-STREAM-INF') === 0) {
        var attrs = ln;
        var uri = (lines[i + 1] || '').trim();
        if (!uri || uri.charAt(0) === '#') continue;
        var q = null;
        var seg = (uri.split('?')[0].split('/').filter(function (s) { return s; }).pop() || '');
        var qm = (uri.match(/(\d{3,4})p/i) || [])[1];
        if (qm) q = qm + 'p';
        else {
          var rm = attrs.match(/RESOLUTION=\d+x(\d+)/i);
          if (rm) q = rm[1] + 'p';
        }
        out.push({ quality: q || 'Auto', url: _resolveUrl(masterUrl, uri) });
      }
    }
    if (!out.length && /#EXTM3U/i.test(String(body))) out.push({ quality: 'Auto', url: masterUrl });
    // Highest quality first.
    out.sort(function (a, b) {
      var qa = parseInt(a.quality, 10) || 0, qb = parseInt(b.quality, 10) || 0;
      return qb - qa;
    });
    return out;
  });
}

function getVideoSources(episodeUrl) {
  var epUrl = String(episodeUrl || '');
  if (epUrl.indexOf('http') !== 0) {
    return Promise.reject(new Error('HentaiMama: bad episode url'));
  }
  var headers = { 'User-Agent': UA, 'Referer': epUrl };
  return _get(epUrl).then(function (html) {
    if (!html) throw new Error('HentaiMama: failed to load episode page');
    var postId = ((html.match(/data-post-id="(\d+)"/) || [])[1]) ||
      ((html.match(/postid-(\d+)/) || [])[1]);
    if (!postId) throw new Error('HentaiMama: no post id on episode page');
    var nums = _mirrorNumbers(html);
    var rest = [];
    // Prefer mirrors whose tab label mentions hls; we only know numbers here,
    // so probe in page order and prefer dt_embed=hls iframes.
    var i = 0, iframe = '', embedKind = '';
    function next() {
      if (i >= nums.length) return Promise.resolve('');
      var n = nums[i++];
      return _mirrorIframe(postId, n, epUrl).then(function (fr) {
        if (!fr) return next();
        var srcM = fr.match(/src="([^"]+)"/i);
        var src = srcM ? srcM[1].replace(/&#0?38;/g, '&').replace(/&amp;/g, '&') : '';
        if (!src) return next();
        if (/dt_embed=hls/i.test(src)) { iframe = src; embedKind = 'hls'; return src; }
        rest.push(src);
        return next();
      });
    }
    return next().then(function () {
      var embedUrl = iframe || rest[0] || '';
      if (!embedUrl) throw new Error('HentaiMama: no playable mirror found');
      if (embedUrl.indexOf('http') !== 0) embedUrl = _abs(embedUrl);
      return _embedFileUrl(embedUrl, epUrl).then(function (fileUrl) {
        if (!fileUrl || fileUrl.indexOf('http') !== 0) {
          throw new Error('HentaiMama: no stream file in embed');
        }
        var isHls = /\.m3u8(\?|$)/i.test(fileUrl);
        var done = function (variants) {
          var out = [];
          for (var k = 0; k < variants.length; k++) {
            var v = variants[k];
            if (!v.url) continue;
            out.push({
              url: v.url, quality: v.quality, container: 'hls',
              headers: headers, kind: 'sub', audioLang: 'ja', subtitles: []
            });
          }
          if (!out.length) throw new Error('HentaiMama: no streams parsed');
          return out;
        };
        if (isHls) {
          return _parseMaster(fileUrl, epUrl).then(function (variants) {
            // Always keep the adaptive master as a fallback entry.
            var hasMaster = false, k;
            for (k = 0; k < variants.length; k++) {
              if (variants[k].url === fileUrl) hasMaster = true;
            }
            if (!hasMaster) variants.push({ quality: 'Auto', url: fileUrl });
            return done(variants);
          });
        }
        return done([{ quality: '720p', url: fileUrl.split(' ').join('%20') }]);
      });
    });
  });
}
