/* ==========================================================================
   Content model for the Spotify clone.
   All names, titles and artwork here are original to this project.
   ========================================================================== */

const RELEASES = [
  { t: "Neon Rain",            a: "Kaya Mori", al: "Neon Rain",            g: "Alt Pop",        y: 2024, d: 218 },
  { t: "Midnight Commute",     a: "The Lantern Club", al: "Midnight Commute",     g: "Indie Rock",     y: 2023, d: 254 },
  { t: "Paper Lanterns",       a: "Owen Reyes", al: "Paper Lanterns",           g: "Folk",           y: 2022, d: 196 },
  { t: "Glass Gardens",        a: "Mira Solene", al: "Glass Gardens",          g: "Dream Pop",      y: 2025, d: 231 },
  { t: "Slow Signal",          a: "Halcyon Drive", al: "Slow Signal",        g: "Electronic",     y: 2024, d: 302 },
  { t: "Harbour Lights",       a: "Neon Aviary", al: "Harbour Lights",          g: "Synthwave",      y: 2023, d: 275 },
  { t: "Velvet Static",        a: "Juno Park", al: "Velvet Static",            g: "R&B",            y: 2024, d: 208 },
  { t: "Dust & Neon",          a: "The Slow Cartographers", al: "Long Exposure", g: "Post Rock",    y: 2021, d: 341 },
  { t: "Quiet Machines",       a: "Aster Vale", al: "Quiet Machines",           g: "Ambient",        y: 2025, d: 289 },
  { t: "Saltwater Radio",      a: "Rue Delacroix", al: "Saltwater Radio",        g: "Coastal Pop",    y: 2022, d: 244 },
  { t: "Paper Tigers",         a: "Pale Harbour", al: "Paper Tigers",         g: "Indie Pop",      y: 2023, d: 227 },
  { t: "Blue Hour Drive",      a: "Ines Okada", al: "Blue Hour Drive",           g: "Jazz Pop",       y: 2024, d: 262 },
  { t: "Fever Dream FM",       a: "Northbound Youth", al: "Fever Dream FM",     g: "Synth Pop",      y: 2025, d: 236 },
  { t: "Loose Threads",        a: "Vela Nine", al: "Loose Threads",            g: "Acoustic",       y: 2021, d: 201 },
  { t: "Coral Static",         a: "Copper Rooms", al: "Coral Static",         g: "Lo-fi",          y: 2023, d: 188 },
  { t: "Winter Frequency",     a: "Sofia Benedetti", al: "Winter Frequency",      g: "Classical Pop",  y: 2024, d: 254 },
  { t: "Echo Chambers",        a: "The Mercury Hours", al: "Echo Chambers",    g: "Alt Rock",       y: 2022, d: 297 },
  { t: "Tidal Drift",          a: "Tavares & Bloom", al: "Tidal Drift",      g: "Downtempo",      y: 2025, d: 322 },
  { t: "Amber Transit",        a: "Liora Sandoval", al: "Amber Transit",       g: "Neo Soul",       y: 2023, d: 246 },
  { t: "Hollow Bloom",         a: "Wavelength", al: "Hollow Bloom",           g: "Shoegaze",       y: 2024, d: 233 },
  { t: "Soft Machinery",       a: "Etta Marlow", al: "Soft Machinery",          g: "Electropop",     y: 2025, d: 210 },
  { t: "Parallel Streets",     a: "Nocturne Bureau", al: "Parallel Streets",      g: "Trip Hop",       y: 2022, d: 279 },
  { t: "Analog Sunrise",       a: "The Fen", al: "Analog Sunrise",              g: "Indie Folk",     y: 2023, d: 224 },
  { t: "Marble Birds",         a: "Kestrel Bay", al: "Marble Birds",          g: "Ambient Pop",    y: 2021, d: 265 },
  { t: "Cold Front Radio",     a: "Iris Calder", al: "Cold Front Radio",          g: "Indie Electronic", y: 2024, d: 238 },
  { t: "Lunar Overpass",       a: "Pale Harbour", al: "Paper Tigers",         g: "Dream Pop",      y: 2025, d: 251 },
  { t: "Small Victories",      a: "Juno Park", al: "Velvet Static",            g: "R&B",            y: 2022, d: 216 },
  { t: "Violet Hours",         a: "Owen Reyes", al: "Paper Lanterns",           g: "Folk",           y: 2024, d: 249 },
  { t: "Rust & Roses",         a: "Aster Vale", al: "Quiet Machines",           g: "Ambient",        y: 2023, d: 281 },
  { t: "Tidal Logic",          a: "Mira Solene", al: "Glass Gardens",          g: "Dream Pop",      y: 2025, d: 203 }
];

