"""Every page on the site. Each function returns one or more layout.Page objects."""
import json
import re
from html import escape

from . import config as C
from .components import (FEATURES, PLANS, aurora, all_plans, breadcrumb_ld, checks, content, cta_band, data, devices_label,
                         faq, faq_ld, faq_section, guarantee, lead_form, page_hero, per_month, plan_label, pricing,
                         referral_form, review_ld, reviews_section, section_head, trust_row)
from .icons import icon
from .layout import Page
from .seo import seo_pages
from .seo_content._util import price_table
from .seo_content.money_pages import TRIAL_FAQ, home_copy, plan_guide, pricing_copy, trial_copy

META = data("page-meta")
FAQ = data("faq")
PAGE_FAQS = data("page-faqs")


def page_faq(slug):
    """FAQ block for pages that have their own questions (src/data/page-faqs.json)."""
    items = PAGE_FAQS.get(slug)
    return faq_section(items) if items else ""


def img(path):
    return re.sub(r"^https?://[^/]+/wp-content/uploads/", "/images/", path)


def _carousels():
    """Logo / poster / device image lists (from the old homepage carousels)."""
    return data("media")


WHY = [
    ("sparkles", "4K quality", "Stunning 4K streaming that brings every detail to life with incredible clarity and colour."),
    ("settings", "Easy to set up", "Quick, guided setup on any device — you’re watching within minutes of ordering."),
    ("wifi", "No buffering", "Anti-freeze servers keep live sports and movies smooth, even at peak hours."),
    ("lock", "Safe & secure", "Your privacy is our priority, with strict data protection and top-level security."),
    ("headset", "24/7 support", "Real humans on WhatsApp and email — quick, reliable help whenever you need it."),
    ("refund", "7-day money-back", "Not completely satisfied? We offer a full refund within 7 days of purchase."),
]


def why_grid():
    cards = "".join(
        f'<div class="card card--hover feature reveal" style="--d:{i * .06:.2f}s"><div class="icon">{icon(ic)}</div><h3>{t}</h3><p>{d}</p></div>'
        for i, (ic, t, d) in enumerate(WHY))
    return f'<div class="grid grid-3 why-grid">{cards}</div>'


def logo_marquee(items, speed=60, reverse=False):
    tiles = "".join(f'<div class="logo-tile"><img src="{src}" alt="{escape(alt)}" loading="lazy" height="40"></div>' for src, alt in items)
    return f'<div class="marquee{" marquee--reverse" if reverse else ""}" style="--speed:{speed}s"><div class="marquee-track">{tiles}{tiles.replace("alt=", "aria-hidden=\"true\" alt=")}</div></div>'


def network_section():
    return f"""<section class="section section--tight">
  <div class="container network">
    <div class="reveal">
      <span class="kicker">Global network</span>
      <h2 class="h2">Over 2,000 servers in 198 countries</h2>
      <p class="lead">Enjoy uninterrupted IPTVMaple streaming with a fast, stable and reliable connection, ensuring premium performance across our global network.</p>
    </div>
    <img class="reveal" src="/images/2024/12/asset-6.png" alt="Fast and reliable IPTV streaming network map" width="641" height="268" loading="lazy">
  </div>
</section>"""


# =================================================================== HOME
SEARCHES = [
    ("IPTV Québec", "/iptv-quebec/"), ("Meilleur IPTV Québec", "/meilleur-iptv/"), ("Abonnement IPTV", "/abonnement-iptv/"),
    ("IPTV Montréal", "/canada/quebec/montreal/"), ("Chaînes IPTV Québec", "/iptv-quebec/"), ("IPTV sur Smart TV", "/iptv-sur-smart-tv/"),
    ("Best IPTV Canada 2026", "/best-iptv-canada/"), ("IPTV Subscription Canada", "/iptv-plans-canada/"), ("IPTV Free Trial", "/try-iptv-canada/"),
    ("IPTV Near Me", "/iptv-near-me/"), ("IPTV USA", "/usa/"), ("IPTV by Province", "/canada/"), ("IPTV New York", "/usa/new-york/new-york-city/"),
    ("IPTV Los Angeles", "/usa/california/los-angeles/"), ("IPTV Chicago", "/usa/illinois/chicago/"), ("IPTV Houston", "/usa/texas/houston/"), ("IPTV Toronto", "/canada/ontario/toronto/"), ("IPTV Vancouver", "/canada/british-columbia/vancouver/"),
    ("IPTV Calgary", "/canada/alberta/calgary/"), ("IPTV Edmonton", "/canada/alberta/edmonton/"), ("IPTV Ottawa", "/canada/ontario/ottawa/"),
    ("IPTV Smarters Pro", "/iptv-smarters-pro/"), ("TiviMate", "/tivimate/"), ("Best IPTV Apps", "/iptv-apps/"),
    ("IPTV on Firestick", "/iptv-firestick/"), ("Best IPTV Box", "/iptv-box/"), ("Formuler Z11 Pro Max", "/formuler-iptv/"),
    ("IPTV Samsung TV", "/iptv-samsung-tv/"), ("IPTV Apple TV", "/iptv-apple-tv/"), ("M3U Playlist", "/m3u-playlist/"),
    ("Sports IPTV", "/iptv-sports/"), ("NHL IPTV", "/nhl-iptv/"), ("UFC PPV IPTV", "/ufc-iptv/"),
    ("4K IPTV", "/4k-iptv/"), ("What Is IPTV", "/what-is-iptv/"), ("IPTV Reviews", "/iptv-reviews/"),
    ("International IPTV", "/iptv-international/"), ("IP Televizija", "/ex-yu-iptv/"), ("IPTV Server", "/iptv-server/"),
    ("IPTV sur Fire Stick", "/iptv-sur-firestick/"), ("TiviMate en français", "/tivimate-en-francais/"), ("UK IPTV Canada", "/uk-iptv/"),
    ("IPTV Price", "/iptv-price/"), ("IPTV Providers", "/iptv-providers/"), ("Is IPTV Legal?", "/is-iptv-legal-in-canada/"), ("IPTV Reddit", "/iptv-reddit/"),
    ("TiviMate Premium", "/tivimate-premium/"), ("TiviMate Firestick", "/tivimate-firestick/"), ("Smarters Pro Firestick", "/iptv-smarters-pro-firestick/"),
    ("Smarters Samsung & LG", "/iptv-smarters-pro-samsung-lg/"), ("Watch IPTV Online", "/watch-iptv-online/"), ("IPTV Buffering Fix", "/iptv-buffering-fix/"),
    ("Premier League IPTV", "/premier-league-iptv/"), ("Champions League IPTV", "/champions-league-iptv/"), ("beIN Sports IPTV", "/bein-sports-iptv/"),
    ("ESPN IPTV", "/espn-iptv/"), ("Plex IPTV", "/plex-iptv/"), ("Jellyfin IPTV", "/jellyfin-iptv/"), ("IPTV Guides", "/iptv-guides/"),
    ("IPTV pas cher", "/iptv-pas-cher/"), ("IPTV légal", "/iptv-legal-canada/"), ("Lecteur IPTV", "/lecteur-iptv/"), ("Liste IPTV M3U", "/liste-iptv-m3u/"),
    ("IPTV ne fonctionne plus", "/iptv-ne-fonctionne-plus/"),
]

