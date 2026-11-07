/* ==========================================================================
   Spotify Web Player — clone application logic
   Vanilla JS. No build step, no dependencies.
   ========================================================================== */
(function () {
  "use strict";

  /* ── tiny helpers ─────────────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── state ────────────────────────────────────────────────────────────── */
  const state = {
    route: { name: "home", params: {} },
    history: [{ name: "home", params: {} }],
    hIndex: 0,
    queue: [],
    qPos: 0,
    playing: false,
    position: 0,
    shuffle: false,
    repeat: 0, // 0 off · 1 all · 2 one
    volume: 0.7,
    muted: false,
    liked: new Set(),
    saved: new Set(),
    following: new Set(),
    playlists: [],          // user-created playlists
    device: "web",
    recent: [],          // recent search terms
    recentlyPlayed: [],  // release indices, most recent first
    view: "list",
    libraryFilter: "",
    tracks: {} // release index -> generated lyric lines
  };

  /* ── generated lyric text (original words, deterministic per track) ──── */
  const LYRIC_BANK = [
    "city lights are folding over",
    "we keep driving but the road runs out",
    "every window holds a different year",
    "slow signal on a borrowed frequency",
    "I could stay here until morning",
    "the harbour keeps a low blue light",
    "nothing moves but the weather",
    "you said slow down and I let you",
    "static on the radio again",
    "somewhere between the bridge and the sea",
    "we were younger than the songs we play",
    "paper lanterns on a wire",
    "the tape hisses like it's apologising",
    "hold the quiet, hold it longer",
    "the morning comes in sideways",
    "I can hear you in the hallway",
    "green light on the dashboard",
    "nothing here is what it looks like",
    "we'll take the long way around"
  ];
  const LYRIC_LABELS = ["Verse 1", "Pre-chorus", "Chorus", "Verse 2", "Bridge", "Chorus", "Outro"];

  function lyricLines(idx) {
    if (state.tracks[idx]) return state.tracks[idx];
    let seed = (idx + 1) * 2654435761 % 2147483647;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const lines = [];
    for (let i = 0; i < 14; i++) {
      const bank = LYRIC_BANK[Math.floor(rnd() * LYRIC_BANK.length)];
      const second = LYRIC_BANK[Math.floor(rnd() * LYRIC_BANK.length)];
      lines.push(i % 3 === 2 ? bank : `${bank} / ${second}`);
    }
    state.tracks[idx] = lines;
    return lines;
  }

  /* ── audio engine (generative pad, so "play" is audible) ─────────────── */
  const Sound = {
    ctx: null,
    master: null,
    analyser: null,
    osc: [],
    timer: null,

    ensure() {
      if (this.ctx) return true;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.82;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      return true;
    },

    play(idx) {
      if (!this.ensure()) return;
      if (this.ctx.state === "suspended") this.ctx.resume();
      this.stop(true);
      const rel = RELEASES[idx];
      const root = 110 * Math.pow(2, (idx % 7) / 12);
      const chord = [1, 1.5, 2, 3].map((m) => root * m);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700;
      filter.Q.value = 3;

      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.07 + (idx % 5) * 0.012;
      lfoGain.gain.value = 420;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();

      const pad = this.ctx.createGain();
      pad.gain.value = 0.16;
      filter.connect(pad).connect(this.master);

      chord.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = i % 2 ? "sine" : "triangle";
        o.frequency.value = f;
        o.detune.value = (i - 1.5) * 6;
        const g = this.ctx.createGain();
        g.gain.value = i === 0 ? 0.5 : 0.3 / i;
        o.connect(g).connect(filter);
        o.start();
        this.osc.push(o);
      });

      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(this.level(), this.ctx.currentTime + 1.6);
      this.osc.push(lfo);
      this.timer = rel;
    },

    stop(keepMaster) {
      this.osc.forEach((o) => {
        try { o.stop(); } catch (e) { /* already stopped */ }
      });
      this.osc = [];
      if (!keepMaster && this.ctx) {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
        this.master.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.35);
      }
    },

    level() {
      return state.muted ? 0 : state.volume * 0.16;
    },

    applyVolume() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.level(), t, 0.08);
    }
  };

  /* ── toast ────────────────────────────────────────────────────────────── */
  function toast(msg, dark, undo) {
    const el = document.createElement("div");
    el.className = "toast" + (dark ? " toast--dark" : "");
    const span = document.createElement("span");
    span.className = "toast__msg";
    span.textContent = msg;
    el.appendChild(span);
    if (undo) {
      const btn = document.createElement("button");
      btn.className = "toast__undo";
      btn.textContent = "Undo";
      btn.addEventListener("click", () => { undo(); dismiss(); });
      el.appendChild(btn);
    }
    const dismiss = () => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 220);
    };
    $("#toasts").appendChild(el);
    setTimeout(dismiss, undo ? 5200 : 2600);
  }

  /* ── routing ──────────────────────────────────────────────────────────── */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [name, param] = raw.split("/");
    if (!name) return { name: "home", params: {} };
    let id = param || "";
    try { id = decodeURIComponent(id); } catch (e) { /* leave the raw param */ }
    return { name, params: { id } };
  }

  function go(name, param, replace) {
    let id = param || "";
    try { id = decodeURIComponent(id); } catch (e) { /* keep the raw param */ }
    const route = { name, params: { id } };
    const changing = !(route.name === state.route.name && route.params.id === state.route.params.id);
    state.route = route;
    const hash = `#/${name}${param ? "/" + param : ""}`;
    if (location.hash !== hash) {
      if (replace) history.replaceState(null, "", hash);
      else location.hash = hash;
    }
    if (replace) {
      state.history[state.hIndex] = route;
    } else {
      state.history = state.history.slice(0, state.hIndex + 1);
      state.history.push(route);
      state.hIndex = state.history.length - 1;
    }
    render(changing);
  }

  function back() {
    if (state.hIndex > 0) {
      state.hIndex--;
      const r = state.history[state.hIndex];
      state.route = r;
      history.replaceState(null, "", `#/${r.name}${r.params.id ? "/" + r.params.id : ""}`);
      render(true);
    }
  }
  function forward() {
    if (state.hIndex < state.history.length - 1) {
      state.hIndex++;
      const r = state.history[state.hIndex];
      state.route = r;
      history.replaceState(null, "", `#/${r.name}${r.params.id ? "/" + r.params.id : ""}`);
      render(true);
    }
  }

  /* ── playback ─────────────────────────────────────────────────────────── */
  let ticker = null;

  function currentIndex() {
    const i = state.queue[state.qPos];
    return i === undefined ? 0 : i;
  }

  function playIndex(idx, queue) {
    notePlayed(idx);
    if (queue && queue.length) {
      state.queue = queue.slice();
      state.qPos = Math.max(0, queue.indexOf(idx));
    } else if (!state.queue.length) {
      state.queue = [idx];
      state.qPos = 0;
    } else {
      state.qPos = state.queue.indexOf(idx);
      if (state.qPos < 0) {
        state.queue.unshift(idx);
        state.qPos = 0;
      }
    }
    state.position = 0;
    lastLyricIndex = -1;
    setPlaying(true);
    paintPlayer();
  }

  function playQueue(queue, startAt) {
    state.queue = queue.slice();
    state.qPos = startAt || 0;
    state.position = 0;
    lastLyricIndex = -1;
    if (state.queue.length) notePlayed(state.queue[state.qPos]);
    setPlaying(true);
    paintPlayer();
  }

  function setPlaying(on) {
    state.playing = on;
    if (on) {
      Sound.play(currentIndex());
      startTicker();
    } else {
      Sound.stop();
      stopTicker();
    }
    paintPlayer();
  }

  function togglePlay() {
    if (!state.queue.length) {
      playQueue([0], 0);
      return;
    }
    setPlaying(!state.playing);
  }

  function nextTrack(auto) {
    if (!state.queue.length) return;
    if (state.repeat === 2 && auto) {
      state.position = 0;
      Sound.play(currentIndex());
      return;
    }
    if (state.shuffle) {
      let n = state.qPos;
      while (state.queue.length > 1 && n === state.qPos) n = Math.floor(Math.random() * state.queue.length);
      state.qPos = n;
    } else if (state.qPos < state.queue.length - 1) {
      state.qPos++;
    } else if (state.repeat === 1 || !auto) {
      state.qPos = 0;
    } else {
      state.playing = false;
      state.position = 0;
      stopTicker();
      paintPlayer();
      return;
    }
    state.position = 0;
    if (state.playing) Sound.play(currentIndex());
    paintPlayer();
  }

  function prevTrack() {
    if (state.position > 3) {
      state.position = 0;
      paintPlayer();
      return;
    }
    if (state.shuffle && state.queue.length > 1) {
      state.qPos = Math.floor(Math.random() * state.queue.length);
    } else if (state.qPos > 0) {
      state.qPos--;
    } else {
      state.qPos = 0;
    }
    state.position = 0;
    if (state.playing) Sound.play(currentIndex());
    paintPlayer();
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      const rel = RELEASES[currentIndex()];
      if (!rel) return;
      state.position += 0.2;
      if (state.position >= rel.d) nextTrack(true);
      paintProgress();
      syncLyrics();
    }, 200);
  }
  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  /* ── player painting ──────────────────────────────────────────────────── */
  function paintProgress() {
    const rel = RELEASES[currentIndex()];
    if (!rel) return;
    const pct = clamp((state.position / rel.d) * 100, 0, 100);
    $("#progressFill").style.width = pct + "%";
    $("#elapsed").textContent = fmtTime(state.position);
    $("#duration").textContent = fmtTime(rel.d);
    $("#nowProgressFill").style.width = pct + "%";
    $("#nowElapsed").textContent = fmtTime(state.position);
    $("#nowDuration").textContent = fmtTime(rel.d);
    const track = $("#progressTrack");
    track.setAttribute("aria-valuenow", Math.round(pct));
    track.setAttribute("aria-valuetext", `${fmtTime(state.position)} of ${fmtTime(rel.d)}`);
    const npt = $("#nowProgressTrack");
    npt.setAttribute("aria-valuenow", Math.round(pct));

    const rows = $$(".row.is-playing");
    rows.forEach((r) => r.classList.remove("is-playing"));
    const row = $(`.row[data-idx="${currentIndex()}"]`);
    if (row) row.classList.add("is-playing");
  }

  function paintPlayer() {
    if ($("#queuePanel") && $("#queuePanel").classList.contains("is-open")) renderQueuePanel();
    updateMediaSession();
    const idx = currentIndex();
    const rel = RELEASES[idx];
    if (!rel) return;
    $("#npCoverImg").src = rel.cover;
    $("#npCoverImg").alt = `${rel.t} cover art`;
    $("#npTitle").textContent = rel.t;
    $("#npArtist").textContent = rel.a;
    $("#npTitle").dataset.route = "album/" + idx;
    $("#npArtist").dataset.route = "artist/" + idx;

    $("#playBtn").innerHTML = `<svg class="ic ic--lg"><use href="#i-${state.playing ? "pause" : "play"}"></use></svg>`;
    $("#playBtn").setAttribute("aria-label", state.playing ? "Pause" : "Play");
    $("#nowPlay").innerHTML = `<svg class="ic ic--xl"><use href="#i-${state.playing ? "pause" : "play"}"></use></svg>`;
    $("#nowPlay").setAttribute("aria-label", state.playing ? "Pause" : "Play");

    $("#npEq").hidden = !state.playing;
    $("#shuffleBtn").setAttribute("aria-pressed", String(state.shuffle));
    $("#nowShuffle").setAttribute("aria-pressed", String(state.shuffle));
    $("#repeatBtn").setAttribute("aria-pressed", String(state.repeat > 0));
    $("#nowRepeat").setAttribute("aria-pressed", String(state.repeat > 0));
    $("#repeatBtn").style.color = state.repeat === 2 ? "var(--green)" : "";
    const isLiked = state.liked.has(idx);
    $("#likeBtn").setAttribute("aria-pressed", String(isLiked));
    $("#likeBtn").innerHTML = `<svg class="ic"><use href="#i-${isLiked ? "heart-fill" : "heart"}"></use></svg>`;
    $("#likeBtn").classList.toggle("is-liked", isLiked);
    syncRowHearts();

    const meta = state.queueMeta && state.queueMeta[idx];
    $("#nowOriginName").textContent = meta || "Your Library";
    $("#nowOrigin").textContent = meta ? "Playing from" : "Playlist";

    syncCardPlayStates();

    const cover = rel.cover;
    $("#nowArtImg").src = cover;
    $("#nowBg").style.backgroundImage = `url("${cover}")`;
    paintNowMeta();
    paintProgress();
  }

  /* ── rendering ────────────────────────────────────────────────────────── */
  function artCard(opts) {
    return `
      <div class="card ${opts.cls || ""}">
        <div class="card__art">
          <img src="${opts.cover}" alt="${esc(opts.alt || opts.title)} cover art" loading="lazy">
          <button class="card__play" data-action="play-card" data-idx="${opts.idx}" data-kind="${opts.kind || "release"}" aria-label="Play ${esc(opts.title)}">
            <svg class="ic"><use href="#i-play"></use></svg>
          </button>
        </div>
        <a class="card__title" href="#" data-route="${opts.route}">${esc(opts.title)}</a>
        ${opts.sub ? `<div class="card__sub">${esc(opts.sub)}</div>` : ""}
      </div>`;
  }

  function renderHome() {
    const sections = HOME_SECTIONS.map((s) => {
      let body = "";
      if (s.kind === "card") {
        body = `<div class="cardgrid ${s.size === "lg" ? "cardgrid--lg" : "cardgrid--sm"}">` + s.items.map(cardFromItem).join("") + `</div>`;
      } else if (s.kind === "artist") {
        body = `<div class="cardgrid cardgrid--sm">` + s.items.map((it) => {
          const a = allArtists[it.idx] || allArtists[0];
          return artCard({
            cls: "card--circle",
            cover: a.cover,
            title: a.title,
            sub: "Artist",
            route: "artist/" + it.idx,
            idx: it.idx,
            kind: "artist"
          });
        }).join("") + `</div>`;
      } else {
        body = `<div class="tracklist">` + s.items.map((it) => rowFor(it.idx)).join("") + `</div>`;
      }
      return `
        <section class="section" id="${s.id}">
          <div class="section__head">
            <div>
              <div class="section__kicker">${esc(s.kicker)}</div>
              <h2 class="section__title">${esc(s.title)}</h2>
            </div>
            <a class="section__link" href="#" data-action="noop">Show all</a>
          </div>
          ${body}
        </section>`;
    }).join("");

    return `
      <div class="hero" style="--hero-a:#4b3fa0; --hero-b:#241f4d;">
        <div class="hero__inner">
          <div class="hero__eyebrow">Spotify Web Player clone</div>
          <h1 class="hero__title">${greeting()}</h1>
          <div class="hero__actions">
            <button class="pill pill--green" data-action="play-hero"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
            <a class="hero__more" href="#" data-action="noop">Show more <svg class="ic ic--sm"><use href="#i-chev-down"></use></svg></a>
          </div>
        </div>
      </div>
      ${
        state.recentlyPlayed.length
          ? `<section class="section">
              <div class="section__head">
                <div><div class="section__kicker">Pick up where you left off</div><h2 class="section__title">Jump back in</h2></div>
              </div>
              <div class="cardgrid cardgrid--sm">
                ${state.recentlyPlayed
                  .slice(0, 8)
                  .map((ri) => {
                    const r = release(ri);
                    return artCard({
                      cover: r.cover,
                      title: r.title,
                      sub: r.artist,
                      route: "album/" + albumIndex(ri),
                      idx: ri
                    });
                  })
                  .join("")}
              </div>
            </section>`
          : ""
      }
      ${sections}`;
  }

  function cardFromItem(it) {
    if (it.type === "release") {
      const r = release(it.idx);
      return artCard({ cover: r.cover, title: r.title, sub: r.artist, route: "album/" + albumIndex(it.idx), idx: it.idx });
    }
    if (it.type === "playlist") {
      return artCard({ cover: `assets/covers/playlist-${String(it.cover).padStart(2, "0")}.svg`, title: it.title, sub: it.sub, route: "playlist/" + it.cover, idx: it.cover, kind: "playlist" });
    }
    if (it.type === "mix") {
      return artCard({ cls: "card--mix", cover: `assets/covers/cover-${String(it.cover).padStart(2, "0")}.svg`, title: it.title, sub: it.sub, route: "playlist/" + it.cover, idx: it.cover, kind: "playlist" });
    }
    if (it.type === "artist") {
      const a = allArtists[it.idx] || allArtists[0];
      return artCard({ cls: "card--circle", cover: a.cover, title: a.title, sub: "Artist", route: "artist/" + it.idx, idx: it.idx, kind: "artist" });
    }
    return "";
  }

  function rowFor(idx, album) {
    const r = release(idx);
    return `
      <div class="row" data-idx="${idx}">
        <div class="row__idx">${idx + 1}</div>
        <button class="row__play" data-action="play-release" data-idx="${idx}" aria-label="Play ${esc(r.title)}"><svg class="ic ic--sm"><use href="#i-play"></use></svg></button>
        <div class="row__eq" aria-hidden="true"><i></i><i></i><i></i></div>
        <img class="row__art" src="${r.cover}" alt="" loading="lazy">
        <div style="min-width:0">
          <a class="row__title" href="#" data-route="album/${albumIndex(idx)}">${esc(r.title)}</a>
          <div class="row__artist">${esc(r.artist)}</div>
        </div>
        <div class="row__album">${esc(album || r.album)}</div>
        <div class="row__dur">${fmtTime(r.dur)}</div>
        <div class="row__actions">
          <button class="icon-btn icon-btn--ghost row__like" data-action="like" data-idx="${idx}" aria-label="Save ${esc(r.title)}"><svg class="ic ic--sm"><use href="#i-heart"></use></svg></button>
          <button class="icon-btn icon-btn--ghost" data-action="queue" data-idx="${idx}" aria-label="Add to queue"><svg class="ic ic--sm"><use href="#i-plus"></use></svg></button>
        </div>
      </div>`;
  }

  function renderSearch() {
    const q = $("#searchInput").value.trim();
    // search has no hero band, so the view needs room for the overlay topbar
    if (!q) {
      return `
        ${recentSearchesHTML()}
        <section class="section">
          <div class="section__head"><div><div class="section__kicker">Browse all</div><h2 class="section__title">Explore genres</h2></div></div>
          <div class="cardgrid cardgrid--sm">
            ${[...new Set(RELEASES.map((r) => r.g))]
              .sort()
              .map((g, i) => {
                const first = RELEASES.findIndex((r) => r.g === g);
                return artCard({
                  cls: "card--mix",
                  cover: release(first).cover,
                  title: g,
                  sub: "Genre",
                  route: "genre/" + encodeURIComponent(g),
                  idx: first,
                  kind: "genre"
                });
              })
              .join("")}
          </div>
        </section>
        <section class="section">
          <div class="section__head"><div><div class="section__kicker">Curated</div><h2 class="section__title">Browse playlists</h2></div></div>
          <div class="cardgrid cardgrid--sm">
            ${allPlaylists.slice(0, 12).map((p, i) => artCard({ cover: p.cover, title: p.title, sub: p.sub, route: "playlist/" + (i + 1), idx: i + 1, kind: "playlist" })).join("")}
          </div>
        </section>`;
    }
    const lq = q.toLowerCase();
    const hitsRel = allReleases.filter((r) => r.title.toLowerCase().includes(lq) || r.artist.toLowerCase().includes(lq));
    const hitsArt = allArtists.filter((a) => a.title.toLowerCase().includes(lq));
    const hitsPl = allPlaylists.filter((p) => p.title.toLowerCase().includes(lq));

    if (!hitsRel.length && !hitsArt.length && !hitsPl.length) {
      return `<div class="empty"><h3>No results for "${esc(q)}"</h3><p>Try a different artist, album or playlist name.</p></div>`;
    }
    const top = [...hitsRel, ...hitsArt, ...hitsPl].slice(0, 6);
    return `
      <div class="results">
        <div class="section__head"><div><div class="section__kicker">Top result</div></div></div>
        ${top.length ? `<div class="result" data-action="noop">
            <img class="result__art" src="${top[0].cover}" alt="">
            <div><div class="result__title">${esc(top[0].title)}</div>
            <div class="result__kind"><span>${esc(top[0].sub || top[0].artist || "")}</span> · ${esc(top[0].genre || "Playlist")}</div></div>
          </div>` : ""}
        ${hitsRel.length ? `<div class="section__head" style="margin-top:24px"><div><div class="section__kicker">Songs</div><h2 class="section__title">${hitsRel.length} result${hitsRel.length > 1 ? "s" : ""}</h2></div></div>
          <div class="tracklist">${hitsRel.slice(0, 12).map((r) => rowFor(allReleases.indexOf(r))).join("")}</div>` : ""}
        ${hitsArt.length ? `<div class="section__head" style="margin-top:24px"><div><div class="section__kicker">Artists</div><h2 class="section__title">Artists</h2></div></div>
          <div class="cardgrid cardgrid--sm">${hitsArt.map((a) => artCard({ cls: "card--circle", cover: a.cover, title: a.title, sub: "Artist", route: "artist/" + allArtists.indexOf(a), idx: allArtists.indexOf(a), kind: "artist" })).join("")}</div>` : ""}
        ${hitsPl.length ? `<div class="section__head" style="margin-top:24px"><div><div class="section__kicker">Playlists</div><h2 class="section__title">Playlists</h2></div></div>
          <div class="cardgrid cardgrid--sm">${hitsPl.map((p, i) => artCard({ cover: p.cover, title: p.title, sub: p.sub, route: "playlist/" + (allPlaylists.indexOf(p) + 1), idx: allPlaylists.indexOf(p) + 1, kind: "playlist" })).join("")}</div>` : ""}
      </div>`;
  }

  function renderLiked() {
    const idxs = [...state.liked].sort((a, b) => a - b);
    const cover = idxs.length ? release(idxs[0]).cover : "assets/covers/playlist-01.svg";
    return `
      <div class="pagehead" style="--pa:#5b3f8c; --pb:#241b4d;">
        <div class="pagehead__art"><img src="${cover}" alt="Liked Songs cover art"></div>
        <div class="pagehead__meta">
          <div class="pagehead__kind">Playlist</div>
          <h1 class="pagehead__title">Liked Songs</h1>
          <p class="pagehead__sub">${idxs.length} song${idxs.length === 1 ? "" : "s"} · Everything you've hearted, in one place</p>
          <div class="pagehead__actions">
            <button class="pill pill--green" data-action="play-liked"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        ${idxs.length ? renderTrackSet(idxs, state.view) : `<div class="empty"><h3>No liked songs yet</h3><p>Heart anything you love and it lands here.</p></div>`}
      </div>`;
  }

  function renderGenre(name) {
    const idxs = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].g === name);
    const artIdx = allArtists
      .map((a, n) => n)
      .filter((n) => RELEASES.some((r) => r.a === allArtists[n].title && r.g === name));
    const albums = [...new Set(idxs.map((n) => albumIndex(n)))];
    if (!idxs.length) {
      return `<div class="empty"><h3>Nothing in “${esc(name)}” yet</h3><p>Try another genre from Search.</p></div>`;
    }
    return `
      <div class="pagehead" style="--pa:#4a3f6b; --pb:#221d38;">
        <div class="pagehead__art pagehead__art--circle"><img src="${release(idxs[0]).cover}" alt="${esc(name)}"></div>
        <div class="pagehead__meta">
          <div class="pagehead__kind">Genre</div>
          <h1 class="pagehead__title">${esc(name)}</h1>
          <p class="pagehead__sub">${idxs.length} song${idxs.length === 1 ? "" : "s"} · ${albums.length} release${albums.length === 1 ? "" : "s"} · ${artIdx.length} artist${artIdx.length === 1 ? "" : "s"}</p>
          <div class="pagehead__actions">
            <button class="pill pill--green" data-action="play-genre" data-idx="${idxs[0]}"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div class="section__head"><div><div class="section__kicker">Artists</div><h2 class="section__title">In this genre</h2></div></div>
        <div class="cardgrid cardgrid--sm">
          ${artIdx
            .map((n) => artCard({ cls: "card--circle", cover: allArtists[n].cover, title: allArtists[n].title, sub: "Artist", route: "artist/" + n, idx: n, kind: "artist" }))
            .join("")}
        </div>
        <div class="section__head" style="margin-top:32px"><div><div class="section__kicker">Releases</div><h2 class="section__title">Popular in ${esc(name)}</h2></div></div>
        <div class="cardgrid cardgrid--sm">
          ${albums
            .slice(0, 8)
            .map((n) => artCard({ cover: release(n).cover, title: release(n).album, sub: release(n).artist, route: "album/" + n, idx: n }))
            .join("")}
        </div>
        <div class="section__head" style="margin-top:32px"><div><div class="section__kicker">Songs</div><h2 class="section__title">All tracks</h2></div></div>
        <div class="tracklist">${idxs.slice(0, 20).map((n) => rowFor(n, release(n).album)).join("")}</div>
      </div>`;
  }

  function renderLibrary() {
    const items = [
      ...state.playlists.map((p) => ({
        name: p.name,
        cover: playlistCover(p),
        route: "playlist/" + p.id,
        idx: p.id
      })),
      ...allPlaylists.map((p, i) => ({
        name: p.title,
        cover: p.cover,
        route: "playlist/" + (i + 1),
        idx: i + 1
      }))
    ];
    return `
      <div class="hero" style="--hero-a:#3d3d3d; --hero-b:#1c1c1c;">
        <div class="hero__inner">
          <div class="hero__eyebrow">Your Library</div>
          <h1 class="hero__title">Your Library</h1>
          <div class="hero__actions">
            <button class="pill pill--green" data-action="play-hero"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
            <a class="hero__more" href="#" data-action="noop">Show more <svg class="ic ic--sm"><use href="#i-chev-down"></use></svg></a>
          </div>
        </div>
      </div>
      <section class="section">
        <div class="cardgrid cardgrid--sm">
          ${items.map((it) => artCard({ cover: it.cover, title: it.name, sub: "Playlist", route: it.route, idx: it.idx, kind: "playlist" })).join("")}
        </div>
      </section>`;
  }

  /** Track set rendered either as a table (list view) or as artwork cards (grid view). */
  function renderTrackSet(idxs, mode) {
    if (mode === "grid") {
      return `<div class="cardgrid cardgrid--sm">` + idxs.map((ri) => {
        const r = release(ri);
        return artCard({
          cover: r.cover,
          title: r.title,
          sub: r.artist,
          route: "album/" + albumIndex(ri),
          idx: ri
        });
      }).join("") + `</div>`;
    }
    return `<div class="tracklist">` + idxs.map((ri) => rowFor(ri)).join("") + `</div>`;
  }

  function renderPlaylist(id) {
    const pl = getPlaylist(id);
    if (!pl) {
      return `<div class="empty"><h3>Playlist not found</h3><p>It may have been deleted.</p></div>`;
    }
    const idxs = playlistTracks(pl, id);
    const name = pl.title || pl.name;
    const sub = pl.desc || playlistSubtitle(pl);
    const isUser = pl.id >= 1001;
    const recommended = allReleases
      .map((_, n) => n)
      .filter((n) => !idxs.includes(n))
      .slice(0, 8);
    return `
      <div class="pagehead" style="--pa:#4b3fa0; --pb:#241f4d;">
        <div class="pagehead__art"><img src="${playlistCover(pl)}" alt="${esc(name)} cover art"></div>
        <div class="pagehead__meta">
          <div class="pagehead__kind">Playlist</div>
          <h1 class="pagehead__title">${esc(name)}</h1>
          <p class="pagehead__sub">${esc(sub)} · ${idxs.length} song${idxs.length === 1 ? "" : "s"}${isUser ? " · Created by you" : ""}</p>
          <div class="pagehead__actions">
            <button class="pill pill--green" data-action="play-list" data-idx="${pl.id}" data-kind="playlist"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
            <button class="icon-btn icon-btn--ghost" data-action="like-idx" data-idx="${pl.id}" aria-label="Save playlist"><svg class="ic"><use href="#i-heart"></use></svg></button>
            <button class="icon-btn icon-btn--ghost" data-action="noop" aria-label="Download"><svg class="ic"><use href="#i-download"></use></svg></button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div class="filterbar">
          <button class="chip" data-action="toggle-view">${state.view === "grid" ? "List" : "Grid"}</button>
          <button class="chip" data-action="noop">Sort: Custom</button>
        </div>
        ${idxs.length ? renderTrackSet(idxs, state.view) : `<div class="empty"><h3>This playlist is empty</h3><p>Right-click any song to add it.</p></div>`}
      </div>
      ${
        recommended.length
          ? `<section class="section">
              <div class="section__head">
                <div><div class="section__kicker">For you</div><h2 class="section__title">Recommended</h2></div>
              </div>
              <div class="cardgrid cardgrid--sm">
                ${recommended
                  .map((ri) => {
                    const r = release(ri);
                    return artCard({
                      cover: r.cover,
                      title: r.title,
                      sub: r.artist,
                      route: "album/" + albumIndex(ri),
                      idx: ri
                    });
                  })
                  .join("")}
              </div>
            </section>`
          : ""
      }`;
  }

  function renderAlbum(id) {
    const i = albumIndex(Math.max(0, Math.min(RELEASES.length - 1, parseInt(id, 10) || 0)));
    const r = release(i);
    const idxs = albumTracks(i);
    const total = idxs.reduce((sum, n) => sum + RELEASES[n].d, 0);
    const more = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].a === r.artist && n !== i);
    return `
      <div class="pagehead" style="--pa:#3f4a6b; --pb:#1d2130;">
        <div class="pagehead__art"><img src="${r.cover}" alt="${esc(r.album)} cover art"></div>
        <div class="pagehead__meta">
          <div class="pagehead__kind">Album</div>
          <h1 class="pagehead__title">${esc(r.album)}</h1>
          <p class="pagehead__sub">${esc(r.artist)} · ${r.year} · ${esc(r.genre)} · ${idxs.length} songs, ${fmtTime(total)}</p>
          <div class="pagehead__actions">
            <button class="pill pill--green" data-action="play-release" data-idx="${i}"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
            <button class="icon-btn icon-btn--ghost" data-action="like" data-idx="${i}" aria-label="Save album"><svg class="ic"><use href="#i-heart"></use></svg></button>
            <button class="icon-btn icon-btn--ghost" data-action="noop" aria-label="Download"><svg class="ic"><use href="#i-download"></use></svg></button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div class="filterbar">
          <button class="chip" data-action="toggle-view">${state.view === "grid" ? "List" : "Grid"}</button>
          <button class="chip" data-action="noop">Sort: Custom</button>
        </div>
        ${renderTrackSet(idxs, state.view)}
        <div class="about">
          <div class="about__row"><dt>Release</dt><dd>${r.year}</dd></div>
          <div class="about__row"><dt>Genre</dt><dd>${esc(r.genre)}</dd></div>
          <div class="about__row"><dt>Runtime</dt><dd>${fmtTime(total)}</dd></div>
          <div class="about__row"><dt>Label</dt><dd>${esc(r.artist)} Records</dd></div>
        </div>
      </div>
      ${
        more.length
          ? `<section class="section">
              <div class="section__head">
                <div><div class="section__kicker">More from</div><h2 class="section__title">${esc(r.artist)}</h2></div>
              </div>
              <div class="cardgrid cardgrid--sm">
                ${more
                  .map((n) => {
                    const nr = release(n);
                    return artCard({ cover: nr.cover, title: nr.title, sub: nr.album, route: "album/" + albumIndex(n), idx: n });
                  })
                  .join("")}
              </div>
            </section>`
          : ""
      }`;
  }

  function renderArtist(id) {
    const i = Math.max(0, Math.min(allArtists.length - 1, parseInt(id, 10) || 0));
    const a = allArtists[i];
    const idxs = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].a === a.title);
    const popular = idxs.slice().sort((x, y) => RELEASES[y].y - RELEASES[x].y);
    const similar = allArtists
      .map((x, n) => ({ n, a: x }))
      .filter((x) => x.a.title !== a.title)
      .slice((i * 3) % 9, ((i * 3) % 9) + 6);
    const following = state.following.has(i);
    return `
      <div class="pagehead" style="--pa:#553a4a; --pb:#241a21;">
        <div class="pagehead__art pagehead__art--circle"><img src="${a.avatar}" alt="${esc(a.title)}"></div>
        <div class="pagehead__meta">
          <div class="pagehead__kind">Verified artist</div>
          <h1 class="pagehead__title">${esc(a.title)}</h1>
          <p class="pagehead__sub">${idxs.length} release${idxs.length === 1 ? "" : "s"} · ${esc(RELEASES[idxs[0] || 0].g)}${following ? " · Following" : ""}</p>
          <div class="pagehead__actions">
            <button class="pill pill--green" data-action="play-release" data-idx="${idxs[0] || 0}"><svg class="ic ic--sm"><use href="#i-play"></use></svg>Play</button>
            <button class="pill ${following ? "pill--outline" : "pill--green"}" data-action="follow" data-idx="${i}" data-artist="${esc(a.title)}" aria-label="${following ? "Unfollow" : "Follow"}" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>
          </div>
        </div>
      </div>
      <div class="detail__body">
        <div class="section__head"><div><div class="section__kicker">Discography</div><h2 class="section__title">Popular</h2></div></div>
        <div class="tracklist">${popular.map((ri) => rowFor(ri, release(ri).album)).join("")}</div>

        <div class="section__head" style="margin-top:32px"><div><div class="section__kicker">Discover</div><h2 class="section__title">Fans also like</h2></div></div>
        <div class="cardgrid cardgrid--sm">
          ${similar
            .map(({ n, a: sa }) =>
              artCard({ cls: "card--circle", cover: sa.cover, title: sa.title, sub: "Artist", route: "artist/" + n, idx: n, kind: "artist" })
            )
            .join("")}
        </div>

        <div class="section__head" style="margin-top:32px"><div><div class="section__kicker">Background</div><h2 class="section__title">About</h2></div></div>
        <div class="about">
          <p class="about__bio">${esc(a.title)} writes ${esc((RELEASES[idxs[0] || 0].g || "").toLowerCase())} that sits
          somewhere between late-night radio and a record shop in the rain. Across ${idxs.length} release${idxs.length === 1 ? "" : "s"} the
          palette stays deliberately narrow — analogue synths, close-mic'd drums, and melodies that
          arrive a half-beat later than you expect.</p>
          <div class="about__row"><dt>Genres</dt><dd>${esc([...new Set(idxs.map((n) => RELEASES[n].g))].join(", "))}</dd></div>
          <div class="about__row"><dt>First release</dt><dd>${idxs.length ? Math.min(...idxs.map((n) => RELEASES[n].y)) : "—"}</dd></div>
          <div class="about__row"><dt>Followers</dt><dd>${(128 + i * 7319).toLocaleString()}</dd></div>
        </div>
      </div>`;
  }

  function miniInfo() {
    const r = state.route;
    if (r.name === "playlist") {
      const p = getPlaylist(r.params.id);
      return p ? { art: playlistCover(p), title: p.title || p.name } : { art: null, title: "Playlist" };
    }
    if (r.name === "album") {
      const a = release(albumIndex(parseInt(r.params.id, 10) || 0));
      return { art: a.cover, title: a.album };
    }
    if (r.name === "artist") {
      const a = allArtists[parseInt(r.params.id, 10) || 0];
      return a ? { art: a.cover, title: a.title } : { art: null, title: "Artist" };
    }
    if (r.name === "library") return { art: null, title: "Your Library" };
    if (r.name === "search") return { art: null, title: "Search" };
    return { art: null, title: "Home" };
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return "Still awake?";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }

  let paintTimer = null;

  /** Applies the view markup, optionally with Spotify's enter/exit transition. */
  function paintView(view, html, animate) {
    const apply = () => {
      view.innerHTML = html;
      view.classList.remove("is-exiting");
      void view.offsetWidth;            // restart the enter animation
      view.classList.add("is-entering");
      staggerItems(view);
      markImagesLoaded(view);
      syncCardPlayStates();
      const canvas = $("#canvas");
      const prev = canvas.style.scrollBehavior;
      canvas.style.scrollBehavior = "auto";
      canvas.scrollTop = 0;
      canvas.style.scrollBehavior = prev;
    };
    clearTimeout(paintTimer);
    if (!animate || prefersReducedMotion()) {
      view.classList.remove("is-entering");
      apply();
      return;
    }
    view.classList.add("is-exiting");
    paintTimer = setTimeout(apply, 170);
  }

  /** Stagger the first section's items so the grid cascades in. */
  function staggerItems(view) {
    const section = view.querySelector(".section");
    if (!section) return;
    section.querySelectorAll(".card, .row").forEach((el, i) => {
      el.style.setProperty("--i", Math.min(i, 8));
    });
  }

  /** Fade artwork in once it has decoded, the way Spotify's image fade-in does. */
  function markImagesLoaded(view) {
    const done = (img) => {
      img.classList.add("is-loaded");
      const art = img.closest(".card__art");
      if (art) art.classList.add("is-loaded");
    };
    view.querySelectorAll("img").forEach((img) => {
      if (img.complete && img.naturalWidth > 0) { done(img); return; }
      img.addEventListener("load", () => done(img), { once: true });
      img.addEventListener("error", () => done(img), { once: true });
    });
  }

  function render(animate) {
    const view = $("#view");
    const r = state.route;
    let html = "";
    if (r.name === "search") html = renderSearch();
    else if (r.name === "library") html = renderLibrary();
    else if (r.name === "playlist") html = renderPlaylist(r.params.id);
    else if (r.name === "album") html = renderAlbum(r.params.id);
    else if (r.name === "artist") html = renderArtist(r.params.id);
    else if (r.name === "liked") html = renderLiked();
    else if (r.name === "genre") html = renderGenre(r.params.id);
    else html = renderHome();
    view.classList.toggle("view--flat", r.name === "search");

    // nav state
    $$(".sidenav__link").forEach((a) => a.classList.toggle("is-active", a.dataset.route === r.name));
    $$(".mobilenav__link").forEach((a) => a.classList.toggle("is-active", a.dataset.route === r.name));
    $("#backBtn").disabled = state.hIndex === 0;
    $("#fwdBtn").disabled = state.hIndex >= state.history.length - 1;
    $("#backBtn").style.opacity = state.hIndex === 0 ? 0.4 : 1;
    $("#fwdBtn").style.opacity = state.hIndex >= state.history.length - 1 ? 0.4 : 1;

    // mini title in the sticky topbar
    const mini = $("#topbarMini");
    mini.innerHTML = "";
    const info = miniInfo();
    if (info) {
      mini.innerHTML = info.art
        ? `<img src="${info.art}" alt=""><strong>${esc(info.title)}</strong>`
        : `<svg class="topbar__mini-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M6.1 9.3c3.9-1 8.1-.7 11.7 1.2M7.3 12.6c3.1-.8 6.6-.5 9.5 1M8.4 15.7c2.4-.6 5-.3 7.3.9" fill="none" stroke="#121212" stroke-width="1.9" stroke-linecap="round"/></svg><strong>${esc(info.title)}</strong>`;
    }

    paintView(view, html, animate);
    paintProgress();
    syncCardPlayStates();
    syncRowHearts();
    renderLibraryList();
    renderFriends();
  }

  /* ── sidebar library ──────────────────────────────────────────────────── */
  function renderLibraryList() {
    const ul = $("#libraryList");
    const liked = `
      <li><a class="libitem" href="#" data-route="liked">
        <span class="libitem__art libitem__art--liked"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.7s-7.5-4.7-9.4-9A5.3 5.3 0 0 1 12 6.2a5.3 5.3 0 0 1 9.4 5.5c-1.9 4.3-9.4 9-9.4 9z"/></svg></span>
        <span class="libitem__name">Liked Songs</span>
      </a></li>`;
    const userItems = state.playlists.map((p) => {
      const active = state.route.name === "playlist" && state.route.params.id === String(p.id);
      return `<li><a class="libitem ${active ? "is-active" : ""}" href="#" data-route="playlist/${p.id}">
        <span class="libitem__art" style="background-image:url('${playlistCover(p)}')"></span>
        <span class="libitem__name">${esc(p.name)}</span>
      </a></li>`;
    }).join("");
    const list = allPlaylists.slice(0, 14).map((p, i) => {
      const active = state.route.name === "playlist" && state.route.params.id === String(i + 1);
      return `<li><a class="libitem ${active ? "is-active" : ""}" href="#" data-route="playlist/${i + 1}">
        <span class="libitem__art" style="background-image:url('${p.cover}')"></span>
        <span class="libitem__name">${esc(p.title)}</span>
      </a></li>`;
    }).join("");
    ul.innerHTML = liked + userItems + list;
  }

  /* ── friend activity panel ────────────────────────────────────────────── */
  let friendTick = 0;

  function renderFriends() {
    $("#socialList").innerHTML = FRIENDS.map((f, fi) => {
      const listen = f.now.r + (fi % 3 === 0 ? (friendTick % 7) : 0);
      const rel = release(((listen - 1) % RELEASES.length + RELEASES.length) % RELEASES.length);
      return `
        <div class="friend">
          <img class="friend__avatar" src="assets/avatars/avatar-${String(f.a).padStart(2, "0")}.svg" alt="${esc(f.n)}">
          <div style="min-width:0">
            <div class="friend__name">${esc(f.n)}</div>
            <div class="friend__act">is listening to <b>${esc(rel.title)}</b></div>
            <a class="friend__track" href="#" data-route="album/${albumIndex(((listen - 1) % RELEASES.length + RELEASES.length) % RELEASES.length)}">
              <img class="friend__cover" src="${rel.cover}" alt="">
              <div class="friend__trackmeta">
                <div class="friend__tracktitle">${esc(rel.title)}</div>
                <div class="friend__trackartist">${esc(rel.artist)}</div>
              </div>
            </a>
          </div>
        </div>`;
    }).join("");
  }

  /** Keeps card play buttons in sync with the current track. */
  function syncRowHearts() {
    $$(".row__like").forEach((b) => {
      const n = parseInt(b.dataset.idx, 10);
      const liked = state.liked.has(n);
      b.innerHTML = `<svg class="ic ic--sm"><use href="#i-${liked ? "heart-fill" : "heart"}"></use></svg>`;
      b.classList.toggle("is-liked", liked);
      b.setAttribute("aria-pressed", String(liked));
    });
  }

  function syncCardPlayStates() {
    const cur = currentIndex();
    $$(".card__play").forEach((btn) => {
      const isCurrent = btn.dataset.kind === "release" && parseInt(btn.dataset.idx, 10) === cur;
      btn.classList.toggle("is-current", isCurrent);
      btn.innerHTML = `<svg class="ic"><use href="#i-${isCurrent && state.playing ? "pause" : "play"}"></use></svg>`;
      btn.setAttribute("aria-label", isCurrent ? "Pause" : "Play");
    });
  }

  /* ── persistence ───────────────────────────────────────────────────────── */
  const STORE_KEY = "spotify-clone.v1";

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        liked: [...state.liked],
        saved: [...state.saved],
        following: [...state.following],
        playlists: state.playlists,
        volume: state.volume,
        view: state.view,
        device: state.device,
        recent: state.recent,
        recentlyPlayed: state.recentlyPlayed
      }));
    } catch (e) { /* storage unavailable — the app still works in-memory */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.liked)) state.liked = new Set(d.liked);
      if (Array.isArray(d.saved)) state.saved = new Set(d.saved);
      if (Array.isArray(d.following)) state.following = new Set(d.following);
      if (Array.isArray(d.playlists)) state.playlists = d.playlists;
      if (typeof d.volume === "number") state.volume = clamp(d.volume, 0, 1);
      if (d.view) state.view = d.view;
      if (d.device) state.device = d.device;
      if (Array.isArray(d.recent)) state.recent = d.recent;
      if (Array.isArray(d.recentlyPlayed)) state.recentlyPlayed = d.recentlyPlayed;
    } catch (e) { /* ignore malformed storage */ }
  }

  /* ── playlists: built-in catalogue + everything the user creates ───────── */
  function getPlaylist(id) {
    const n = parseInt(id, 10);
    if (!n) return null;
    if (n >= 1001) return state.playlists.find((p) => p.id === n) || null;
    return allPlaylists[n - 1] || null;
  }

  function playlistTracks(pl, id) {
    if (!pl) return [];
    if (Array.isArray(pl.tracks)) return pl.tracks;
    return tracksFor((parseInt(id, 10) || 1) - 1, 24);
  }

  function playlistCover(pl) {
    if (!pl) return "";
    if (pl.cover) return pl.cover;
    const first = (pl.tracks || [])[0];
    if (first !== undefined) return release(first).cover;
    return "assets/covers/playlist-01.svg";
  }

  function playlistSubtitle(pl) {
    const n = (pl.tracks || []).length;
    return `Playlist • ${n} song${n === 1 ? "" : "s"}`;
  }

  /* ── context menu ──────────────────────────────────────────────────────── */
  let menuItems = [];

  function openMenu(x, y, spec) {
    const m = $("#contextMenu");
    const items = Array.isArray(spec) ? spec : spec.items || [];
    const label = Array.isArray(spec) ? "" : spec.label;
    menuItems = items;
    m.innerHTML =
      (label ? `<div class="menu__label">${esc(label)}</div>` : "") +
      items
        .map((it, i) =>
          it.divider
            ? '<div class="menu__sep"></div>'
            : `<button class="menu__item ${it.danger ? "menu__item--danger" : ""}" role="menuitem" data-menu="${i}">
                 ${it.icon ? `<svg class="ic ic--sm"><use href="#i-${it.icon}"></use></svg>` : ""}
                 <span>${esc(it.label)}</span>
               </button>`
        )
        .join("");
    m.hidden = false;
    const r = m.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 12);
    const top = Math.min(y, window.innerHeight - r.height - 12);
    m.style.left = Math.max(8, left) + "px";
    m.style.top = Math.max(8, top) + "px";
  }

  function closeMenu() {
    $("#contextMenu").hidden = true;
    menuItems = [];
  }

  function releaseMenuItems(idx) {
    const r = release(idx);
    const liked = state.liked.has(idx);
    return [
      { label: "Add to queue", icon: "plus", action: "queue-add", idx },
      { label: "Add to playlist", icon: "plus", action: "add-to-playlist", idx },
      { divider: true },
      { label: "Go to album", icon: "library", action: "go-album", idx },
      { label: "Go to artist", icon: "search", action: "go-artist", idx },
      { divider: true },
      {
        label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: "heart",
        action: "toggle-like",
        idx
      }
    ];
  }

  /* ── queue panel ───────────────────────────────────────────────────────── */
  function queueOrder() {
    const n = state.queue.length;
    const out = [];
    for (let k = 1; k < n; k++) out.push((state.qPos + k) % n);
    return out;
  }

  function renderQueuePanel() {
    const cur = currentIndex();
    const now = $("#queueNow");
    const next = $("#queueNext");
    if (!now || !next) return;

    if (cur === undefined || !state.queue.length) {
      now.innerHTML = `<p class="queuepanel__title">Now playing</p><p class="queueitem__a">Nothing queued yet.</p>`;
      next.innerHTML = "";
      return;
    }
    const r = release(cur);
    now.innerHTML = `
      <p class="queuepanel__title">Now playing</p>
      <div class="queueitem queueitem--now">
        <img class="queueitem__art" src="${r.cover}" alt="">
        <div style="min-width:0">
          <div class="queueitem__t">${esc(r.title)}</div>
          <div class="queueitem__a">${esc(r.artist)}</div>
        </div>
        <span></span>
      </div>`;

    const order = queueOrder();
    next.innerHTML = `
      <p class="queuepanel__title">Next up</p>` +
      (order.length
        ? order
            .map(
              (qi) => `
        <div class="queueitem" data-queue-idx="${qi}">
          <img class="queueitem__art" src="${release(qi).cover}" alt="">
          <div style="min-width:0">
            <div class="queueitem__t">${esc(release(qi).title)}</div>
            <div class="queueitem__a">${esc(release(qi).artist)}</div>
          </div>
          <button class="icon-btn icon-btn--ghost queueitem__x" data-action="queue-remove" data-idx="${qi}" aria-label="Remove from queue">
            <svg class="ic ic--sm"><use href="#i-close"></use></svg>
          </button>
        </div>`
            )
            .join("")
        : `<p class="queueitem__a">Nothing queued next.</p>`);
  }

  function toggleQueue(force) {
    const panel = $("#queuePanel");
    const open = force === undefined ? !panel.classList.contains("is-open") : force;
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    if (open) renderQueuePanel();
  }

  /* ── device popover ────────────────────────────────────────────────────── */
  const DEVICES = [
    { id: "web", name: "This browser", detail: "Chrome on Linux", kind: "browser" },
    { id: "phone", name: "Kaya's Phone", detail: "Android · Spotify", kind: "phone" },
    { id: "laptop", name: "Studio MacBook", detail: "macOS · Spotify", kind: "laptop" },
    { id: "tv", name: "Living Room TV", detail: "Chromecast", kind: "tv" }
  ];

  function renderDevices() {
    const p = $("#devicePopover");
    p.innerHTML =
      `<div class="popover__title">Connect to a device</div>` +
      DEVICES.map(
        (d) => `
        <button class="popover__item ${state.device === d.id ? "is-current" : ""}" data-action="pick-device" data-device="${d.id}">
          <span class="popover__dot"></span>
          <span style="min-width:0">
            <div style="font-weight:600">${esc(d.name)}</div>
            <div style="font-size:12px;color:var(--text-subdued)">${esc(d.detail)}</div>
          </span>
        </button>`
      ).join("");
  }

  function toggleDevices(anchor) {
    const p = $("#devicePopover");
    if (!p.hidden) { p.hidden = true; return; }
    renderDevices();
    p.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = p.getBoundingClientRect().width;
    p.style.left = Math.max(8, Math.min(r.left - w / 2 + r.width / 2, window.innerWidth - w - 12)) + "px";
    p.style.top = Math.max(8, r.top - p.getBoundingClientRect().height - 10) + "px";
  }

  /* ── command palette ─────────────────────────────────────────────────── */
  const CMD_STATIC = [
    { id: "nav-home", label: "Home", icon: "home", run: () => go("home") },
    { id: "nav-search", label: "Search", icon: "search", run: () => go("search") },
    { id: "nav-library", label: "Your Library", icon: "library", run: () => go("library") },
    { id: "nav-liked", label: "Liked Songs", icon: "heart", run: () => go("liked") },
    { id: "act-create", label: "Create playlist", icon: "plus", run: () => { state.pendingTrack = undefined; openCreatePlaylist(); } },
    { id: "act-queue", label: "Open queue", icon: "queue", run: () => toggleQueue(true) },
    { id: "act-devices", label: "Connect to a device", icon: "device", run: () => toggleDevices($("#deviceBtn")) },
    { id: "act-shortcuts", label: "Keyboard shortcuts", icon: "dots", run: () => openShortcuts() },
    { id: "act-sidebar", label: "Toggle sidebar", icon: "list", run: () => $("#app").classList.toggle("is-collapsed") }
  ];

  let cmdResults = [];
  let cmdIndex = 0;

  function cmdMatch(q) {
    const needle = q.trim().toLowerCase();
    const out = [];
    const push = (group, title, sub, run, art, icon, circle) =>
      out.push({ group, title, sub, run, art, icon, circle });

    for (const a of CMD_STATIC) {
      if (!needle || a.label.toLowerCase().includes(needle)) push("Actions", a.label, "", a.run, null, a.icon);
    }
    if (!needle) {
      for (const p of state.playlists) push("Your playlists", p.name, "Playlist", () => go("playlist", String(p.id)), playlistCover(p), null);
      for (const p of allPlaylists.slice(0, 6)) push("Your playlists", p.title, p.sub, () => go("playlist", String(allPlaylists.indexOf(p) + 1)), p.cover, null);
      return out;
    }
    for (const p of state.playlists) {
      if (p.name.toLowerCase().includes(needle)) push("Your playlists", p.name, "Playlist", () => go("playlist", String(p.id)), playlistCover(p), null);
    }
    for (const p of allPlaylists) {
      if (p.title.toLowerCase().includes(needle)) push("Playlists", p.title, p.sub, () => go("playlist", String(allPlaylists.indexOf(p) + 1)), p.cover, null);
    }
    for (const a of allArtists) {
      if (a.title.toLowerCase().includes(needle)) {
        const n = allArtists.indexOf(a);
        push("Artists", a.title, "Artist", () => go("artist", String(n)), a.avatar, null, true);
      }
    }
    for (const r of allReleases) {
      const n = allReleases.indexOf(r);
      if (r.title.toLowerCase().includes(needle)) push("Songs", r.title, r.artist, () => { go("album", String(albumIndex(n))); playIndex(n); }, r.cover, null);
    }
    for (const g of [...new Set(RELEASES.map((x) => x.g))]) {
      if (g.toLowerCase().includes(needle)) {
        const first = RELEASES.findIndex((x) => x.g === g);
        push("Genres", g, "Genre", () => go("genre", encodeURIComponent(g)), release(first).cover, null);
      }
    }
    return out;
  }

  function renderCmd() {
    const q = $("#cmdpalInput").value;
    cmdResults = cmdMatch(q).slice(0, 24);
    cmdIndex = 0;
    if (!cmdResults.length) {
      $("#cmdpalList").innerHTML = `<div class="cmdpal__empty">No matches for “${esc(q)}”</div>`;
      return;
    }
    let html = "";
    let group = null;
    cmdResults.forEach((r, i) => {
      if (r.group !== group) {
        group = r.group;
        html += `<div class="cmdpal__group">${esc(group)}</div>`;
      }
      html += `
        <button class="cmdpal__item ${i === 0 ? "is-active" : ""}" data-cmd="${i}">
          ${r.art ? `<img class="cmdpal__item-art ${r.circle ? "cmdpal__item-art--circle" : ""}" src="${r.art}" alt="">` : `<svg class="ic"><use href="#i-${r.icon || "search"}"></use></svg>`}
          <span style="min-width:0">
            <div class="cmdpal__item-t">${esc(r.title)}</div>
            ${r.sub ? `<div class="cmdpal__item-s">${esc(r.sub)}</div>` : ""}
          </span>
        </button>`;
    });
    $("#cmdpalList").innerHTML = html;
  }

  function paintCmdActive() {
    $$("#cmdpalList .cmdpal__item").forEach((el, i) => el.classList.toggle("is-active", i === cmdIndex));
    const active = $$("#cmdpalList .cmdpal__item")[cmdIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function openCmdpal() {
    closeModal();
    $("#shortcuts").hidden = true;
    $("#devicePopover").hidden = true;
    closeMenu();
    $("#cmdpal").hidden = false;
    const input = $("#cmdpalInput");
    input.value = "";
    renderCmd();
    input.focus();
  }

  function closeCmdpal() {
    $("#cmdpal").hidden = true;
  }

  /* ── recents ─────────────────────────────────────────────────────────── */
  function pushRecent(list, value, cap) {
    const i = list.indexOf(value);
    if (i > -1) list.splice(i, 1);
    list.unshift(value);
    if (list.length > cap) list.length = cap;
  }

  function notePlayed(idx) {
    pushRecent(state.recentlyPlayed, idx, 12);
    saveState();
  }

  function recentSearchesHTML() {
    if (!state.recent.length) return "";
    return `
      <section class="section">
        <div class="section__head"><div><div class="section__kicker">History</div><h2 class="section__title">Recent searches</h2></div></div>
        <div style="display:grid;gap:2px">
          ${state.recent
            .map(
              (t) => `
            <button class="recent" data-action="use-recent" data-term="${esc(t)}">
              <svg class="ic"><use href="#i-clock"></use></svg>
              <span class="recent__t">${esc(t)}</span>
              <span class="recent__x" data-action="drop-recent" data-term="${esc(t)}"><svg class="ic ic--sm"><use href="#i-close"></use></svg></span>
            </button>`
            )
            .join("")}
        </div>
      </section>`;
  }

  /* ── modals ────────────────────────────────────────────────────────────── */
  function openModal(html) {
    closeCmdpal();
    $("#shortcuts").hidden = true;
    $("#devicePopover").hidden = true;
    closeMenu();
    $("#modalCard").innerHTML = html;
    $("#modal").hidden = false;
  }
  function closeModal() {
    $("#modal").hidden = true;
    $("#modalCard").innerHTML = "";
  }

  function openCreatePlaylist() {
    openModal(`
      <h2 class="modal__title">Create playlist</h2>
      <p class="modal__desc">Give it a name — it appears in your library straight away.</p>
      <div class="modal__field">
        <label for="newPlaylistName">Name</label>
        <input class="modal__input" id="newPlaylistName" placeholder="My playlist" maxlength="60">
      </div>
      <div class="modal__field">
        <label for="newPlaylistDesc">Description</label>
        <input class="modal__input" id="newPlaylistDesc" placeholder="What's it about?" maxlength="120">
      </div>
      <div class="modal__actions">
        <button class="pill pill--ghost" data-action="close-modal">Cancel</button>
        <button class="pill pill--green" data-action="create-playlist">Create</button>
      </div>`);
    const input = $("#newPlaylistName");
    if (input) { input.focus(); input.select(); }
  }

  function createPlaylist(withTrack) {
    const name = ($("#newPlaylistName")?.value || "").trim() || "New Playlist";
    const desc = ($("#newPlaylistDesc")?.value || "").trim();
    const pl = {
      id: 1001 + state.playlists.length,
      name,
      desc,
      tracks: [],
      cover: null
    };
    // attach the pending track *before* the page renders, so the new
    // playlist opens with its first song already in place
    if (typeof withTrack === "number") pl.tracks.push(withTrack);
    state.playlists.push(pl);
    saveState();
    closeModal();
    renderLibraryList();
    toast(`Playlist “${name}” created`);
    go("playlist", String(pl.id));
  }

  function openAddToPlaylist(idx) {
    const r = release(idx);
    state.pendingTrack = idx;
    const targets = [
      ...state.playlists.map((p) => ({ id: p.id, name: p.name, cover: playlistCover(p), count: p.tracks.length })),
      ...allPlaylists.slice(0, 6).map((p, i) => ({ id: i + 1, name: p.title, cover: p.cover, count: null }))
    ];
    openModal(`
      <h2 class="modal__title">Add to playlist</h2>
      <p class="modal__desc">“${esc(r.title)}” by ${esc(r.artist)}</p>
      <div style="display:grid;gap:2px">
        ${targets
          .map(
            (t) => `
          <button class="modal__pick" data-action="add-to-playlist" data-idx="${idx}" data-pl="${t.id}">
            <img class="modal__pick-art" src="${t.cover}" alt="">
            <span style="min-width:0">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
              ${t.count !== null ? `<div style="font-size:12px;color:var(--text-subdued)">${t.count} songs</div>` : ""}
            </span>
          </button>`
          )
          .join("")}
      </div>
      <div class="modal__actions">
        <button class="pill pill--ghost" data-action="close-modal">Cancel</button>
        <button class="pill pill--green" data-action="open-create-from-add">New playlist</button>
      </div>`);
  }

  function addToPlaylist(releaseIdx, playlistId) {
    const pl = getPlaylist(playlistId);
    if (!pl) return;
    state.pendingTrack = undefined;
    if (!Array.isArray(pl.tracks)) pl.tracks = [];
    if (pl.tracks.includes(releaseIdx)) {
      toast(`Already in “${pl.title || pl.name}”`, true);
    } else {
      pl.tracks.push(releaseIdx);
      saveState();
      toast(`Added to “${pl.title || pl.name}”`);
    }
    closeModal();
  }

  /* ── keyboard shortcuts overlay ────────────────────────────────────────── */
  const SHORTCUTS = [
    { group: "Playback", items: [["Play / pause", "Space"], ["Next track", "Alt + →"], ["Previous track", "Alt + ←"], ["Seek forward", "Shift + →"]] },
    { group: "Navigation", items: [["Search", "/"], ["Back", "Alt + ←"], ["Forward", "Alt + →"], ["Close overlay", "Esc"]] },
    { group: "Panels", items: [["Queue", "Q"], ["Devices", "D"], ["Shortcuts", "?"]] }
  ];

  function openShortcuts() {
    closeModal();
    closeCmdpal();
    $("#devicePopover").hidden = true;
    closeMenu();
    $("#shortcutsCard").innerHTML = `
      <div style="position:relative">
        <h2 class="modal__title">Keyboard shortcuts</h2>
        <p class="modal__desc">Everything you can drive without the mouse.</p>
        <div class="shortcuts__grid">
          ${SHORTCUTS.map(
            (g) => `
            <div class="shortcuts__group">
              <h3>${esc(g.group)}</h3>
              ${g.items.map(([label, key]) => `<div class="shortcuts__row"><span>${esc(label)}</span><kbd>${esc(key)}</kbd></div>`).join("")}
            </div>`
          ).join("")}
        </div>
        <div class="modal__actions"><button class="pill pill--ghost" data-action="close-shortcuts">Close</button></div>
      </div>`;
    $("#shortcuts").hidden = false;
  }

  /* ── now playing view ─────────────────────────────────────────────────── */
  function paintNowMeta() {
    const idx = currentIndex();
    const r = release(idx);
    $("#nowTitle").textContent = r.title;
    $("#nowArtist").textContent = r.artist;

    const lines = lyricLines(idx);
    $("#lyricsBody").innerHTML = lines.map((l, i) => {
      const label = i % 2 === 0 ? `<span style="display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.42);margin-bottom:6px;font-family:var(--font-ui)">${LYRIC_LABELS[Math.floor(i / 2) % LYRIC_LABELS.length]}</span>` : "";
      const cls = i === 4 ? "is-current" : i === 5 ? "is-next" : "";
      return `<p class="${cls}">${label}${esc(l)}</p>`;
    }).join("");

    const artistIdx = Math.max(0, allArtists.findIndex((a) => a.title === r.artist));
    const artistRel = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].a === r.artist);
    $("#aboutBody").innerHTML = `
      <a class="about__artist" href="#" data-route="artist/${artistIdx}">
        <img class="about__artist-art" src="${allArtists[artistIdx].avatar}" alt="">
        <span style="min-width:0">
          <div class="about__artist-name">${esc(r.artist)}</div>
          <div class="about__artist-sub">Artist · ${artistRel.length} release${artistRel.length === 1 ? "" : "s"}</div>
        </span>
      </a>
      <dl class="about">
        <div class="about__row"><dt>Album</dt><dd>${esc(r.title)}</dd></div>
        <div class="about__row"><dt>Artist</dt><dd>${esc(r.artist)}</dd></div>
        <div class="about__row"><dt>Released</dt><dd>${r.year}</dd></div>
        <div class="about__row"><dt>Genre</dt><dd>${esc(r.genre)}</dd></div>
        <div class="about__row"><dt>Length</dt><dd>${fmtTime(r.dur)}</dd></div>
      </dl>
      <p class="about__bio">${esc(r.artist)} blends ${esc(r.genre.toLowerCase())} textures with slow, cinematic arrangements.
      ${esc(r.title)} is the track that anchors the set — built around a single repeating figure that gradually opens up.</p>
      <div class="about__credits">
        <div class="about__credits-head">Song credits</div>
        <div class="about__credit"><span>Written by</span><b>${esc(r.artist)}, R. Solano</b></div>
        <div class="about__credit"><span>Produced by</span><b>H. Varga at Studio Nord</b></div>
        <div class="about__credit"><span>Recorded at</span><b>Studio Nord, Room A</b></div>
        <div class="about__credit"><span>Mastered by</span><b>K. Oduya</b></div>
        <div class="about__credit"><span>Label</span><b>${esc(r.artist)} Records</b></div>
        <div class="about__credit"><span>Released</span><dd>${r.year}</dd></div>
      </div>`;

    const next = [];
    for (let k = 1; k <= 6; k++) {
      const j = (state.qPos + k) % state.queue.length;
      const ni = state.queue[j];
      if (ni === undefined) break;
      next.push(ni);
    }
    $("#upnextBody").innerHTML = next.map((ni) => {
      const nr = release(ni);
      return `<div class="upnext__row" data-action="play-release" data-idx="${ni}">
        <img class="upnext__art" src="${nr.cover}" alt="">
        <div style="min-width:0"><div class="upnext__t">${esc(nr.title)}</div><div class="upnext__a">${esc(nr.artist)}</div></div>
        <div class="upnext__a">${fmtTime(nr.dur)}</div>
      </div>`;
    }).join("") || `<p class="about__bio">Nothing queued yet.</p>`;
  }

  let lastLyricIndex = -1;
  let nowTab = "lyrics";

  /** Scrolls the lyrics panel and highlights the line under the playhead. */
  function syncLyrics() {
    if (nowTab !== "lyrics") return;
    const idx = currentIndex();
    const rel = RELEASES[idx];
    if (!rel) return;
    const lines = lyricLines(idx);
    const per = rel.d / lines.length;
    const li = Math.min(lines.length - 1, Math.floor(state.position / per));
    if (li === lastLyricIndex) return;
    lastLyricIndex = li;
    const body = $("#lyricsBody");
    const paras = body.querySelectorAll("p");
    paras.forEach((p, i) => {
      p.classList.toggle("is-current", i === li);
      p.classList.toggle("is-next", i === li + 1);
    });
    const pane = body.parentElement;
    const active = paras[li];
    if (active) {
      const target = active.offsetTop - pane.clientHeight / 2 + active.offsetHeight / 2;
      pane.scrollTo({ top: Math.max(0, target), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }

  let spectrumBars = [];
  function buildSpectrum() {
    const el = $("#spectrum");
    el.innerHTML = "";
    spectrumBars = [];
    for (let i = 0; i < 56; i++) {
      const b = document.createElement("i");
      el.appendChild(b);
      spectrumBars.push(b);
    }
  }

  function animateSpectrum() {
    requestAnimationFrame(animateSpectrum);
    const analyser = Sound.analyser;
    let data = null;
    if (analyser && state.playing) {
      data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
    }
    const t = Date.now() / 1000;
    spectrumBars.forEach((bar, i) => {
      const n = spectrumBars.length;
      // synthetic envelope: a soft mound with a travelling ripple
      const mound = 26 + 30 * Math.exp(-Math.pow((i - n * 0.38) / (n * 0.42), 2));
      const ripple = 18 * Math.abs(Math.sin(t * 2.2 + i * 0.33)) + 10 * Math.abs(Math.sin(t * 0.9 + i * 0.11));
      let h = mound * 0.45 + ripple * 0.4;
      if (data) {
        const bin = Math.min(data.length - 1, Math.floor(Math.pow(i / n, 1.5) * data.length));
        const v = data[bin] / 255;
        h = Math.max(v * 95, h);
      }
      if (!state.playing) h = 9;
      bar.style.height = clamp(h, 5, 100) + "%";
    });
  }

  /** Delta that maps an element laid out at `from` onto the box at `to`. */
  function artworkDelta(from, to) {
    return {
      dx: (from.left + from.width / 2) - (to.left + to.width / 2),
      dy: (from.top + from.height / 2) - (to.top + to.height / 2),
      sx: from.width / to.width,
      sy: from.height / to.height
    };
  }

  /** Flies the artwork from the player-bar thumbnail into the full-screen view. */
  function openNowView() {
    const now = $("#nowView");
    const art = $("#nowArt");
    const small = $("#npCover").getBoundingClientRect();
    now.classList.remove("is-closing");
    now.classList.add("is-open");
    now.setAttribute("aria-hidden", "false");
    paintNowMeta();
    if (prefersReducedMotion()) return;
    const big = art.getBoundingClientRect();
    if (!small.width || !big.width) return;
    const d = artworkDelta(small, big);
    art.style.transition = "none";
    art.style.borderRadius = "4px";
    art.style.transform = `translate(${d.dx}px, ${d.dy}px) scale(${d.sx}, ${d.sy})`;
    void art.offsetWidth;
    art.style.transition =
      "transform 420ms cubic-bezier(0, 0, .2, 1), border-radius 420ms cubic-bezier(0, 0, .2, 1)";
    art.style.borderRadius = "10px";
    art.style.transform = "translate(0px, 0px) scale(1)";
  }

  /** Flies the artwork back down into the player bar. */
  function closeNowView() {
    const now = $("#nowView");
    const art = $("#nowArt");
    if (prefersReducedMotion()) {
      now.classList.remove("is-open");
      now.setAttribute("aria-hidden", "true");
      return;
    }
    const big = art.getBoundingClientRect();
    const small = $("#npCover").getBoundingClientRect();
    const finish = () => {
      now.classList.remove("is-open", "is-closing");
      now.setAttribute("aria-hidden", "true");
      art.style.transition = "";
      art.style.transform = "";
      art.style.borderRadius = "";
    };
    if (!big.width || !small.width) { finish(); return; }
    const d = artworkDelta(small, big);
    art.style.transition = "none";
    art.style.transform = "translate(0px, 0px) scale(1)";
    void art.offsetWidth;
    art.style.transition =
      "transform 340ms cubic-bezier(.8, 0, 1, 1), border-radius 340ms cubic-bezier(.8, 0, 1, 1)";
    art.style.borderRadius = "4px";
    art.style.transform = `translate(${d.dx}px, ${d.dy}px) scale(${d.sx}, ${d.sy})`;
    setTimeout(finish, 330);
  }

  /* ── scrubbing ────────────────────────────────────────────────────────── */
  function bindTrack(el, onChange) {
    if (!el) return;
    let dragging = false;
    const ratio = (e) => {
      const r = el.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      el.classList.add("is-dragging");
      el.setPointerCapture(e.pointerId);
      onChange(ratio(e), false);
    });
    el.addEventListener("pointermove", (e) => { if (dragging) onChange(ratio(e), false); });
    el.addEventListener("pointerup", (e) => {
      dragging = false;
      el.classList.remove("is-dragging");
      onChange(ratio(e), true);
    });
    el.addEventListener("pointercancel", () => { dragging = false; el.classList.remove("is-dragging"); });
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === "ArrowRight") { onChange(clamp(currentRatio() + step, 0, 1), true); e.preventDefault(); }
      if (e.key === "ArrowLeft") { onChange(clamp(currentRatio() - step, 0, 1), true); e.preventDefault(); }
    });
  }
  function seekBy(seconds) {
    const rel = RELEASES[currentIndex()];
    if (!rel) return;
    state.position = clamp(state.position + seconds, 0, rel.d);
    paintProgress();
  }

  /* ── media session (OS media keys, lock screen) ─────────────────────── */
  function updateMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const i = currentIndex();
    const r = RELEASES[i];
    if (!r) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: r.t,
        artist: r.a,
        album: r.al,
        artwork: [{ src: r.cover, sizes: "any", type: "image/svg+xml" }]
      });
      const handlers = {
        play: () => { if (!state.playing) togglePlay(); },
        pause: () => { if (state.playing) togglePlay(); },
        previoustrack: () => prevTrack(),
        nexttrack: () => nextTrack(false),
        seekbackward: (d) => seekBy(-(d && d.seekOffset ? d.seekOffset : 15)),
        seekforward: (d) => seekBy(d && d.seekOffset ? d.seekOffset : 15),
        seekto: (d) => {
          const rel = RELEASES[currentIndex()];
          if (rel && d && typeof d.seekTime === "number") {
            state.position = clamp(d.seekTime, 0, rel.d);
            paintProgress();
          }
        },
        stop: () => { state.playing = false; paintPlayer(); }
      };
      Object.keys(handlers).forEach((k) => {
        try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) { /* unsupported action */ }
      });
      navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
    } catch (e) { /* MediaMetadata unavailable */ }
  }

  function currentRatio() {
    const rel = RELEASES[currentIndex()];
    return rel ? clamp(state.position / rel.d, 0, 1) : 0;
  }

  /* ── events ───────────────────────────────────────────────────────────── */
  function onAction(action, el) {
    const idx = el.dataset.idx !== undefined ? parseInt(el.dataset.idx, 10) : null;
    const kind = el.dataset.kind;

    switch (action) {
      case "play-hero":
        playQueue([0, 1, 2, 3, 4, 5], 0);
        break;
      case "play-card":
      case "play-release":
        if (kind === "playlist") {
          const pid = idx;
          const pl = getPlaylist(pid);
          if (!pl) break;
          const tracks = playlistTracks(pl, String(pid));
          state.queueMeta = state.queueMeta || {};
          const label = pl.title || pl.name;
          tracks.forEach((t) => { state.queueMeta[t] = label; });
          playQueue(tracks, 0);
        } else if (kind === "artist") {
          const rels = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].a === allArtists[idx].title);
          playQueue(rels.length ? rels : [idx], 0);
        } else if (kind === "genre") {
          const name = RELEASES[idx].g;
          const idxs = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].g === name);
          state.queueMeta = state.queueMeta || {};
          idxs.forEach((t) => { state.queueMeta[t] = name; });
          playQueue(idxs.length ? idxs : [idx], 0);
        } else {
          playIndex(idx);
        }
        break;
      case "play-genre": {
        const name = el.dataset.genre || (RELEASES[el.dataset.idx] || {}).g;
        const idxs = RELEASES.map((_, n) => n).filter((n) => RELEASES[n].g === name);
        if (!idxs.length) break;
        state.queueMeta = state.queueMeta || {};
        idxs.forEach((t) => { state.queueMeta[t] = name; });
        playQueue(idxs, 0);
        break;
      }
      case "play-liked": {
        const likedIdx = [...state.liked].sort((a, b) => a - b);
        if (!likedIdx.length) { toast("No liked songs yet", true); break; }
        state.queueMeta = state.queueMeta || {};
        likedIdx.forEach((t) => { state.queueMeta[t] = "Liked Songs"; });
        playQueue(likedIdx, 0);
        break;
      }
      case "play-list": {
        const pid = idx;
        const pl = getPlaylist(pid);
        if (!pl) break;
        const tracks = playlistTracks(pl, String(pid));
        state.queueMeta = state.queueMeta || {};
        const label = pl.title || pl.name;
        tracks.forEach((t) => { state.queueMeta[t] = label; });
        playQueue(tracks, 0);
        break;
      }
      case "like":
      case "like-idx": {
        const target = idx;
        if (state.liked.has(target)) { state.liked.delete(target); toast("Removed from Liked Songs", true); }
        else { state.liked.add(target); toast("Added to Liked Songs"); }
        saveState();
        paintPlayer();
        break;
      }
      case "toggle-like": {
        if (state.liked.has(idx)) {
          state.liked.delete(idx);
          toast("Removed from Liked Songs", true, () => {
            state.liked.add(idx);
            saveState();
            paintPlayer();
            toast("Added to Liked Songs");
          });
        } else { state.liked.add(idx); toast("Added to Liked Songs"); }
        saveState();
        paintPlayer();
        break;
      }
      case "queue-add": {
        state.queue.splice(state.qPos + 1, 0, idx);
        toast("Added to queue");
        renderQueuePanel();
        break;
      }
      case "queue-remove": {
        const qi = state.queue.indexOf(idx);
        if (qi > -1 && qi !== state.qPos) {
          state.queue.splice(qi, 1);
          if (qi < state.qPos) state.qPos--;
          toast("Removed from queue", true, () => {
            state.queue.splice(qi, 0, idx);
            if (qi <= state.qPos) state.qPos++;
            renderQueuePanel();
          });
        }
        break;
      }
      case "add-to-playlist": openAddToPlaylist(idx); break;
      case "open-create-from-add": {
        closeModal();
        openCreatePlaylist();
        break;
      }
      case "create-playlist": {
        const pending = state.pendingTrack;
        state.pendingTrack = undefined;
        createPlaylist(typeof pending === "number" ? pending : undefined);
        break;
      }
      case "close-modal": closeModal(); break;
      case "close-cmdpal": closeCmdpal(); break;
      case "use-recent": {
        const input = $("#searchInput");
        input.value = el.dataset.term || "";
        $("#clearSearch").hidden = false;
        go("search");
        render();
        break;
      }
      case "drop-recent": {
        const term = el.dataset.term;
        state.recent = state.recent.filter((t) => t !== term);
        saveState();
        render();
        break;
      }
      case "queue-add-list": {
        const pl = getPlaylist(el.dataset.idx);
        if (!pl) break;
        const tracks = playlistTracks(pl, String(pl.id));
        state.queue.splice(state.qPos + 1, 0, ...tracks);
        toast(`Added ${tracks.length} songs to queue`);
        renderQueuePanel();
        break;
      }
      case "remove-playlist": {
        const pl = getPlaylist(el.dataset.idx);
        if (!pl) break;
        if (pl.id >= 1001) {
          const snapshot = { ...pl, tracks: pl.tracks.slice() };
          const at = state.playlists.indexOf(pl);
          state.playlists = state.playlists.filter((p) => p.id !== pl.id);
          saveState();
          toast(`Removed “${pl.name}” from your library`, true, () => {
            state.playlists.splice(Math.max(0, at), 0, snapshot);
            saveState();
            renderLibraryList();
            render();
            toast(`Restored “${snapshot.name}”`);
          });
          if (state.route.name === "playlist" && state.route.params.id === String(pl.id)) go("library");
          else { renderLibraryList(); render(); }
        } else {
          toast("Built-in playlists can't be removed", true);
        }
        break;
      }
      case "go-artist-card": {
        const ai = allArtists.findIndex((a) => a.title === release(el.dataset.idx).artist);
        go("artist", String(Math.max(0, ai)));
        break;
      }
      case "close-shortcuts": $("#shortcuts").hidden = true; break;
      case "pick-device": {
        const d = DEVICES.find((x) => x.id === el.dataset.device);
        state.device = el.dataset.device;
        saveState();
        $("#devicePopover").hidden = true;
        toast(`Playing on ${d ? d.name : "this device"}`);
        break;
      }
      case "go-album": go("album", String(albumIndex(idx))); break;
      case "go-artist": {
        const ai = allArtists.findIndex((a) => a.title === release(idx).artist);
        go("artist", String(Math.max(0, ai)));
        break;
      }
      case "queue": {
        state.queue.splice(state.qPos + 1, 0, idx);
        toast("Added to queue");
        break;
      }
      case "like-playlist": {
        if (state.saved.has(idx)) { state.saved.delete(idx); toast("Removed from your library", true); }
        else { state.saved.add(idx); toast("Added to your library"); }
        break;
      }
      case "follow": {
        const ai = allArtists.findIndex((a) => a.title === (el.dataset.artist || ""));
        const key = ai > -1 ? ai : parseInt(el.dataset.idx, 10);
        if (state.following.has(key)) { state.following.delete(key); toast("Unfollowed", true); }
        else { state.following.add(key); toast("You're now following this artist"); }
        saveState();
        render();
        break;
      }
      case "toggle-view":
        state.view = state.view === "grid" ? "list" : "grid";
        saveState();
        render();
        break;
      case "noop":
        break;
    }
  }

  function bind() {
    // global delegated clicks
    document.addEventListener("click", (e) => {
      const routeEl = e.target.closest("[data-route]");
      if (routeEl) {
        e.preventDefault();
        const r = routeEl.dataset.route;
        if (r === "home" || r === "search" || r === "library") go(r);
        else {
          const [name, id] = r.split("/");
          go(name, id);
        }
        if (window.innerWidth <= 760) $("#sidebar").classList.remove("is-open");
        return;
      }
      const actEl = e.target.closest("[data-action]");
      if (actEl) {
        e.preventDefault();
        e.stopPropagation();
        onAction(actEl.dataset.action, actEl);
      }
    });

    // sidebar
    $("#collapseBtn").addEventListener("click", () => {
      $("#app").classList.toggle("is-collapsed");
      toast($("#app").classList.contains("is-collapsed") ? "Sidebar collapsed" : "Sidebar expanded", true);
    });
    $("#navToggle").addEventListener("click", () => {
      const side = $("#sidebar");
      if (window.innerWidth <= 760) side.classList.toggle("is-open");
      else $("#app").classList.toggle("is-collapsed");
    });
    $("#filterBtn").addEventListener("click", (e) => {
      const b = e.currentTarget;
      const on = b.getAttribute("aria-pressed") === "true";
      b.setAttribute("aria-pressed", String(!on));
      toast(!on ? "Showing playlists" : "Showing all", true);
    });
    $("#createBtn").addEventListener("click", () => { state.pendingTrack = undefined; openCreatePlaylist(); });
    $("#upgradeBtn").addEventListener("click", () => toast("Upgrade — Premium features are not part of this clone", true));
    $("#installBtn").addEventListener("click", () => toast("Install App — desktop only", true));
    $("#profileBtn").addEventListener("click", () => toast("Signed in as Kaya Mori", true));
    $("#socialInvite").addEventListener("click", () => toast("Invite link copied", true));
    $("#socialClose").addEventListener("click", () => $("#social").classList.remove("is-forced"));

    // friend activity keeps moving, the way the real activity panel does
    setInterval(() => {
      friendTick++;
      if ($("#social") && !$("#social").hidden) renderFriends();
    }, 9000);

    // history
    $("#backBtn").addEventListener("click", back);
    $("#fwdBtn").addEventListener("click", forward);

    // search
    const input = $("#searchInput");
    let searchTimer = null;
    input.addEventListener("input", () => {
      $("#clearSearch").hidden = !input.value;
      if (state.route.name !== "search" && input.value) go("search");
      else if (state.route.name === "search") render();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const term = input.value.trim();
        if (term.length >= 2) {
          pushRecent(state.recent, term, 8);
          saveState();
        }
      }, 900);
    });
    input.addEventListener("focus", () => $("#topbar").classList.add("is-searching"));
    input.addEventListener("blur", () => { if (!input.value) $("#topbar").classList.remove("is-searching"); });
    $("#clearSearch").addEventListener("click", () => {
      input.value = "";
      $("#clearSearch").hidden = true;
      if (state.route.name === "search") render();
      input.focus();
    });

    // transport
    $("#playBtn").addEventListener("click", togglePlay);
    $("#nowPlay").addEventListener("click", togglePlay);
    $("#nextBtn").addEventListener("click", () => nextTrack(false));
    $("#prevBtn").addEventListener("click", prevTrack);
    $("#nowNext").addEventListener("click", () => nextTrack(false));
    $("#nowPrev").addEventListener("click", prevTrack);
    $("#shuffleBtn").addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      paintPlayer();
      toast(state.shuffle ? "Shuffle on" : "Shuffle off", true);
    });
    $("#nowShuffle").addEventListener("click", () => $("#shuffleBtn").click());
    $("#repeatBtn").addEventListener("click", () => {
      state.repeat = (state.repeat + 1) % 3;
      paintPlayer();
      toast(["Repeat off", "Repeat all", "Repeat one"][state.repeat], true);
    });
    $("#nowRepeat").addEventListener("click", () => $("#repeatBtn").click());
    $("#likeBtn").addEventListener("click", () => {
      const i = currentIndex();
      if (state.liked.has(i)) { state.liked.delete(i); toast("Removed from Liked Songs", true); }
      else { state.liked.add(i); toast("Added to Liked Songs"); }
      saveState();
      paintPlayer();
    });

    // now playing view
    $("#nowViewBtn").addEventListener("click", openNowView);
    $("#npCover").addEventListener("click", openNowView);
    $("#nowClose").addEventListener("click", closeNowView);
    $("#nowMore").addEventListener("click", () => toast("More options", true));
    $("#lyricsBtn").addEventListener("click", () => {
      const on = $("#lyricsBtn").getAttribute("aria-pressed") === "true";
      $("#lyricsBtn").setAttribute("aria-pressed", String(!on));
      if (!on) openNowView();
    });
    $("#deviceBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleDevices(e.currentTarget); });
    $("#queueBtn").addEventListener("click", () => toggleQueue());
    $("#nowMore").addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const i = currentIndex();
      openMenu(r.left - 180, r.bottom + 8, releaseMenuItems(i));
    });

    // now view tabs
    $$(".now__tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".now__tab").forEach((t) => t.classList.remove("is-active"));
        $$(".now__pane").forEach((p) => p.classList.remove("is-active"));
        tab.classList.add("is-active");
        nowTab = tab.dataset.pane;
        lastLyricIndex = -1;
        syncLyrics();
        const pane = $("#pane" + tab.dataset.pane.charAt(0).toUpperCase() + tab.dataset.pane.slice(1));
        pane.classList.add("is-active");
        pane.scrollTop = 0;
      });
    });

    // volume
    $("#muteBtn").addEventListener("click", () => {
      state.muted = !state.muted;
      const icon = state.muted ? "mute" : state.volume < 0.45 ? "vol-low" : "vol-high";
      $("#muteBtn").innerHTML = `<svg class="ic"><use href="#i-${icon}"></use></svg>`;
      $("#muteBtn").dataset.tip = state.muted ? "Unmute" : "Mute";
      Sound.applyVolume();
    });
    bindTrack($("#volumeTrack"), (r, done) => {
      state.volume = r;
      state.muted = false;
      $("#volumeFill").style.width = r * 100 + "%";
      $("#volumeTrack").setAttribute("aria-valuenow", Math.round(r * 100));
      Sound.applyVolume();
    });
    $("#volumeFill").style.width = state.volume * 100 + "%";

    // progress scrubbing
    const seek = (r) => {
      const rel = RELEASES[currentIndex()];
      if (!rel) return;
      state.position = r * rel.d;
      paintProgress();
    };
    bindTrack($("#progressTrack"), seek);
    bindTrack($("#nowProgressTrack"), seek);


    // ── drag the now-playing view down to dismiss ───────────────────────
    (() => {
      const view = $("#nowView");
      let startY = 0;
      let dragging = false;
      let moved = false;
      const head = view.querySelector(".now__head");
      head.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        startY = e.clientY;
        dragging = true;
        moved = false;
        view.classList.add("is-dragging");
      });
      window.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        if (dy > 6) moved = true;
        if (dy > 0) {
          view.style.transform = `translateY(${Math.min(dy, 400)}px)`;
          view.style.opacity = String(Math.max(0, 1 - dy / 420));
        }
      });
      const release = () => {
        if (!dragging) return;
        dragging = false;
        view.classList.remove("is-dragging");
        const dy = parseFloat((view.style.transform.match(/translateY\(([-\d.]+)px\)/) || [0, 0])[1]) || 0;
        view.style.transform = "";
        view.style.opacity = "";
        if (moved && dy > 90) closeNowView();
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    })();

    // ── command palette ──────────────────────────────────────────────────
    $("#cmdpalInput").addEventListener("input", renderCmd);
    $("#cmdpalInput").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cmdIndex = Math.min(cmdIndex + 1, cmdResults.length - 1);
        paintCmdActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cmdIndex = Math.max(cmdIndex - 1, 0);
        paintCmdActive();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = cmdResults[cmdIndex];
        if (r) { closeCmdpal(); r.run(); }
      }
    });
    $("#cmdpalList").addEventListener("click", (e) => {
      const item = e.target.closest("[data-cmd]");
      if (!item) return;
      const r = cmdResults[parseInt(item.dataset.cmd, 10)];
      if (r) { closeCmdpal(); r.run(); }
    });
    $("#cmdpal").addEventListener("click", (e) => {
      if (e.target.classList.contains("cmdpal__scrim")) closeCmdpal();
    });

    // ── context menu ──────────────────────────────────────────────────────
    document.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".row[data-idx]");
      const card = e.target.closest(".card");
      const lib = e.target.closest(".libitem[data-route]");
      if (!row && !card && !lib) return;
      e.preventDefault();
      if (row) {
        openMenu(e.clientX, e.clientY, releaseMenuItems(parseInt(row.dataset.idx, 10)));
        return;
      }
      if (card) {
        const btn = card.querySelector("[data-action='play-card']");
        const idx = btn ? parseInt(btn.dataset.idx, 10) : null;
        const kind = btn ? btn.dataset.kind : "release";
        const title = card.querySelector(".card__title");
        const items = [];
        if (kind === "playlist") {
          items.push({ label: "Play", icon: "play", action: "play-card", idx });
          items.push({ label: "Add to queue", icon: "plus", action: "queue-add-list", idx });
          items.push({ divider: true });
          items.push({ label: "Remove from your library", icon: "close", action: "remove-playlist", idx, danger: true });
        } else if (kind === "artist") {
          items.push({ label: "Follow", icon: "plus", action: "follow", idx });
          items.push({ label: "Go to artist", icon: "search", action: "go-artist-card", idx });
        } else {
          items.push({ label: "Play", icon: "play", action: "play-card", idx });
          items.push({ label: "Add to queue", icon: "plus", action: "queue-add", idx });
          items.push({ label: "Add to playlist", icon: "plus", action: "add-to-playlist", idx });
          items.push({ divider: true });
          items.push({ label: "Go to album", icon: "library", action: "go-album", idx });
        }
        openMenu(e.clientX, e.clientY, { label: title ? title.textContent : "More options", items });
        return;
      }
      if (lib) {
        const route = lib.dataset.route;
        const [nm, pid] = route.split("/");
        if (nm !== "playlist") return;
        const pl = getPlaylist(pid);
        if (!pl) return;
        openMenu(e.clientX, e.clientY, {
          label: pl.title || pl.name,
          items: [
            { label: "Play", icon: "play", action: "play-list", idx: pl.id },
            { label: "Add to queue", icon: "plus", action: "queue-add-list", idx: pl.id },
            { divider: true },
            { label: "Remove from your library", icon: "close", action: "remove-playlist", idx: pl.id, danger: true }
          ]
        });
      }
    });

    document.addEventListener("click", (e) => {
      const menuBtn = e.target.closest("[data-menu]");
      if (menuBtn) {
        e.preventDefault();
        e.stopPropagation();
        const it = menuItems[parseInt(menuBtn.dataset.menu, 10)];
        closeMenu();
        if (it && it.action) onAction(it.action, { dataset: { idx: it.idx, kind: it.kind } });
        return;
      }
      if (!e.target.closest("#contextMenu")) closeMenu();
      if (!e.target.closest("#devicePopover")) $("#devicePopover").hidden = true;
      if (!e.target.closest("#modal")) { /* modal has its own scrim */ }
      if (!e.target.closest(".shortcuts__card") && !e.target.closest("[data-action='close-shortcuts']")) {
        if (e.target.classList.contains("shortcuts__scrim")) $("#shortcuts").hidden = true;
      }
    });

    // ── keyboard ──────────────────────────────────────────────────────────
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if ($("#cmdpal").hidden) openCmdpal(); else closeCmdpal();
        return;
      }
      if (e.key === "Escape") {
        // close the topmost layer first — palette, then shortcuts, popover,
        // menu, modal, and only then fall back to blurring a text field
        if (!$("#cmdpal").hidden) { closeCmdpal(); return; }
        if (!$("#shortcuts").hidden) { $("#shortcuts").hidden = true; return; }
        if (!$("#devicePopover").hidden) { $("#devicePopover").hidden = true; return; }
        if (!$("#contextMenu").hidden) { closeMenu(); return; }
        if (!$("#modal").hidden) { closeModal(); return; }
        if (typing) { e.target.blur(); return; }
        if ($("#queuePanel").classList.contains("is-open")) { toggleQueue(false); return; }
        closeNowView();
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (e.key === "?") { e.preventDefault(); $("#shortcuts").hidden ? openShortcuts() : ($("#shortcuts").hidden = true); }
      else if (k === "q") { e.preventDefault(); toggleQueue(); }
      else if (k === "d") { e.preventDefault(); toggleDevices($("#deviceBtn")); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight" && e.altKey) nextTrack(false);
      else if (e.key === "ArrowLeft" && e.altKey) prevTrack();
      else if (e.key === "ArrowRight" && e.shiftKey) seekBy(15);
      else if (e.key === "ArrowLeft" && e.shiftKey) seekBy(-15);
      else if (e.key === "/") { e.preventDefault(); $("#searchInput").focus(); }
    });

    // ── sticky topbar on scroll
    $("#canvas").addEventListener("scroll", (e) => {
      $("#topbar").classList.toggle("is-stuck", e.target.scrollTop > 40);
    });

    window.addEventListener("hashchange", () => {
      const r = parseHash();
      if (r.name === state.route.name && r.params.id === state.route.params.id) return;
      state.route = r;
      const existing = state.history.findIndex((h) => h.name === r.name && h.params.id === r.params.id);
      if (existing >= 0) state.hIndex = existing;
      else { state.history = state.history.slice(0, state.hIndex + 1); state.history.push(r); state.hIndex = state.history.length - 1; }
      render(true);
    });
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */
  function init() {
    buildSpectrum();
    bind();
    animateSpectrum();
    loadState();
    // seed a real queue so the player bar, queue panel and like button all
    // have something to show before the user presses play
    if (!state.queue.length) {
      state.queue = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      state.qPos = 0;
    }
    $("#volumeFill").style.width = state.volume * 100 + "%";
    $("#volumeTrack").setAttribute("aria-valuenow", Math.round(state.volume * 100));

    const r = parseHash();
    state.route = r;
    state.history = [r];
    state.hIndex = 0;

    // seed the queue so the player bar is never empty
    state.queue = [0, 4, 12, 3, 29, 8, 16, 25];
    state.qPos = 0;
    paintPlayer();
    render(false);

    if (window.innerWidth <= 1280) $("#social").classList.remove("is-forced");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