/* Every release owns its cover file. */
RELEASES.forEach((r, i) => {
  r.cover = `assets/covers/cover-${String(i + 1).padStart(2, "0")}.svg`;
});

const PLAYLISTS = [
  { t: "Late Night Drive",        s: "Playlist • 4 hr 12 min", c: 1 },
  { t: "Focus Deep Work",         s: "Playlist • 2 hr 48 min", c: 2 },
  { t: "Rainy Day Acoustics",     s: "Playlist • 3 hr 05 min", c: 3 },
  { t: "Gym Momentum",            s: "Playlist • 1 hr 36 min", c: 4 },
  { t: "Coffee & Vinyl",          s: "Playlist • 2 hr 21 min", c: 5 },
  { t: "Neon City Nights",        s: "Playlist • 3 hr 44 min", c: 6 },
  { t: "Sunday Kitchen",          s: "Playlist • 1 hr 58 min", c: 7 },
  { t: "First Light",             s: "Playlist • 2 hr 09 min", c: 8 },
  { t: "Old Favourite Songs",     s: "Playlist • 6 hr 17 min", c: 9 },
  { t: "Atmospheric Electronica", s: "Playlist • 4 hr 51 min", c: 10 },
  { t: "Indie Discovery",         s: "Playlist • 3 hr 33 min", c: 11 },
  { t: "Soul & Retro",            s: "Playlist • 2 hr 47 min", c: 12 },
  { t: "Coastal Weekend",         s: "Playlist • 3 hr 19 min", c: 13 },
  { t: "Sleep Signals",           s: "Playlist • 5 hr 02 min", c: 14 },
  { t: "Morning Commute",         s: "Playlist • 1 hr 42 min", c: 15 },
  { t: "Alternative Pulse",       s: "Playlist • 2 hr 55 min", c: 16 },
  { t: "Jazz Corner",             s: "Playlist • 3 hr 08 min", c: 17 },
  { t: "Soft Focus",              s: "Playlist • 2 hr 26 min", c: 18 },
  { t: "Night Shift",             s: "Playlist • 4 hr 40 min", c: 19 },
  { t: "Garden Soundtrack",       s: "Playlist • 2 hr 14 min", c: 20 }
];

const FRIENDS = [
  { n: "Maya Ellis",    a: 3,  now: { t: "Glass Gardens",      r: 4  }, sub: "Kaya Mori" },
  { n: "Tomás Ribeiro", a: 7,  now: { t: "Tidal Logic",        r: 30 }, sub: "Mira Solene" },
  { n: "Priya Raman",   a: 12, now: { t: "Analog Sunrise",     r: 23 }, sub: "The Fen" },
  { n: "Jonah Weiss",   a: 18, now: { t: "Coral Static",       r: 15 }, sub: "Copper Rooms" },
  { n: "Nina Fournier", a: 5,  now: { t: "Fever Dream FM",     r: 13 }, sub: "Northbound Youth" },
  { n: "Omar Haddad",   a: 21, now: { t: "Hollow Bloom",       r: 20 }, sub: "Wavelength" }
];

/* ---- Static, generated views ------------------------------------------------ */

