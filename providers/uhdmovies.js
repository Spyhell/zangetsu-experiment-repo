/*
 * UHDMovies — movies & TV shows in 4K/HDR, dual-audio Hindi-English.
 * Source site: uhdmovies.beauty (fallback uhdmovies.email).
 *
 * Chain (verified 2026-11-01): {base}/search/{q} -> article.gridlove-post ->
 * a[href*="/download-"] post page -> per-quality SID links on
 * en.thenaukriadda.in/?sid=... -> 4-step form/cookie flow (lp-land/_lp_http,
 * landing/_wp_http, landing/_wp_http2+token, dynamic s_343 cookie + href) ->
 * meta-refresh -> Driveleech/DriVeseed file page -> Instant Download /
 * Resume Cloud button -> direct mp4 (workers.dev / video-leech CDN).
 *
 * ES5 / QuickJS: var + function only, no arrows/template literals/let/const.
 * Every network call rejects with a message (never hangs): per-request
 * timeout via Promise.race when setTimeout exists, plus a global deadline
 * on the multi-hop resolver. Cookie jar is manual (the runtime fetch keeps
 * no session); response headers are read defensively like anv.js does.
 */
var SOURCE_ID = 'uhdmovies';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
var _DOMAINS = ['https://uhdmovies.beauty', 'https://uhdmovies.email'];
var _REQ_TIMEOUT = 12000;   /* per request */
var _RESOLVE_BUDGET = 20000;/* total for one getVideoSources call */
var _MAX_REDIRECTS = 5;

/* ---------------- settings ---------------- */
function getSettings() {
  return [
    {
      key: 'domain',
      label: 'Site domain',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto (recommended)' },
        { value: 'https://uhdmovies.beauty', label: 'uhdmovies.beauty' },
        { value: 'https://uhdmovies.email', label: 'uhdmovies.email' },
        { value: 'custom', label: 'Custom domain (set below)' }
      ]
    },
    {
      key: 'customDomain',
      label: 'Custom domain (https://..., used when Domain = Custom)',
      type: 'text',
      default: ''
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings[SOURCE_ID]) || {};
    var v = s[key];
    return (v === undefined || v === null || v === '') ? def : v;
  } catch (e) { return def; }
}

function _normBase(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

/* Ordered list of bases to try: configured choice first. */
function _baseList() {
  var d = _cfg('domain', 'auto');
  if (d === 'custom') {
    var c = _normBase(_cfg('customDomain', ''));
    if (c) return [c];
  } else if (d && d !== 'auto') {
    var b = _normBase(d);
    if (b) return [b];
  }
  return _DOMAINS.slice();
}
var _workingBase = null;
function _bases() {
  var list = _baseList();
  if (_workingBase && list.indexOf(_workingBase) >= 0) {
    return [_workingBase].concat(list.filter(function (x) { return x !== _workingBase; }));
  }
  return list;
}

/* ---------------- tiny utils ---------------- */
function _raceTimeout(p, ms, what) {
  try {
    if (typeof setTimeout !== 'function') return p;
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('UHDMovies: timed out (' + (what || 'request') + ')')); }, ms);
    })]);
  } catch (e) { return p; }
}

