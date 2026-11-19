"""SEO landing pages (apps, devices, sports, cities, guides, French Québec pages).

Every page is a plain dict in sitegen/seo_content/*.py and is rendered by the one template below, so all of
them share the same title block, quick-answer box, FAQ (with FAQPage schema), breadcrumbs and internal links.

Page dict keys
  slug         URL slug ("tivimate" -> /tivimate/)
  hub          which cluster it belongs to (key of HUBS) — sets the breadcrumb and the hub page it's listed on
  lang         "en" (default) or "fr"
  title        <title> (aim for 50–60 characters, primary keyword first)
  description  meta description (aim for 120–160 characters)
  kicker, h1, lead      the shared page title block
  crumb        short name for the breadcrumb / hub card
  blurb        one sentence for the hub card
  answer       quick-answer HTML shown at the top of the article
  body         article HTML (h2/h3/p/ul/table …)
  faq          [(question, answer_html), …] — shown on the page and in FAQPage schema
  related      [slug, …] — "Related guides" links at the end of the article
  hub_page     True on the hub itself (lists every page of its cluster as cards)
  keywords     the spreadsheet keywords this page targets (documentation only)
"""
import re
from html import escape

from . import config as C
from .components import all_plans, breadcrumb_ld, cta_band, faq_ld, faq_section, page_hero
from .icons import icon
from .layout import Page
from .seo_content import ALL

UPDATED = "2026-09-30"

HUBS = {
    "apps": ("/ca/iptv-apps/", "IPTV apps"),
    "devices": ("/ca/iptv-devices/", "Devices"),
    "sports": ("/ca/iptv-sports/", "Sports"),
    "cities": ("/ca/iptv-near-me/", "Cities"),
    "intl": ("/ca/iptv-international/", "International"),
    "guides": ("/ca/iptv-guides/", "IPTV guides"),
    "fr": ("/ca/iptv-quebec/", "IPTV Québec"),
    "usa": ("/ca/usa/", "USA"),
    "canada": ("/ca/canada/", "Canada"),
}

TEXT = {
    "en": dict(home="Home", quick="Quick answer", toc="On this page", updated="Updated", by="By the IPTVMaple team", related="Related guides",
               explore="Explore", trial="Start free 24h trial", plans="See plans — 50% off",
               faq="Frequently asked questions", cta_title="Ready to start watching?",
               cta_text="Every plan includes 50,000+ live channels, 300,000+ movies & series and 24/7 human support. Try it free first.",
               side1=("Try IPTVMaple free", "24 hours of full access. No credit card needed.", "Start free trial"),
               side2=("Plans from $9", "50,000+ channels &amp; 300,000+ movies in 4K — 50% off.", "See pricing"),
               all_label="All {label}"),
    "fr": dict(home="Accueil", quick="Réponse rapide", toc="Dans cet article", updated="Mis à jour le", by="Par l’équipe IPTVMaple", related="Guides connexes",
               explore="Découvrir", trial="Essai gratuit de 24 h", plans="Voir les forfaits — 50 % de rabais",
               faq="Questions fréquentes", cta_title="Prêt à regarder?",
               cta_text="Chaque forfait inclut plus de 50 000 chaînes en direct, 300 000 films et séries et un soutien humain 24/7. Essayez-le gratuitement d’abord.",
               side1=("Essayez IPTVMaple gratuitement", "24 heures d’accès complet. Aucune carte de crédit.", "Commencer l’essai"),
               side2=("Forfaits dès 9 $", "50 000+ chaînes et 300 000+ films en 4K — 50 % de rabais.", "Voir les prix"),
               all_label="{label}"),
}


def _plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.replace("&amp;", "&"))).strip()


def _slugify(text):
    import unicodedata
    t = unicodedata.normalize("NFD", _plain(text).lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:48] or "section"


