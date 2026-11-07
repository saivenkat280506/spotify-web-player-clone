"""Layout sweep: verifies the app shell never leaks a dead column, never
overflows horizontally, and never pushes the page taller than the viewport.

Checks every width across all three breakpoints, with the sidebar both
expanded and collapsed.
"""
import asyncio
import json
import sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/index.html"

WIDTHS = [1920, 1680, 1440, 1366, 1281, 1280, 1200, 1100, 1024, 1001, 1000, 900, 820, 768, 640, 480, 390, 360]

MEASURE = """() => {
  const app = document.querySelector('#app');
  const main = document.querySelector('.main');
  const side = document.querySelector('.social');
  const player = document.querySelector('.player');
  const nav = document.querySelector('.mobilenav');
  const cs = getComputedStyle(side);
  const socialVisible = cs.display !== 'none' && side.getBoundingClientRect().width > 0;
  const mainRect = main.getBoundingClientRect();
  const sideRect = side.getBoundingClientRect();
  const playerRect = player.getBoundingClientRect();
  const appRect = app.getBoundingClientRect();

  // dead column = empty space between the main panel and whatever is right of it
  let gapRight = socialVisible
    ? sideRect.left - mainRect.right
    : window.innerWidth - mainRect.right;

  // elements spilling past the right edge
  const spills = [];
  const drawer = document.querySelector('.sidebar');
  const drawerOpen = drawer.classList.contains('is-open');
  document.querySelectorAll('.card, .libitem, .row, .pill, .search, .pagehead, .hero, .section__title, .player__center')
    .forEach(el => {
      // a closed off-canvas drawer is intentionally parked outside the viewport
      if (!drawerOpen && el.closest('.sidebar')) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 1.5 || r.left < -1.5)) {
        spills.push(el.className.split(' ')[0] + ':' + Math.round(r.left) + '-' + Math.round(r.right));
      }
    });

  return {
    winW: window.innerWidth,
    winH: window.innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    docScrollH: document.documentElement.scrollHeight,
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
    gapRight: Math.round(gapRight),
    socialVisible,
    mainW: Math.round(mainRect.width),
    mainLeft: Math.round(mainRect.left),
    appH: Math.round(appRect.height),
    playerTop: Math.round(playerRect.top),
    playerBottom: Math.round(playerRect.bottom),
    navDisplay: getComputedStyle(nav).display,
    spills: spills.slice(0, 3),
  };
}"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        failures = []

        for w in WIDTHS:
            page = await browser.new_page(viewport={"width": w, "height": 820})
            await page.goto(BASE, wait_until="networkidle")
            await page.wait_for_timeout(700)

            for collapsed in (False, True):
                if collapsed:
                    btn = page.locator("#collapseBtn")
                    if await btn.count() and await btn.is_visible():
                        await btn.click()
                        await page.mouse.move(w - 200, 400)
                        await page.wait_for_timeout(500)
                    else:
                        continue  # collapse control is hidden at this width
                m = await page.evaluate(MEASURE)
                tag = f"{w}px {'collapsed' if collapsed else 'expanded'}"

                # 1. no horizontal page scroll
                if m["docScrollW"] > m["winW"] + 1:
                    failures.append(f"{tag}: horizontal overflow {m['docScrollW']} > {m['winW']}")
                # 2. no element spilling past the viewport
                if m["spills"]:
                    failures.append(f"{tag}: elements spill -> {m['spills']}")
                # 3. no dead column where the hidden friend panel used to sit
                if m["gapRight"] > 24:
                    failures.append(f"{tag}: dead column of {m['gapRight']}px right of main panel")
                # 4. the shell must fit the viewport (player visible, no page scroll)
                if m["pageScrolls"]:
                    failures.append(f"{tag}: page scrolls vertically ({m['docScrollH']} > {m['winH']})")
                if m["playerBottom"] > m["winH"] + 2:
                    failures.append(f"{tag}: player bar below the fold ({m['playerBottom']} > {m['winH']})")

            await page.close()

        await browser.close()

        print(f"swept {len(WIDTHS)} widths x 2 sidebar states")
        if failures:
            print(f"\n{len(failures)} LAYOUT FAILURES:")
            for f in failures:
                print("  -", f)
            sys.exit(1)
        print("PASS - no dead columns, no overflow, no vertical page scroll")


asyncio.run(main())
