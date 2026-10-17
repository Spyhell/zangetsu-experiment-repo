// MonosChinos — anime sub-español source for the Zangetsu provider repo (monoschinos.st).
//
// Chain (all plain GET, no login):
//   /buscar?q=<q>                    -> card-wrap cards (anime link, data-src cover, alt title)
//   /                                 -> home: "Últimos capítulos" (/ver/ episode cards)
//                                        + "Series recientes" (/anime/ cards)
//   /anime/<slug>                   -> title / og:image / meta description
//                                        + data-ajax=".../ajax/ajax_pagination/<id>"
//   /ajax/ajax_pagination/<id>      -> JSON {eps:[{num}...]} (ALL episode numbers)
//   /ver/<slug>-episodio-<n>        -> episode page: data-player="<base64>" attrs
//                                        -> base64 decode -> embed URLs
//                                        (ok.ru, mp4upload, doodstream, uqload, voe,
//                                         vembed, streamwish, filemoon, yourupload)
//   getVideoSources returns the ok.ru + mp4upload embed URLs; the app's
//   extractVideo resolves those two hosts (others are listed as fallback labels
//   only when no extractable host exists).
//
// Notes:
// - Episode URLs are constructed from the ep-1 URL found on the anime page;
//   the ajax_pagination JSON gives the complete, gap-free episode list.
// - Spanish hardcoded subs -> kind 'sub'.
// - Verified 2026-10-17: naruto-shippuden ep1 -> 5 embeds incl. ok.ru + mp4upload.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — pure-JS base64 below.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'monoschinos';

var SITE = 'https://monoschinos.st';
var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var REF = SITE + '/';

// ── Network ──────────────────────────────────────────────────────────────────
function _get(url, ref, timeoutMs) {
  var headers = { 'User-Agent': UA, 'Referer': ref || REF,
                  'X-Requested-With': 'XMLHttpRequest' };
  var p = fetch(url, { headers: headers }).then(function (r) {
    if (!r.ok) throw new Error('MonosChinos: HTTP ' + r.status + ' ' + url);
    return String((r && r.body) || '');
  });
  return _raceTimeout(p, timeoutMs || 12000, 'MonosChinos: timeout ' + url);
}
// Rejects if p does not settle in ms. No-op if the runtime lacks timers.
function _raceTimeout(p, ms, msg) {
  if (typeof setTimeout !== 'function') return p;
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error(msg)); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); },
           function (e) { clearTimeout(t); reject(e); });
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function _dec(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
}
function _cleanTitle(t) {
  return _dec(t || '').replace(/\s+/g, ' ').trim();
}
function _ogImg(html) {
  var m = String(html || '').match(
    /<meta\s+property="og:image"\s+content="([^"]*)"/i);
  return m ? _dec(m[1]) : null;
}
function _metaDesc(html) {
  var m = String(html || '').match(
    /<meta\s+name="description"\s+content="([^"]*)"/i);
  return m ? _dec(m[1]) : null;
}

/* Pure-JS base64 decoder (standard + URL-safe alphabets, padding optional). */
function _b64decode(input) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var lookup = {};
  for (var i = 0; i < alphabet.length; i++) lookup[alphabet.charAt(i)] = i;
  lookup['-'] = 62; lookup['_'] = 63;
  var str = String(input || '').replace(/=+$/, '');
  var out = '';
  var buffer = 0, bits = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charAt(j);
    if (!(c in lookup)) continue;
    buffer = (buffer << 6) | lookup[c];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

// ── Card parsing (search + "Series recientes" share the card-wrap markup) ────
function _parseAnimeCards(html) {
  var out = [], seen = {}, m;
  var re = /<a\s+href="(https:\/\/monoschinos\.st\/anime\/[a-z0-9-]+\/?)"[^>]*class="card-wrap[^"]*"[\s\S]{0,1200}?<img[^>]*?(?:data-src="(https?:\/\/[^"]+)"|src="(https?:\/\/[^"]+)")[^>]*?alt="([^"]{1,160})"/gi;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (seen[m[1]]) continue;
    seen[m[1]] = 1;
    var cover = _dec(m[2] || m[3] || '');
    if (/\/img\/anime\.png$/.test(cover)) cover = '';
    out.push({ id: m[1], title: _cleanTitle(m[4]), url: m[1], type: 'anime',
               cover: cover || undefined });
  }
  return out;
}

// "Últimos capítulos": cards link to /ver/<anime-ep>-episodio-<n>; rebuild the
// /anime/ URL so home items open the detail screen.
function _parseLatestEps(html) {
  var out = [], seen = {}, m;
  var re = /<a\s+href="(https:\/\/monoschinos\.st\/ver\/([a-z0-9-]+)-episodio-([0-9]{1,4})\/?)"[^>]*class="card-wrap[^"]*"[\s\S]{0,1200}?<img[^>]*?src="(https?:\/\/[^"]+)"[^>]*?alt="([^"]{1,160})"/gi;
  while ((m = re.exec(String(html || ''))) !== null) {
    var animeUrl = SITE + '/anime/' + m[2] + '-sub-espanol';
    if (seen[animeUrl]) continue;
    seen[animeUrl] = 1;
    var title = _cleanTitle(m[5]).replace(/\s+capitulo\s+\d+\s*$/i, '').trim();
    out.push({ id: animeUrl, title: title || _cleanTitle(m[2].replace(/-/g, ' ')),
               url: animeUrl, type: 'anime', cover: _dec(m[4]) || undefined });
  }
  return out;
}