LEAGUES = [
    ("🏈", "Football", "NFL, Premier League, La Liga, Champions League, World Cup"),
    ("🏀", "Basketball", "NBA, EuroLeague, FIBA tournaments"),
    ("🏒", "Hockey", "NHL, IIHF World Championships"),
    ("🥊", "UFC & combat", "UFC, WWE, MMA, boxing events"),
    ("⚾", "Baseball", "MLB, World Series"),
    ("🏎️", "Motorsports", "Formula 1, MotoGP, NASCAR"),
    ("🎾", "Tennis", "Wimbledon, US Open, French Open, Australian Open"),
    ("🏏", "Cricket & athletics", "IPL, ICC World Cup, Olympics, Diamond League"),
]


def media_visual(src):
    if isinstance(src, str):
        return f'<img src="{src}" alt="" loading="lazy" width="960" height="540">'
    imgs = "".join(f'<img src="{x}" alt="" loading="lazy" width="590" height="800">' for x in src)
    return f'<div class="media-strip">{imgs}</div>'


def home():
    m = _carousels()
    meta = META["home"]
    posters = m["posters"]
    real = [x for x in posters if "/movies" in x[0]]
    cols = [real[i::3] for i in range(3)]
    def poster_col(c):
        imgs = "".join(f'<img src="{src}" alt="" width="590" height="800"{"" if j < 3 else ' loading="lazy"'}>' for j, (src, _) in enumerate(c + c))
        return f'<div class="poster-col">{imgs}</div>'
    wall = "".join(poster_col(c) for c in cols)
    rail = "".join(f'<img src="{s}" alt="{escape(a)}" width="590" height="800" loading="lazy">' for s, a in real)
    devices = "".join(f'<div class="device"><img src="{s}" alt="{escape(a)}" loading="lazy"></div>' for s, a in m["devices"])
    leagues = "".join(f'<li><span class="emo" aria-hidden="true">{e}</span><span><b>{t}</b>{d}</span></li>' for e, t, d in LEAGUES)
    orbit = "".join(f'<div class="orbit"><img src="{s}" alt="{escape(a)}" loading="lazy"></div>' for s, a in m["sports"])
    cats = [
        ("/images/2024/12/Holiday-Gathering-iStock-1.webp", "Live sports", "Live Sports", "Watch every major match, tournament and event in real time. Football, UFC, F1, basketball — all your favourite sports, all in one place.", "/#sports"),
        (["/images/2025/01/movies-5.jpg", "/images/2025/01/movies-13.webp", "/images/2025/01/movies-12.webp"], "4K movies", "Latest Movies", "Enjoy thousands of blockbuster hits and new releases in crystal-clear 4K. Movie nights have never looked this good.", "/iptv-plans-canada/"),
        (["/images/2025/01/movies.jpg", "/images/2025/01/movies-3.jpg", "/images/2025/01/movies-6.jpg"], "Series", "Latest TV Shows", "Stream popular series from around the world — drama, comedy, documentaries and more. Always something new to watch.", "/channels-list/"),
    ]
    cat_html = "".join(
        f'<a class="media-card reveal" style="--d:{i * .08:.2f}s" href="{href}">{media_visual(src)}<span class="tag">{tag}</span><h3>{t}</h3><p>{d}</p><span class="link-arrow">Explore</span></a>'
        for i, (src, tag, t, d, href) in enumerate(cats))
    searches = "".join(f'<a href="{h}">{escape(t)}</a>' for t, h in SEARCHES)

    body = f"""
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><img src="/images/hero/canada-fan-bg-1920.webp" srcset="/images/hero/canada-fan-bg-960.webp 960w, /images/hero/canada-fan-bg-1920.webp 1920w" sizes="100vw" width="1920" height="1410" alt="" fetchpriority="high"></div>
  {aurora()}<div class="grid-bg" aria-hidden="true"></div>
  <div class="container z">
    <div class="hero-copy">
      <span class="eyebrow"><b>50% OFF</b> Premium 4K IPTV · made for Canada 🍁</span>
      <h1 class="h1">The best IPTV service in Canada for <span class="grad-text">2026</span></h1>
      <p class="lead">50,000+ live channels and 300,000+ movies &amp; series in stunning 4K. Buffer-free streaming on every device, instant activation — no contracts, no hidden fees.</p>
      <div class="btn-row">
        <a class="btn btn--primary btn--lg" href="#pricing">See plans — 50% off {icon("arrow-right")}</a>
        <a class="btn btn--ghost btn--lg" href="/try-iptv-canada/">{icon("play")} Free 24h trial</a>
      </div>
      <div class="hero-trust">
        <span>{icon("check-circle")} 7-day money-back</span>
        <span>{icon("check-circle")} Ready in 5 minutes</span>
        <span>{icon("check-circle")} 24/7 human support</span>
      </div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="hero-badges">
        <div class="float-card float-card--live"><span class="ic">{icon("tv")}</span><div><strong><span class="live-dot"></span>LIVE · NHL in 4K</strong><small>Sports, PPV &amp; every big game</small></div></div>
        <div class="float-card float-card--ready"><span class="ic">{icon("bolt")}</span><div><strong>Sent in under 1 minute</strong><small>Your login, ready to watch</small></div></div>
      </div>
      <div class="poster-wall"><div class="cols">{wall}</div></div>
    </div>
  </div>
</section>

<section class="section--tight" style="padding-top:0">
  <div class="container">
    <div class="stats reveal">
      <div class="stat"><b>50K+</b><span>Live TV channels</span></div>
      <div class="stat"><b>300K+</b><span>Movies &amp; series</span></div>
      <div class="stat"><b>4K</b><span>Ultra HD quality</span></div>
      <div class="stat"><b>24/7</b><span>Human support</span></div>
    </div>
  </div>
</section>

<section class="section--tight">
  <p class="center muted" style="font-size:14px;margin-bottom:22px">All your favourite networks, sports and streaming content — in one subscription</p>
  {logo_marquee(m["channels"], 70)}
</section>

<section class="section">
  <div class="container">
    {section_head("Everything in one place", "Sports. Movies. Series. <span class='grad-text nowrap'>All of it.</span>", "Stop juggling apps and cable bills. One IPTVMaple subscription brings live TV, sports and a huge on-demand library to every screen in your home.")}
    <div class="grid grid-3">{cat_html}</div>
  </div>
</section>

<section class="section--tight">
  <div class="container">{section_head("On demand", "Popular movies &amp; series", "Stream movies and TV shows on demand in HD &amp; 4K quality — updated every day.")}</div>
  <div class="marquee poster-rail reveal" style="--speed:80s"><div class="marquee-track">{rail}{rail.replace('alt="', 'aria-hidden="true" alt="')}</div></div>
</section>

<section class="section" id="pricing">
  {aurora()}
  <div class="container z">{pricing()}</div>
</section>

{reviews_section()}

<section class="section" id="sports">
  <div class="container sports">
    <div class="sports-visual reveal">
      <img src="/images/2025/11/Connor-McDavid-1-png.webp" alt="Connor McDavid playing NHL hockey – sports streaming on IPTV" width="800" height="600" loading="lazy">
      {orbit}
    </div>
    <div class="reveal">
      <span class="kicker">PPV &amp; live sports</span>
      <h2 class="h2">Feel the stadium — <span class="grad-text">from your couch</span></h2>
      <p class="lead">Cheer for your team with unlimited sports channels and live PPV events in 4K, freeze-free, anywhere in the world.</p>
      <ul class="league-list">{leagues}</ul>
      <a class="btn btn--primary btn--lg" href="#pricing">Get every game — 50% off {icon("arrow-right")}</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    {section_head("Every screen", "Works on all your devices", "Smart TVs, Firestick, Android, iPhone, computers and more. Use the IPTV app you already love.")}
    <div class="devices reveal">{devices}</div>
    <div class="apps reveal">
      {"".join(f'<span class="chip">{a}</span>' for a in ["IPTV Smarters", "TiviMate", "IBO Player", "SmartOne", "DuplexPlay", "Net IPTV", "OTT Navigator", "MAG / Formuler", "Kodi"])}
    </div>
  </div>
</section>

<section class="section" id="how">
  <div class="container">
    {section_head("Getting started", "Watching in 3 easy steps", "")}
    <div class="steps">
      <div class="card step reveal"><h3>Place your order</h3><p>Pick the perfect plan for you — 1, 6 or 12 months — and get started right away.</p></div>
      <div class="card step reveal" style="--d:.08s"><h3>Receive your login</h3><p>We send your login details by WhatsApp and email, ready for your IPTV player app.</p></div>
      <div class="card step reveal" style="--d:.16s"><h3>Start watching</h3><p>Connect on your TV, computer or phone and enjoy unlimited international channels.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    {section_head("Why IPTVMaple", "Why Canadians choose our IPTV", "")}
    {why_grid()}
  </div>
</section>

{network_section()}
{home_copy()}
{faq_section(FAQ)}
{cta_band()}

<section class="section--tight">
  <div class="container narrow center">
    <h2 class="h3 muted" style="font-size:15px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px">Popular IPTV searches in Canada &amp; Québec</h2>
    <div class="searches">{searches}</div>
  </div>
</section>"""
    offers = {"@type": "Product", "name": "IPTVMaple IPTV subscription", "brand": {"@type": "Brand", "name": C.NAME},
              "image": C.SITE_URL + "/brand/og-default.jpg", "description": meta["description"],
              "offers": {"@type": "AggregateOffer", "priceCurrency": "USD", "lowPrice": min(p["price"] for _, p in all_plans()),
                         "highPrice": max(p["price"] for _, p in all_plans()), "offerCount": 15}, **review_ld()}
    return Page("/", meta["title"], meta["description"], body, og_image=meta["og_image"] or C.DEFAULT_OG,
                published=meta["published"], modified=meta["modified"], jsonld=[faq_ld(FAQ), offers],
                preload_image='href="/images/hero/canada-fan-bg-1920.webp" imagesrcset="/images/hero/canada-fan-bg-960.webp 960w, /images/hero/canada-fan-bg-1920.webp 1920w" imagesizes="100vw"')


