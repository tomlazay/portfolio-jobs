#!/usr/bin/env python3
"""
generate-og.py  —  Branding script for portfolio-jobs forks
═══════════════════════════════════════════════════════════════════════════════
Run this script once after editing fork-config.json to:
  1. Regenerate og-image.png with your firm's logo, colors, and copy.
  2. Patch all firm-specific meta tags in index.html automatically.

Usage (from repo root):
  python scripts/generate-og.py

Requirements:
  pip install Pillow cairosvg

Font fallback:
  The script tries Lato (bundled on most Linux/Mac). If Lato isn't available
  it falls back to the system default font. Install Lato for best results:
    Linux:  sudo apt install fonts-lato
    Mac:    brew install --cask font-lato
═══════════════════════════════════════════════════════════════════════════════
"""

import io
import json
import os
import re
import sys
from pathlib import Path

# ── Dependency check ──────────────────────────────────────────────────────────
try:
    import cairosvg
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with:  pip install Pillow cairosvg")
    sys.exit(1)

# ── Paths (relative to repo root) ─────────────────────────────────────────────
REPO_ROOT   = Path(__file__).resolve().parent.parent
CONFIG_FILE = REPO_ROOT / "fork-config.json"
INDEX_HTML  = REPO_ROOT / "index.html"
OG_OUT      = REPO_ROOT / "og-image.png"

# ── Load config ───────────────────────────────────────────────────────────────
if not CONFIG_FILE.exists():
    print(f"Error: {CONFIG_FILE} not found. Copy fork-config.json to the repo root and edit it.")
    sys.exit(1)

with open(CONFIG_FILE) as f:
    cfg = json.load(f)

firm_name    = cfg.get("firmName",        "Your Firm")
site_url     = cfg.get("siteUrl",         "https://your-domain.vercel.app").rstrip("/")
page_title   = cfg.get("pageTitle",       f"Portfolio Careers | {firm_name}")
description  = cfg.get("description",     f"Explore open roles across {firm_name}'s portfolio companies.")
twitter_hdl    = cfg.get("twitterHandle",   "@yourfirmhandle")
og_headline    = cfg.get("ogImageHeadline", "Portfolio Careers")
og_tagline     = cfg.get("ogImageTagline",  f"Explore open roles across our portfolio companies")
logo_file      = cfg.get("logoFile",        "logo.svg")
accent_hex     = cfg.get("accentColor",     "#00b6fe")
bg_hex         = cfg.get("bgColor",         "#0d1b2a")
published_date = cfg.get("publishedDate",   __import__("datetime").date.today().isoformat())

# Normalise to ISO 8601 datetime string (LinkedIn requires the time component)
if len(published_date) == 10:          # "YYYY-MM-DD" → add time + UTC offset
    published_time = published_date + "T00:00:00Z"
else:
    published_time = published_date    # already a full datetime string

logo_path    = REPO_ROOT / logo_file
og_image_url = f"{site_url}/og-image.png"

# ── Hex → RGB helper ──────────────────────────────────────────────────────────
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

ACCENT = hex_to_rgb(accent_hex)
BG     = hex_to_rgb(bg_hex)
WHITE  = (255, 255, 255)
MUTED  = tuple(min(255, int(c * 0.72 + 100)) for c in ACCENT)   # auto-derived muted tint
SUBTLE = tuple(max(0,   int(c * 0.35 + 30))  for c in ACCENT)   # very muted (URL)

# ── Font loader with graceful fallback ───────────────────────────────────────
def load_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

LATO_BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/lato/Lato-Bold.ttf",
    "/Library/Fonts/Lato-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Lato-Bold.ttf",
    os.path.expanduser("~/Library/Fonts/Lato-Bold.ttf"),
]
LATO_REG_CANDIDATES  = [p.replace("Bold", "Regular") for p in LATO_BOLD_CANDIDATES]
LATO_MED_CANDIDATES  = [p.replace("Bold", "Medium")  for p in LATO_BOLD_CANDIDATES]

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Generate og-image.png
# ══════════════════════════════════════════════════════════════════════════════
print("Generating og-image.png …")

W, H = 1200, 630
img  = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Subtle dot-grid texture
for x in range(0, W, 60):
    for y in range(0, H, 60):
        draw.ellipse([x-1, y-1, x+1, y+1], fill=(255, 255, 255, 8))

# Top accent bar
draw.rectangle([0, 0, W, 5], fill=ACCENT)

# Right-side decorative circle rings
cx, cy = 980, 315
for r, alpha in [(280, 12), (220, 18), (160, 25), (100, 35)]:
    ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd   = ImageDraw.Draw(ring)
    rd.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(*ACCENT, alpha), width=1)
    img.paste(ring, mask=ring.split()[3])

# Logo
if logo_path.exists() and logo_path.suffix.lower() == ".svg":
    logo_png = cairosvg.svg2png(url=str(logo_path), output_width=300)
    logo     = Image.open(io.BytesIO(logo_png)).convert("RGBA")
else:
    logo     = None
    print(f"  Warning: logo file '{logo_path}' not found or not an SVG — skipping logo.")

