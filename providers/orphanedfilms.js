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
    version: '1.0.1'
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

// Crisp movie posters for the curated highlights (Wikidata/Wikipedia, bundled 2026-10-01).
// Keyed by archive.org identifier; anything not listed falls back to the archive.org thumbnail.
const POSTERS = {
  '1950-in-a-lonely-place-en-un-lugar-solitario-nicholas-ray-vose': 'https://commons.wikimedia.org/wiki/Special:FilePath/In_a_Lonely_Place_%281950_poster%29.jpg?width=500',
  '1953thebigheatlossobornadosfritzlang': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Big_Heat_%281953_poster%29.jpg?width=500',
  '1955-the-night-of-the-hunter-la-noche-del-cazador-charles-laughton': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a5/The_Night_of_the_Hunter_%281955_poster%29.jpg/500px-The_Night_of_the_Hunter_%281955_poster%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  '1957-witness-for-the-prosecution-testigo-de-cargo-billy-wilder': 'https://upload.wikimedia.org/wikipedia/en/thumb/c/cf/Witness_for_the_Prosecution_%281957_film%29_poster.jpg/500px-Witness_for_the_Prosecution_%281957_film%29_poster.jpg',
  '1959-anatomy-of-a-murder-anatomia-de-un-asesinato-otto-preminger-vose': 'https://commons.wikimedia.org/wiki/Special:FilePath/AnatomyMurder2.jpg?width=500',
  'BattleshipPotemkin': 'https://commons.wikimedia.org/wiki/Special:FilePath/Vintage_Potemkin.jpg?width=500',
  'Cabiria': 'https://commons.wikimedia.org/wiki/Special:FilePath/Cabiria_Poster_Metlicovitz.jpg?width=500',
  'ChelovekskinoapparatomManWithAMovieCamera': 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Man_with_a_movie_camera_1929_2.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled',
  'DasKabinettdesDoktorCaligariTheCabinetofDrCaligari': 'https://commons.wikimedia.org/wiki/Special:FilePath/CABINETOFDRCALIGARI-poster.jpg?width=500',
  'DeepRed1975': 'https://upload.wikimedia.org/wikipedia/en/thumb/0/03/Profondo_Rosso_poster.jpg/500px-Profondo_Rosso_poster.jpg',
  'Double.Indemnity.1944.720p.BrRip.x265.HEVCBay.com.mkv': 'https://commons.wikimedia.org/wiki/Special:FilePath/Double_Indemnity_%281944_poster%29.jpg?width=500',
  'Dr.MabuseTheGamblerdr.MabuseDerSpieler1922Part1': 'https://commons.wikimedia.org/wiki/Special:FilePath/Dr._Mabuse%2C_der_Spieler.jpg?width=500',
  'Haxan_tinted_and_subtitled': 'https://upload.wikimedia.org/wikipedia/en/6/6c/Haxan_sv_poster.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled',
  'Intolerance': 'https://commons.wikimedia.org/wiki/Special:FilePath/Intolerance_%28film%29.jpg?width=500',
  'Little_ShopOf_Horrors.avi': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/The_Little_Shop_of_Horrors_%281960%29_-_Half-Sheet_poster.webp/500px-The_Little_Shop_of_Horrors_%281960%29_-_Half-Sheet_poster.webp?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'MyManGodfrey1936': 'https://commons.wikimedia.org/wiki/Special:FilePath/My_Man_Godfrey_%281936_poster_-_Style_C%29.jpg?width=500',
  'MyMovie_20190318': 'https://commons.wikimedia.org/wiki/Special:FilePath/Sherlock_jr_poster.jpg?width=500',
  'Night.Of.The.Living.Dead_1080p': 'https://upload.wikimedia.org/wikipedia/en/thumb/9/91/Night_of_the_Living_Dead_%281968%29_poster.jpg/500px-Night_of_the_Living_Dead_%281968%29_poster.jpg',
  'Nosferatu_most_complete_version_93_mins.': 'https://thumb.wikimedia.org/wikipedia/en/thumb/9/90/Nosferatu_poster_%28Albin_Grau%2C_1922%29_1.jpg/500px-Nosferatu_poster_%28Albin_Grau%2C_1922%29_1.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'OurHospitality_29': 'https://commons.wikimedia.org/wiki/Special:FilePath/Our_Hospitality_%281923%29_Poster.jpg?width=500',
  'ROBOCOPCC': 'https://upload.wikimedia.org/wikipedia/en/thumb/1/16/RoboCop_%281987%29_theatrical_poster.jpg/500px-RoboCop_%281987%29_theatrical_poster.jpg',
  'ScarletStreet': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5d/Edward_G._Robinson_and_Joan_Bennett_in_%27Scarlet_Street%27%2C_1946.jpg/500px-Edward_G._Robinson_and_Joan_Bennett_in_%27Scarlet_Street%27%2C_1946.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'SteamboatBillJr': 'https://commons.wikimedia.org/wiki/Special:FilePath/Steamboat_bill_poster.jpg?width=500',
  'SunsetBoulevard1950': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/Sunset_Boulevard_%281950_poster%29.jpg/500px-Sunset_Boulevard_%281950_poster%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'TheGolem_893': 'https://commons.wikimedia.org/wiki/Special:FilePath/Golem_1920_Poster.jpg?width=500',
  'ThePhantomCarriage': 'https://thumb.wikimedia.org/wikipedia/en/thumb/5/56/The_Phantom_Carriage_%281921%29_poster.jpg/500px-The_Phantom_Carriage_%281921%29_poster.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'ThePhantomoftheOpera': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/53/Phantom_of_the_opera_1925_poster.jpg/500px-Phantom_of_the_opera_1925_poster.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'The_General_Buster_Keaton': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/The_General_%281926%29_-_Movie_Poster_2.png/500px-The_General_%281926%29_-_Movie_Poster_2.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'ThiefOfBagdad1924': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Thief_of_Bagdad_%281924%29_-_film_poster.jpg?width=500',
  'all.-about.-eve.-1950.720p': 'https://commons.wikimedia.org/wiki/Special:FilePath/All_About_Eve_%281950_poster_-_retouch%29.jpg?width=500',
  'bad-taste-1987-full-movie': 'https://upload.wikimedia.org/wikipedia/en/thumb/9/9f/Bad_taste_poster.jpg/500px-Bad_taste_poster.jpg',
  'black-christmas-1974_202405': 'https://upload.wikimedia.org/wikipedia/en/thumb/e/ee/Black_Christmas_%281974%29_poster.jpg/500px-Black_Christmas_%281974%29_poster.jpg',
  'breathless-1960': 'https://upload.wikimedia.org/wikipedia/en/thumb/3/3f/%C3%80_bout_de_souffle_%28movie_poster%29.jpg/500px-%C3%80_bout_de_souffle_%28movie_poster%29.jpg',
  'brotherhood-of-the-wolf': 'https://upload.wikimedia.org/wikipedia/en/thumb/e/ed/Brotherhood_of_the_Wolf_Film_Poster.jpg/500px-Brotherhood_of_the_Wolf_Film_Poster.jpg',
  'carrie-1976_202409': 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d7/Carrieposter.jpg/500px-Carrieposter.jpg',
  'creepshow-2-1983': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/85/Creepshow2poster.jpg/500px-Creepshow2poster.jpg',
  'daisies_202103': 'https://upload.wikimedia.org/wikipedia/commons/2/25/Marie_on_the_bed.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled',
  'dawn-of-the-dead-1978_202512': 'https://upload.wikimedia.org/wikipedia/en/thumb/6/63/Dawn_of_the_dead.jpg/500px-Dawn_of_the_dead.jpg',
  'diabolique.-1955': 'https://upload.wikimedia.org/wikipedia/en/thumb/3/37/Lesdiaboliquesposter.jpg/500px-Lesdiaboliquesposter.jpg',
  'dr-strangelove-or-how-i-learned-to-stop-worrying-and-love-the-bomb': 'https://commons.wikimedia.org/wiki/Special:FilePath/Dr._Strangelove_poster.png?width=500',
  'dra-cula.-eng.-mp-4.': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/92/Frankenstein_poster_1931.jpg/500px-Frankenstein_poster_1931.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'faust.-1926': 'https://thumb.wikimedia.org/wikipedia/en/thumb/0/0e/Faust_poster_%28Karl_Michel%2C_1926%29.jpg/500px-Faust_poster_%28Karl_Michel%2C_1926%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'flatliners-1990': 'https://upload.wikimedia.org/wikipedia/en/thumb/7/7b/Flatliners.jpg/500px-Flatliners.jpg',
  'frankenstein-1931-english': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/92/Frankenstein_poster_1931.jpg/500px-Frankenstein_poster_1931.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'frankenstein-1931-restored-movie-720p-hd': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/92/Frankenstein_poster_1931.jpg/500px-Frankenstein_poster_1931.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'gilda-1080p': 'https://commons.wikimedia.org/wiki/Special:FilePath/Gilda_%281946_one-sheet_poster_-_Style_B%29.jpg?width=500',
  'high-and-low': 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6a/HIGH_AND_LOW_JP_.jpg/500px-HIGH_AND_LOW_JP_.jpg',
  'his_girl_friday': 'https://commons.wikimedia.org/wiki/Special:FilePath/His_Girl_Friday_%281940_poster%29.jpg?width=500',
  'invasion-of-the-body-snatchers-1956_202511': 'https://commons.wikimedia.org/wiki/Special:FilePath/Invasion_of_the_Body_Snatchers_%281956_poster%29.jpg?width=500',
  'kind-hearts-and-coronets': 'https://thumb.wikimedia.org/wikipedia/en/thumb/1/18/Kind_Hearts_and_Coronets.jpg/330px-Kind_Hearts_and_Coronets.jpg',
  'king-kong-1933-espanol_202401': 'https://commons.wikimedia.org/wiki/Special:FilePath/Kingkongposter.jpg?width=500',
  'lajungladeasfalto': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Asphalt_Jungle_%281950_poster%29.jpg?width=500',
  'laputa.-castle.in.the.-sky.-1986.1080p.-bdrip.-dual.-audio.-10bits.x-265-rapta': 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f5/Castle_in_the_Sky_%281986%29.png/500px-Castle_in_the_Sky_%281986%29.png',
  'laura-1944': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/30/Laura_%281944_film_poster%29.jpg/500px-Laura_%281944_film_poster%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'little-big-man-1970_202511': 'https://upload.wikimedia.org/wikipedia/en/thumb/2/24/Little_Big_Man_1970_film_poster.jpg/500px-Little_Big_Man_1970_film_poster.jpg',
  'lp-473-pl_202403': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Bride_of_Frankenstein_%281935_poster%29.jpg?width=500',
  'm.-1931': 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/M_poster.jpg/500px-M_poster.jpg',
  'mad.-max.-1979.1080p.-blu-ray.x-265-rarbg': 'https://upload.wikimedia.org/wikipedia/en/thumb/5/5a/MadMazAus.jpg/500px-MadMazAus.jpg',
  'metropolis-1927-bdrip-1080p-x-265-dts-hd-ma-5.1-d-0ct-0r-lew-sev': 'https://thumb.wikimedia.org/wikipedia/en/thumb/9/97/Metropolis_%28German_three-sheet_poster%29.jpg/500px-Metropolis_%28German_three-sheet_poster%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'monty-python__the-meaning-of-life__1983': 'https://thumb.wikimedia.org/wikipedia/en/thumb/9/91/Meaningoflife.jpg/330px-Meaningoflife.jpg',
  'night_of_the_living_dead_dvd': 'https://upload.wikimedia.org/wikipedia/en/thumb/9/91/Night_of_the_Living_Dead_%281968%29_poster.jpg/500px-Night_of_the_Living_Dead_%281968%29_poster.jpg',
  'notorious-1946-restored-movie-720p-hd': 'https://commons.wikimedia.org/wiki/Special:FilePath/Notorious_%281946_film_poster%29.jpg?width=500',
  'one.-two.-three.-1961.720p.-billy-wilder-film-james-cagney-howard-st.-john-pamel': 'https://commons.wikimedia.org/wiki/Special:FilePath/One_two_three43.jpg?width=500',
  'pagkasuklam': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/89/Repulsion_%281965_film_poster%29.jpg/500px-Repulsion_%281965_film_poster%29.jpg',
  'pulp-fiction-1994': 'https://upload.wikimedia.org/wikipedia/en/thumb/3/3b/Pulp_Fiction_%281994%29_poster.jpg/500px-Pulp_Fiction_%281994%29_poster.jpg',
  'rebecca-1940-film-noir-thirller-hitchcock': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ad/Rebecca_%281939_poster%29.jpeg/500px-Rebecca_%281939_poster%29.jpeg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'rosemarys-baby_202105': 'https://upload.wikimedia.org/wikipedia/en/thumb/e/ef/Rosemarys_baby_poster.jpg/500px-Rosemarys_baby_poster.jpg',
  'sanjuro_202012': 'https://upload.wikimedia.org/wikipedia/en/thumb/7/75/SanjuroPoster.jpg/500px-SanjuroPoster.jpg',
  'shadowofadoubt1943_202003': 'https://commons.wikimedia.org/wiki/Special:FilePath/Shadow_of_a_Doubt_%281942_poster_-_Style_C%29.jpg?width=500',
  'sherlock-jr_202506': 'https://commons.wikimedia.org/wiki/Special:FilePath/Sherlock_jr_poster.jpg?width=500',
  'side-6-laserdisc': 'https://upload.wikimedia.org/wikipedia/en/thumb/3/3d/The_Lion_King_poster.jpg/500px-The_Lion_King_poster.jpg',
  'silent-the-big-parade': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Big_Parade_%281925%29_poster.jpg?width=500',
  'strangers-on-a-train-720p': 'https://commons.wikimedia.org/wiki/Special:FilePath/Strangers_on_a_Train_%28film%29.jpg?width=500',
  'sunrise.-a.-song.-of.-two.-humans.-1927.720p.-blu-ray.x-264-hdclub-public-hd': 'https://commons.wikimedia.org/wiki/Special:FilePath/Sunrise_-_A_Song_of_Two_Humans.jpg?width=500',
  'the-bridge-on-the-river-kwai-1957_202511': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Bridge_on_the_River_Kwai_%281958_US_poster_-_Style_A%29.jpg?width=500',
  'the-cameraman-1928_202507': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_cameraman_poster.jpg?width=500',
  'the-howling-1981_202512': 'https://upload.wikimedia.org/wikipedia/en/thumb/0/04/The_Howling_%281981_film%29_poster.jpg/500px-The_Howling_%281981_film%29_poster.jpg',
  'the-invisible-man-1933_202105': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Invisible_Man_%281933_poster_-_Style_B%29.jpg?width=500',
  'the-lady-from-shanghai-1947': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Lady_from_Shanghai_%281947_poster%29.jpg?width=500',
  'the-ladykillers_202105': 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/The_Ladykillers_poster.jpg/500px-The_Ladykillers_poster.jpg',
  'the-seventh-seal-1957': 'https://upload.wikimedia.org/wikipedia/en/thumb/6/69/Seventhsealposter.jpg/500px-Seventhsealposter.jpg',
  'the-silence-of-the-lambs-1991_202405': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/86/The_Silence_of_the_Lambs_poster.jpg/500px-The_Silence_of_the_Lambs_poster.jpg',
  'the-third-man-1949_202511': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/The_Third_Man_%281949_American_theatrical_poster%29.jpg/500px-The_Third_Man_%281949_American_theatrical_poster%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
  'the.-blob.-1958': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/80/The_Blob_%281958%29_theatrical_poster.jpg/500px-The_Blob_%281958%29_theatrical_poster.jpg',
  'the.-lost.-world.-1925.1080p.-blu-ray.x-264-sadpanda': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Lost_World_%281925%29_-_film_poster.jpg?width=500',
  'the.-wicker.-man.-1973': 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Wicker_Man_-_1977_US_poster.jpg?width=500',
  'thekilling1956': 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d6/TheKillingPosterKubrick.jpg/500px-TheKillingPosterKubrick.jpg',
  'throw.momma.from.the.train.1987': 'https://upload.wikimedia.org/wikipedia/en/thumb/8/89/Throwmommafromthetrain.jpg/500px-Throwmommafromthetrain.jpg',
  'uhf.-1989': 'https://upload.wikimedia.org/wikipedia/en/thumb/f/fc/UHFposter.jpg/500px-UHFposter.jpg',
  'wings.1927.1080p.bluray.x264-cinefile': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/Wings_%281927%29_poster.jpg/500px-Wings_%281927%29_poster.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail'
};

function _cover(identifier) {
  return POSTERS[identifier] || (_SITE + '/download/' + identifier + '/__ia_thumb.jpg');
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