const HOME_SECTIONS = [
  {
    id: "top-mixes",
    title: "Your Top Mixes",
    kicker: "Made for you",
    kind: "card",
    size: "lg",
    items: [
      { type: "mix",   title: "Kaya Mori",        sub: "Kaya Mori, J. Park, The F.", cover: 1 },
      { type: "mix",   title: "Slow Signal Mix",  sub: "Halcyon Drive, Iris Calder", cover: 5 },
      { type: "mix",   title: "Indie Essentials", sub: "Pale Harbour, Owen Reyes",  cover: 11 },
      { type: "mix",   title: "Dream State",      sub: "Mira Solene, Aster Vale",  cover: 9 },
      { type: "mix",   title: "Late Shift",       sub: "Nocturne Bureau, Wavelength", cover: 22 },
      { type: "mix",   title: "Golden Hour",      sub: "The Fen, Liora Sandoval",  cover: 23 }
    ]
  },
  {
    id: "recent",
    title: "Recently Played",
    kicker: "Your history",
    kind: "card",
    size: "sm",
    items: [
      { type: "release", idx: 4 },  { type: "release", idx: 12 }, { type: "release", idx: 29 },
      { type: "release", idx: 17 }, { type: "release", idx: 8 },  { type: "release", idx: 2 },
      { type: "release", idx: 21 }, { type: "release", idx: 14 }, { type: "release", idx: 25 },
      { type: "release", idx: 19 }
    ]
  },
  {
    id: "made-for-you",
    title: "Made For You",
    kicker: "New music for you",
    kind: "card",
    size: "sm",
    items: PLAYLISTS.slice(0, 8).map((p, i) => ({
      type: "playlist", title: p.t, sub: p.s, cover: p.c, tracks: [4, 9, 16, 25, 30]
    }))
  },
  {
    id: "jump-back",
    title: "Jump Back In",
    kicker: "Pick up where you left off",
    kind: "card",
    size: "sm",
    items: [
      { type: "playlist", title: "Winter Frequency", sub: "Playlist • 3 hr 12 min", cover: 16, tracks: [16, 23, 7] },
      { type: "playlist", title: "Soft Focus",       sub: "Playlist • 2 hr 04 min", cover: 18, tracks: [21, 3, 27] },
      { type: "playlist", title: "Night Shift",      sub: "Playlist • 4 hr 40 min", cover: 19, tracks: [12, 18, 1] },
      { type: "playlist", title: "Coffee & Vinyl",   sub: "Playlist • 2 hr 21 min", cover: 5,  tracks: [22, 10, 15] },
      { type: "playlist", title: "Rainy Day Acoustics", sub: "Playlist • 3 hr 05 min", cover: 3, tracks: [2, 13, 26] },
      { type: "playlist", title: "Neon City Nights", sub: "Playlist • 3 hr 44 min", cover: 6,  tracks: [5, 24, 28] }
    ]
  },
  {
    id: "new-releases",
    title: "New Releases for You",
    kicker: "Fresh this week",
    kind: "card",
    size: "sm",
    items: [3, 20, 17, 8, 25, 29, 29, 7, 11, 26].map(i => ({ type: "release", idx: i - 1 }))
  },
  {
    id: "popular-artists",
    title: "Popular Artists",
    kicker: "On repeat",
    kind: "artist",
    size: "circle",
    items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ type: "artist", idx: i }))
  },
  {
    id: "history",
    title: "Listening History",
    kicker: "Today",
    kind: "list",
    size: "sm",
    items: [4, 30, 12, 8, 17, 3, 25, 2, 21, 16].map(i => ({ type: "release", idx: i - 1 }))
  }
];

/* Release-index helpers ----------------------------------------------------- */
/** Index of the first release that shares the same parent album. */
function albumIndex(i) {
  const target = RELEASES[i].al;
  const first = RELEASES.findIndex((r) => r.al === target);
  return first < 0 ? i : first;
}

/** Every release that belongs to the same parent album. */
function albumTracks(i) {
  return RELEASES.map((_, n) => n).filter((n) => RELEASES[n].al === RELEASES[i].al);
}

const release = (i) => ({
  id: `r${i}`,
  title: RELEASES[i].t,
  artist: RELEASES[i].a,
  genre: RELEASES[i].g,
  year: RELEASES[i].y,
  dur: RELEASES[i].d,
  album: RELEASES[i].al,
  cover: RELEASES[i].cover
});

const artist = (i) => ({
  id: `a${i}`,
  title: RELEASES[i].a,
  sub: "Artist",
  cover: `assets/covers/cover-${String(i + 1).padStart(2, "0")}.svg`,
  avatar: `assets/avatars/avatar-${String((i % 25) + 1).padStart(2, "0")}.svg`
});

const playlist = (i) => ({
  id: `p${i}`,
  title: PLAYLISTS[i].t,
  sub: PLAYLISTS[i].s,
  cover: `assets/covers/playlist-${String(PLAYLISTS[i].c).padStart(2, "0")}.svg`
});

const allReleases = RELEASES.map((_, i) => release(i));
const allArtists = Array.from(new Set(RELEASES.map((r) => r.a))).map((name, i) => {
  const first = RELEASES.findIndex((r) => r.a === name);
  return {
    id: `art${i}`,
    title: name,
    sub: "Artist",
    cover: `assets/covers/cover-${String(first + 1).padStart(2, "0")}.svg`,
    avatar: `assets/avatars/avatar-${String((first % 25) + 1).padStart(2, "0")}.svg`
  };
});
const allPlaylists = PLAYLISTS.map((_, i) => playlist(i));

/* Stable, shuffled-feeling track lists per playlist (deterministic). */
function tracksFor(seedIdx, count) {
  const out = [];
  let s = (seedIdx + 3) * 7919;
  for (let k = 0; k < count; k++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push(s % RELEASES.length);
  }
  return out;
}
