"""The HTML shell shared by every page: <head> (SEO + analytics), header, footer, contact dock."""
import json
import os
from dataclasses import dataclass, field
from html import escape

import re

from . import config as C
from .icons import icon, payment_icons
from .imgmeta import add_dimensions, image_size

ASSET_VERSION = "dev"  # set by build.py to a content hash


@dataclass
class Page:
    path: str                      # "/" or "/slug/"
    title: str
    description: str
    body: str
    og_image: str = C.DEFAULT_OG
    og_type: str = "website"
    robots: str = "follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large"
    published: str = ""
    modified: str = ""
    jsonld: list = field(default_factory=list)
    in_sitemap: bool = True
    canonical: str = ""  # set when the page is a variant whose canonical URL is another page
    nav_active: str = ""           # which NAV href to highlight
    lang: str = "en-CA"            # html lang / og:locale ("fr-CA" for the French Québec pages)
    alternates: list = field(default_factory=list)  # [(hreflang, path)] incl. this page, e.g. en-CA / fr-CA pairs
    preload_image: str = ""        # attributes for an LCP image preload link, e.g. 'href="..." imagesrcset="..." imagesizes="100vw"'


def abs_url(u):
    return u if u.startswith("http") else C.SITE_URL + u


# The question group may not cross another <details>/<summary>, otherwise a non-FAQ <details> earlier on the page
# (e.g. the country lists on /channels-list/) gets swallowed into the first question.
_FAQ_ITEM = re.compile(r'<details[^>]*><summary>((?:(?!<summary>|</details>).)*?)</summary><div class="answer">(.*?)</div></details>', re.S)