function _dec(s) {
  s = String(s || '');
  return s.replace(/&#0?38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function _strip(s) {
  return _dec(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function _abs(href, base) {
  href = String(href || '').trim(); base = String(base || '').replace(/\/+$/, '');
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href.charAt(0) === '/' && base) return base + href;
  return base ? base + '/' + href : href;
}

/* ---------------- cookie jar ---------------- */
function _newJar() { return { map: {}, count: 0 }; }
function _jarHead(jar) {
  var parts = [];
  for (var k in jar.map) parts.push(k + '=' + jar.map[k]);
  return parts.join('; ');
}
function _captureCookies(jar, res) {
  var raw = '';
  try {
    if (res && res.headers) {
      if (typeof res.headers.getSetCookie === 'function') {
        var arr = res.headers.getSetCookie();
        if (arr && arr.length) raw = arr.join('\n');
      }
      if (!raw && typeof res.headers.get === 'function') raw = res.headers.get('set-cookie') || '';
      else if (!raw && res.headers['set-cookie']) raw = String(res.headers['set-cookie']);
    }
  } catch (e) {}
  if (!raw) return;
  var lines = String(raw).split('\n');
  for (var i = 0; i < lines.length; i++) {
    var segs = lines[i].split(',');
    for (var j = 0; j < segs.length; j++) {
      var kv = segs[j].split(';')[0].split('=');
      var k = (kv[0] || '').trim();
      if (!k || /expires|path|domain|max-age|secure|httponly|samesite/i.test(k)) continue;
      jar.map[k] = kv.slice(1).join('=').trim();
    }
  }
}
function _headerGet(res, name) {
  try {
    if (res && res.headers) {
      if (typeof res.headers.get === 'function') return res.headers.get(name);
      var v = res.headers[String(name).toLowerCase()] || res.headers[name];
      if (v) return String(v);
    }
  } catch (e) {}
  return null;
}

/* ---------------- http ---------------- */
function _req(url, opts, jar, timeoutMs) {
  opts = opts || {};
  var hops = 0;
  function once(u) {
    var h = { 'User-Agent': _UA, 'Accept': 'text/html,application/xhtml+xml,application/json,*/*' };
    if (jar) { var ch = _jarHead(jar); if (ch) h['Cookie'] = ch; }
    if (opts.headers) { for (var k in opts.headers) h[k] = opts.headers[k]; }
    var init = { headers: h };
    if (opts.method) init.method = opts.method;
    if (opts.body !== undefined) init.body = opts.body;
    return _raceTimeout(fetch(u, init), timeoutMs || _REQ_TIMEOUT, u).then(function (r) {
      if (!r) throw new Error('UHDMovies: empty response for ' + u);
      if (jar) _captureCookies(jar, r);
      var loc = _headerGet(r, 'location');
      if (loc && r.status >= 300 && r.status < 400 && hops < _MAX_REDIRECTS) {
        hops++;
        return once(_abs(loc, u));
      }
      return r.text().then(function (t) { return { status: r.status, ok: !!r.ok, body: t, url: u }; });
    });
  }
  return once(url);
}
function _get(url, jar, headers, timeoutMs) {
  return _req(url, { headers: headers }, jar, timeoutMs);
}
function _postForm(url, params, referer, jar, timeoutMs) {
  var body = [];
  for (var k in params) body.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  var origin = String(url).replace(/^(https?:\/\/[^\/]+).*/, '$1');
  return _req(url, {
    method: 'POST',
    body: body.join('&'),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': referer || url,
      'Origin': origin,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1'
    }
  }, jar, timeoutMs);
}
function _multipart(params) {
  var b = '----uhd' + String(Math.floor(Math.random() * 1e12));
  var parts = [];
  for (var k in params) {
    parts.push('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + params[k] + '\r\n');
  }
  parts.push('--' + b + '--\r\n');
  return { body: parts.join(''), type: 'multipart/form-data; boundary=' + b };
}

/* ---------------- article parsing ---------------- */
function _slugFromPostUrl(u) {
  var m = String(u || '').match(/(\/download-[^?#]*\/?)/i);
  return m ? m[1].replace(/^\/+/, '') : null;
}
function _cleanTitle(raw) {
  var t = _strip(raw).replace(/^Download\s+/i, '');
  return t;
}
function _yearOf(s) {
  var m = String(s || '').match(/\((19|20)\d{2}\)/);
  return m ? m[0].replace(/[()]/g, '') : null;
}
function _audioOf(s) {
  s = String(s || '').toLowerCase();
  if (/dual[\s-]?audio/.test(s) || (/hindi/.test(s) && /english/.test(s))) return 'Hindi-English';
  if (/hindi/.test(s)) return 'Hindi';
  if (/english/.test(s)) return 'English';
  return null;
}
function _articles(html, base) {
  var out = [], seen = {};
  var blocks = String(html || '').match(/<article[\s\S]*?<\/article>/gi) || [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var am = b.match(/<a[^>]*href="([^"]*\/download-[^"]*)"[^>]*>/i);
    if (!am) continue;
    var slug = _slugFromPostUrl(am[1]);
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;
    var tm = am[0].match(/title="([^"]*)"/i);
    var title = tm ? _cleanTitle(tm[1]) : '';
    if (!title) {
      var hm = b.match(/<h1[^>]*class="[^"]*sanket[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
               b.match(/class="entry-title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
      if (hm) title = _cleanTitle(hm[1]);
    }
    if (!title) continue;
    var im = b.match(/<img[^>]*?(?:data-src|src)="([^"]+)"/i);
    var cover = (im && !/^data:/i.test(im[1])) ? _abs(im[1], base) : null;
    out.push({
      id: 'uhdmovies://post/' + slug,
      title: title,
      url: 'uhdmovies://post/' + slug,
      type: 'movie',
      cover: cover,
      year: _yearOf(title)
    });
  }
  return out;
}

/* ---------------- post page parsing ---------------- */
function _postMeta(html, base, slug) {
  var m = String(html || '').match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  var title = m ? _cleanTitle(m[1]) : _cleanTitle(slug.replace(/-/g, ' '));
  var om = String(html || '').match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  var cover = om ? _abs(om[1], base) : null;
  var desc = '';
  var pm = String(html || '').match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (pm) {
    var paras = pm[1].match(/<p>([\s\S]*?)<\/p>/gi) || [];
    for (var i = 0; i < paras.length && desc.length < 400; i++) {
      var t = _strip(paras[i]);
      if (t.length > 40 && t.indexOf('thenaukriadda') < 0) { desc = t.slice(0, 400); break; }
    }
  }
  var season = null, isSeries = false;
  var sm = title.match(/[Ss]eason\s*(\d+)/);
  if (sm) { isSeries = true; season = parseInt(sm[1], 10); }
  return { title: title, cover: cover, description: desc || null,
           year: _yearOf(title), audio: _audioOf(title), isSeries: isSeries, season: season };
}

/* SID download links: {base}/... post pages carry one SID link per quality
 * inside <p>/<h2..h4> blocks; the anchor text IS the quality label. */
function _sidLinks(html) {
  var out = [], seen = {};
  var blocks = String(html || '').match(/<(p|h2|h3|h4)[^>]*>[\s\S]*?<\/\1>/gi) || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].indexOf('thenaukriadda.in') < 0) continue;
    var re = /<a[^>]*href="(https?:\/\/en\.thenaukriadda\.in\/\?sid=[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(blocks[i])) !== null) {
      var sid = m[1];
      if (seen[sid]) continue;
      seen[sid] = 1;
      var label = _strip(m[2]);
      if (!label) continue;
      out.push({ sid: sid, label: label });
    }
  }
  return out;
}

function _qualityOf(label) {
  var l = String(label || '');
  var qm = l.match(/(2160p|1080p|720p|480p|360p)/i);
  var q = qm ? qm[1].toLowerCase() : (/4k/i.test(l) ? '2160p' : (/3d/i.test(l) ? '3d' : '1080p'));
  var tags = [];
  if (/4k/i.test(l)) tags.push('4K');
  if (/hdr/i.test(l)) tags.push('HDR');
  if (/dovi|dolby.?vision/i.test(l)) tags.push('DoVi');
  if (/10.?bit/i.test(l)) tags.push('10bit');
  if (/hevc|x265/i.test(l)) tags.push('HEVC');
  else if (/x264/i.test(l)) tags.push('x264');
  if (/60\s?fps/i.test(l)) tags.push('60FPS');
  if (/remux/i.test(l)) tags.push('REMUX');
  if (/bluray|blu-ray|bd/i.test(l)) tags.push('BluRay');
  else if (/web[-\s]?dl/i.test(l)) tags.push('WEB-DL');
  var full = q.toUpperCase() + (tags.length ? ' ' + tags.join(' ') : '');
  return { quality: q === '3d' ? '1080p' : q, full: full };
}

/* ---------------- SID resolution (en.thenaukriadda.in) ----------------
 * Flow B (current, verified 2026-11-02):
 *   Step 0: GET ?sid= -> form#lp-land (_lp_http)
 *   Step 1: POST _lp_http -> form#lp-s1-form (_lp_http2,_lp_token,_lp_chain,_lp_hop_index)
 *   Step 2: POST hop -> stage-2 page; script sets lp-btn-go href to ?lp_go=lp-<hex>
 *           and cookie lp-<hex>=<_lp_http2 value> via sc("lp-<hex>","<val>",60)
 *   Step 3: set cookie, GET ?lp_go=lp-<hex> -> "Please wait" + window.location.replace(<final>)
 * Flow A (legacy, kept as fallback): form#landing/_wp_http chain.
 */
function _formVal(html, formId, inputName) {
  var fm = String(html || '').match(new RegExp('<form[^>]*id="' + formId + '"[^>]*>([\\s\\S]*?)<\\/form>', 'i'));
  if (!fm) return null;
  var tag = String(html).match(new RegExp('<form[^>]*id="' + formId + '"[^>]*>', 'i'));
  var action = tag ? (tag[0].match(/action="([^"]*)"/i) || [])[1] : null;
  var im = fm[1].match(new RegExp('<input[^>]*name="' + inputName + '"[^>]*>', 'i'));
  var val = im ? (im[0].match(/value="([^"]*)"/i) || [])[1] : null;
  if (!action || val === undefined || val === null) return null;
  var out = { action: action };
  out[inputName] = val;
  return out;
}

function _lpS1Form(html) {
  var tag = String(html || '').match(/<form[^>]*id="lp-s1-form"[^>]*>/i);
  if (!tag) return null;
  var action = (tag[0].match(/action="([^"]*)"/i) || [])[1];
  var names = ['_lp_http2', '_lp_token', '_lp_chain', '_lp_hop_index'];
  var fields = {}, i, m, v;
  for (i = 0; i < names.length; i++) {
    m = String(html).match(new RegExp('<input[^>]*name="' + names[i] + '"[^>]*>', 'i'));
    v = m ? (m[0].match(/value="([^"]*)"/i) || [])[1] : null;
    if (v === null || v === undefined) return null;
    fields[names[i]] = v;
  }
  if (!action) return null;
  return { action: action, fields: fields };
}

function _resolveSid(sidUrl, jar, deadline) {
  function over() { throw new Error('UHDMovies: SID resolution budget exceeded'); }
  var origin = sidUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1');
  // Flow B steps 2-3 (current shortener shape).
  function newFlow(s1) {
    return _postForm(_abs(s1.action, origin), s1.fields, origin + '/', jar).then(function (r2) {
      if (Date.now() > deadline) over();
      var html = String(r2.body || '');
      var go = html.match(/lp_go=(lp-[a-f0-9]+)/i);
      var sc = html.match(/sc\("(lp-[a-f0-9]+)"\s*,\s*"([^"]+)"/);
      if (!go || !sc) throw new Error('UHDMovies: SID stage-2 changed');
      jar.map[sc[1]] = sc[2];
      return _get(origin + '/?lp_go=' + go[1], jar, { 'Referer': s1.action });
    }).then(function (r3) {
      if (Date.now() > deadline) over();
      var html = String(r3.body || '');
      var m = html.match(/window\.location\.replace\("([^"]+)"\)/);
      if (!m) throw new Error('UHDMovies: no SID final redirect');
      return _abs(m[1].replace(/\\\//g, '/'), origin);
    });
  }
  return _get(sidUrl, jar, { 'Referer': origin + '/' }).then(function (r0) {
    if (Date.now() > deadline) over();
    var f0 = _formVal(r0.body, 'lp-land', '_lp_http');
    if (f0) {
      var p = {}; p['_lp_http'] = f0['_lp_http'];
      return _postForm(_abs(f0.action, origin), p, sidUrl, jar).then(function (r) { return r.body; });
    }
    /* legacy shape: form#landing carries _wp_http directly */
    var g0 = _formVal(r0.body, 'landing', '_wp_http');
    if (g0) return r0.body;
    throw new Error('UHDMovies: SID landing form changed (step 0)');
  }).then(function (h1) {
    if (Date.now() > deadline) over();
    var s1 = _lpS1Form(h1);
    if (s1) return newFlow(s1);
    var f1 = _formVal(h1, 'landing', '_wp_http');
    if (!f1) throw new Error('UHDMovies: SID form changed (step 1)');
    var p = {}; p['_wp_http'] = f1['_wp_http'];
    return _postForm(_abs(f1.action, origin), p, sidUrl, jar);
  }).then(function (r2) {
    // Flow B (new shortener) already resolved to the final URL string.
    if (typeof r2 === 'string') return r2;
    if (Date.now() > deadline) over();
    var tag = String(r2.body).match(/<form[^>]*id="landing"[^>]*>/i);
    var action = tag ? (tag[0].match(/action="([^"]*)"/i) || [])[1] : null;
    var w2 = _formVal(r2.body, 'landing', '_wp_http2') || {};
    var tm = String(r2.body).match(/<input[^>]*name="token"[^>]*>/i);
    var tok = tm ? (tm[0].match(/value="([^"]*)"/i) || [])[1] : '';
    if (!action) throw new Error('UHDMovies: SID form changed (step 2)');
    return _postForm(_abs(action, origin), { '_wp_http2': w2['_wp_http2'] || '', 'token': tok || '' }, sidUrl, jar);
  }).then(function (r3) {
    if (typeof r3 === 'string') return r3;
    if (Date.now() > deadline) over();
    var cm = String(r3.body).match(/s_343\('([^']+)',\s*'([^']+)'\)/);
    var lm = String(r3.body).match(/c\.setAttribute\("href",\s*"([^"]+)"\)/);
    if (!cm || !lm) throw new Error('UHDMovies: SID dynamic link changed (step 3)');
    jar.map[cm[1].trim()] = cm[2].trim();
    return _get(_abs(lm[1].trim(), origin), jar, { 'Referer': sidUrl });
  }).then(function (r4) {
    if (typeof r4 === 'string') return r4;
    var mm = String(r4.body).match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*>/i);
    var uu = mm ? mm[0].match(/url=([^"'\s>]+)/i) : null;
    if (!uu || !uu[1]) throw new Error('UHDMovies: no driveleech redirect in SID meta refresh');
    return _abs(uu[1].replace(/["']/g, ''), origin);
  });
}

/* ---------------- Driveleech / DriVeseed file page ----------------
 * GET redirect -> window.location.replace(...) -> file page with buttons:
 * Instant Download (direct CDN href, or ?url= -> POST <origin>/api x-token),
 * Resume Cloud / Cloud Resume Download (GET -> .btn-success href),
 * Resume Worker Bot (GET -> token/id script -> POST /download?id=),
 * Direct Links (GET ?type=1 -> .btn-success hrefs). */
function _anchors(html) {
  var out = [];
  var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var t = _strip(m[2]);
    if (t) out.push({ href: m[1], text: t });
  }
  return out;
}
function _isDirectCdn(u) {
  return /workers\.dev|\.r2\.dev|cdn\.video-leech\.pro/i.test(u) ||
    (/^https?:/i.test(u) && u.indexOf('?url=') < 0 && u.indexOf('/d/') < 0);
}
function _fixSpaces(u) {
  if (/workers\.dev|\.r2\.dev/i.test(u)) {
    var parts = u.split('/');
    parts[parts.length - 1] = parts[parts.length - 1].replace(/ /g, '%20');
    return parts.join('/');
  }
  return u;
}

function _resolveDriveleech(dlUrl, jar, deadline) {
  function over() { throw new Error('UHDMovies: driveleech resolution budget exceeded'); }
  var pageOrigin = dlUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1');
  return _get(dlUrl, jar, { 'Referer': pageOrigin + '/' }).then(function (r) {
    var html = r.body, hops = 0, m;
    while (hops < _MAX_REDIRECTS && (m = html.match(/window\.location\.replace\("([^"]+)"\)/))) {
      if (Date.now() > deadline) over();
      hops++;
      var next = _abs(m[1], pageOrigin);
      pageOrigin = next.replace(/^(https?:\/\/[^\/]+).*/, '$1');
      return _get(next, jar).then(function (r2) { html = r2.body; return step(html); });
    }
    return step(html);
    function step(h) { return _buttons(h); }
  });

  function _buttons(h) {
    var anchors = _anchors(h);
    var instant = null, cloud = null, worker = null, direct = null;
    for (var i = 0; i < anchors.length; i++) {
      var t = anchors[i].text;
      if (!instant && /instant download/i.test(t)) instant = anchors[i];
      else if (!cloud && /resume cloud|cloud resume download/i.test(t)) cloud = anchors[i];
      else if (!worker && /resume worker bot/i.test(t)) worker = anchors[i];
      else if (!direct && /direct links/i.test(t)) direct = anchors[i];
    }
    var chain = Promise.resolve(null);
    if (instant) chain = chain.then(function (v) { return v || _instant(instant.href); });
    if (cloud) chain = chain.then(function (v) { return v || _cloud(cloud.href); });
    if (worker) chain = chain.then(function (v) { return v || _workerBot(worker.href); });
    if (direct) chain = chain.then(function (v) { return v || _directLinks(direct.href); });
    chain = chain.then(function (v) { return v || _lastResort(h); });
    return chain;
  }

  function _instant(href) {
    if (Date.now() > deadline) return over();
    if (_isDirectCdn(href)) return Promise.resolve(_fixSpaces(href));
    var um = href.match(/[?&]url=([^&]+)/);
    if (!um) return Promise.resolve(_isDirectCdn(href) ? href : null);
    var keys = decodeURIComponent(um[1]);
    var api = _abs('/api', href.replace(/^(https?:\/\/[^\/]+).*/, '$1'));
    var host = href.replace(/^(https?:\/\/[^\/]+).*/, '$1').replace(/^https?:\/\//, '');
    var mp = _multipart({ keys: keys });
    return _req(api, { method: 'POST', body: mp.body,
      headers: { 'Content-Type': mp.type, 'x-token': host, 'Referer': dlUrl } }, jar
    ).then(function (r) {
      try {
        var j = JSON.parse(r.body);
        if (j && j.url) return _fixSpaces(j.url);
      } catch (e) {}
      return null;
    }, function () { return null; });
  }

  function _cloud(href) {
    if (Date.now() > deadline) return over();
    if (/^https?:/i.test(href) && /workers\.dev/i.test(href)) return Promise.resolve(_fixSpaces(href));
    return _get(_abs(href, pageOrigin), jar, { 'Referer': dlUrl }).then(function (r) {
      var m = r.body.match(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"/i) ||
              r.body.match(/<a[^>]*href="([^"]*workers\.dev[^"]*)"[^>]*>/i);
      return m ? _fixSpaces(m[1]) : null;
    }, function () { return null; });
  }

  function _workerBot(href) {
    if (Date.now() > deadline) return over();
    var wurl = _abs(href, pageOrigin);
    return _get(wurl, jar, { 'Referer': dlUrl }).then(function (r) {
      var scripts = r.body.match(/<script[\s\S]*?<\/script>/gi) || [];
      var target = null;
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].indexOf("formData.append('token'") >= 0) { target = scripts[i]; break; }
      }
      if (!target) return null;
      var tm = target.match(/formData\.append\('token',\s*'([^']+)'\)/);
      var im = target.match(/fetch\('\/download\?id=([^']+)'/);
      if (!tm || !im) return null;
      var api = pageOrigin + '/download?id=' + im[1];
      var mp = _multipart({ token: tm[1] });
      return _req(api, { method: 'POST', body: mp.body,
        headers: { 'Content-Type': mp.type, 'x-requested-with': 'XMLHttpRequest', 'Referer': wurl } }, jar
      ).then(function (r2) {
        try { var j = JSON.parse(r2.body); if (j && j.url) return j.url; } catch (e) {}
        return null;
      }, function () { return null; });
    }, function () { return null; });
  }

  function _directLinks(href) {
    if (Date.now() > deadline) return over();
    var u = _abs(href, pageOrigin);
    u += (u.indexOf('?') >= 0 ? '&' : '?') + 'type=1';
    return _get(u, jar, { 'Referer': dlUrl }).then(function (r) {
      var re = /<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="(https?:[^"]+)"/gi;
      var m, first = null;
      while ((m = re.exec(r.body)) !== null) { if (!first) first = m[1]; }
      return first;
    }, function () { return null; });
  }

  function _lastResort(h) {
    var re = /<a[^>]*href="([^"]*(?:workers\.dev|workerseed|driveleech\.net\/d\/|driveseed\.org\/d\/)[^"]*)"[^>]*>/gi;
    var m = re.exec(h);
    return Promise.resolve(m ? _fixSpaces(m[1]) : null);
  }
}

/* Verify the final URL actually serves video bytes (Range GET). */
function _validateStream(url, deadline) {
  if (!/^https?:/i.test(url || '')) return Promise.resolve(false);
  return _req(url, { headers: { 'Range': 'bytes=0-1' } }, null, 10000).then(function (r) {
    var ct = _headerGet(r, 'content-type') || '';
    if (r.status === 206) return true;
    if (r.status === 200 && /video|mp4|octet-stream/i.test(ct)) return true;
    if (r.status === 200 && /\.mp4(\?|$)/i.test(url)) return true;
    return false;
  }, function () { return false; });
}

/* ---------------- public API ---------------- */
function getInfo() {
  return {
    name: 'UHDMovies',
    lang: 'en',
    baseUrl: _baseList()[0],
    logo: _baseList()[0] + '/favicon.ico',
    type: 'movie',
    version: '1.0.1'
  };
}

function _fetchWithBases(path) {
  var bases = _bases(), lastErr = null;
  function attempt(i) {
    if (i >= bases.length) return Promise.reject(lastErr || new Error('UHDMovies: all domains unreachable'));
    var url = bases[i] + path;
    return _get(url, null, { 'Referer': bases[i] + '/' }).then(function (r) {
      if (!r.ok || !r.body || r.body.length < 500) {
        lastErr = new Error('UHDMovies: HTTP ' + r.status + ' from ' + bases[i]);
        return attempt(i + 1);
      }
      _workingBase = bases[i];
      return { base: bases[i], body: r.body };
    }, function (e) { lastErr = e; return attempt(i + 1); });
  }
  return attempt(0);
}

function getHome(opts) {
  return _fetchWithBases('/').then(function (r1) {
    var rows = [{ title: 'Latest Movies & Shows', items: _articles(r1.body, r1.base) }];
    return _fetchWithBases('/4k-movies/').then(function (r2) {
      var k = _articles(r2.body, r2.base);
      if (k.length) rows.push({ title: '4K Movies', items: k });
      return rows;
    }, function () { return rows; });
  });
}

function search(query, page, opts) {
  query = String(query || '').trim();
  if (!query) return Promise.resolve([]);
  return _fetchWithBases('/search/' + encodeURIComponent(query)).then(function (r) {
    var items = _articles(r.body, r.base);
    if (!items.length) {
      /* fallback: any /download- link on the page */
      var re = /<a[^>]*href="([^"]*\/download-[^"]*)"[^>]*(?:title="([^"]*)")?[^>]*>/gi;
      var m, seen = {};
      while ((m = re.exec(r.body)) !== null) {
        var slug = _slugFromPostUrl(m[1]);
        if (!slug || seen[slug]) continue;
        seen[slug] = 1;
        var t = m[2] ? _cleanTitle(m[2]) : _cleanTitle(slug.replace(/-/g, ' '));
        items.push({ id: 'uhdmovies://post/' + slug, title: t, url: 'uhdmovies://post/' + slug,
                     type: 'movie', year: _yearOf(t) });
        if (items.length >= 24) break;
      }
    }
    return items;
  });
}

function _slugFromOpaque(url) {
  var m = String(url || '').match(/^uhdmovies:\/\/(?:post|ep)\/(.+)$/);
  if (!m) throw new Error('UHDMovies: bad url ' + url);
  return m[1].replace(/^\/+/, '');
}

function getDetail(url, opts) {
  var slug = _slugFromOpaque(url);
  return _fetchWithBases('/' + slug).then(function (r) {
    var meta = _postMeta(r.body, r.base, slug);
    return {
      id: 'uhdmovies://post/' + slug,
      title: meta.title,
      url: 'uhdmovies://post/' + slug,
      type: 'movie',
      cover: meta.cover,
      description: meta.description,
      year: meta.year
    };
  });
}

function getEpisodes(url, opts) {
  var slug = _slugFromOpaque(url);
  return _fetchWithBases('/' + slug).then(function (r) {
    var meta = _postMeta(r.body, r.base, slug);
    if (meta.isSeries) {
      var sn = meta.season || 1;
      return [{ id: 'uhdmovies://ep/' + slug, title: 'Season ' + sn + ' Complete Pack',
                 url: 'uhdmovies://ep/' + slug, number: 1 }];
    }
    return [{ id: 'uhdmovies://ep/' + slug, title: 'Movie', url: 'uhdmovies://ep/' + slug, number: 1 }];
  });
}

function getVideoSources(episodeUrl) {
  var slug = _slugFromOpaque(episodeUrl);
  var deadline = Date.now() + _RESOLVE_BUDGET;
  return _fetchWithBases('/' + slug).then(function (r) {
    var meta = _postMeta(r.body, r.base, slug);
    var links = _sidLinks(r.body).slice(0, 5);
    if (!links.length) throw new Error('UHDMovies: no download links found on post page (site layout may have changed)');
    var audio = meta.audio || 'Hindi-English';
    var out = [], lastErr = null, i = 0;
    function next() {
      if (i >= links.length || out.length >= 3) return Promise.resolve();
      if (Date.now() > deadline) return Promise.resolve();
      var L = links[i++];
      var q = _qualityOf(L.label);
      var jar = _newJar();
      return _resolveSid(L.sid, jar, deadline).then(function (dl) {
        return _resolveDriveleech(dl, jar, deadline);
      }).then(function (mp4) {
        if (!mp4) throw new Error('empty stream url');
        return _validateStream(mp4, deadline).then(function (ok) {
          if (!ok) throw new Error('stream validation failed (no video bytes)');
          out.push({
            url: mp4,
            quality: q.quality,
            label: audio + ' ' + q.full,
            container: 'mp4',
            headers: { 'User-Agent': _UA, 'Referer': mp4.replace(/^(https?:\/\/[^\/]+).*/, '$1') + '/' }
          });
        });
      }).then(next, function (e) { lastErr = e; return next(); });
    }
    return next().then(function () {
      if (!out.length) {
        throw new Error('UHDMovies: no playable stream resolved' +
          (lastErr ? ' — last error: ' + lastErr.message : '') +
          ' (the SID shortener needs plain HTTP POSTs; if this VM blocks them the phone app still works)');
      }
      return out;
    });
  });
}
