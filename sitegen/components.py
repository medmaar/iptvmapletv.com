"""Reusable page sections."""
import json
import os
import re
from html import escape

from . import config as C
from .icons import icon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")


def data(name):
    return json.load(open(os.path.join(SRC, "data", name + ".json"), encoding="utf-8"))


def content(slug):
    """src/content/<slug>.html -> (meta dict, html body). Meta lives in a leading <!--meta {json} --> block."""
    raw = open(os.path.join(SRC, "content", slug + ".html"), encoding="utf-8").read()
    m = re.match(r"\s*<!--meta\s*(\{.*?\})\s*-->\s*", raw, re.S)
    return (json.loads(m.group(1)), raw[m.end():]) if m else ({}, raw)


PLANS = data("plans")
FEATURES = PLANS["features"]


def plan_label(months):
    return {1: "1 Month", 6: "6 Months", 12: "12 Months"}[months]


def devices_label(n):
    return f"{n} {'device' if n == 1 else 'devices'}"


def all_plans():
    for c in PLANS["connections"]:
        for p in c["plans"]:
            yield c["devices"], p


def per_month(p):
    return f"≈ ${p['price'] / p['months']:.2f}/mo" if p["months"] > 1 else "Billed monthly"


# ------------------------------------------------------------------ small pieces
def aurora():
    return '<div class="aurora" aria-hidden="true"><i></i><i></i><i></i></div>'


def section_head(kicker, title, sub="", left=False):
    k = f'<span class="kicker">{kicker}</span>' if kicker else ""
    s = f"<p>{sub}</p>" if sub else ""
    return f'<div class="section-head{" section-head--left" if left else ""} reveal">{k}<h2 class="h2">{title}</h2>{s}</div>'


def checks(items):
    return '<ul class="checks">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def crumbs(items):
    parts = []
    for i, (label, href) in enumerate(items):
        if i:
            parts.append('<span aria-hidden="true">/</span>')
        parts.append(f'<a href="{href}">{label}</a>' if href else f"<span>{label}</span>")
    return f'<nav class="crumbs" aria-label="Breadcrumb">{"".join(parts)}</nav>'


def breadcrumb_ld(items):
    def _ca(href):
        if href and href.startswith("/") and not href.startswith("/ca/"):
            return "/ca" + href
        return href
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": label, **({"item": C.SITE_URL + _ca(href)} if href else {})}
        for i, (label, href) in enumerate(items)]}


def page_hero(title, lead, kicker, crumb, extra=""):
    """The one title area used by every page except the homepage: breadcrumb, kicker, H1, lead, optional buttons.
    All four parts are required so every page's title block looks exactly the same (build.py checks this)."""
    return f"""<section class="page-hero">
  {aurora()}<div class="grid-bg" aria-hidden="true"></div>
  <div class="container z">
    {crumbs(crumb)}
    <span class="kicker">{kicker}</span>
    <h1>{title}</h1>
    <p class="lead">{lead}</p>
    {extra}
  </div>
</section>"""


def trust_row():
    return f"""<div class="pricing-foot">
  <span>{icon("refund")} 7-day money-back guarantee</span>
  <span>{icon("bolt")} Ready within 5 minutes</span>
  <span>{icon("headset")} 24/7 human support</span>
  <span>{icon("lock")} Secure &amp; private</span>
</div>"""


