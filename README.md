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
| Anikage | Anime | 1.0.4 | Anime streaming. |
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
| AnimeSuge | Anime | 1.0.2 | Anime streaming with sub & dub, soft subtitles. |
| EZTV | Movie | 1.0.0 | TV series torrents, ranked by seeders. |
| AnimeTosho | Anime | 1.0.0 | Anime torrent index, magnet streams. |
| Hindi Dub | Anime | 1.0.0 | Hindi-dubbed anime movies & series. |
| AnimeX | Anime | 1.0.1 | Anime streaming from pp.animex.one. |
| BitSearch | Movie | 1.0.1 | Movie/series torrent search, ranked by seeders. |
| ThePirateBay | Movie | 1.0.1 | Movie/series torrents via TPB, ranked by seeders. |


New sources are added regularly. After a source updates, tap **Update** on it in the app's Sources screen.


## The manifest


`index.json` at the root lists the sources. When a source changes, bump its `version` in both the `.js` file and its `index.json` entry — installed users will see an update in the app.


## License


MIT.
