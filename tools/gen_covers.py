#!/usr/bin/env python3
"""
Procedural artwork generator for the Spotify clone.

Emits one abstract SVG cover per release plus a set of artist avatars.
No third-party imagery: every cover is composed from deterministic
gradients + geometric primitives seeded by the release title.
"""
import hashlib
import json
import os
import random
import xml.etree.ElementTree as ET

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "covers")
AVA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "avatars")
os.makedirs(OUT, exist_ok=True)
os.makedirs(AVA, exist_ok=True)

# Curated palettes: each entry is (deep, mid, light, accent)
PALETTES = [
    ("#0b1d2a", "#134e5e", "#5eead4", "#f59e0b"),
    ("#2b1055", "#7597de", "#ff8fab", "#ffd166"),
    ("#1a1423", "#5f4b8b", "#a78bfa", "#f472b6"),
    ("#0f2027", "#2c5364", "#61e8e1", "#ffd9a0"),
    ("#231942", "#5e548e", "#9f86c0", "#e0b1cb"),
    ("#141e30", "#243b55", "#654ea3", "#eaafc8"),
    ("#0b0b0b", "#1f4037", "#99f6e4", "#f4a261"),
    ("#31081f", "#852f3c", "#e56b6f", "#ffd8a8"),
    ("#16222a", "#3a6073", "#89c4e1", "#ffd166"),
    ("#1d1d1d", "#4b4b4b", "#c9ada7", "#f2e9e4"),
    ("#0f3443", "#34e89e", "#6ff2d0", "#0f3443"),
    ("#3a1c71", "#d76d77", "#ffaf7b", "#fddb92"),
    ("#200122", "#6f0000", "#e056fd", "#ffb199"),
    ("#04293e", "#075985", "#38bdf8", "#fde68a"),
    ("#1f1c2c", "#928dab", "#ffcfd2", "#415f91"),
    ("#101820", "#2c3e50", "#bdc3c7", "#2ecc71"),
]


def xml_escape(text: str) -> str:
    """Titles contain '&' (e.g. 'Coffee & Vinyl') which must be escaped for XML."""
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&apos;"))


def seed_of(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)


def shapes(rng: random.Random, p) -> str:
    """Layer 2-3 geometric primitives over the gradient base."""
    deep, mid, light, accent = p
    out = []
    kind = rng.choice(["rings", "waves", "stripes", "arch", "blocks", "orb", "dots", "peaks"])
    o = rng.uniform(0.25, 0.65)

    if kind == "rings":
        cx, cy = rng.uniform(180, 420), rng.uniform(180, 420)
        for i in range(rng.randint(4, 7)):
            r = 70 + i * rng.randint(42, 62)
            out.append(
                f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r}" fill="none" '
                f'stroke="{light}" stroke-opacity="{o - i * 0.045:.3f}" stroke-width="{rng.randint(8, 26):.0f}"/>'
            )
    elif kind == "waves":
        base = rng.uniform(300, 460)
        for i in range(rng.randint(3, 5)):
            amp = rng.uniform(40, 105)
            y = base + i * rng.randint(28, 44)
            op = o - i * 0.06
            out.append(
                f'<path d="M-20 {y:.0f} C 130 {y - amp:.0f}, 270 {y + amp:.0f}, 420 {y - amp * 0.6:.0f} '
                f'S 620 {y:.0f} 620 {y:.0f}" fill="none" stroke="{light}" '
                f'stroke-opacity="{op:.3f}" stroke-width="{rng.randint(10, 30):.0f}" stroke-linecap="round"/>'
            )
    elif kind == "stripes":
        ang = rng.uniform(-38, 38)
        gap = rng.randint(48, 92)
        for i in range(-4, 9):
            off = i * gap
            op = o * (0.45 + 0.55 * ((i % 3) / 2 + 0.2))
            out.append(
                f'<rect x="{off}" y="-120" width="{rng.randint(18, 44)}" height="860" fill="{light}" '
                f'fill-opacity="{op:.3f}" transform="rotate({ang:.0f} 300 300)"/>'
            )
    elif kind == "arch":
        w = rng.uniform(240, 340)
        h = rng.uniform(230, 330)
        x = 300 - w / 2
        y = 300 + h / 2 - rng.uniform(90, 180)
        out.append(
            f'<path d="M{x:.0f} {y + h:.0f} L{x:.0f} {y:.0f} A {w / 2:.0f} {w / 2:.0f} 0 0 1 {x + w:.0f} {y:.0f} '
            f'L{x + w:.0f} {y + h:.0f} Z" fill="{light}" fill-opacity="{o:.3f}"/>'
        )
        out.append(
            f'<rect x="{x + w * 0.22:.0f}" y="{y + h * 0.18:.0f}" width="{w * 0.56:.0f}" height="{h * 0.9:.0f}" '
            f'rx="{w * 0.28:.0f}" fill="{deep}" fill-opacity="0.72"/>'
        )
    elif kind == "blocks":
        for i in range(rng.randint(4, 7)):
            bw = rng.randint(70, 190)
            bh = rng.randint(70, 190)
            bx = rng.randint(-30, 560)
            by = rng.randint(-30, 560)
            out.append(
                f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="{rng.randint(4, 26)}" '
                f'fill="{light}" fill-opacity="{rng.uniform(0.16, 0.5):.2f}" transform="rotate({rng.uniform(-16, 16):.0f} {bx + bw // 2} {by + bh // 2})"/>'
            )
    elif kind == "orb":
        cx, cy = rng.uniform(180, 420), rng.uniform(180, 420)
        r = rng.uniform(120, 215)
        out.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}" fill="{light}" fill-opacity="{o:.3f}"/>')
        out.append(
            f'<circle cx="{cx - r * 0.34:.0f}" cy="{cy - r * 0.3:.0f}" r="{r * 0.44:.0f}" fill="{accent}" fill-opacity="0.5"/>'
        )
    elif kind == "dots":
        step = rng.randint(46, 74)
        for gx in range(0, 640, step):
            for gy in range(0, 640, step):
                if rng.random() < 0.42:
                    continue
                out.append(
                    f'<circle cx="{gx}" cy="{gy}" r="{rng.uniform(5, 13):.1f}" fill="{light}" '
                    f'fill-opacity="{rng.uniform(0.2, 0.72):.2f}"/>'
                )
    else:  # peaks
        pts = []
        n = rng.randint(4, 6)
        for i in range(n + 1):
            px = -20 + i * (640 / n)
            py = rng.uniform(120, 480)
            pts.append((px, py))
        d = f"M {pts[0][0]:.0f} {pts[0][1]:.0f} " + " ".join(f"L {x:.0f} {y:.0f}" for x, y in pts[1:])
        out.append(f'<path d="{d} L 620 620 L -20 620 Z" fill="{light}" fill-opacity="{o:.3f}"/>')

    return "".join(out)