def _with_toc(body, label):
    """Long articles get a table of contents and anchor ids on every <h2> (better for readers and for sitelinks in Google)."""
    heads = re.findall(r"<h2>(.*?)</h2>", body, flags=re.S)
    if len(heads) < 4 or len(_plain(body).split()) < 900:
        return body, ""
    used, items = set(), []
    def put_id(m):
        base = _slugify(m.group(1))
        slug, n = base, 2
        while slug in used:
            slug, n = f"{base}-{n}", n + 1
        used.add(slug)
        items.append((slug, m.group(1)))
        return f'<h2 id="{slug}">{m.group(1)}</h2>'
    body = re.sub(r"<h2>(.*?)</h2>", put_id, body, flags=re.S)
    toc = f'<nav class="toc" aria-label="{label}"><strong>{label}</strong><ol>' + "".join(f'<li><a href="#{i}">{_plain(t)}</a></li>' for i, t in items) + "</ol></nav>"
    return body, toc


# Contextual internal links added automatically to article text. First mention only, never inside headings / existing links / code,
# never a page linking to itself, and capped by article length, so the result reads as normal editorial linking.
AUTO_EN = [
    ("TiviMate Premium", "/tivimate-premium/"), ("IPTV Smarters Pro", "/iptv-smarters-pro/"), ("Smarters Player Lite", "/smarters-player-lite/"),
    ("TiviMate", "/tivimate/"), ("XCIPTV", "/xciptv/"), ("IMPlayer", "/implayer/"), ("iPlayTV", "/iplaytv/"), ("STBEmu", "/stbemu/"),
    ("MyTVOnline", "/mytvonline/"), ("SmartOne IPTV", "/smartone-iptv/"), ("Flix IPTV", "/flix-iptv/"), ("Smart IPTV", "/smart-iptv/"),
    ("Kodi", "/kodi-iptv/"), ("VLC", "/vlc-iptv/"), ("Plex", "/plex-iptv/"), ("Jellyfin", "/jellyfin-iptv/"), ("Stremio", "/stremio-iptv/"),
    ("Xtream Codes", "/xtream-codes-iptv/"), ("M3U playlist", "/m3u-playlist/"), ("M3U", "/m3u-playlist/"),
    ("Firestick", "/iptv-firestick/"), ("Formuler", "/formuler-iptv/"), ("MAG box", "/mag-box-iptv/"), ("Chromecast", "/iptv-chromecast/"),
    ("Roku", "/iptv-roku/"), ("Apple TV", "/iptv-apple-tv/"), ("Android TV", "/iptv-android-tv/"), ("iPhone", "/iptv-iphone/"),
    ("IPTV box", "/iptv-box/"), ("4K IPTV", "/4k-iptv/"), ("IPTV server", "/iptv-server/"),
    ("IPTV prices", "/iptv-price/"), ("IPTV price", "/iptv-price/"), ("IPTV providers", "/iptv-providers/"), ("IPTV provider", "/iptv-providers/"),
    ("is IPTV legal", "/is-iptv-legal-in-canada/"), ("buffering", "/iptv-buffering-fix/"),
    ("Premier League", "/premier-league-iptv/"), ("Champions League", "/champions-league-iptv/"), ("beIN Sports", "/bein-sports-iptv/"),
    ("ESPN", "/espn-iptv/"), ("NHL", "/nhl-iptv/"), ("NBA", "/nba-iptv/"), ("UFC", "/ufc-iptv/"), ("Formula 1", "/f1-iptv/"),
    ("free 24-hour trial", "/try-iptv-canada/"), ("7-day money-back guarantee", "/refund/"), ("channels list", "/channels-list/"),
]
AUTO_FR = [
    ("TiviMate", "/tivimate-en-francais/"), ("IPTV Smarters", "/iptv-smarters-pro-francais/"), ("Smarters Player Lite", "/iptv-sur-apple-tv-iphone/"),
    ("Fire TV Stick", "/iptv-sur-firestick/"), ("liste M3U", "/liste-iptv-m3u/"), ("lecteur IPTV", "/lecteur-iptv/"), ("Samsung", "/iptv-sur-samsung/"),
    ("Apple TV", "/iptv-sur-apple-tv-iphone/"), ("VLC", "/iptv-sur-pc-mac/"), ("IPTV pas cher", "/iptv-pas-cher/"),
    ("abonnement IPTV", "/abonnement-iptv/"), ("meilleur IPTV", "/meilleur-iptv/"), ("légalité", "/iptv-legal-canada/"),
]
_SKIP_TAGS = {"a", "h1", "h2", "h3", "h4", "h5", "h6", "code", "pre", "summary", "th", "button", "script", "style"}


