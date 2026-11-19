"""Build the static site into ./public.   Usage: python build.py

Pure standard library (Python 3.12+). GitHub Actions runs this before every deploy.
"""
import hashlib
import json
import os
import re
import shutil
import sys
from html import unescape
from urllib.parse import unquote, urlparse

from sitegen import config as C
from sitegen import layout
from sitegen.pages import all_pages

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "src", "static")
OUT = os.path.join(ROOT, "public")

_CA_SKIP = ("/ca/", "/api/", "/go/")
_EXT_RE = re.compile(r"\.[a-z0-9]{2,12}$")


def _add_ca(url):
    if any(url.startswith(s) for s in _CA_SKIP):
        return url
    if _EXT_RE.search(url.split("?")[0].split("#")[0].rstrip("/")):
        return url
    return "/ca" + url


def rewrite_links(html):
    return re.sub(r'href=(["\'])(/[^"\']*)\1', lambda m: f'href={m.group(1)}{_add_ca(m.group(2))}{m.group(1)}', html)


def write(rel, text):
    p = os.path.join(OUT, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def asset_hash():
    h = hashlib.sha256()
    for rel in ("css/site.css", "js/site.js"):
        h.update(open(os.path.join(STATIC, rel), "rb").read())
    return h.hexdigest()[:10]


def sitemaps(pages):
    def entry(p):
        alts = "".join(f'<xhtml:link rel="alternate" hreflang="{hl}" href="{C.SITE_URL}{h}"/>' for hl, h in p.alternates)
        if p.alternates:  # x-default = the first (English) version
            alts += f'<xhtml:link rel="alternate" hreflang="x-default" href="{C.SITE_URL}{p.alternates[0][1]}"/>'
        lm = f"<lastmod>{p.modified[:10]}</lastmod>" if p.modified else ""
        return f"<url><loc>{C.SITE_URL}{p.path}</loc>{lm}{alts}</url>\n"
    urls = "".join(entry(p) for p in pages if p.in_sitemap and "noindex" not in p.robots)
    urlset = (f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
              f'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n{urls}</urlset>\n')
    write("sitemap.xml", urlset)       # main sitemap: every indexable page
    write("page-sitemap.xml", urlset)  # kept for sitemap_index.xml (submitted since the WordPress days)
    last = max((p.modified for p in pages if p.modified), default="")
    write("sitemap_index.xml", f'<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                               f'<sitemap><loc>{C.SITE_URL}/page-sitemap.xml</loc><lastmod>{last}</lastmod></sitemap>\n</sitemapindex>\n')
    ai = "".join(f"\nUser-agent: {bot}\nAllow: /\nDisallow: /api/\n" for bot in ("GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"))
    write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /go/\n{ai}\nSitemap: {C.SITE_URL}/sitemap.xml\n")


def check_redirects(pages):
    """A redirect whose source is a real page would hide that page: fail the build instead."""
    real = {p.path for p in pages}
    bad = []
    for line in open(os.path.join(OUT, "_redirects"), encoding="utf-8"):
        parts = line.split()
        if len(parts) >= 2 and not line.startswith("#") and parts[0] in real:
            bad.append(parts[0])
    return bad


def llms_txt():
    """Plain-text site summary for AI assistants (https://llmstxt.org)."""
    from sitegen.seo import HUBS
    from sitegen.seo_content import ALL
    lines = [f"# {C.LEGAL_NAME}", "",
             "> Premium IPTV service for Canada (English and French): 50,000+ live channels including TSN, Sportsnet, RDS, TVA, CBC and CTV,",
             "> 300,000+ movies and series in HD and 4K, plans from $9 USD on 1-5 devices, free 24-hour trial, 7-day money-back guarantee, 24/7 support on WhatsApp.",
             "", "## Main pages",
             f"- Plans and prices: {C.SITE_URL}/ca/iptv-plans-canada/", f"- Free 24-hour trial: {C.SITE_URL}/ca/try-iptv-canada/",
             f"- Channels list: {C.SITE_URL}/ca/channels-list/", f"- How it works: {C.SITE_URL}/ca/how-it-works/", f"- Contact: {C.SITE_URL}/ca/contact/"]
    for key, (_, label) in HUBS.items():
        pages = [p for p in ALL if p["hub"] == key and not p.get("service_area") and not p["slug"].startswith("fr/canada/")]
        if pages:
            lines += ["", f"## {label or 'Guides'}"]
            lines += [f"- {unescape(re.sub('<[^>]+>', '', p['h1']))}: {C.SITE_URL}/ca/{p['slug']}/" for p in pages]
    lines += ["", "## Locations",
              f"- IPTV across Canada by province and city: {C.SITE_URL}/ca/canada/",
              f"- IPTV across the USA by state and city: {C.SITE_URL}/ca/usa/",
              f"- IPTV near me (all cities): {C.SITE_URL}/ca/iptv-near-me/",
              f"- IPTV au Québec (en français): {C.SITE_URL}/ca/iptv-quebec/"]
    write("llms.txt", "\n".join(lines) + "\n")


def manifest():
    write("site.webmanifest", json.dumps({
        "name": C.LEGAL_NAME, "short_name": C.NAME, "start_url": "/ca/", "display": "standalone",
        "background_color": "#06070b", "theme_color": "#06070b",
        "icons": [{"src": "/brand/icon-192.png?v=4", "sizes": "192x192", "type": "image/png"},
                  {"src": "/brand/icon-512.png?v=4", "sizes": "512x512", "type": "image/png"}],
    }, indent=2))


def check_links():
    """Fail the build if any page links to a local file or page that doesn't exist."""
    redirects = [l.split()[0] for l in open(os.path.join(OUT, "_redirects"), encoding="utf-8") if l.strip() and not l.startswith("#")]
    bad = []
    for dirpath, _, files in os.walk(OUT):
        for f in files:
            if not f.endswith(".html"):
                continue
            html = open(os.path.join(dirpath, f), encoding="utf-8").read()
            for ref in re.findall(r'(?:href|src)="(/[^"#]*)"', html):
                path = unquote(urlparse(unescape(ref)).path)
                if path.startswith(("/api/", "/cdn-cgi/")) or path in redirects:
                    continue
                target = os.path.join(OUT, path.lstrip("/"))
                if not (os.path.isfile(target) or os.path.isfile(os.path.join(target, "index.html"))):
                    bad.append(f"{os.path.relpath(os.path.join(dirpath, f), OUT)} -> {ref}")
    return bad


def check_layout(pages):
    """Every page must use the shared header, footer and (except the homepage) the shared page title block."""
    bad = []
    for p in pages:
        html = layout.render(p)
        if html.count('<header class="header">') != 1 or html.count('<footer class="footer">') != 1:
            bad.append(f"{p.path}: missing shared header/footer")
        if html.count("<h1") != 1:
            bad.append(f"{p.path}: has {html.count('<h1')} <h1> titles (must be exactly 1)")
        if p.path not in ("/", "/ca/") and not p.body.lstrip().startswith('<section class="page-hero">'):
            bad.append(f"{p.path}: must start with page_hero() so the title area matches every other page")
    indexed = [p for p in pages if "noindex" not in p.robots]
    for attr in ("title", "description"):
        seen = {}
        for p in indexed:
            v = getattr(p, attr).strip().lower()
            if v in seen:
                bad.append(f"{p.path}: same {attr} as {seen[v]}")
            seen.setdefault(v, p.path)
    for p in indexed:  # warnings only: Google truncates long titles/descriptions
        if len(p.title) > 65:
            print(f"  note: {p.path} title is {len(p.title)} chars")
        if not 70 <= len(p.description) <= 165:
            print(f"  note: {p.path} description is {len(p.description)} chars")
    return bad


def main():
    layout.ASSET_VERSION = asset_hash()
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(STATIC, OUT)

    pages = all_pages()
    bad = check_layout(pages)
    if bad:
        print("Inconsistent page layout:\n  " + "\n  ".join(bad))
        sys.exit(1)
    seen = set()
    for p in pages:
        assert p.path not in seen, f"duplicate page {p.path}"
        seen.add(p.path)
        write(p.path + "index.html", rewrite_links(layout.render(p)))
    bad = check_redirects(pages)
    if bad:
        print("Redirects that would hide real pages:\n  " + "\n  ".join(bad))
        sys.exit(1)
    from sitegen.pages import not_found
    write("404.html", rewrite_links(layout.render(not_found())))  # Cloudflare Pages serves this for unknown URLs (with a 404 status)
    sitemaps(pages)
    llms_txt()
    manifest()

    bad = check_links()
    if bad:
        print("Broken internal links:\n  " + "\n  ".join(sorted(set(bad))))
        sys.exit(1)
    print(f"Built {len(pages)} pages into public/ (assets v{layout.ASSET_VERSION})")


if __name__ == "__main__":
    main()