# =================================================================== PRICING
# Merchant-listing fields for every plan Offer. Values mirror the published /refund/ page
# (7-day full refund) and the "ready within 5 minutes" delivery claim: digital, nothing ships.
SALE_COUNTRIES = ["CA", "US"]
RETURN_POLICY = {"@type": "MerchantReturnPolicy", "applicableCountry": SALE_COUNTRIES,
                 "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow", "merchantReturnDays": 7,
                 "returnFees": "https://schema.org/FreeReturn", "refundType": "https://schema.org/FullRefund",
                 "merchantReturnLink": C.SITE_URL + "/refund/"}
SHIPPING = {"@type": "OfferShippingDetails",
            "shippingRate": {"@type": "MonetaryAmount", "value": 0, "currency": "USD"},
            "shippingDestination": [{"@type": "DefinedRegion", "addressCountry": c} for c in SALE_COUNTRIES],
            "deliveryTime": {"@type": "ShippingDeliveryTime",
                             "handlingTime": {"@type": "QuantitativeValue", "minValue": 0, "maxValue": 0, "unitCode": "DAY"},
                             "transitTime": {"@type": "QuantitativeValue", "minValue": 0, "maxValue": 0, "unitCode": "DAY"}}}


def plan_offer(p, **extra):
    return {"@type": "Offer", **extra, "price": p["price"], "priceCurrency": "USD", "availability": "https://schema.org/InStock",
            "url": f"{C.SITE_URL}/{p['slug']}/", "shippingDetails": SHIPPING, "hasMerchantReturnPolicy": RETURN_POLICY}