def autolink(html, self_url, lang="en"):
    words = len(_plain(html).split())
    budget = max(2, min(7, words // 220))
    have = set(re.findall(r'href="(/[^"#]*)', html))
    rules = AUTO_FR if lang == "fr" else AUTO_EN
    out, depth, added = [], 0, 0
    for tok in re.split(r"(<[^>]+>)", html):
        if tok.startswith("<"):
            m = re.match(r"<(/?)([a-zA-Z0-9]+)", tok)
            if m and m.group(2).lower() in _SKIP_TAGS and not tok.endswith("/>"):
                depth += -1 if m.group(1) else 1
                depth = max(depth, 0)
            out.append(tok)
            continue
        if depth or added >= budget or not tok.strip():
            out.append(tok)
            continue
        for phrase, url in rules:
            if added >= budget:
                break
            if url == self_url or url in have:
                continue
            m = re.search(rf"(?<![\w/-]){re.escape(phrase)}(?![\w-])", tok)
            if m:
                tok = tok[:m.start()] + f'<a href="{url}">{m.group(0)}</a>' + tok[m.end():]
                have.add(url)
                added += 1
        out.append(tok)
    return "".join(out)


def _by_slug():
    return {p["slug"]: p for p in ALL}


def _crumbs(p, T):
    items = [(T["home"], "/ca/")]
    if "trail" in p:  # explicit breadcrumb trail, e.g. USA → Texas for a city page
        return items + list(p["trail"]) + [(p["crumb"], "")]
    hub_url, hub_label = HUBS[p["hub"]]
    if hub_url and not p.get("hub_page"):
        items.append((hub_label, hub_url))
    items.append((p["crumb"], ""))
    return items


def _aside(T):
    (t1, d1, b1), (t2, d2, b2) = T["side1"], T["side2"]
    return f"""<aside>
  <div class="card side-cta"><div class="icon" style="margin-inline:auto">{icon("play")}</div><h3>{t1}</h3><p>{d1}</p><a class="btn btn--primary btn--block" href="/ca/try-iptv-canada/">{b1}</a></div>
  <div class="card side-cta"><h3>{t2}</h3><p>{d2}</p><a class="btn btn--ghost btn--block" href="/ca/iptv-plans-canada/">{b2}</a></div>
</aside>"""


def _hub_cards(p, T):
    by = _by_slug()
    if "children" in p:
        pages = [by[s] for s in p["children"]]
    else:
        pages = [q for q in ALL if q["hub"] == p["hub"] and not q.get("hub_page")]
    if not pages:
        return ""
    cards = "".join(
        f'<a class="card card--hover link-card reveal" href="/ca/{q["slug"]}/"><h3>{q["crumb"]}</h3><p>{q["blurb"]}</p><span class="link-arrow">{T["explore"]}</span></a>'
        for q in pages)
    return f"""<section class="section section--tight">
  <div class="container"><div class="grid grid-3 link-cards">{cards}</div></div>
</section>"""


def _fit_description(desc, lang):
    """Meta descriptions read best at 150-160 characters: add a short factual tail when the text is shorter."""
    tails = (" Essai gratuit de 24 h, sans carte.", " Forfaits dès 9 $. Essai gratuit de 24 h.") if lang == "fr" else (" Free 24-hour trial, no card.", " Plans from $9. Free 24-hour trial, no card.")
    if len(desc) >= 150:
        return desc
    for t in reversed(tails):
        if len(desc) + len(t) <= 160 and len(desc) + len(t) >= 145:
            return desc + t
    for t in tails:
        if len(desc) + len(t) <= 160:
            return desc + t
    return desc


def render(p):
    lang = p.get("lang", "en")
    T = TEXT[lang]
    by = _by_slug()
    crumb = _crumbs(p, T)
    buttons = (f'<div class="btn-row" style="justify-content:center;margin-top:28px">'
               f'<a class="btn btn--primary btn--lg" href="/ca/try-iptv-canada/">{T["trial"]}</a>'
               f'<a class="btn btn--ghost btn--lg" href="/ca/iptv-plans-canada/">{T["plans"]}</a></div>')
    related = "".join(f'<li><a href="/ca/{s}/">{by[s]["crumb"]}</a> — {by[s]["blurb"]}</li>' for s in p.get("related", []))
    hub_url, hub_label = HUBS[p["hub"]]
    if hub_url and not p.get("hub_page") and hub_url.rstrip("/").split("/")[-1] not in p.get("related", []):
        related += f'<li><a href="{hub_url}">{T["all_label"].format(label=hub_label)}</a></li>'
    related_html = f'<h2>{T["related"]}</h2><ul class="related-list">{related}</ul>' if related else ""
    published = p.get("published", UPDATED)
    updated = p.get("updated", UPDATED)
    p = dict(p, description=_fit_description(p["description"], lang))
    raw_body = p["body"] if p.get("service_area") else autolink(p["body"], f"/{p['slug']}/", lang)
    art_body, toc = _with_toc(raw_body, T["toc"])
    price_note = ""
    if p.get("service_area"):
        lo, hi = min(x["price"] for _, x in all_plans()), max(x["price"] for _, x in all_plans())
        price_note = (f'<p class="meta-line">Plans from ${lo:g} (1 month) to ${hi:g} (12 months, most screens), in US dollars. '
                      f'<a href="/ca/iptv-plans-canada/">See every plan</a>.</p>' if lang != "fr" else
                      f"<p class=\"meta-line\">Forfaits de {lo:g} $ US (1 mois) à {hi:g} $ US (12 mois, le plus d’écrans). "
                      f'<a href="/ca/iptv-plans-canada/">Voir tous les forfaits</a>.</p>')
    body = f"""{page_hero(p["h1"], p["lead"], p["kicker"], crumb, buttons)}
<section class="section section--after-hero">
  <div class="container page-grid">
    <article class="prose-card prose reveal">
      <div class="answer-box"><strong>{T["quick"]}</strong>{p["answer"]}</div>
      <p class="meta-line">{T["updated"]} {updated} · {T["by"]}</p>
      {toc}
      {art_body}
      {price_note}
      {related_html}
    </article>
    {_aside(T)}
  </div>
</section>
{_hub_cards(p, T) if p.get("hub_page") or p.get("children") else ""}
{faq_section([{"q": q, "a": a} for q, a in p["faq"]], T["faq"], lang) if p.get("faq") else ""}
{cta_band(p.get("cta_title", T["cta_title"]), p.get("cta_text", T["cta_text"]), lang=lang)}"""
    url = f"/ca/{p['slug']}/"
    ld = [breadcrumb_ld([(label, href or url) for label, href in crumb])]
    if p.get("faq"):
        ld.append(faq_ld([{"q": q, "a": a} for q, a in p["faq"]]))
    locale = p.get("locale", "fr-CA" if lang == "fr" else "en-CA")
    if p.get("service_area"):  # location pages: the service offered in that area (no physical address is claimed)
        kind, name = p["service_area"]
        ld.append({"@type": "Service", "name": _plain(p["h1"]), "serviceType": "IPTV subscription", "description": p["description"],
                   "provider": {"@id": C.SITE_URL + "/#organization"}, "areaServed": {"@type": kind, "name": name},
                   "url": C.SITE_URL + url,
                   "offers": {"@type": "AggregateOffer", "priceCurrency": "USD", "lowPrice": min(x["price"] for _, x in all_plans()), "highPrice": max(x["price"] for _, x in all_plans()),
                              "url": C.SITE_URL + "/ca/iptv-plans-canada/"}})
    else:
        ld.append({"@type": "Article", "headline": _plain(p["h1"])[:110], "description": p["description"],
                   "datePublished": published, "dateModified": updated, "inLanguage": locale,
                   "author": {"@id": C.SITE_URL + "/#organization"}, "publisher": {"@id": C.SITE_URL + "/#organization"},
                   "image": C.SITE_URL + C.DEFAULT_OG, "mainEntityOfPage": C.SITE_URL + url})
    extra = {"robots": "noindex, follow", "in_sitemap": False} if p.get("noindex") else {}
    if p.get("og_image"):
        extra["og_image"] = p["og_image"]
    return Page(url, p["title"], p["description"], body, og_type="article" if not p.get("service_area") else "website",
                published=published, modified=updated, jsonld=ld, lang=locale, alternates=p.get("alternates", []), **extra)


def seo_pages():
    return [render(p) for p in ALL]
