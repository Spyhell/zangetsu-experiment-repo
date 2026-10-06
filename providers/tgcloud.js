function getInfo() {
  return {
    name: 'TG Cloud',
    lang: 'en',
    baseUrl: 'https://t.me',
    type: 'movie',
    version: '1.0.0'
  };
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings.tgcloud) || {};
    var v = s[key];
    return (v === undefined || v === null || v === '') ? def : v;
  } catch (e) {
    return def;
  }
}

function _serverUrl() {
  var u = _cfg('serverUrl', '');
  if (!u) return '';
  return String(u).replace(/\/+$/, '');
}

function _get(url) {
  return fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Zangetsu/1.0', 'Accept': 'application/json' }
  }).then(function (r) {
    if (!r.ok) throw new Error('server returned HTTP ' + r.status);
    return r.json();
  });
}

function _toItem(f) {
  var title = f.title || f.file_name || ('File ' + f.id);
  var isSeries = /S\d{1,2}E\d{1,2}/i.test(title) || /\bepisode\s*\d+/i.test(title);
  return {
    id: String(f.id),
    title: title,
    url: 'tgcloud://file/' + encodeURIComponent(String(f.id)),
    type: isSeries ? 'anime' : 'movie',
    cover: f.thumb || f.thumbnail_url || undefined
  };
}

function getHome(opts) {
  var base = _serverUrl();
  if (!base) return [{ title: 'Setup required', items: [] }];
  return _get(base + '/api/trending').then(function (d) {
    var results = (d && d.results) || [];
    return [{ title: 'Recent Files', items: results.map(_toItem) }];
  }).catch(function () {
    return [{ title: 'Recent Files', items: [] }];
  });
}

function search(query, page, opts) {
  var base = _serverUrl();
  if (!base) throw new Error('TG Cloud: add your server URL in settings first.');
  return _get(base + '/api/search?q=' + encodeURIComponent(query)).then(function (d) {
    var results = (d && d.results) || [];
    return results.map(_toItem);
  });
}

function getDetail(url, opts) {
  var base = _serverUrl();
  if (!base) throw new Error('TG Cloud: add your server URL in settings first.');
  var id = decodeURIComponent(String(url).replace('tgcloud://file/', ''));
  return _get(base + '/api/file/' + encodeURIComponent(id)).then(function (f) {
    var item = _toItem(f);
    return {
      id: item.id,
      title: item.title,
      url: url,
      type: item.type,
      cover: item.cover,
      description: f.caption || '',
      episodes: [{
        id: item.id,
        title: item.title,
        url: 'tgcloud://play/' + encodeURIComponent(item.id),
        number: 1
      }]
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

function getVideoSources(episodeUrl) {
  var base = _serverUrl();
  if (!base) throw new Error('TG Cloud: add your server URL in settings first.');
  var id = decodeURIComponent(String(episodeUrl).replace('tgcloud://play/', ''));
  var streamUrl = base + '/api/stream/' + encodeURIComponent(id);
  return _get(base + '/api/file/' + encodeURIComponent(id)).then(function (f) {
    var label = f.title || f.file_name || 'TG Cloud';
    var quality = '720p';
    var m = /(\d{3,4})p/i.exec(label);
    if (m) quality = m[1] + 'p';
    else if (/2160|4k/i.test(label)) quality = '2160p';
    else if (/1080/i.test(label)) quality = '1080p';
    else if (/480/i.test(label)) quality = '480p';
    return [{ url: streamUrl, quality: quality, label: label, container: 'mp4' }];
  }).catch(function () {
    return [{ url: streamUrl, quality: '720p', label: 'TG Cloud', container: 'mp4' }];
  });
}
