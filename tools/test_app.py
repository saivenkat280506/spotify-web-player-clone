import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8765/index.html"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(800)

        # --- routing -------------------------------------------------------
        await page.click('.sidenav__link[data-route="search"]')
        await page.wait_for_timeout(400)
        check("route: sidebar nav to search", page.url.endswith("#/search"), page.url)

        await page.click('.sidenav__link[data-route="library"]')
        await page.wait_for_timeout(400)
        check("route: sidebar nav to library", page.url.endswith("#/library"), page.url)

        # back / forward
        await page.click("#backBtn")
        await page.wait_for_timeout(400)
        check("history: back", page.url.endswith("#/search"), page.url)
        await page.click("#fwdBtn")
        await page.wait_for_timeout(400)
        check("history: forward", page.url.endswith("#/library"), page.url)

        # --- search --------------------------------------------------------
        await page.fill("#searchInput", "kaya")
        await page.wait_for_timeout(600)
        n = await page.evaluate("document.querySelectorAll('.result, .row, .card').length")
        check("search: filters results", n > 0, f"{n} nodes")
        empty = await page.evaluate("document.querySelector('.empty') !== null")
        await page.fill("#searchInput", "zzzzqqq")
        await page.wait_for_timeout(500)
        empty2 = await page.evaluate("document.querySelector('.empty') !== null")
        check("search: empty state", empty2 and not empty)
        await page.fill("#searchInput", "")
        await page.wait_for_timeout(400)

        # --- playback ------------------------------------------------------
        await page.click('.sidenav__link[data-route="home"]')
        await page.wait_for_timeout(500)
        title_before = await page.inner_text("#npTitle")
        await page.click("#playBtn")
        await page.wait_for_timeout(1500)
        playing = await page.evaluate("document.querySelector('#playBtn').getAttribute('aria-label')")
        elapsed = await page.inner_text("#elapsed")
        check("play: button flips to Pause", playing == "Pause", playing)
        check("play: position advances", elapsed not in ("0:00", ""), elapsed)

        audio = await page.evaluate("""() => {
            const c = window.__ctx; return c ? c.state : 'n/a';
        }""")
        # audio context is internal; check that the analyser reports signal
        sig = await page.evaluate("""() => {
            const bars = [...document.querySelectorAll('#spectrum i')];
            return bars.filter(b => parseFloat(b.style.height) > 12).length;
        }""")
        check("audio: spectrum bars are driven", sig > 5, f"{sig} bars active")

        await page.click("#nextBtn")
        await page.wait_for_timeout(700)
        title_after = await page.inner_text("#npTitle")
        check("play: next track changes title", title_before != title_after, f"{title_before} -> {title_after}")

        await page.click("#prevBtn")
        await page.wait_for_timeout(700)
        check("play: prev returns to previous", (await page.inner_text("#npTitle")) == title_before)

        # shuffle / repeat toggles
        await page.click("#shuffleBtn")
        await page.wait_for_timeout(250)
        check("toggle: shuffle", await page.get_attribute("#shuffleBtn", "aria-pressed") == "true")
        await page.click("#repeatBtn")
        await page.wait_for_timeout(250)
        check("toggle: repeat", await page.get_attribute("#repeatBtn", "aria-pressed") == "true")

        # seek by clicking the progress track
        box = await page.locator("#progressTrack").bounding_box()
        await page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] / 2)
        await page.wait_for_timeout(400)
        el2 = await page.inner_text("#elapsed")
        check("seek: click moves the playhead", el2 != "0:00", el2)

        # like toggle
        await page.click("#likeBtn")
        await page.wait_for_timeout(400)
        check("like: saved to library", await page.get_attribute("#likeBtn", "aria-pressed") == "true")
        toast = await page.evaluate("[...document.querySelectorAll('.toast')].pop()?.textContent || ''")
        check("toast: appears on like", "Liked Songs" in toast, toast)

        # --- now playing view ---------------------------------------------
        await page.click("#nowViewBtn")
        await page.wait_for_timeout(900)
        open_ = await page.evaluate("document.querySelector('#nowView').classList.contains('is-open')")
        check("now view: opens", open_)
        lyrics = await page.evaluate("document.querySelectorAll('#lyricsBody p').length")
        check("now view: lyrics rendered", lyrics > 5, f"{lyrics} lines")
        await page.click('.now__tab[data-pane="upnext"]')
        await page.wait_for_timeout(400)
        upnext = await page.evaluate("document.querySelectorAll('#upnextBody .upnext__row').length")
        check("now view: up next queue", upnext > 0, f"{upnext} rows")
        await page.click("#nowClose")
        await page.wait_for_timeout(500)
        check("now view: closes", not await page.evaluate("document.querySelector('#nowView').classList.contains('is-open')"))

        # --- card play button ---------------------------------------------
        await page.evaluate("document.querySelector('#canvas').scrollTop = 0")
        await page.wait_for_timeout(300)
        await page.locator(".card__play").first.click()
        await page.wait_for_timeout(900)
        check("card: play button starts playback", await page.get_attribute("#playBtn", "aria-label") == "Pause")

        # --- playlist detail ------------------------------------------------
        await page.click('.libitem[data-route="playlist/3"]')
        await page.wait_for_timeout(700)
        rows = await page.evaluate("document.querySelectorAll('.row').length")
        check("playlist: track rows rendered", rows > 5, f"{rows} rows")
        head = await page.inner_text(".pagehead__title")
        check("playlist: header title", len(head) > 2, head)

        # album + artist routes
        await page.goto(BASE + "#/album/3", wait_until="networkidle")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(700)
        check("album: renders", await page.evaluate("!!document.querySelector('.pagehead__art img')"))
        await page.goto(BASE + "#/artist/2", wait_until="networkidle")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(700)
        check("artist: renders", await page.evaluate("!!document.querySelector('.pagehead__art--circle')"))

        # --- keyboard -------------------------------------------------------
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(600)
        await page.keyboard.press(" ")
        await page.wait_for_timeout(600)
        check("keyboard: space toggles play", await page.get_attribute("#playBtn", "aria-label") == "Pause")

        # --- no broken images (scroll first so lazy images load) ------------
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(600)
        for _ in range(14):
            await page.evaluate("document.querySelector('#canvas').scrollTop += 900")
            await page.wait_for_timeout(160)
        await page.wait_for_timeout(1500)
        broken = await page.evaluate("""() => [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src)""")
        unloaded = await page.evaluate("""() => [...document.images].filter(i => !i.complete).length""")
        check("assets: no broken images", len(broken) == 0, str(broken[:3]))
        check("assets: all lazy images resolved", unloaded == 0, f"{unloaded} still loading")

        check("js: no uncaught errors", len(errors) == 0, str(errors[:2]))

        await browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        print("FAILURES:")
        for name, _, d in failed:
            print("  -", name, d)

asyncio.run(main())