def _plans_product(meta):
    """Product with one Offer per plan; every price shown here is also visible in the plan cards."""
    offers = [plan_offer(p, name=f"{plan_label(p['months'])} · {devices_label(d)}") for d, p in all_plans()]
    return {"@type": "Product", "name": "IPTVMaple IPTV subscription", "brand": {"@type": "Brand", "name": C.NAME},
            "image": C.SITE_URL + "/brand/og-default.jpg", "description": meta["description"], "offers": offers, **review_ld()}


def pricing_page():
    meta = META["iptv-plans-canada"]
    body = f"""{page_hero('IPTV subscription in Canada — <span class="grad-text">50% off</span>', "Every IPTV subscription includes every channel, every movie and every feature, now 50% off. Choose your screens and save more with longer plans.", "Pricing", [("Home", "/"), ("Pricing", "")])}
<section class="section section--after-hero"><div class="container">{pricing(heading=False)}</div></section>
<section class="section section--tight"><div class="container narrow"><div class="prose-card prose reveal">
<h2>Every IPTVMaple plan at a glance</h2>
<p>All prices are in US dollars. The cards above show one screen at a time; this table lists every combination of screens and length.</p>
{price_table(link=True)}
<p>The 12-month plan has the lowest cost per month on every screen count. More on <a href="/iptv-price/">IPTV prices in Canada</a>.</p>
</div></div></section>
{reviews_section()}
<section class="section"><div class="container">{section_head("Included", "Every plan comes with", "")}{why_grid()}</div></section>
{pricing_copy()}
{faq_section(FAQ[:6], "Questions before you buy?")}
{network_section()}
{cta_band("Not sure yet? Try it free.", "Get a free 24-hour trial — no credit card, no commitment. See the quality for yourself.")}"""
    return Page("/iptv-plans-canada/", meta["title"], meta["description"], body, og_image=meta["og_image"],
                published=meta["published"], modified=meta["modified"], nav_active="/iptv-plans-canada/",
                jsonld=[faq_ld(FAQ[:6]), breadcrumb_ld([("Home", "/"), ("Pricing", "/iptv-plans-canada/")]), _plans_product(meta)])


# =================================================================== PRODUCT (order) PAGES
def _picker(devices, months):
    conn = {c["devices"]: c for c in PLANS["connections"]}
    dur = "".join(
        f'<a href="/{p["slug"]}/" aria-current="{str(p["months"] == months).lower()}">{plan_label(p["months"])}</a>'
        for p in conn[devices]["plans"])
    dev = "".join(
        f'<a href="/{next(p for p in c["plans"] if p["months"] == months)["slug"]}/" aria-current="{str(n == devices).lower()}">{n}</a>'
        for n, c in conn.items())
    return f'<div class="pick"><small>Duration</small><div class="pick-row">{dur}</div><small>Devices at the same time</small><div class="pick-row">{dev}</div></div>'


def product_pages():
    pages = []
    for devices, p in all_plans():
        name = f"{plan_label(p['months'])} · {devices_label(devices)}"
        crumb = [("Home", "/"), ("Pricing", "/iptv-plans-canada/"), (name, "")]
        feats = [f"{devices} simultaneous {'connection' if devices == 1 else 'connections'}"] + FEATURES
        body = f"""{page_hero(f'{plan_label(p["months"])} IPTV <span class="grad-text">subscription</span>', f"{devices_label(devices).capitalize()} at the same time · everything included · ready within 5 minutes.", "Your order", crumb)}
<section class="section section--after-hero">
  <div class="container checkout">
    <div class="order-card reveal">
      <h2>Complete your order</h2>
      <p class="muted" style="margin:0">Enter your details and we’ll send your login and activation instructions right away.</p>
      <div class="order-steps"><span class="on"><i>1</i>Your details</span><span><i>2</i>We confirm on WhatsApp</span><span><i>3</i>Start watching</span></div>
      {lead_form(p["form_id"], "order", f"Order now — ${p['price']}", p["price"], name)}
    </div>
    <aside class="checkout-summary reveal">
      <div class="summary-card">
        <div class="top">
          <span class="tag" style="margin-bottom:14px">{icon("sparkles")} 50% off</span>
          <h3>{name}</h3>
          <div class="price" style="margin-top:14px"><span class="cur">$</span><span class="amt">{p["price"]}</span><span class="per">USD</span></div>
          <div class="price-meta" style="margin-bottom:0"><s>${p["original"]}</s><span class="save">You save ${p["original"] - p["price"]}</span><span class="per-month">{per_month(p)}</span></div>
          {_picker(devices, p["months"])}
        </div>
        <div class="bottom">{checks(feats)}{guarantee()}</div>
      </div>
    </aside>
  </div>
</section>
{plan_guide(devices, p, PLANS["connections"], plan_label)}
{reviews_section()}
{faq_section(FAQ[:5])}"""
        offer = {"@type": "Product", "name": f"IPTVMaple {name}", "description": p["description"], "brand": {"@type": "Brand", "name": C.NAME},
                 "image": C.SITE_URL + (p["og_image"] or C.DEFAULT_OG),
                 "offers": plan_offer(p), **review_ld()}
        pages.append(Page(f"/{p['slug']}/", p["title"], p["description"], body, og_image=p["og_image"] or C.DEFAULT_OG,
                          published=p["published"], modified=p["modified"], nav_active="/iptv-plans-canada/",
                          canonical="/iptv-plans-canada/", in_sitemap=False,  # 15 near-identical order variants: the plans page is the canonical
                          jsonld=[offer, breadcrumb_ld([("Home", "/"), ("Pricing", "/iptv-plans-canada/"), (name, f"/{p['slug']}/")])]))
    return pages


