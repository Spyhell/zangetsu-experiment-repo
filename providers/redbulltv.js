/*
 * Red Bull TV — free global streaming: films, documentaries, shows & clips
 * (extreme sports, biking, surfing, F1, dance, adventure). No login, no geo
 * block (verified from VM + en_IN locale for India).
 *
 * VERIFIED chain (2026-10-22, plain HTTP, no crypto, no browser):
 *   GET https://www.redbull.tv/en_IN/  -> SSR flight JSON, 13 collections
 *        (Films & Documentaries, Shows, Biking films and shows, Replays, ...)
 *        cards carry detail_page_id, title, descriptions, year, duration,
 *        media_resources (cover art). Escapes are \\" -> normalized to ".
 *   GET https://www.redbull.tv/en_IN/page/<detail_page_id>
 *        -> product {title, long_description, year, content_type, ...} (200,
 *        works with and without the slug; show pages list episode rails).
 *   Show page rails -> episode cards {episode_number (real number),
 *        id: rrn:content:episode-videos:<uuid>, title, duration}.
 *   Manifest: https://play.redbull.com/main/v1/rbtv/en/in/personal_computer/
 *        http/<rrn>.m3u8?device_group=group_5
 *        -> 200 application/vnd.apple.mpegurl, multivariant (240p..4K, HEVC +
 *        AVC fallbacks) + 6 subtitle tracks (de, pt, es, fr, ...).
 *   Variant playlist -> 200; segment range request -> 206 Partial Content
 *        (Akamai). Byte-verified.
 *
 * Search strategy: client-side filter over the home-page catalog (~150
 * curated films/shows/clips). No server-side search API exists (search page
 * is a client-side shell; dms.redbull.tv exposes no public content paths).
 * ES5 only.
 */

var _RB_SITE = 'https://www.redbull.tv';
var _RB_LOCALE = 'en_IN';
var _RB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var _RB_PLAY = 'https://play.redbull.com/main/v1/rbtv/en/in/personal_computer/http/';
var _RB_IMG_T = 'f_avif,c_fill,w_640,q_70';

function getInfo() {
  return {
    name: 'Red Bull TV', lang: 'en', baseUrl: _RB_SITE,
    logo: _RB_SITE + '/favicon.ico', type: 'movie', version: '1.0.0'
  };
}

function _raceTimeout(promise, ms) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) { t = setTimeout(function () { resolve(null); }, ms); });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}

function _fetchText(url) {
  return _raceTimeout(fetch(url, {
    headers: { 'User-Agent': _RB_UA, 'Accept-Language': 'en-US,en;q=0.9' }
  }).then(function (r) {
    if (!r || !r.ok) throw new Error('RedBullTV: HTTP ' + (r && r.status) + ' for ' + url);
    return r.text();
  }), 20000).then(function (t) {
    if (t == null) throw new Error('RedBullTV: timeout for ' + url);
    return t;
  });
}

/* The SSR flight payload double-escapes quotes as \\" — normalize to ". */
function _norm(html) {
  return String(html || '').split('\\"').join('"');
}

