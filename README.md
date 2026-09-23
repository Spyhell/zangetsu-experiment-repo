# zangetsu-providers

Source repo for the [Zangetsu](https://github.com/Spyou/Zangetsu) app, containing the Oppai Stream, Hanime, HentaiMama and MovieBox providers.

## How users install

1. Open the app
2. **Settings → Sources → Add repo**
3. Paste the manifest URL:
   ```
   https://raw.githubusercontent.com/Spyhell/zangetsu-experiment-repo/main/index.json
   ```
4. Tap **Install** next to the source you want

## Sources

| Source | Type | Notes |
| --- | --- | --- |
| Oppai Stream | Anime | Hentai, direct mp4/webm streams up to 4K. |
| Hanime | Anime | HLS streams 720p/480p/360p. |
| HentaiMama | Anime | HLS streams up to 1080p. |
| MovieBox | Movie | Movies & TV shows, HLS streams with subtitles. |

## The manifest

`index.json` at the root lists the source. When the source changes, bump its `version` in both the `.js` file and its `index.json` entry — installed users will see an update in the app.

## License

MIT.