# =================================================================== FREE TRIAL
def trial_pages():
    out = []
    for slug in ("try-iptv-canada", "landing2"):
        meta, extra = content(slug)
        more = f'<section class="section section--tight"><div class="container narrow"><div class="prose-card prose reveal">{extra}</div></div></section>' if slug == "landing2" else ""
        body = f"""{page_hero('IPTV free trial — <span class="grad-text">24 hours, no card</span>', "Full access to live TV, sports, movies and series in 4K. No credit card, no commitment — just your details so we can send your trial instantly.", "Free trial", [("Home", "/"), ("Free trial", "")])}
<section class="section section--after-hero">
  <div class="container checkout">
    <div class="order-card reveal">
      <div data-success-hide>
        <h2>Get your free trial</h2>
        <p class="muted" style="margin:0">Provide your first name, email, country and WhatsApp number — we’ll email your login instantly.</p>
        <div class="order-steps"><span class="on"><i>1</i>Your details</span><span><i>2</i>Login sent by email</span><span><i>3</i>Watch for 24h</span></div>
        {lead_form("1570", "free-trial", "Start my free trial", 0, "Free trial 24h")}
      </div>
      <div class="form-success" data-success hidden tabindex="-1" role="status">
        <div class="success-mark">{icon("check")}</div>
        <h2>Check your inbox!</h2>
        <p>Your 24-hour trial is active. We just emailed your username, password and M3U link to <b data-success-email>your email address</b>. Not there in a couple of minutes? Check your spam folder or message us on WhatsApp.</p>
        <div class="btn-row">
          <a class="btn btn--primary btn--lg" href="/how-it-works/">Set up my device</a>
          <a class="btn btn--wa btn--lg" href="{C.WHATSAPP_URL}" target="_blank" rel="noopener">{icon("whatsapp")} Help on WhatsApp</a>
        </div>
      </div>
    </div>
    <aside class="checkout-summary reveal">
      <div class="summary-card">
        <div class="top">
          <span class="tag" style="margin-bottom:14px">{icon("gift")} Free trial</span>
          <h3>24-hour free trial</h3>
          <div class="price" style="margin-top:14px"><span class="cur">$</span><span class="amt">0</span><span class="per">no card needed</span></div>
        </div>
        <div class="bottom">{checks(FEATURES[:9])}
          <p class="muted" style="font-size:14px;margin:14px 0 0">Loved it? <a class="link-arrow" href="/iptv-plans-canada/">See plans — 50% off</a></p>
        </div>
      </div>
    </aside>
  </div>
</section>
{more}
{trial_copy() if slug == "try-iptv-canada" else ""}
{faq_section((TRIAL_FAQ + FAQ[:4]) if slug == "try-iptv-canada" else FAQ[:6])}"""
        out.append(Page(f"/{slug}/", meta["title"] if slug == "landing2" else "IPTV Free Trial Canada – 24 Hours, No Card | IPTVMaple",
                        meta["description"] if slug == "landing2" else "Try IPTVMaple free for 24 hours: live TV, sports, movies and series in 4K on any device. No credit card needed — get your login instantly by email and WhatsApp.",
                        body, og_image=meta["og_image"], published=meta["published"], modified=meta["modified"], nav_active="/try-iptv-canada/",
                        # landing2 is an ad landing page with the same form as /try-iptv-canada/ — keep it out of the index
                        robots="noindex, follow" if slug == "landing2" else Page.robots, in_sitemap=slug != "landing2",
                        jsonld=[breadcrumb_ld([("Home", "/"), ("Free trial", f"/{slug}/")])]))
    return out


# =================================================================== THANK YOU
def thank_you():
    meta, _ = content("thank-you")
    body = f"""{page_hero('Thank you for choosing <span class="grad-text">IPTVMaple</span>!', "Your request was received successfully. Our team is processing it now and will contact you shortly with your login details.", "Order received", [("Home", "/"), ("Thank you", "")])}
<section class="section section--after-hero">
  <div class="container narrow">
    <div class="steps">
      <div class="card step"><h3>We contact you</h3><p>Watch your WhatsApp and inbox — we’ll reach out within minutes to confirm and activate.</p></div>
      <div class="card step"><h3>Get your login</h3><p>You’ll receive your username, password and server URL for your IPTV app.</p></div>
      <div class="card step"><h3>Start watching</h3><p>Follow our setup guide for your device and enjoy 4K streaming.</p></div>
    </div>
    <div class="card center" style="margin-top:22px">
      <h2 class="h3">Want it even faster?</h2>
      <p class="muted">Message us directly on WhatsApp — our team is available and ready to assist you.</p>
      <div class="btn-row" style="justify-content:center">
        <a class="btn btn--wa btn--lg" href="{C.WHATSAPP_URL}" target="_blank" rel="noopener">{icon("whatsapp")} Message us on WhatsApp</a>
        <a class="btn btn--ghost btn--lg" href="/how-it-works/">Setup guides</a>
      </div>
    </div>
  </div>
</section>"""
    return Page("/thank-you/", meta["title"], meta["description"], body, og_image=meta["og_image"], robots="noindex, follow", in_sitemap=False)


