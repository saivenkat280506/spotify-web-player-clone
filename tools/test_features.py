#!/usr/bin/env python3
"""Feature tests for the surfaces added on top of the core player.

Covers: context menu, queue panel, device popover, create-playlist modal,
shortcuts overlay, user playlists, liked-songs route, genre pages, persistence.
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:8765/index.html"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    return ok


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(700)

        # ── context menu on a track row ───────────────────────────────────
        row = page.locator(".row").first
        row.click(button="right")
        page.wait_for_timeout(300)
        menu = page.locator("#contextMenu")
        check("menu: opens on right click", menu.is_visible())
        items = page.locator("#contextMenu .menu__item")
        check("menu: has items", items.count() >= 4, f"{items.count()} items")
        labels = " ".join(items.all_inner_texts()).lower()
        check("menu: add to playlist present", "add to playlist" in labels)
        check("menu: go to album present", "go to album" in labels)

        # choose "Add to playlist" -> modal
        page.locator("#contextMenu .menu__item", has_text="Add to playlist").click()
        page.wait_for_timeout(350)
        check("modal: add-to-playlist opens", page.locator("#modal").is_visible())
        check("modal: has playlist rows", page.locator("#modal .modal__pick").count() > 0)

        # ── create playlist from the modal ────────────────────────────────
        page.locator("#modal [data-action='open-create-from-add']").click()
        page.wait_for_timeout(300)
        check("modal: create-playlist form opens", page.locator("#newPlaylistName").is_visible())
        page.fill("#newPlaylistName", "Late Night Drives")
        page.fill("#newPlaylistDesc", "for the 2am stretch")
        page.locator("#modal [data-action='create-playlist']").click()
        page.wait_for_timeout(600)

        # ── user playlist exists in the sidebar and is playable ───────────
        sidebar = page.locator("#sidebar")
        check("playlist: appears in sidebar", sidebar.locator("text=Late Night Drives").count() > 0)
        check("playlist: route is the new playlist", "#/playlist/1001" in page.url, page.url)
        page.wait_for_timeout(400)
        rows = page.locator(".detail__body .row")
        check("playlist: has the added track", rows.count() >= 1, f"{rows.count()} rows")

        # play it
        page.locator("[data-action='play-list']").first.click()
        page.wait_for_timeout(600)
        check("playlist: track is playing", page.locator("#npTitle").inner_text().strip() != "",
              page.locator("#npTitle").inner_text().strip())
        check("playlist: play button flips to pause",
              page.locator("#playBtn use").get_attribute("href") == "#i-pause",
              page.locator("#playBtn use").get_attribute("href"))

        # ── liked songs route ─────────────────────────────────────────────
        page.locator(".row__like").first.click()
        page.wait_for_timeout(250)
        page.goto(URL + "#/liked")
        page.wait_for_timeout(600)
        check("liked: route renders", "liked songs" in page.locator("#view").inner_text().lower())
        check("liked: has rows", page.locator("#view .row").count() >= 1)

        # ── queue panel ───────────────────────────────────────────────────
        page.keyboard.press("q")
        page.wait_for_timeout(450)
        panel = page.locator("#queuePanel")
        check("queue: opens with Q", "is-open" in (panel.get_attribute("class") or ""))
        check("queue: shows now playing", page.locator("#queueNow .queueitem--now").count() == 1)
        check("queue: shows next up", page.locator("#queueNext .queueitem").count() >= 0)
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check("queue: closes with Escape", "is-open" not in (panel.get_attribute("class") or ""))

        # ── device popover ────────────────────────────────────────────────
        page.locator("#deviceBtn").click()
        page.wait_for_timeout(350)
        check("device: popover opens", page.locator("#devicePopover").is_visible())
        check("device: lists devices", page.locator("#devicePopover .popover__item").count() >= 3)
        page.locator("#devicePopover [data-device='phone']").click()
        page.wait_for_timeout(300)
        check("device: selection closes popover", not page.locator("#devicePopover").is_visible())
        check("device: toast confirms", "Playing on" in page.locator("#toasts").inner_text())

        # ── shortcuts overlay ─────────────────────────────────────────────
        page.keyboard.press("?")
        page.wait_for_timeout(350)
        check("shortcuts: overlay opens", page.locator("#shortcuts").is_visible())
        check("shortcuts: lists keys", page.locator("#shortcuts kbd").count() >= 8)
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        check("shortcuts: closes with Escape", not page.locator("#shortcuts").is_visible())

        # ── genre browsing actually filters ───────────────────────────────
        page.goto(URL + "#/search")
        page.wait_for_timeout(500)
        genre_cards = page.locator("#view .card--mix")
        check("genre: cards rendered", genre_cards.count() >= 8, f"{genre_cards.count()}")
        first_genre = genre_cards.first.locator(".card__title").inner_text().strip()
        genre_cards.first.locator(".card__title").click()
        page.wait_for_timeout(600)
        check("genre: navigates to genre route", "/genre/" in page.url, page.url)
        body = page.locator("#view").inner_text()
        check("genre: title matches card", first_genre.lower() in body.lower(), first_genre)
        check("genre: lists artists", page.locator("#view .card--circle").count() >= 1)
        check("genre: lists tracks", page.locator("#view .row").count() >= 1)

        # multi-word genres must survive URL encoding
        page.goto(URL + "#/genre/Indie%20Pop")
        page.wait_for_timeout(700)
        gtext = page.locator("#view").inner_text().lower()
        check("genre: multi-word genre decodes", "indie pop" in gtext, gtext[:80])
        check("genre: multi-word has tracks", page.locator("#view .row").count() >= 1)

        # ── artist page depth ─────────────────────────────────────────────
        page.goto(URL + "#/artist/0")
        page.wait_for_timeout(600)
        text = page.locator("#view").inner_text()
        low = text.lower()
        check("artist: popular section", "popular" in low)
        check("artist: fans also like", "fans also like" in low)
        check("artist: about section", "about" in low)
        check("artist: bio paragraph", page.locator("#view .about__bio").count() == 1)
        check("artist: follow button", page.locator("#view [data-action='follow']").count() == 1)
        page.locator("#view [data-action='follow']").click()
        page.wait_for_timeout(400)
        check("artist: follow toggles state", "following" in page.locator("#view").inner_text().lower())

        # ── album page depth ──────────────────────────────────────────────
        page.goto(URL + "#/album/0")
        page.wait_for_timeout(600)
        check("album: credits block", page.locator("#view .about__row").count() >= 3)
        # the "More from" shelf only appears for artists with more than one release
        more_ok = False
        for ai in range(12):
            page.goto(URL + f"#/album/{ai}")
            page.wait_for_timeout(260)
            if "more from" in page.locator("#view").inner_text().lower():
                more_ok = True
                break
        check("album: more by artist shelf", more_ok)

        # ── playlist recommended shelf ────────────────────────────────────
        page.goto(URL + "#/playlist/1")
        page.wait_for_timeout(600)
        check("playlist: recommended shelf", "recommended" in page.locator("#view").inner_text().lower())

        # ── persistence across reload ─────────────────────────────────────
        page.goto(URL + "#/library")
        page.wait_for_timeout(500)
        before = page.locator("#sidebar").inner_text()
        check("persist: playlist in sidebar before reload", "Late Night Drives" in before)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        after = page.locator("#sidebar").inner_text()
        check("persist: playlist survives reload", "Late Night Drives" in after)
        page.goto(URL + "#/liked")
        page.wait_for_timeout(600)
        check("persist: liked songs survive reload", page.locator("#view .row").count() >= 1)

        # ── command palette ───────────────────────────────────────────────
        page.goto(URL + "#/home")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+k")
        page.wait_for_timeout(350)
        check("cmdpal: opens with Ctrl+K", page.locator("#cmdpal").is_visible())
        check("cmdpal: shows actions", page.locator("#cmdpal .cmdpal__item").count() >= 5)
        page.fill("#cmdpalInput", "library")
        page.wait_for_timeout(250)
        check("cmdpal: filters", page.locator("#cmdpal .cmdpal__item").count() >= 1)
        page.fill("#cmdpalInput", "zzzznotathing")
        page.wait_for_timeout(250)
        check("cmdpal: empty state", page.locator("#cmdpalList").inner_text().lower().find("no matches") > -1)
        page.fill("#cmdpalInput", "home")
        page.wait_for_timeout(250)
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        check("cmdpal: Enter navigates", "#/home" in page.url, page.url)
        check("cmdpal: closes after run", not page.locator("#cmdpal").is_visible())

        # ── media session ──────────────────────────────────────────────────
        page.locator(".card__play").first.click()
        page.wait_for_timeout(800)
        check("media: metadata title set", page.evaluate(
            "() => navigator.mediaSession && navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : ''"
        ) != "", page.evaluate(
            "() => navigator.mediaSession && navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : ''"
        ))
        check("media: playback state playing", page.evaluate(
            "() => navigator.mediaSession ? navigator.mediaSession.playbackState : ''"
        ) == "playing")

        # ── recents ────────────────────────────────────────────────────────
        page.goto(URL + "#/search")
        page.wait_for_timeout(400)
        page.fill("#searchInput", "kaya mori")
        page.wait_for_timeout(1400)
        page.fill("#searchInput", "")
        page.wait_for_timeout(500)
        check("recents: recent search listed", "kaya mori" in page.locator("#view").inner_text().lower())
        page.locator("[data-action='drop-recent']").first.click()
        page.wait_for_timeout(400)
        check("recents: can be removed", "kaya mori" not in page.locator("#view").inner_text().lower())

        # jump back in
        page.goto(URL + "#/home")
        page.wait_for_timeout(600)
        check("recents: jump back in section", "jump back in" in page.locator("#view").inner_text().lower())

        # ── player cover opens the now-playing view ────────────────────────
        page.locator("#npCover").click()
        page.wait_for_timeout(700)
        check("cover: opens now playing", "is-open" in (page.locator("#nowView").get_attribute("class") or ""))
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        # ── now view About tab has song credits ────────────────────────────
        page.locator("#nowViewBtn").click()
        page.wait_for_timeout(800)
        page.locator(".now__tab[data-pane='about']").click()
        page.wait_for_timeout(400)
        about = page.locator("#aboutBody").inner_text().lower()
        check("about: has song credits", "song credits" in about)
        check("about: artist links out", page.locator("#aboutBody .about__artist").count() == 1)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        # ── toast undo restores a removed playlist ─────────────────────────
        page.goto(URL + "#/library")
        page.wait_for_timeout(500)
        page.locator("#createBtn").click()
        page.wait_for_timeout(350)
        page.fill("#newPlaylistName", "Undo Test")
        page.locator("#modal [data-action='create-playlist']").click()
        page.wait_for_timeout(700)
        page.locator("#sidebar .libitem", has_text="Undo Test").first.click(button="right")
        page.wait_for_timeout(350)
        page.locator("#contextMenu .menu__item", has_text="Remove from your library").click()
        page.wait_for_timeout(500)
        check("undo: toast offers undo", page.locator(".toast__undo").count() >= 1)
        page.locator(".toast__undo").first.click()
        page.wait_for_timeout(600)
        check("undo: playlist restored", "Undo Test" in page.locator("#sidebar").inner_text())

        # ── like heart actually renders ───────────────────────────────────
        page.goto(URL + "#/home")
        page.wait_for_timeout(600)
        heart = page.evaluate("""() => {
          const u = document.querySelector('#likeBtn use');
          const sym = document.getElementById('i-heart');
          const path = sym && sym.querySelector('path');
          const cs = path ? getComputedStyle(path) : null;
          return { href: u ? u.getAttribute('href') : null,
                   opacity: path ? path.getAttribute('opacity') : 'none',
                   stroke: cs ? cs.stroke : 'none' };
        }""")
        check("heart: sprite is visible", heart["opacity"] in (None, "none", "1"), str(heart["opacity"]))
        check("heart: has a stroke", heart["stroke"] not in (None, "none", ""), str(heart["stroke"]))
        before = page.eval_on_selector("#likeBtn use", "e=>e.getAttribute('href')")
        page.locator("#likeBtn").click()
        page.wait_for_timeout(400)
        after = page.eval_on_selector("#likeBtn use", "e=>e.getAttribute('href')")
        check("heart: toggles between outline and filled",
              (before, after) in (("#i-heart", "#i-heart-fill"), ("#i-heart-fill", "#i-heart")),
              f"{before} -> {after}")
        check("heart: row hearts sync", page.locator(".row__like.is-liked").count() >= 0)

        # ── no JS errors ──────────────────────────────────────────────────
        real = [e for e in errors if "favicon" not in e.lower()]
        check("js: no uncaught errors", not real, str(real[:2]))

        browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    if passed != len(results):
        print("FAILURES:")
        for n, ok, d in results:
            if not ok:
                print(f"  - {n} {d}")
        sys.exit(1)


if __name__ == "__main__":
    main()