def cover_svg(title: str, idx: int) -> str:
    rng = random.Random(seed_of(title))
    p = PALETTES[idx % len(PALETTES)]
    deep, mid, light, accent = p
    gid = f"g{idx}"
    ang = rng.choice([(135, 45), (45, 225), (90, 270), (160, 340)])
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="{xml_escape(title)} cover art">
  <defs>
    <linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate({ang[0]} 0.5 0.5)">
      <stop offset="0%" stop-color="{deep}"/>
      <stop offset="58%" stop-color="{mid}"/>
      <stop offset="100%" stop-color="{deep}"/>
    </linearGradient>
    <radialGradient id="{gid}r" cx="50%" cy="38%" r="72%">
      <stop offset="0%" stop-color="{light}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="{light}" stop-opacity="0"/>
    </radialGradient>
    <filter id="{gid}n" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="{idx * 7 + 3}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.10"/></feComponentTransfer>
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
    <clipPath id="{gid}c"><rect width="600" height="600"/></clipPath>
  </defs>
  <g clip-path="url(#{gid}c)">
    <rect width="600" height="600" fill="url(#{gid})"/>
    <rect width="600" height="600" fill="url(#{gid}r)"/>
    {shapes(rng, p)}
    <circle cx="{rng.randint(60, 540)}" cy="{rng.randint(60, 540)}" r="{rng.randint(10, 30)}" fill="{accent}" fill-opacity="0.8"/>
    <rect width="600" height="600" filter="url(#{gid}n)" opacity="0.5"/>
  </g>
</svg>
"""


def avatar_svg(name: str, idx: int) -> str:
    rng = random.Random(seed_of("av" + name))
    p = PALETTES[idx % len(PALETTES)]
    deep, mid, light, accent = p
    skin = rng.choice(["#f3c9a8", "#d9a066", "#a9744f", "#7a4a2c", "#f0d3bd", "#c98d5e"])
    cloth = rng.choice(["#1DB954", "#e056fd", "#38bdf8", "#fb7185", "#fbbf24", "#818cf8", "#f97316"])
    hair = rng.choice(["#1b1410", "#3b2314", "#5a3825", "#0f0f0f", "#7a5230", "#2b2b2b"])
    hair_style = rng.randint(0, 3)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="{xml_escape(name)}">
  <defs>
    <linearGradient id="a{idx}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{mid}"/><stop offset="100%" stop-color="{deep}"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" fill="url(#a{idx})"/>
  <circle cx="60" cy="49" r="21" fill="{skin}"/>
  <path d="M60 74c-24 0-38 15-42 38h84c-4-23-18-38-42-38z" fill="{cloth}"/>
  <path d="M39 46c0-15 9-24 21-24s21 9 21 24c0 3-1 5-1 5-2-9-8-12-9-16-4 6-18 9-30 11-1 2-2 4-2 5z" fill="{hair}"/>
  {f'<path d="M39 47c-3-16 8-26 21-26s24 10 21 26c0 0-3-12-21-12s-21 12-21 12z" fill="{hair}"/>' if hair_style == 0 else ''}
  {f'<ellipse cx="60" cy="30" rx="23" ry="12" fill="{hair}"/>' if hair_style == 1 else ''}
  {f'<circle cx="60" cy="30" r="9" fill="{hair}"/>' if hair_style == 2 else ''}
  {f'<path d="M34 52h9v9h-9zM77 52h9v9h-9z" fill="{hair}" fill-opacity="0.75"/>' if hair_style == 3 else ''}
</svg>
"""


