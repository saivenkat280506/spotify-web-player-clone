import asyncio, sys, os
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8765/index.html"
OUT = os.environ.get("SHOT_DIR", "/workspace/preview")
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errors = []

        # ---------- desktop ----------
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = await ctx.new_page()
        page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/01-home.png")

        # scroll down to sections
        await page.evaluate("document.querySelector('#canvas').scrollTop = 700")
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{OUT}/02-home-scrolled.png")

        # hover a card to reveal the play button
        await page.evaluate("document.querySelector('#canvas').scrollTop = 320")
        await page.wait_for_timeout(500)
        card = page.locator(".card").first
        await card.hover()
        await page.wait_for_timeout(500)
        await page.screenshot(path=f"{OUT}/03-card-hover.png")

        # press play
        await page.locator("#playBtn").click()
        await page.wait_for_timeout(1600)
        await page.screenshot(path=f"{OUT}/04-playing.png")

        # open the full-screen now playing view
        await page.locator("#nowViewBtn").click()
        await page.wait_for_timeout(1400)
        await page.screenshot(path=f"{OUT}/05-nowview.png")

        await page.locator('.now__tab[data-pane="upnext"]').click()
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"{OUT}/06-nowview-upnext.png")

        await page.locator("#nowClose").click()
        await page.wait_for_timeout(600)

        # playlist detail
        await page.goto(BASE + "#/playlist/6", wait_until="networkidle")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/07-playlist.png")

        # search
        await page.goto(BASE + "#/search", wait_until="networkidle")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(700)
        await page.fill("#searchInput", "night")
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{OUT}/08-search.png")

        # collapsed sidebar + friend panel
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(600)
        await page.locator("#collapseBtn").click()
        await page.mouse.move(1200, 700)
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{OUT}/09-collapsed.png")
        # hover the collapsed rail -> it expands in place
        await page.mouse.move(40, 400)
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{OUT}/09b-collapsed-hover.png")
        await page.mouse.move(1200, 700)

        await ctx.close()

        # ---------- mobile ----------
        mctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await mctx.new_page()
        mp.on("pageerror", lambda e: errors.append(f"[mobile pageerror] {e}"))
        await mp.goto(BASE, wait_until="networkidle")
        await mp.wait_for_timeout(1200)
        await mp.screenshot(path=f"{OUT}/10-mobile.png")
        await mp.locator("#navToggle").click()
        await mp.wait_for_timeout(700)
        await mp.screenshot(path=f"{OUT}/11-mobile-drawer.png")
        await mctx.close()

        await browser.close()

        print("CONSOLE/PAGE ERRORS:" if errors else "NO JS ERRORS")
        for e in errors[:40]:
            print("  ", e)

asyncio.run(main())