# ------------------------------------------------------------------ pricing
def pricing(default_devices=1, heading=True):
    conn = next(c for c in PLANS["connections"] if c["devices"] == default_devices)
    tabs = "".join(
        f'<button type="button" role="tab" data-devices="{c["devices"]}" aria-selected="{str(c["devices"] == default_devices).lower()}">'
        f'<b>{c["devices"]}</b> <span>{"device" if c["devices"] == 1 else "devices"}</span></button>'
        for c in PLANS["connections"])
    cards = []
    for p in conn["plans"]:
        best = p["months"] == 12
        n = default_devices
        feats = [f'<span class="js-conn">{n} {"device" if n == 1 else "devices"} at the same time</span>'] + FEATURES
        cards.append(f"""<article class="plan{' plan--best' if best else ''} reveal" style="--d:{.08 * len(cards)}s">
  {'<span class="plan-badge">Best value</span>' if best else ''}
  <div class="plan-name">{plan_label(p["months"])}</div>
  <div class="plan-sub">{n} simultaneous {"connection" if n == 1 else "connections"}</div>
  <div class="price"><span class="cur">$</span><span class="amt">{p["price"]}</span><span class="per">/ {plan_label(p["months"]).lower()}</span></div>
  <div class="price-meta"><s>${p["original"]}</s><span class="save">Save 50%</span><span class="per-month">{per_month(p)}</span></div>
  {checks(feats)}
  <a class="btn {'btn--primary' if best else 'btn--ghost'} btn--block" href="/{p['slug']}/">Get {plan_label(p['months'])}</a>
  <div class="plan-foot">Ready within 5 minutes</div>
</article>""")
    payload = json.dumps([{"devices": c["devices"], "plans": [{k: q[k] for k in ("months", "price", "original", "slug")} for q in c["plans"]]}
                          for c in PLANS["connections"]], separators=(",", ":"))
    head = section_head("Pricing", 'Simple plans. <span class="grad-text nowrap">Half the price.</span>',
                        "Every plan includes every channel, every movie and every feature. Pick how many screens you need and how long you want to save.") if heading else ""
    return f"""<div data-pricing>
  {head}
  <div class="seg-wrap reveal"><p class="seg-note">How many devices will watch at the same time?</p>
  <div class="seg" role="tablist" aria-label="Number of devices" style="--n:{len(PLANS["connections"])};--i:{default_devices - 1}"><span class="seg-thumb" aria-hidden="true"></span>{tabs}</div></div>
  <div class="plans">{"".join(cards)}</div>
  {trust_row()}
  <p class="center muted" style="font-size:13.5px;margin-top:14px">Prices in US dollars. Paying in CAD? Your bank converts automatically.</p>
  <script type="application/json">{payload}</script>
</div>"""


# ------------------------------------------------------------------ FAQ
def faq(items, open_first=True):
    out = []
    for i, f in enumerate(items):
        out.append(f'<details{" open" if open_first and i == 0 else ""}><summary>{escape(f["q"])}</summary><div class="answer">{f["a"]}</div></details>')
    return '<div class="faq">' + "".join(out) + "</div>"


def faq_ld(items):
    return {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", " ", f["a"]).strip()}}
        for f in items]}


FAQ_TEXT = {
    "en": ("Can’t find what you’re looking for? Our team replies in minutes, day and night.", "Chat on WhatsApp"),
    "fr": ("Vous ne trouvez pas votre réponse? Notre équipe répond en quelques minutes, jour et nuit.", "Écrivez-nous sur WhatsApp"),
}


def faq_section(items, title="Frequently asked questions", lang="en"):
    note, wa = FAQ_TEXT[lang]
    return f"""<section class="section" id="faq">
  <div class="container faq-layout">
    <div class="faq-aside reveal">
      <span class="kicker">FAQ</span>
      <h2 class="h2">{title}</h2>
      <p class="muted">{note}</p>
      <div class="btn-row" style="margin-top:22px">
        <a class="btn btn--wa" href="{C.WHATSAPP_URL}" target="_blank" rel="noopener">{icon("whatsapp")} {wa}</a>
      </div>
    </div>
    <div class="reveal">{faq(items)}</div>
  </div>
</section>"""


# ------------------------------------------------------------------ reviews
FLAGS = {
    "USA": '<rect width="20" height="14" fill="#B22234"/>' + "".join(f'<rect y="{y}" width="20" height="1.08" fill="#fff"/>' for y in (1.08, 3.23, 5.38, 7.54, 9.69, 11.85)) + '<rect width="8" height="7.54" fill="#3C3B6E"/>',
    "UK": '<rect width="20" height="14" fill="#012169"/><path d="M0 0L20 14M20 0L0 14" stroke="#fff" stroke-width="2.6"/><path d="M0 0L20 14M20 0L0 14" stroke="#C8102E" stroke-width="1"/><path d="M10 0V14M0 7H20" stroke="#fff" stroke-width="4"/><path d="M10 0V14M0 7H20" stroke="#C8102E" stroke-width="2.4"/>',
    "Germany": '<rect width="20" height="4.67" fill="#000"/><rect y="4.67" width="20" height="4.67" fill="#DD0000"/><rect y="9.33" width="20" height="4.67" fill="#FFCE00"/>',
    "France": '<rect width="6.67" height="14" fill="#002395"/><rect x="6.67" width="6.67" height="14" fill="#fff"/><rect x="13.33" width="6.67" height="14" fill="#ED2939"/>',
}