RELEASES = [
    "Neon Rain", "Midnight Commute", "Paper Lanterns", "Glass Gardens", "Slow Signal",
    "Harbour Lights", "Velvet Static", "Dust & Neon", "Quiet Machines", "Saltwater Radio",
    "Paper Tigers", "Blue Hour Drive", "Fever Dream FM", "Loose Threads", "Coral Static",
    "Winter Frequency", "Echo Chambers", "Tidal Drift", "Amber Transit", "Hollow Bloom",
    "Soft Machinery", "Parallel Streets", "Analog Sunrise", "Marble Birds", "Cold Front Radio",
    "Lunar Overpass", "Small Victories", "Violet Hours", "Rust & Roses", "Tidal Logic",
]

ARTISTS = [
    "Kaya Mori", "The Lantern Club", "Owen Reyes", "Mira Solene", "Halcyon Drive",
    "Neon Aviary", "Juno Park", "The Slow Cartographers", "Aster Vale", "Rue Delacroix",
    "Pale Harbour", "Ines Okada", "Northbound Youth", "Vela Nine", "Copper Rooms",
    "Sofia Benedetti", "The Mercury Hours", "Tavares & Bloom", "Liora Sandoval", "Wavelength",
    "Etta Marlow", "Nocturne Bureau", "The Fen", "Kestrel Bay", "Iris Calder",
]

PLAYLISTS = [
    "Late Night Drive", "Focus Deep Work", "Rainy Day Acoustics", "Gym Momentum",
    "Coffee & Vinyl", "Neon City Nights", "Sunday Kitchen", "First Light",
    "Old Favourite Songs", "Atmospheric Electronica", "Indie Discovery",
    "Soul & Retro", "Coastal Weekend", "Sleep Signals", "Morning Commute",
    "Alternative Pulse", "Jazz Corner", "Soft Focus", "Night Shift",
    "Garden Soundtrack",
]


def playlist_svg(title: str, idx: int) -> str:
    """Playlist art reuses the cover engine but rotates the palette + shape seed
    so playlist tiles never look like the album art they link to."""
    p = PALETTES[(idx * 7 + 3) % len(PALETTES)]
    deep, mid, light, accent = p
    rng = random.Random(seed_of("pl" + title))
    gid = f"p{idx}"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="{xml_escape(title)} cover art">
  <defs>
    <linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate({rng.choice([(115, 295), (205, 25), (65, 245)])} 0.5 0.5)">
      <stop offset="0%" stop-color="{deep}"/>
      <stop offset="55%" stop-color="{mid}"/>
      <stop offset="100%" stop-color="{accent}"/>
    </linearGradient>
    <filter id="{gid}n" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="{idx * 13 + 5}"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.09"/></feComponentTransfer>
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
    <clipPath id="{gid}c"><rect width="600" height="600"/></clipPath>
  </defs>
  <g clip-path="url(#{gid}c)">
    <rect width="600" height="600" fill="url(#{gid})"/>
    {shapes(rng, p)}
    <rect width="600" height="600" filter="url(#{gid}n)" opacity="0.45"/>
  </g>
</svg>
"""


if __name__ == "__main__":
    manifest = []
    for i, rel in enumerate(RELEASES):
        fn = f"cover-{i + 1:02d}.svg"
        with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
            f.write(cover_svg(rel, i))
        manifest.append({"title": rel, "file": fn})

    for i, pl in enumerate(PLAYLISTS):
        fn = f"playlist-{i + 1:02d}.svg"
        with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
            f.write(playlist_svg(pl, i))

    for i, art in enumerate(ARTISTS):
        fn = f"avatar-{i + 1:02d}.svg"
        with open(os.path.join(AVA, fn), "w", encoding="utf-8") as f:
            f.write(avatar_svg(art, i))

    with open(os.path.join(os.path.dirname(OUT), "covers.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # fail loudly if any emitted SVG is not well-formed
    broken = []
    for f in sorted(os.listdir(OUT)) + ["../avatars/" + a for a in sorted(os.listdir(AVA))]:
        path = os.path.join(OUT, f) if not f.startswith("../") else os.path.join(OUT, f)
        try:
            ET.parse(path)
        except Exception as exc:
            broken.append((path, str(exc)))
    if broken:
        for path, exc in broken:
            print("INVALID SVG:", path, "->", exc)
        raise SystemExit(1)

    print(f"generated {len(manifest)} covers + {len(PLAYLISTS)} playlists -> {OUT}")
    print(f"generated {len(ARTISTS)} avatars -> {AVA}")
    print("all SVGs validated")