def _plain(html):
    from html import unescape
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def _auto_faq(p: Page):
    """FAQPage schema built from the FAQ that is actually visible on the page (so schema and page can never differ)."""
    if any(isinstance(x, dict) and x.get("@type") == "FAQPage" for x in p.jsonld):
        return None
    items = _FAQ_ITEM.findall(p.body)
    if not items:
        return None
    return {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": _plain(q), "acceptedAnswer": {"@type": "Answer", "text": _plain(a)}} for q, a in items]}


def _analytics():
    first = C.GOOGLE_TAGS[0]
    configs = "".join(f'gtag("config","{t}");' for t in C.GOOGLE_TAGS)
    return f"""<script async src="https://www.googletagmanager.com/gtag/js?id={first}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag("js",new Date());gtag("set","linker",{{"domains":["iptvmapletv.com"]}});{configs}</script>
<script>!function(w,d){{if(!w.rdt){{var p=w.rdt=function(){{p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)}};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}}}(window,document);rdt("init","{C.REDDIT_PIXEL}");rdt("track","PageVisit");</script>"""


def _head(p: Page):
    url = abs_url(p.path)
    img = abs_url(p.og_image)
    t, d = escape(p.title), escape(p.description)
    sz = image_size(p.og_image) if not p.og_image.startswith("http") else None
    og_size = (f'<meta property="og:image:width" content="{sz[0]}">\n<meta property="og:image:height" content="{sz[1]}">\n' if sz else "")
    others = sorted({hl.replace("-", "_") for hl, _ in p.alternates if hl not in ("x-default", p.lang)})
    og_alt = "".join(f'<meta property="og:locale:alternate" content="{o}">\n' for o in others)
    title_text = escape(p.title, quote=False)
    ld = [{
        "@context": "https://schema.org", "@graph": [
            {"@type": "Organization", "@id": C.SITE_URL + "/#organization", "name": C.LEGAL_NAME, "url": C.SITE_URL,
             "logo": C.SITE_URL + "/brand/icon-512.png", "email": C.EMAIL,
             "contactPoint": {"@type": "ContactPoint", "contactType": "customer support", "email": C.EMAIL,
                              "areaServed": "CA", "availableLanguage": ["English", "French"]}},
            {"@type": "WebSite", "@id": C.SITE_URL + "/#website", "url": C.SITE_URL, "name": C.LEGAL_NAME,
             "alternateName": C.NAME, "publisher": {"@id": C.SITE_URL + "/#organization"}, "inLanguage": "en-CA"},
            {"@type": "WebPage", "@id": url + "#webpage", "url": url, "name": p.title, "description": p.description,
             "isPartOf": {"@id": C.SITE_URL + "/#website"}, "inLanguage": p.lang,
             **({"datePublished": p.published} if p.published else {}), **({"dateModified": p.modified} if p.modified else {})},
        ] + p.jsonld + ([f] if (f := _auto_faq(p)) else []),
    }]
    dates = ""
    if p.og_type == "article" and p.published:
        dates = f'<meta property="article:published_time" content="{p.published}">\n<meta property="article:modified_time" content="{p.modified or p.published}">\n'
    return f"""<!doctype html>
<html lang="{p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title_text}</title>
<meta name="description" content="{d}">
<meta name="robots" content="{p.robots}">
{"" if p.path == "/404/" else f'<link rel="canonical" href="{abs_url(p.canonical) if p.canonical else url}">'}{"".join(f'{chr(10)}<link rel="alternate" hreflang="{hl}" href="{abs_url(h)}">' for hl, h in p.alternates)}{f'{chr(10)}<link rel="alternate" hreflang="x-default" href="{abs_url(p.alternates[0][1])}">' if p.alternates else ""}
<meta name="theme-color" content="#06070b">
<meta property="og:locale" content="{p.lang.replace('-', '_')}">
<meta property="og:type" content="{p.og_type}">
<meta property="og:site_name" content="{C.LEGAL_NAME}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{abs_url(p.canonical) if p.canonical else url}">
<meta property="og:image" content="{img}">
{og_size}<meta property="og:image:alt" content="{t}">
{og_alt}{dates}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{img}">
<meta name="twitter:image:alt" content="{t}">
<meta name="google-site-verification" content="{C.GOOGLE_SITE_VERIFICATION}">
<link rel="icon" href="/favicon.ico?v=6" sizes="48x48">
<link rel="icon" href="/favicon.svg?v=6" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png?v=6">
<link rel="manifest" href="/site.webmanifest">
{f'<link rel="preload" as="image" {p.preload_image} fetchpriority="high">' + chr(10) if p.preload_image else ""}<link rel="preload" href="/fonts/sora-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v={ASSET_VERSION}">
<script type="application/ld+json">{json.dumps(ld[0], ensure_ascii=False, separators=(",", ":"))}</script>
{_analytics()}
</head>"""


def brand_html():
    return (f'<a class="brand" href="/ca/" aria-label="{C.NAME} home">'
            f'<picture><source srcset="/favicon.svg?v=6" media="(prefers-reduced-motion: reduce)">'
            f'<img src="/brand/logo-animated.svg?v=6" width="38" height="38" alt=""></picture>'
            f'<span class="wm"><span class="r">IPTV</span><span class="c">Maple</span></span></a>')


def _header(p: Page):
    def link(label, href):
        cur = ' aria-current="page"' if href == (p.nav_active or p.path) else ""
        return f'<a href="{href}"{cur}>{label}</a>'
    nav = "".join(link(l, h) for l, h in C.NAV)
    promo_text, promo_href = C.PROMO
    return f"""<a class="skip" href="#main">Skip to content</a>
<div class="top-bar">
<a class="promo" href="{promo_href}">{promo_text} <span>— <u>see how</u> →</span></a>
<header class="header">
  <div class="container">
    {brand_html()}
    <nav class="nav" aria-label="Main">{nav}</nav>
    <div class="header-cta">
      <a class="btn btn--ghost btn--sm" href="/ca/try-iptv-canada/">Free trial</a>
      <a class="btn btn--primary btn--sm" href="/ca/iptv-plans-canada/">Get started</a>
      <button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav"><span></span></button>
    </div>
  </div>
</header>
</div>
<nav class="mobile-nav" id="mobile-nav" aria-label="Mobile">
  {nav}
  <a class="btn btn--primary btn--lg btn--block" href="/ca/iptv-plans-canada/">See plans — 50% off</a>
  <a class="btn btn--ghost btn--lg btn--block" href="/ca/try-iptv-canada/">Start free 24h trial</a>
</nav>"""


def _footer():
    cols = "".join(
        f'<div><h4>{title}</h4><ul>{"".join(f"<li><a href=\"{h}\">{l}</a></li>" for l, h in links)}</ul></div>'
        for title, links in C.FOOTER
    )
    return f"""<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        {brand_html()}
        <p style="margin-top:18px">Premium IPTV for Canada — live TV, sports, movies and series in stunning 4K on every device. No contracts, no hidden fees.</p>
        <div class="pay" aria-label="Accepted payment methods">{payment_icons()}</div>
      </div>
      {cols}
      <div><h4>Get in touch</h4><ul>
        <li><a href="{C.WHATSAPP_URL}" target="_blank" rel="noopener">WhatsApp</a></li>
        <li><a href="{C.MAILTO}">{C.EMAIL}</a></li>
      </ul></div>
    </div>
    <p class="footer-disclaimer"><strong>Disclaimer:</strong> {C.NAME} does not host or stream any copyrighted content. All content is provided by third-party providers.
      Users are responsible for ensuring they have the rights to view content in their jurisdiction. <a href="/ca/disclaimer/">Read more</a></p>
    <div class="footer-bottom">
      <span>© {C.YEAR} {C.NAME}. All rights reserved.</span>
      <span>Prices in USD · 7-day money-back guarantee</span>
    </div>
  </div>
  <div class="footer-word" aria-hidden="true">IPTVMaple</div>
</footer>
<div class="dock" aria-label="Contact us">
  <a class="wa" href="{C.WHATSAPP_URL}" target="_blank" rel="noopener" data-label="Chat on WhatsApp" aria-label="Chat on WhatsApp">{icon("whatsapp")}</a>
  <a class="em" href="{C.MAILTO}" data-label="Email us" aria-label="Email us">{icon("mail")}</a>
</div>"""


def fix_heading_levels(html):
    """Keep the outline H1 > H2 > H3 unbroken: a heading that jumps a level (h1 -> h3) becomes the next level down,
    with the original size kept through the .hN utility class so the design does not change."""
    last = [0]
    def fix(m):
        lvl, attrs = int(m.group(1)), m.group(2)
        if last[0] and lvl > last[0] + 1:
            new = last[0] + 1
            cls = re.search(r'class="([^"]*)"', attrs)
            attrs = re.sub(r'class="[^"]*"', f'class="{cls.group(1)} h{lvl}"', attrs) if cls else f'{attrs} class="h{lvl}"'
            lvl_out = new
        else:
            lvl_out = lvl
        last[0] = lvl_out
        return f"<h{lvl_out}{attrs}>"
    def close(m):  # closing tags are matched in the same order, so re-derive levels from the opening pass
        return m.group(0)
    out, pos, stack = [], 0, []
    for m in re.finditer(r"<h([1-6])\b([^>]*)>|</h([1-6])>", html):
        out.append(html[pos:m.start()]); pos = m.end()
        if m.group(1):
            new_open = fix(m); stack.append(int(new_open[2]))
            out.append(new_open)
        else:
            out.append(f"</h{stack.pop() if stack else m.group(3)}>")
    out.append(html[pos:])
    return "".join(out)


def _sales_data():
    """Entries from src/data/recent-orders.json, inlined into every page for the recent-activity
    notification card (no API call at runtime). Empty file -> nothing is emitted -> no card."""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "src", "data", "recent-orders.json")
    try:
        rows = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    clean = lambda v, n: re.sub(r"[<>&\"]", "", str(v or "")).strip()[:n]
    items = []
    for r in rows if isinstance(rows, list) else []:
        x = {"first": clean(r.get("first"), 24), "place": clean(r.get("place"), 40), "plan": clean(r.get("plan"), 24)}
        if not all(x.values()):
            continue
        if r.get("date"):
            x["at"] = clean(r["date"], 25)
        items.append(x)
    items.sort(key=lambda x: x.get("at", ""), reverse=True)
    if not items:
        return ""
    return f'<script type="application/json" id="sale-data">{json.dumps(items[:20], ensure_ascii=False, separators=(",", ":"))}</script>\n'


_SALES = None


def render(p: Page):
    global _SALES
    if _SALES is None:
        _SALES = _sales_data()
    body = fix_heading_levels(p.body)
    return add_dimensions(f"""{_head(p)}
<body>
{_header(p)}
<main id="main">
{body}
</main>
{_footer()}
{_SALES}<script src="/js/site.js?v={ASSET_VERSION}" defer></script>
</body>
</html>
""")