# =================================================================== CHANNELS
def channels():
    meta = META["channels-list"]
    regions = data("channels")  # every region stays listed for viewers in Canada and the US; the SEO copy does not target those markets
    total_ch = sum(len(c["channels"]) for r in regions for c in r["countries"])
    total_co = sum(len(r["countries"]) for r in regions)
    tabs = '<button type="button" data-region="all" aria-pressed="true">All regions</button>' + "".join(
        f'<button type="button" data-region="{r["name"].lower()}" aria-pressed="false">{r["name"]}</button>' for r in regions)
    groups = []
    for r in regions:
        cs = "".join(
            f'<details class="country" data-name="{escape(c["name"].lower())}"><summary><span>{escape(c["name"].title() if c["name"].isupper() and len(c["name"]) > 3 else c["name"])}</span>'
            f'<span class="count"><small>{len(c["channels"])} channels</small></span></summary>'
            f'<ul class="ch-list">{"".join(f"<li>{escape(x)}</li>" for x in c["channels"])}</ul></details>'
            for c in r["countries"])
        groups.append(f'<div data-region="{r["name"].lower()}"><h2 class="region-title">{r["name"]}</h2><div class="countries">{cs}</div></div>')
    body = f"""{page_hero('The full <span class="grad-text">channels list</span>', f"Browse {total_ch:,}+ listed channels across {total_co} countries and regions — news, sports, movies, kids and more, many in 4K.", "Channels", [("Home", "/"), ("Channels list", "")])}
<section class="section section--after-hero">
  <div class="container" data-channels>
    <div class="ch-tools">
      <label class="search"><span class="sr-only">Search channels or countries</span>{icon("search")}<input class="input" type="search" placeholder="Search channels or countries… (e.g. TSN, BBC, beIN)" autocomplete="off"></label>
      <div class="region-tabs">{tabs}</div>
    </div>
    {"".join(groups)}
    <p class="empty">No channels match your search. Ask us on WhatsApp — we probably have it.</p>
  </div>
</section>
{page_faq("channels-list")}
{cta_band("Found your channels?", "Every plan includes the full lineup. Start watching in minutes.")}"""
    return Page("/channels-list/", meta["title"].replace("Channels list", "IPTV Channels List – 50,000+ Channels | IPTVMaple"), meta["description"], body,
                og_image=meta["og_image"], published=meta["published"], modified=meta["modified"],
                jsonld=[breadcrumb_ld([("Home", "/"), ("Channels list", "/channels-list/")])])


# =================================================================== HOW IT WORKS
def how_it_works():
    meta, player_html = content("how-it-works")
    guides = data("setup-guides")
    tabs = "".join(
        f'<button type="button" role="tab" id="gt-{i}" aria-controls="gp-{i}" aria-selected="{str(i == 0).lower()}">{escape(g["device"])}</button>'
        for i, g in enumerate(guides))
    panels = "".join(
        f'<div class="guide-panel prose-card prose" role="tabpanel" id="gp-{i}" aria-labelledby="gt-{i}"{"" if i == 0 else " hidden"}><h3 style="margin-top:0">{escape(g["device"])}</h3>{g["html"].replace("<img ", "<img loading=\"lazy\" ")}</div>'
        for i, g in enumerate(guides))
    body = f"""{page_hero('How to set up IPTV: <span class="grad-text">3 easy steps</span>', "Setting up IPTV takes 3 easy steps: order, receive your login, and start watching on any device. Most customers are streaming within minutes.", "How it works", [("Home", "/"), ("How it works", "")])}
<section class="section section--after-hero">
  <div class="container">
    <div class="steps">
      <div class="card step reveal"><h3>Place your order</h3><p>Pick the perfect plan for you — 1, 6 or 12 months — and get started right away.</p></div>
      <div class="card step reveal" style="--d:.08s"><h3>Receive your login</h3><p>Check your WhatsApp and inbox for login details and use them in your IPTV player app.</p></div>
      <div class="card step reveal" style="--d:.16s"><h3>Start watching</h3><p>Connect your IPTV to your TV, computer or phone and enjoy unlimited international channels.</p></div>
    </div>
  </div>
</section>
<section class="section section--tight">
  <div class="container narrow"><div class="prose-card prose reveal">{player_html}</div></div>
</section>
<section class="section" id="setup">
  <div class="container narrow" data-tabs>
    {section_head("Setup guides", "Install on your device", "Choose your device for step-by-step instructions.")}
    <div class="guide-tabs" role="tablist">{tabs}</div>
    {panels}
  </div>
</section>
{page_faq("how-it-works")}
{cta_band()}"""
    return Page("/how-it-works/", meta["title"], meta["description"], body, og_image=meta["og_image"],
                published=meta["published"], modified=meta["modified"],
                jsonld=[breadcrumb_ld([("Home", "/"), ("How it works", "/how-it-works/")])])