def flag(country):
    """'🇨🇦 Canada' -> inline SVG flag (emoji flags don't render on Windows)."""
    name = country.split(" ", 1)[-1]
    if name == "Canada":  # the official flag image supplied by the owner (2:1)
        return '<img class="rv-flag" src="/brand/flag-ca.png" width="28" height="14" alt="Canada" loading="lazy" decoding="async">'
    shapes = FLAGS.get(name)
    return (f'<svg class="rv-flag" width="20" height="14" viewBox="0 0 20 14" role="img" aria-label="{escape(name)}">{shapes}</svg>'
            if shapes else escape(name))


def _dots(n, label):
    return f'<div class="rv-dots" aria-label="{label}s">' + "".join(
        f'<button type="button" aria-label="Show {label.lower()} {i + 1}"{" aria-current=\"true\"" if i == 0 else ""}></button>' for i in range(n)) + "</div>"


def _carousel(slides, label, cls):
    """Horizontal slider: all slides sit side by side in a track that slides left/right (see site.js)."""
    track = "".join(f'<div class="rv-slide">{sl}</div>' for sl in slides)
    dots = _dots(len(slides), label) if len(slides) > 1 else ""
    return (f'<div class="rv-carousel {cls}" data-carousel><div class="rv-viewport">'
            f'<div class="rv-track">{track}</div></div>{dots}</div>')


GOOGLE_LOGO = ('<svg class="rv-google" viewBox="0 0 260 56" width="220" height="50" role="img" aria-label="Google reviews">'
               '<path d="M22 10C15.4 10 10 15.4 10 22s5.4 12 12 12c5.6 0 10.3-3.8 11.6-9H22v-4h16.2c.2 1 .3 2 .3 3 0 8.8-5.9 15-16.5 15C10.5 39 4 32.5 4 22S10.5 5 22 5c5.6 0 10.2 2.1 13.8 5.4l-3.6 3.6C29.8 11.6 26.2 10 22 10z" fill="#4285F4"/>'
               '<text x="50" y="26" font-family="Arial,sans-serif" font-weight="700" font-size="24" dominant-baseline="middle">'
               '<tspan fill="#4285F4">G</tspan><tspan fill="#EA4335">o</tspan><tspan fill="#FBBC05">o</tspan><tspan fill="#4285F4">g</tspan><tspan fill="#34A853">l</tspan><tspan fill="#EA4335">e</tspan></text>'
               '<text x="50" y="48" font-family="Arial,sans-serif" font-weight="600" font-size="15" fill="rgba(255,255,255,0.6)">Reviews</text>'
               '<text x="135" y="48" font-family="Arial,sans-serif" font-size="15" fill="#FBBC05">★★★★★</text></svg>')


def _stars(n):
    return f'<span class="rv-squares" aria-label="{n} out of 5 stars">' + '<i>★</i>' * n + "</span>"


def review_ld():
    """Product review + aggregateRating built only from the featured reviews shown in reviews_section()
    (genuine customer reviews with the star score each customer gave), so the markup matches the page."""
    rs = data("reviews")["reviews"]
    reviews = [{"@type": "Review", "name": x["title"], "reviewBody": x["body"], "author": {"@type": "Person", "name": x["name"]},
                "reviewRating": {"@type": "Rating", "ratingValue": x["rating"], "bestRating": 5, "worstRating": 1}} for x in rs]
    avg = round(sum(x["rating"] for x in rs) / len(rs), 1)
    return {"review": reviews, "aggregateRating": {"@type": "AggregateRating", "ratingValue": avg, "bestRating": 5,
                                                   "worstRating": 1, "ratingCount": len(rs), "reviewCount": len(rs)}}


