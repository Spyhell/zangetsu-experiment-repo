# spyhell-repo


Source repo for the [Zangetsu](https://github.com/Spyou/Zangetsu) app.


## How users install


1. Open the app
2. **Settings → Sources → Add repo**
3. Paste the manifest URL:
   ```
   https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/index.json
   ```
4. Tap **Install** next to the source you want


## Sources


| Source | Type | Version | Notes |
| --- | --- | --- | --- |
| Oppai Stream | Anime | 1.0.3 | Direct mp4/webm streams up to 4K. |
| Hanime | Anime | 1.0.1 | HLS streams 720p/480p/360p. |
| HentaiMama | Anime | 1.0.0 | HLS streams up to 1080p. |
| Anikage | Anime | 1.0.5 | Anime streaming. |
| HentaiTV | Anime | 1.0.0 | Anime streaming. |
| ToraStream | Movie | 1.0.3 | Movies & TV shows. |
| Internet Archive | Movie | 1.0.3 | Public-domain films from archive.org. |
| Filmzie | Movie | 1.0.3 | Free films. |
| PeerTube Films | Movie | 1.0.3 | Films from PeerTube instances. |
| Wikimedia Films | Movie | 1.0.3 | Films from Wikimedia Commons. |
| CineStream | Movie | 1.0.4 | Multi-source movies & shows; Hindi and English listed as separate streams. |
| TheNkiri | Movie | 1.0.0 | Movies & shows. |
| HentaiOcean | Anime | 1.0.0 | ENG SUB hentai, direct mp4 streams. |
| Live TV India | Movie | 1.0.0 | 700+ live Indian TV channels (News, Sports, Movies, Music, Kids). |
| World Live TV | Movie | 1.0.0 | Live TV: India + USA + UK (~2,500 channels). |
| Music Live TV | Movie | 1.0.0 | Live music TV channels worldwide. |
| SuperCartoons | Movie | 1.0.0 | Classic cartoons, direct mp4. |
| Nyaa Anime | Anime | 1.0.3 | Anime torrents from nyaa.si, ranked by seeders. |
| Kids Live TV | Movie | 1.0.0 | Live kids TV channels worldwide. |
| AnimeSuge | Anime | 1.0.3 | Anime streaming with sub & dub, soft subtitles. |
| EZTV | Movie | 1.0.0 | TV series torrents, ranked by seeders. |
| AnimeTosho | Anime | 1.0.0 | Anime torrent index, magnet streams. |
| Hindi Dub | Anime | 1.0.0 | Hindi-dubbed anime movies & series. |
| AnimeX | Anime | 1.0.1 | Anime streaming from pp.animex.one. |
| BitSearch | Movie | 1.0.0 | Movie/series torrent search, ranked by seeders. |
| ThePirateBay | Movie | 1.0.0 | Movie/series torrents via TPB, ranked by seeders. |
| ARTE TV | Movie | 1.0.0 | European documentaries, concerts & films from arte.tv (keyless, HLS). |
| Pluto TV | Movie | 1.0.0 | 400+ free linear channels: movies, comedy, kids, news, sports. |
| NetMirror | Movie | 1.0.1 | Movies & TV series, OTT-platform rows (Netflix, Prime Video, Crunchyroll), 360p-1080p MP4 + subtitles. |
| VidFast | Movie | 1.0.1 | Movies & TV series via multi-server HLS resolver (TMDB-keyed), subtitles. |
| KissKH | Anime | 1.0.0 | Asian dramas & movies with EN subtitles, direct MP4 streams. |
| DesiDub Anime | Anime | 1.0.0 | Hindi/Tamil/Telugu dubbed anime, HLS streams via VidMoly. |
| Orphaned Films | Movie | 1.0.2 | Curated public-domain & forgotten films (Film Noir, Silent, Sci-Fi/Horror, VHS Vault), direct archive.org MP4. |
| ToonStream | Anime | 1.0.0 | Anime, movies & cartoons (incl. Hindi/Tamil/Telugu dubs), HLS via VidMoly. |
| AniKoto | Anime | 1.0.3 | Anime streaming with sub & dub, HLS + subtitles. |
| AnimeGG | Anime | 1.0.0 | Anime with sub & dub as separate streams, direct MP4 up to 1080p. |
| Classic Cartoons | Anime | 1.0.0 | Public-domain classic cartoon shorts (Popeye, Betty Boop), direct MP4 from archive.org. |
| Classic TV Vault | Movie | 1.0.0 | Public-domain vintage TV serials (Dragnet, Lone Ranger, Sherlock Holmes), direct MP4 from archive.org. |
| Sports Live TV | Movie | 1.0.0 | ~450 live sports channels worldwide (football, ESPN/beIN, outdoor sports), direct HLS. |
| Movies Live TV | Movie | 1.0.0 | ~790 live 24/7 movie channels (action, comedy, classic, family, series), direct HLS. |
| Cooking Live TV | Movie | 1.0.0 | ~59 live 24/7 cooking & food channels (BBC Food, bon appetit, America's Test Kitchen), direct HLS. |
| Education Live TV | Movie | 1.0.0 | ~214 live 24/7 education channels (documentaries, kids learning, science, culture), direct HLS. |
| TG Cloud | Movie | 2.1.2 | Stream Telegram files via your own pencarimovie-server (set Server URL + Password in settings). Works like Nuvio. |



New sources are added regularly. After a source updates, tap **Update** on it in the app's Sources screen.


## The manifest


`index.json` at the root lists the sources. When a source changes, bump its `version` in both the `.js` file and its `index.json` entry — installed users will see an update in the app.


## License


MIT.

| News Live TV | Movie | 1.0.0 | ~1,000 live news channels worldwide (BBC, CNN, Sky, Al Jazeera, NDTV), direct HLS. |
| Documentary Live TV | Movie | 1.0.0 | ~250 live documentary channels (nature, science, docuseries, culture), direct HLS. |
| YTS | Movie | 1.0.0 | Curated movie torrents (magnet links, quality/size/seeds), played by the app's torrent engine. |
| Archive Anime | Anime | 1.0.0 | ~37k anime from the Internet Archive collection, direct mp4, per-episode files. |
| VidZee | Movie | 1.0.0 | Movies & TV shows via VidZee's direct stream API (multi-server, no login), direct HLS. |
| Entertainment Live TV | Movie | 1.0.0 | ~900 live entertainment channels worldwide (Zee, Colors, Sony, reality, variety), direct HLS. |
| SubsPlease | Anime | 1.0.0 | Current-season English-subbed anime, torrent magnets in 480p/720p/1080p, played by the app's torrent engine. |
| Series Live TV | Movie | 1.0.0 | ~500 live 24/7 TV-series channels worldwide (drama, comedy, classic), direct HLS. |
| MoviesDa | Movie | 1.0.0 | Tamil/Telugu/Malayalam/Kannada + Hindi-dubbed movies, direct signed mp4 per quality (480p/720p/1080p). |
| Animation Live TV | Movie | 1.0.0 | ~160 live cartoon & anime channels (Animax, Anime Vision, Cartoon Network), direct HLS. |
| Odysee | Movie | 1.0.0 | Movies, series & anime from Odysee's public API — trending/new releases, direct mp4, no login. |
| Comedy Live TV | Movie | 1.0.0 | ~215 live 24/7 comedy channels worldwide (stand-up, sitcoms), direct HLS. |
| NASA Video Library | Movie | 1.0.0 | NASA's public video library — Mars, Apollo, ISS, Artemis footage, direct mp4 (360p–Original) + English captions, no login. |
| Travel Live TV | Movie | 1.0.0 | ~60 live 24/7 travel channels worldwide (destinations, beaches, adventure), direct HLS. |
| 9Anime | Anime | 1.0.0 | English sub + dub anime, HLS (Auto/1080p/720p/480p) with multi-language subtitles. |
| VidSpark | Movie | 1.0.0 | Movies & TV shows via TMDB catalog, direct HLS (Auto/1080p/720p), no login. |
| WcoFlix | Anime | 1.0.0 | Cartoons + anime (sub & dub), direct mp4 (1080p/720p/480p), no login. |
| DonghuaNation | Anime | 1.0.3 | Donghua (Chinese anime), HLS up to 4K with 20 subtitle languages incl. Hindi & English, no login. Latest ~23 episodes per ongoing series (site limit); full runs for movies/short series. |
| Anv | Anime | 1.0.3 | Anime sub + dub, direct HLS (Auto/720p) with English subtitles via the site API, no login. |
| Jkanime | Anime | 1.0.0 | Anime sub-español, direct HLS (Auto) via the site's own UM player, no login. |
| MonosChinos | Anime | 1.0.0 | Anime sub-español, multi-server embeds (Okru/Mp4Upload extracted by the app), no login. |
| HindiAnime | Anime | 1.0.0 | Hindi/Tamil/Telugu dubbed anime, signed HLS (Auto) via VidMoly embeds, no login. |
| MMani | Anime | 1.0.0 | Anime BD/WEB releases, English subbed HLS (720p/1080p) with English subtitles, no login. |
| NekoSama | Anime | 1.0.0 | French VF/VOSTFR anime, signed HLS (Auto + quality variants) via ansembed embeds, no login. |
| AV1Please | Anime | 1.0.3 | Tiny AV1 encodes (sub + dual audio), direct file + DASH streams via the site API, no login. |