# =================================================================== REFERRAL
def referral():
    r = data("referral")
    meta = r["meta"]
    steps = [
        ("Fill in the form", "Enter your details and your friend’s: name, phone and email."),
        ("Your friend subscribes", "They buy any 12-month IPTVMaple plan."),
        ("You get 6 months free", "Once their payment is verified, we add 6 months to your account."),
    ]
    steps_html = "".join(f'<div class="card step reveal" style="--d:{i * .08:.2f}s"><h3>{t}</h3><p>{d}</p></div>' for i, (t, d) in enumerate(steps))
    body = f"""{page_hero('Refer a friend, <span class="nowrap">get <span class="grad-text">6 months free</span></span>', "Fill in the form below. When your friend subscribes for a year, you get 6 months free.", "Referral program", [("Home", "/"), ("Referral", "")])}
<section class="section section--after-hero">
  <div class="container narrow">
    <div class="order-card reveal" id="referral-form">
      <div data-success-hide>
        <h2>Submit a referral</h2>
        <p class="muted">All fields are required.</p>
        {referral_form()}
      </div>
      <div class="form-success" data-success hidden tabindex="-1" role="status">
        <div class="success-mark">{icon("check")}</div>
        <h2>Referral received!</h2>
        <p>Thank you! We’ve got your referral. As soon as your friend’s 12-month plan is paid, we’ll add <b>6 months free</b> to your account and let you know on WhatsApp.</p>
        <div class="btn-row">
          <a class="btn btn--wa btn--lg" href="{C.WHATSAPP_URL}" target="_blank" rel="noopener">{icon("whatsapp")} Confirm on WhatsApp</a>
          <button class="btn btn--ghost btn--lg" type="button" data-success-again>Refer another friend</button>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="section section--tight" style="padding-top:0">
  <div class="container">
    {section_head("How it works", "3 steps to 6 free months", "")}
    <div class="steps">{steps_html}</div>
    <div class="card reveal ref-rules"><h2 class="h3">Rules</h2>{checks(r["rules"])}</div>
  </div>
</section>
<section class="section section--tight"><div class="container narrow"><div class="prose-card prose reveal">
<h2>New to IPTVMaple?</h2>
<p>Referral credit applies to paid plans. If your friend is not sure yet, send them to the <a href="/try-iptv-canada/">free 24-hour trial</a> first, or to <a href="/how-it-works/">how it works</a> and the <a href="/iptv-plans-canada/">plans</a>. Questions about the programme? <a href="/contact/">Contact support</a> or read the <a href="/terms/">terms</a>.</p>
</div></div></section>
{page_faq("refer-a-friend")}
{cta_band("Not a customer yet?", "Join IPTVMaple today, then start earning free months by sharing it with friends.")}"""
    return Page("/refer-a-friend/", "Refer a Friend – Get 6 Months Free | IPTVMaple", "Refer 1 friend to IPTVMaple and get 6 months free. Unlimited referrals — every successful referral adds 6 more months to your subscription.",
                body, og_image=meta["og_image"], published=meta["published"], modified=meta["modified"],
                jsonld=[breadcrumb_ld([("Home", "/"), ("Referral", "/refer-a-friend/")])])


# =================================================================== CONTACT
def contact():
    meta = META["contact"]
    cards = [
        ("icon--wa", "whatsapp", "WhatsApp", "The fastest way to reach us — usually a reply within minutes.", "Chat with us", C.WHATSAPP_URL, "btn--wa"),
        ("icon--mail", "mail", "Email", f"Write to us any time at <span class=\"val\">{C.EMAIL}</span>", "Send an email", C.MAILTO, "btn--ghost"),
    ]
    html = "".join(
        f'<div class="card contact-card reveal" style="--d:{i * .08:.2f}s"><div class="icon {cls}">{icon(ic)}</div><h3>{t}</h3><p>{d}</p>'
        f'<a class="btn {btn} btn--block" href="{href}"{" target=\"_blank\" rel=\"noopener\"" if href == C.WHATSAPP_URL else ""}>{label}</a></div>'
        for i, (cls, ic, t, d, label, href, btn) in enumerate(cards))
    body = f"""{page_hero('Contact IPTVMaple support — <span class="grad-text">here 24/7</span>', "Have any questions? Our friendly support team is always ready to help and will get back to you as soon as possible, so you enjoy a flawless IPTV experience.", "Contact us", [("Home", "/"), ("Contact", "")])}
<section class="section section--after-hero"><div class="container narrow"><div class="grid grid-2">{html}</div></div></section>
<section class="section section--tight"><div class="container narrow"><div class="prose-card prose reveal">
<h2>Before you write to us</h2>
<p>Most questions have a quick answer. <a href="/how-it-works/">How it works</a> covers setup, <a href="/iptv-devices/">device guides</a> cover Firestick, Smart TV, phones and boxes, and <a href="/iptv-buffering-fix/">buffering fixes</a> solve most playback problems. Not a customer yet? Start the <a href="/try-iptv-canada/">free 24-hour trial</a> or compare <a href="/iptv-plans-canada/">plans</a>.</p>
<p>When you contact support, include your name, the device you use and a screenshot of any error. We answer by WhatsApp and email at {C.EMAIL}. Billing questions are handled under the <a href="/refund/">refund policy</a>, and we handle your details as described in the <a href="/privacy/">privacy policy</a>.</p>
</div></div></section>
{faq_section(FAQ)}"""
    return Page("/contact/", "Contact Us – 24/7 IPTV Support | IPTVMaple", meta["description"], body, og_image=meta["og_image"],
                published=meta["published"], modified=meta["modified"], jsonld=[breadcrumb_ld([("Home", "/"), ("Contact", "/contact/")]),
                        {"@type": "ContactPage", "@id": C.SITE_URL + "/contact/#contactpage", "url": C.SITE_URL + "/contact/", "name": "Contact IPTVMaple",
                         "about": {"@id": C.SITE_URL + "/#organization"}}])


# =================================================================== PROSE PAGES (about, legal, articles, landings)
def _aside():
    return f"""<aside>
  <div class="card side-cta"><div class="icon" style="margin-inline:auto">{icon("play")}</div><h3>Try IPTVMaple free</h3><p>24 hours of full access. No credit card needed.</p><a class="btn btn--primary btn--block" href="/try-iptv-canada/">Start free trial</a></div>
  <div class="card side-cta"><h3>Plans from $9</h3><p>50,000+ channels &amp; 300,000+ movies in 4K — 50% off.</p><a class="btn btn--ghost btn--block" href="/iptv-plans-canada/">See pricing</a></div>
</aside>"""


PROSE = {
    "about-iptvmaple": ("About us", "About IPTVMaple", "Canada’s trusted IPTV provider — redefining the way you watch TV."),
    "privacy": ("Legal", "Privacy policy", "How we collect, use and protect your personal data."),
    "terms": ("Legal", "Terms &amp; conditions", "The terms that govern your use of IPTVMaple."),
    "refund": ("Legal", "Refund policy", "Our 7-day money-back guarantee, explained."),
    "disclaimer": ("Legal", "Disclaimer", "Our content disclaimer, user responsibilities and how to report a copyright concern."),
    "3-smarter-ways-to-stream-tv-without-cable-in-2025": ("Guide", "3 Smarter Ways to Stream TV Without Cable", "Three smarter ways to stream TV without cable: streaming apps, live-TV bundles and IPTV, compared on cost, what you get and how you watch."),
    "cord-cutting-guide": ("Guide", "Cut the Cord &amp; Stream Smarter", "Cut the cord and stream smarter: why switching from cable pays off, what you need and how to switch without missing a game."),
    "landing": ("Save money", "Cut Your Monthly Bills — Smarter Entertainment Awaits", "Still paying expensive cable bills every month? There’s a better way."),
    "landing3": ("Cut the cord", "The Best Way to Cut the Cord", "Stream live TV, sports &amp; movies in 4K — without buffering or contracts."),
}