def reviews_section():
    r = data("reviews")
    squares = '<span class="rv-squares" aria-label="5 out of 5 stars">' + '<i>★</i>' * 5 + "</span>"
    featured = [f"""<figure class="rv-feature">{_stars(x["rating"])}
  <h3>{escape(x["title"])}</h3><blockquote><p>{escape(x["body"])}</p></blockquote>
  <figcaption class="rv-who rv-who--green">— {escape(x["name"])} {flag(x["country"])}</figcaption></figure>""" for x in r["reviews"]]
    wa_icon = f'<span class="rv-wa-icon">{icon("whatsapp")}</span>'
    wa = ['<div class="rv-grid rv-grid--2">' + "".join(
        f"""<figure class="rv-card"><div class="rv-card-head">{wa_icon}<span>WhatsApp</span></div>
  <blockquote><p>{escape(x["text"])}</p></blockquote><figcaption class="rv-who rv-who--wa">— {escape(x["name"])} {flag(x["country"])}</figcaption></figure>"""
        for x in r["whatsapp"][i:i + 2]) + "</div>" for i in range(0, len(r["whatsapp"]), 2)]
    # Google block: only real reviews copied from the business's Google profile (src/data/reviews.json -> "google")
    google_block = ""
    if r.get("google"):
        gl = r["google"]
        slides = ['<div class="rv-grid rv-grid--3">' + "".join(
            f"""<figure class="rv-card"><span class="rv-gstars" aria-label="{x.get('rating', 5)} out of 5 stars">{"★" * int(x.get("rating", 5))}</span>
  <figcaption class="rv-gname">{escape(x["name"])}</figcaption><blockquote><p>{escape(x["text"])}</p></blockquote></figure>"""
            for x in gl[i:i + 3]) + "</div>" for i in range(0, len(gl), 3)]
        google_block = f"""
    <div class="rv-block reveal">
      <div class="rv-brand">{GOOGLE_LOGO}</div>
      {_carousel(slides, "Google review", "rv-carousel--google")}
    </div>"""
    sources = "our customers, our WhatsApp support chat and Google" if r.get("google") else "our customers and our WhatsApp support chat"
    stats = [("50,000+", "Live channels", "#00E5FF"), ("7-day", "Money-back", "#00b67a"),
             ("4K", "Ultra HD", "#FBBC04"), ("24/7", "Human support", "#E8041F")]
    stat_html = "".join(f'<div class="rv-stat"><b style="color:{c}">{v}</b><span>{t}</span></div>' for v, t, c in stats)
    return f"""<section class="section rv-section" id="reviews">
  <div class="container">
    <div class="rv-head reveal">
      <p class="rv-kicker">Customer reviews</p>
      <h2>What customers say about <span>IPTVMaple</span></h2>
      <p class="rv-sub">Real feedback from {sources}</p>
      <div class="rv-stats">{stat_html}</div>
    </div>

    <div class="rv-block reveal">
      <div class="rv-brand">{squares}<span>Customer reviews</span></div>
      {_carousel(featured, "Review", "rv-carousel--feature")}
    </div>

    <div class="rv-block reveal">
      <div class="rv-brand rv-brand--wa">{wa_icon}<span>WhatsApp</span></div>
      {_carousel(wa, "Message", "rv-carousel--wa")}
    </div>{google_block}
  </div>
</section>"""


# ------------------------------------------------------------------ CTA band
CTA_TEXT = {
    "en": ("Start today", "See plans — 50% off", "Try free for 24 hours"),
    "fr": ("Commencez aujourd’hui", "Voir les forfaits — 50 % de rabais", "Essai gratuit de 24 h"),
}


def cta_band(title="Ready to cut the cord?", text="Stream live TV, sports and blockbusters in 4K — for half the price. Start with a free 24-hour trial.", img="/images/composed/mosaic.webp", lang="en"):
    kicker, primary, secondary = CTA_TEXT[lang]
    return f"""<section class="section section--tight">
  <div class="container">
    <div class="cta-band reveal">
      <img src="{img}" alt="" loading="lazy" width="1600" height="676">
      <span class="kicker">{kicker}</span>
      <h2 class="h2">{title}</h2>
      <p>{text}</p>
      <div class="btn-row">
        <a class="btn btn--primary btn--lg" href="/iptv-plans-canada/">{primary}</a>
        <a class="btn btn--ghost btn--lg" href="/try-iptv-canada/">{secondary}</a>
      </div>
    </div>
  </div>
</section>"""