// ── Detail / episodes ────────────────────────────────────────────────────────
function _parseDetail(html, url) {
  var t = String(html || '');
  var m = t.match(/<title>([^<]{1,160})<\/title>/i);
  var title = m ? _cleanTitle(m[1])
    .replace(/\s+Sub Espa.nol Online\s*-\s*MonosChinos\s*$/i, '').trim()
    : _cleanTitle(url.split('/').filter(Boolean).pop().replace(/-/g, ' '));
  var d = { id: url, title: title || 'MonosChinos', url: url, type: 'anime' };
  var cover = _ogImg(t);
  if (cover) d.cover = cover;
  var desc = _metaDesc(t);
  if (desc) d.description = desc;
  return d;
}
function _ajaxId(html) {
  var m = String(html || '').match(/data-ajax="https:\/\/monoschinos\.st\/ajax\/ajax_pagination\/(\d+)"/);
  return m ? m[1] : null;
}
function _ep1Url(html) {
  var m = String(html || '').match(/href="(https:\/\/monoschinos\.st\/ver\/[a-z0-9-]+-episodio-1\/?)"/);
  return m ? m[1] : null;
}
function _episodesForAnime(animeUrl) {
  return _get(animeUrl, null, 15000).then(function (html) {
    var id = _ajaxId(html);
    if (!id) throw new Error('MonosChinos: no episode index on ' + animeUrl);
    return _get(SITE + '/ajax/ajax_pagination/' + id, animeUrl, 15000)
      .then(function (body) {
        var j;
        try { j = JSON.parse(body); } catch (e) {
          throw new Error('MonosChinos: bad episode JSON');
        }
        var nums = (j.eps || []).map(function (e) { return e.num; })
          .filter(function (n) { return typeof n === 'number' && n > 0; })
          .sort(function (a, b) { return a - b; });
        if (!nums.length) throw new Error('MonosChinos: empty episode list');
        var ep1 = _ep1Url(html);
        if (!ep1) throw new Error('MonosChinos: no ep-1 URL to build from');
        var base = ep1.replace(/-episodio-1\/?$/, '-episodio-');
        return nums.map(function (n) {
          var url = base + n;
          return { id: url, title: 'Episodio ' + n, url: url, number: n };
        });
      });
  });
}

// ── Video sources ────────────────────────────────────────────────────────────
// Extractable by the app's extractVideo: ok.ru, mp4upload. The rest are
// plain embeds the app cannot resolve server-side — include them only as a
// labeled last resort (the player may still open some via WebView).
var EXTRACTABLE = [
  [/ok\.ru/i, 'Okru'], [/mp4upload\.com/i, 'Mp4Upload']
];
function _hostLabel(url) {
  for (var i = 0; i < EXTRACTABLE.length; i++) {
    if (EXTRACTABLE[i][0].test(url)) return EXTRACTABLE[i][1];
  }
  var m = String(url).match(/^https?:\/\/(?:www\.)?([^\/]+)/i);
  return m ? m[1] : 'Embed';
}
function _decodePlayers(html) {
  var out = [], seen = {}, m;
  var re = /data-player="([A-Za-z0-9+\/=]{20,})"/g;
  while ((m = re.exec(String(html || ''))) !== null) {
    var url = _b64decode(m[1]).trim();
    if (!/^https?:\/\//i.test(url) || seen[url]) continue;
    seen[url] = 1;
    out.push(url);
  }
  return out;
}

// ── Contract ─────────────────────────────────────────────────────────────────
function getInfo() {
  return {
    name: 'MonosChinos', lang: 'es', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0'
  };
}
function getHome(opts) {
  return _get(SITE + '/', null, 15000).then(function (html) {
    var rows = [];
    var latest = _parseLatestEps(html);
    if (latest.length) rows.push({ title: 'Últimos capítulos', items: latest });
    var recent = _parseAnimeCards(html);
    if (recent.length) rows.push({ title: 'Series recientes', items: recent });
    return rows;
  });
}
function search(query, page, opts) {
  var q = encodeURIComponent(String(query || '').trim());
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/buscar?q=' + q, null, 15000).then(_parseAnimeCards);
}
function getDetail(url, opts) {
  if (!/^https:\/\/monoschinos\.st\/anime\//i.test(String(url || ''))) {
    return Promise.reject(new Error('MonosChinos: bad detail URL'));
  }
  return _get(url, null, 15000).then(function (html) { return _parseDetail(html, url); });
}
function getEpisodes(url, opts) {
  return _episodesForAnime(url);
}
function getVideoSources(episodeUrl) {
  return _get(episodeUrl, null, 15000).then(function (html) {
    var urls = _decodePlayers(html);
    if (!urls.length) throw new Error('MonosChinos: no players on episode page');
    var good = [], rest = [];
    urls.forEach(function (u) {
      var label = _hostLabel(u);
      var entry = { url: u, label: 'MonosChinos · ' + label, kind: 'sub' };
      if (/ok\.ru|mp4upload\.com/i.test(u)) good.push(entry);
      else rest.push(entry);
    });
    var list = good.concat(rest);
    if (!list.length) throw new Error('MonosChinos: no playable stream URLs');
    return list;
  });
}