/* Extract every {"cards":[...],...} object via brace matching. */
function _cardBlocks(norm) {
  var out = [];
  var re = /\{"cards":\[/g;
  var m;
  while ((m = re.exec(norm)) !== null) {
    var start = m.index;
    var depth = 0, instr = false, esc = false, end = -1;
    var lim = Math.min(norm.length, start + 400000);
    for (var i = start; i < lim; i++) {
      var c = norm.charAt(i);
      if (instr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') instr = false;
      } else {
        if (c === '"') instr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
    }
    if (end > 0) {
      try { out.push(JSON.parse(norm.slice(start, end))); }
      catch (e) { /* skip malformed block */ }
    }
  }
  return out;
}

/* Extract a single top-level JSON object value: "key":{...} */
function _objForKey(norm, key) {
  var re = new RegExp('"' + key + '":\\{');
  var m = re.exec(norm);
  if (!m) return null;
  var start = m.index + key.length + 3;
  var depth = 0, instr = false, esc = false, end = -1;
  var lim = Math.min(norm.length, start + 200000);
  for (var i = start; i < lim; i++) {
    var c = norm.charAt(i);
    if (instr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') instr = false;
    } else {
      if (c === '"') instr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
  }
  if (end <= 0) return null;
  try { return JSON.parse(norm.slice(start, end)); }
  catch (e) { return null; }
}

function _imgUrl(tpl) {
  var u = String(tpl || '');
  if (!u) return null;
  return u.split('{im}').join(_RB_IMG_T);
}

function _coverOf(card, detailId) {
  var mr = (card && card.media_resources) || {};
  var art = mr.rbtv_display_art_landscape || mr.rbtv_background_landscape ||
            mr.rbtv_display_art_portrait || mr.rbtv_cover_art_portrait;
  if (art && art.url) return _imgUrl(art.url);
  if (detailId) {
    return 'https://resources.redbull.tv/' + detailId +
      '/rbtv_display_art_landscape/' + _RB_IMG_T + '?namespace=rbtv&refresh=true';
  }
  return null;
}

function _kindOf(detailId) {
  var d = String(detailId || '');
  if (d.indexOf('content:films:') !== -1) return 'film';
  if (d.indexOf('content:shows:') !== -1) return 'show';
  if (d.indexOf('content:videos:') !== -1) return 'clip';
  if (d.indexOf('content:episode-videos:') !== -1) return 'episode';
  return 'video';
}

/* Playable RRN for a detail id (films/clips/episodes strip the page: prefix). */
function _playRrn(detailId) {
  var d = String(detailId || '');
  if (d.indexOf('page:') === 0) d = d.slice(5);
  return d;
}

function _yearStr(v) {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function _cardItem(card) {
  var detailId = card.detail_page_id || card.id;
  if (!detailId) return null;
  var kind = _kindOf(detailId);
  if (kind !== 'film' && kind !== 'show' && kind !== 'clip' && kind !== 'episode') return null;
  var title = card.title || 'Untitled';
  var uuid = detailId.replace(/^page:/, '');
  var desc = card.short_description || card.long_description || '';
  return {
    id: 'rbtv-' + kind + '-' + uuid.replace(/[^a-z0-9-]/gi, ''),
    title: String(title),
    url: 'rbtv://' + detailId,
    type: 'movie',
    cover: _coverOf(card, detailId),
    year: _yearStr(card.year),
    _kind: kind,
    _detailId: detailId,
    _desc: String(desc)
  };
}

function _dedup(items) {
  var seen = {}, out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || seen[it.url]) continue;
    seen[it.url] = true;
    out.push(it);
  }
  return out;
}

function _homeCards() {
  return _fetchText(_RB_SITE + '/' + _RB_LOCALE).then(function (html) {
    var norm = _norm(html);
    var blocks = _cardBlocks(norm);
    var rows = [];
    var all = [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      var label = blk.label;
      var cards = blk.cards || [];
      if (!label || !cards.length) continue;
      if (/browse by interest/i.test(label)) continue;
      var items = [];
      for (var i = 0; i < cards.length; i++) {
        var it = _cardItem(cards[i]);
        if (it) { items.push(it); all.push(it); }
      }
      items = _dedup(items);
      if (items.length >= 3) rows.push({ title: String(label).replace(/^\s+|\s+$/g, ''), items: items });
    }
    return { rows: rows, all: _dedup(all) };
  });
}

function getHome(opts) {
  return _homeCards().then(function (h) { return h.rows; });
}

function search(query, page, opts) {
  var q = String(query || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  if (!q) return Promise.resolve([]);
  return _homeCards().then(function (h) {
    var out = [];
    for (var i = 0; i < h.all.length; i++) {
      var it = h.all[i];
      var hay = (it.title + ' ' + (it._desc || '')).toLowerCase();
      if (hay.indexOf(q) !== -1) {
        out.push({ id: it.id, title: it.title, url: it.url, type: it.type, cover: it.cover, year: it.year });
      }
    }
    return out.slice(0, 40);
  });
}

function _parseDetailId(url) {
  var m = /^rbtv:\/\/(.+)$/.exec(String(url || ''));
  return m ? m[1] : null;
}

function _episodeOf(detailId, card, num) {
  return {
    id: 'rbtv-ep-' + String(detailId).replace(/[^a-z0-9-]/gi, ''),
    title: card && card.title ? String(card.title) : ('Episode ' + num),
    url: 'rbtv://play/' + _playRrn(detailId),
    number: num
  };
}

function getDetail(url, opts) {
  var detailId = _parseDetailId(url);
  if (!detailId) return Promise.reject(new Error('RedBullTV: bad url'));
  var kind = _kindOf(detailId);
  return _fetchText(_RB_SITE + '/' + _RB_LOCALE + '/page/' + detailId).then(function (html) {
    var norm = _norm(html);
    var prod = _objForKey(norm, 'product') || {};
    var title = prod.title || 'Untitled';
    var desc = prod.long_description || prod.short_description || null;
    var cover = _coverOf(prod, detailId);
    var item = {
      id: 'rbtv-' + kind + '-' + String(detailId).replace(/[^a-z0-9-]/gi, ''),
      title: String(title),
      url: url,
      type: 'movie',
      cover: cover,
      description: desc ? String(desc) : null,
      year: _yearStr(prod.year)
    };
    if (kind === 'show') {
      var blocks = _cardBlocks(norm);
      var eps = [];
      for (var b = 0; b < blocks.length; b++) {
        var cards = blocks[b].cards || [];
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          if (!c || c.content_type !== 'episode') continue;
          var eid = c.detail_page_id || c.id;
          if (!eid) continue;
          var n = (typeof c.episode_number === 'number') ? c.episode_number : (eps.length + 1);
          eps.push({
            id: 'rbtv-ep-' + String(eid).replace(/[^a-z0-9-]/gi, ''),
            title: c.title ? String(c.title) : ('Episode ' + n),
            url: 'rbtv://play/' + _playRrn(eid),
            number: n
          });
        }
      }
      eps.sort(function (a, b) { return a.number - b.number; });
      item.episodes = eps;
    } else {
      item.episodes = [_episodeOf(detailId, prod, 1)];
    }
    return item;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function _qualityOf(h) {
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 900) return '1080p';
  if (h >= 650) return '720p';
  if (h >= 450) return '480p';
  if (h >= 300) return '360p';
  return '240p';
}

function _expandRb(master, body) {
  var lines = String(body || '').split('\n');
  var subs = [];
  var i, m, uri;
  for (i = 0; i < lines.length; i++) {
    var mm = /#EXT-X-MEDIA:TYPE=SUBTITLES[^\n]*?LANGUAGE="([^"]+)"[^\n]*?URI="([^"]+)"/.exec(lines[i]);
    if (mm && mm[2]) subs.push({ url: mm[2], lang: mm[1], label: mm[1] });
  }
  var out = [{
    url: master, quality: 'Auto', label: 'Auto',
    container: 'hls', kind: 'sub',
    subtitles: subs.length ? subs : undefined
  }];
  var seen = {};
  for (i = 0; i < lines.length; i++) {
    m = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
    if (!m) continue;
    uri = (lines[i + 1] || '').replace(/^\s+|\s+$/g, '');
    if (!uri || uri.charAt(0) === '#') continue;
    var q = _qualityOf(parseInt(m[2], 10));
    if (seen[q]) continue;
    seen[q] = true;
    out.push({ url: uri, quality: q, label: q, container: 'hls', kind: 'sub' });
  }
  return out;
}

function getVideoSources(episodeUrl) {
  var m = /^rbtv:\/\/play\/(rrn:content:[a-z-]+:[0-9a-f-]{36})$/.exec(String(episodeUrl || ''));
  if (!m) return Promise.resolve([]);
  var master = _RB_PLAY + encodeURIComponent(m[1]) + '.m3u8?device_group=group_5';
  return _fetchText(master).then(function (body) {
    if (!body || body.indexOf('#EXTM3U') === -1) throw new Error('RedBullTV: bad manifest');
    return _expandRb(master, body);
  }).catch(function () {
    return [{ url: master, quality: 'Auto', label: 'Auto', container: 'hls', kind: 'sub' }];
  });
}