# ------------------------------------------------------------------ forms
COUNTRIES = ["Canada", "United States", "United Kingdom", "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Cape Verde", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", "Côte d’Ivoire", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "DR Congo", "Ecuador", "Egypt", "El Salvador", "Eritrea", "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar", "Romania", "Russia", "Rwanda", "Saint Lucia", "San Marino", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Uganda", "Ukraine", "United Arab Emirates", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe", "Other"]


def lead_form(form_id, kind, submit_label, value=0, plan_name=""):
    """Order / free-trial form. Field names match the old Forminator form so leads keep the same shape."""
    opts = "".join(f"<option{' selected' if c == 'Canada' else ''}>{escape(c)}</option>" for c in COUNTRIES)
    trial = f' data-trial-endpoint="{C.TRIAL_WORKER_URL}"' if kind == "free-trial" else ""
    return f"""<form class="lead-form" data-lead-form="{kind}" data-value="{value}"{trial} novalidate>
  <input type="hidden" name="action" value="forminator_submit_form_custom-forms">
  <input type="hidden" name="form_id" value="{form_id}">
  <input type="hidden" name="plan" value="{escape(plan_name)}">
  <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="fields">
    <div class="field"><label for="f-name">First name</label><input class="input" id="f-name" name="name-1" autocomplete="given-name" placeholder="E.g. John" required><span class="err"></span></div>
    <div class="field"><label for="f-country">Country</label><select class="input" id="f-country" name="address-1-country" autocomplete="country-name">{opts}</select><span class="err"></span></div>
    <div class="field field--full"><label for="f-email">Email address</label><input class="input" id="f-email" name="email-1" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required><span class="err"></span></div>
    <div class="field field--full"><label for="f-phone">WhatsApp number <em>— {"for setup help if you need it" if kind == "free-trial" else "we send your login by email and WhatsApp"}</em></label><input class="input" id="f-phone" name="phone-1" type="tel" autocomplete="tel" inputmode="tel" placeholder="E.g. +1 300 400 5000" required><span class="err"></span></div>
  </div>
  <button class="btn btn--primary btn--lg btn--block" type="submit" style="margin-top:22px"><span class="spinner"></span>{submit_label} {icon("arrow-right")}</button>
  <div class="form-msg" role="status" aria-live="polite"></div>
  <p class="form-note">{icon("lock")} Your details are only used to activate your service. No spam, ever.</p>
</form>"""


def referral_form():
    def person(prefix, n, who, hint, ph_name, ph_phone, ph_email):
        return f"""<fieldset class="ref-group ref-group--{prefix}">
    <legend><span class="ref-num">{n}</span><span><b>{who}</b><small>{hint}</small></span></legend>
    <div class="fields">
      <div class="field"><label for="{prefix}-name">Name</label><input class="input" id="{prefix}-name" name="name-{n}" autocomplete="{'name' if n == 1 else 'off'}" placeholder="{ph_name}" required><span class="err"></span></div>
      <div class="field"><label for="{prefix}-phone">Phone (WhatsApp)</label><input class="input" id="{prefix}-phone" name="phone-{n}" type="tel" inputmode="tel" autocomplete="{'tel' if n == 1 else 'off'}" placeholder="{ph_phone}" required><span class="err"></span></div>
      <div class="field field--full"><label for="{prefix}-email">Email</label><input class="input" id="{prefix}-email" name="email-{n}" type="email" inputmode="email" autocomplete="{'email' if n == 1 else 'off'}" placeholder="{ph_email}" required><span class="err"></span></div>
    </div>
  </fieldset>"""
    return f"""<form class="lead-form" data-lead-form="referral" novalidate>
  <input type="hidden" name="action" value="forminator_submit_form_custom-forms">
  <input type="hidden" name="form_id" value="3995">
  <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
  {person("r", 1, "Your details", "The person referring", "E.g. John Smith", "E.g. +1 300 400 5000", "you@example.com")}
  {person("rf", 2, "Your friend’s details", "The new customer you’re referring", "E.g. Mike Brown", "E.g. +1 245 852 4100", "friend@example.com")}
  <button class="btn btn--primary btn--lg btn--block" type="submit" style="margin-top:22px"><span class="spinner"></span>Submit referral {icon("arrow-right")}</button>
  <div class="form-msg" role="status" aria-live="polite"></div>
</form>"""


def guarantee():
    return f"""<div class="guarantee">{icon("shield")}<div><strong>7-day money-back guarantee</strong>Not satisfied? Request a full refund within 7 days of purchase.</div></div>"""