def prose_pages():
    out = []
    for slug, (kicker, title, lead) in PROSE.items():
        meta, html = content(slug)
        legal = slug in ("privacy", "terms", "refund", "disclaimer")
        hero_img = meta.get("image")
        figure = f'<img src="{hero_img}" alt="" style="border-radius:20px;border:1px solid var(--line);margin:0 0 28px;width:100%" loading="lazy">' if hero_img else ""
        if legal:
            html += ('<h2>Related</h2><p>See also our <a href="/terms/">terms</a>, <a href="/privacy/">privacy policy</a>, <a href="/refund/">refund policy</a> and <a href="/disclaimer/">disclaimer</a>. '
                     'Questions about plans or setup? <a href="/iptv-plans-canada/">Plans and prices</a>, <a href="/how-it-works/">how it works</a>, '
                     '<a href="/try-iptv-canada/">free trial</a> or <a href="/contact/">contact support</a> by WhatsApp or email.</p>')
        updated = f'<p class="muted" style="font-size:14px">Last updated {meta["modified"][:10]}</p>' if legal and meta.get("modified") else ""
        ctas = ('<div class="btn-row" style="justify-content:center;margin-top:28px"><a class="btn btn--primary btn--lg" href="/try-iptv-canada/">Start free trial</a>'
                '<a class="btn btn--ghost btn--lg" href="/iptv-plans-canada/">See all plans</a></div>') if meta.get("kind") == "landing" else ""
        body = f"""{page_hero(title, lead, kicker, [("Home", "/"), (re.sub("<[^>]+>|&amp;", "", title.replace("&amp;", "&")), "")], ctas)}
<section class="section section--after-hero">
  <div class="container page-grid">
    <article class="prose-card prose reveal">{updated}{figure}{html}</article>
    {_aside()}
  </div>
</section>
{page_faq(slug)}
{cta_band() if not legal else ""}"""
        kind = "article" if meta.get("kind") == "article" else "website"
        extra = []
        if kind == "article":
            extra.append({"@type": "Article", "headline": re.sub("<[^>]+>", "", title).replace("&amp;", "&"), "datePublished": meta["published"],
                          "dateModified": meta["modified"], "author": {"@id": C.SITE_URL + "/#organization"},
                          "publisher": {"@id": C.SITE_URL + "/#organization"}, "image": C.SITE_URL + (meta.get("og_image") or C.DEFAULT_OG),
                          "mainEntityOfPage": f"{C.SITE_URL}/{slug}/"})
        extra.append(breadcrumb_ld([("Home", "/"), (re.sub("<[^>]+>", "", title).replace("&amp;", "&"), f"/{slug}/")]))
        # /landing/ and /landing3/ are ad landing pages that duplicate the cord-cutting guide: keep them out of Google's index
        dup = slug in ("landing", "landing3")
        out.append(Page(f"/{slug}/", meta["title"], meta["description"], body, og_image=meta.get("og_image") or C.DEFAULT_OG,
                        og_type=kind, published=meta["published"], modified=meta["modified"], jsonld=extra,
                        robots="noindex, follow" if dup else Page.robots, in_sitemap=not dup))
    return out


def not_found():
    """The 404 page: friendly, noindex, and links to the main hubs so a lost visitor (or crawler) can carry on."""
    body = f"""{page_hero('Page not found — <span class="grad-text">let’s get you back</span>', "That page doesn’t exist or has moved. Try one of these popular pages.", "Error 404", [("Home", "/"), ("Page not found", "")],
        '<div class="btn-row" style="justify-content:center;margin-top:28px"><a class="btn btn--primary btn--lg" href="/iptv-plans-canada/">See plans</a><a class="btn btn--ghost btn--lg" href="/try-iptv-canada/">Free 24h trial</a></div>')}
<section class="section section--after-hero">
  <div class="container narrow">
    <div class="grid grid-3 link-cards">
      <a class="card card--hover link-card" href="/iptv-guides/"><h3>IPTV guides</h3><p>Prices, providers, legal and setup.</p><span class="link-arrow">Explore</span></a>
      <a class="card card--hover link-card" href="/iptv-apps/"><h3>IPTV apps</h3><p>TiviMate, IPTV Smarters and more.</p><span class="link-arrow">Explore</span></a>
      <a class="card card--hover link-card" href="/iptv-devices/"><h3>Devices</h3><p>Firestick, Samsung, LG, Apple TV.</p><span class="link-arrow">Explore</span></a>
      <a class="card card--hover link-card" href="/channels-list/"><h3>Channels list</h3><p>Search 50,000+ channels.</p><span class="link-arrow">Explore</span></a>
      <a class="card card--hover link-card" href="/iptv-near-me/"><h3>IPTV near me</h3><p>Every province and city.</p><span class="link-arrow">Explore</span></a>
      <a class="card card--hover link-card" href="/contact/"><h3>Contact us</h3><p>WhatsApp and email, 24/7.</p><span class="link-arrow">Explore</span></a>
    </div>
  </div>
</section>"""
    return Page("/404/", "Page not found | IPTVMaple", "The page you were looking for could not be found. Browse IPTV plans, guides, apps and devices.", body,
                robots="noindex, follow", in_sitemap=False)


def all_pages():
    return [home(), pricing_page(), *product_pages(), *trial_pages(), thank_you(), channels(), how_it_works(), referral(), contact(), *prose_pages(),
            *seo_pages()]
