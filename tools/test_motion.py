"""Motion audit.

1. Asserts that the computed transition timings on the key components match
   the values extracted from Spotify's production stylesheet (Encore tokens).
2. Slows the browser's animation clock via CDP to capture legible filmstrips.
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright
from PIL import Image

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/index.html"
OUT = "/tmp/motion"
os.makedirs(OUT, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1200)

        # ── 1. computed timing vs Spotify's real values ──────────────────────
        got = await page.evaluate("""() => {
          const g = (sel, props) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const c = getComputedStyle(el);
            const o = {}; props.forEach(p => o[p] = c[p]); return o;
          };
          const T = ['transitionDuration','transitionTimingFunction','transitionProperty','transform','opacity','backgroundColor','borderRadius','width','height','willChange','transformOrigin'];
          return {
            play:    g('.card__play', T),
            pill:    g('.pill--green', T),
            iconbtn: g('.icon-btn', T),
            track:   g('.track__fill', T),
            trackBase: g('.track', T),
            view:    g('.view', T),
            sidenav: g('.sidenav__link', T),
            art:     g('.card__art img', T),
            card:    g('.card', T),
            eq:      g('.npcover__eq i', T),
            nowArt:  g('.now__art', T),
            mobile:  g('.mobilenav__link.is-active', ['color']),
          };
        }""")

        prod = "cubic-bezier(0.3, 0, 0, 1)"
        dec = "cubic-bezier(0, 0, 0.2, 1)"
        acc = "cubic-bezier(0.8, 0, 1, 1)"

        check("card play button: 150ms productive curve",
              got["play"]["transitionDuration"] == "0.15s" and got["play"]["transitionTimingFunction"] == prod,
              f'{got["play"]["transitionDuration"]} {got["play"]["transitionTimingFunction"]}')
        check("card play button: 48px circle",
              got["play"]["width"] == "48px" and got["play"]["borderRadius"] == "9999px",
              f'{got["play"]["width"]} r={got["play"]["borderRadius"]}')
        check("CTA button: 500px radius",
              got["pill"]["borderRadius"] == "500px", got["pill"]["borderRadius"])
        check("CTA button: Spotify green #1ed760",
              got["pill"]["backgroundColor"] == "rgb(30, 215, 96)", got["pill"]["backgroundColor"])
        check("icon button: 150ms productive",
              got["iconbtn"]["transitionDuration"] == "0.15s" and got["iconbtn"]["transitionTimingFunction"] == prod,
              f'{got["iconbtn"]["transitionDuration"]} {got["iconbtn"]["transitionTimingFunction"]}')
        check("progress fill: 300ms productive",
              got["track"]["transitionDuration"] == "0.3s" and got["track"]["transitionTimingFunction"] == prod,
              f'{got["track"]["transitionDuration"]} {got["track"]["transitionTimingFunction"]}')
        check("progress track: 6px, tinted base",
              got["trackBase"]["height"] == "12px", got["trackBase"]["height"])
        check("view exit: 200ms accelerate",
              got["view"]["transitionDuration"] == "0.2s" and got["view"]["transitionTimingFunction"] == acc,
              f'{got["view"]["transitionDuration"]} {got["view"]["transitionTimingFunction"]}')
        check("card artwork: fade transition on opacity",
              "opacity" in got["art"]["transitionProperty"], got["art"]["transitionProperty"])
        eq = await page.evaluate("""() => {
          const el = document.querySelector('.npcover__eq i');
          if (!el) return null;
          const c = getComputedStyle(el);
          const o = c.transformOrigin.split(' ').map(parseFloat);
          return {origin: c.transformOrigin, h: el.offsetHeight, oy: o[1], ox: o[0], w: el.offsetWidth};
        }""")
        check("equaliser: transform-origin anchored to the bottom edge",
              eq is not None and abs(eq["oy"] - eq["h"]) < 1.5 and abs(eq["ox"] - eq["w"] / 2) < 1.5,
              f'{eq["origin"]} bar={eq["h"]}x{eq["w"]}' if eq else "no bar")
        check("mobile nav active: accent green",
              got["mobile"]["color"] == "rgb(30, 215, 96)", got["mobile"]["color"])

        # hover state timings (Spotify: hover-in is 50ms) — settle the transition first
        await page.locator(".card").first.hover()
        await page.wait_for_timeout(600)
        h = await page.evaluate("""() => {
          const c = getComputedStyle(document.querySelector('.pill--green'));
          return {d: c.transitionDuration, t: c.transitionTimingFunction,
                  cardbg: getComputedStyle(document.querySelector('.card')).backgroundColor,
                  playop: getComputedStyle(document.querySelector('.card__play')).opacity};
        }""")
        await page.locator(".pill--green").first.hover()
        await page.wait_for_timeout(150)
        hover_d = await page.evaluate(
            "getComputedStyle(document.querySelector('.pill--green')).transitionDuration")
        check("hover-in speed: 50ms while hovered",
              hover_d == "0.05s", hover_d)
        check("card hover surface: #2a2a2a",
              h["cardbg"] == "rgb(42, 42, 42)", h["cardbg"])
        check("play button revealed on hover", float(h["playop"]) > 0.9, h["playop"])

        # ── 2. FLIP actually moves the artwork ──────────────────────────────
        await page.mouse.move(10, 10)
        await page.wait_for_timeout(300)
        flip = await page.evaluate("""async () => {
          const art = document.querySelector('#nowArt');
          const small = document.querySelector('#npCover').getBoundingClientRect();
          document.querySelector('#nowViewBtn').click();
          await new Promise(r => requestAnimationFrame(r));
          const t0 = getComputedStyle(art).transform;
          const now = document.querySelector('#nowView').getBoundingClientRect();
          await new Promise(r => setTimeout(r, 1800));
          const t1 = getComputedStyle(art).transform;
          return {smallW: Math.round(small.width), t0, t1, opened: document.querySelector('#nowView').classList.contains('is-open')};
        }""")
        check("FLIP: view opened", flip["opened"])
        check("FLIP: artwork starts offset from its final position",
              flip["t0"] != flip["t1"] and flip["t0"] not in ("none", "matrix(1, 0, 0, 1, 0, 0)"),
              f'{flip["t0"][:44]} -> {flip["t1"][:44]}')
        check("FLIP: artwork settles at its final position",
              flip["t1"] in ("none", "matrix(1, 0, 0, 1, 0, 0)"), flip["t1"][:44])

        # ── 3. slow-motion filmstrips ───────────────────────────────────────
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Animation.enable")
        await cdp.send("Animation.setPlaybackRate", {"playbackRate": 0.06})

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1500)
        clip = {"x": 330, "y": 90, "width": 640, "height": 400}
        rt = []
        await page.click('.sidenav__link[data-route="library"]')
        for i in range(5):
            await page.screenshot(path=f"{OUT}/rt_{i}.png", clip=clip)
            rt.append(f"{OUT}/rt_{i}.png")
            await page.wait_for_timeout(120)

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1500)
        fl = []
        await page.click("#nowViewBtn")
        for i in range(5):
            await page.screenshot(path=f"{OUT}/fl_{i}.png", clip={"x": 330, "y": 90, "width": 700, "height": 420})
            fl.append(f"{OUT}/fl_{i}.png")
            await page.wait_for_timeout(120)

        await browser.close()

    def strip(files, out, w=460):
        ims = [Image.open(f).convert("RGB") for f in files]
        ims = [im.resize((w, int(w * im.height / im.width))) for im in ims]
        h = ims[0].height
        sheet = Image.new("RGB", (len(ims) * w, h), "#000")
        for i, im in enumerate(ims):
            sheet.paste(im, (i * w, 0))
        sheet.save(out)
        print("wrote", out, sheet.size)

    strip(rt, "/workspace/preview/motion-route.png")
    strip(fl, "/workspace/preview/motion-flip.png")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} motion checks passed")
    for n, _, d in failed:
        print("  FAIL:", n, d)


asyncio.run(main())