lh = 0
if logo:
    lw, lh = logo.size
    img.paste(logo, (80, 70), mask=logo.split()[3])

# Thin separator line below logo
sep_y = 70 + lh + 28
draw.rectangle([80, sep_y, 80 + 64, sep_y + 3], fill=ACCENT)

# Headline
font_h = load_font(LATO_BOLD_CANDIDATES, 72)
draw.text((80, sep_y + 22), og_headline, font=font_h, fill=WHITE)

# Sub-headline (tagline)
font_s = load_font(LATO_REG_CANDIDATES, 26)
sub_y  = sep_y + 22 + 72 + 10
draw.text((80, sub_y), og_tagline, font=font_s, fill=MUTED)

# Bottom URL badge (strip protocol for cleanliness)
font_u  = load_font(LATO_MED_CANDIDATES, 20)
url_txt = re.sub(r"^https?://", "", site_url)
bb      = font_u.getbbox(url_txt)
url_w   = bb[2] - bb[0]
draw.text((W - url_w - 56, H - 48), url_txt, font=font_u, fill=SUBTLE)

img.save(OG_OUT, "PNG", optimize=True)
print(f"  ✓  Saved {OG_OUT.name}  ({W}×{H})")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Patch index.html meta tags
# ══════════════════════════════════════════════════════════════════════════════
print("Patching index.html …")

if not INDEX_HTML.exists():
    print(f"  Warning: {INDEX_HTML} not found — skipping HTML patch.")
    sys.exit(0)

html = INDEX_HTML.read_text(encoding="utf-8")
original = html

year = __import__("datetime").date.today().year

# Helper: replace the content="..." value of a specific meta/link/title tag
def patch_tag(source, pattern, replacement):
    """Replace first occurrence of pattern with replacement (regex sub)."""
    new_source, count = re.subn(pattern, replacement, source, count=1, flags=re.IGNORECASE)
    if count == 0:
        print(f"  ! Could not find pattern: {pattern[:60]}")
    return new_source

# <title>
html = patch_tag(html,
    r"(<title>)[^<]*(</title>)",
    rf"\g<1>{page_title}\g<2>")

# <meta name="description">
html = patch_tag(html,
    r'(<meta\s+name="description"\s+content=")[^"]*(")',
    rf'\g<1>{description}\g<2>')

# <link rel="canonical">
html = patch_tag(html,
    r'(<link\s+rel="canonical"\s+href=")[^"]*(")',
    rf'\g<1>{site_url}\g<2>')

# og:url
html = patch_tag(html,
    r'(<meta\s+property="og:url"\s+content=")[^"]*(")',
    rf'\g<1>{site_url}\g<2>')

# og:site_name
html = patch_tag(html,
    r'(<meta\s+property="og:site_name"\s+content=")[^"]*(")',
    rf'\g<1>{firm_name}\g<2>')

# og:title
html = patch_tag(html,
    r'(<meta\s+property="og:title"\s+content=")[^"]*(")',
    rf'\g<1>{page_title}\g<2>')

# og:description
html = patch_tag(html,
    r'(<meta\s+property="og:description"\s+content=")[^"]*(")',
    rf'\g<1>{description}\g<2>')

# og:image
html = patch_tag(html,
    r'(<meta\s+property="og:image"\s+content=")[^"]*(")',
    rf'\g<1>{og_image_url}\g<2>')

# twitter:site
html = patch_tag(html,
    r'(<meta\s+name="twitter:site"\s+content=")[^"]*(")',
    rf'\g<1>{twitter_hdl}\g<2>')

# twitter:title
html = patch_tag(html,
    r'(<meta\s+name="twitter:title"\s+content=")[^"]*(")',
    rf'\g<1>{page_title}\g<2>')

# twitter:description
html = patch_tag(html,
    r'(<meta\s+name="twitter:description"\s+content=")[^"]*(")',
    rf'\g<1>{description}\g<2>')

# twitter:image
html = patch_tag(html,
    r'(<meta\s+name="twitter:image"\s+content=")[^"]*(")',
    rf'\g<1>{og_image_url}\g<2>')

# article:author (LinkedIn author field)
html = patch_tag(html,
    r'(<meta\s+property="article:author"\s+content=")[^"]*(")',
    rf'\g<1>{firm_name}\g<2>')

# article:published_time (LinkedIn publish date field)
html = patch_tag(html,
    r'(<meta\s+property="article:published_time"\s+content=")[^"]*(")',
    rf'\g<1>{published_time}\g<2>')

# Logo alt text
html = patch_tag(html,
    r'(<img\s+src="logo\.svg"\s+alt=")[^"]*(")',
    rf'\g<1>{firm_name}\g<2>')

# Static footer copyright (fallback before JS runtime config loads)
html = patch_tag(html,
    r'(id="footer-copy">)[^<]*(</span>)',
    rf'\g<1>© {year} {firm_name}\g<2>')

if html == original:
    print("  (no changes needed — index.html already up to date)")
else:
    INDEX_HTML.write_text(html, encoding="utf-8")
    print("  ✓  index.html patched")

print("\nAll done! Commit both og-image.png and index.html.")
