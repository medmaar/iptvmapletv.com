"""Location pages: /usa/, /usa/{state}/, /usa/{state}/{city}/, /canada/, /canada/{province}/, /canada/{province}/{city}/
plus French Quebec city pages under /fr/canada/quebec/ (hreflang-paired with the English ones).

Every page is assembled from real local data (geo_us_data.py, geo_ca_data.py) and the local stations that are
actually in our lineup (src/data/channels.json), so no two pages share the same specifics.
"""
import json
import os
import re
from html import escape
from .geo_local import local_note

from .geo_ca_data import CITIES as CA_CITIES, PROVINCES
from .geo_us_data import CITIES as US_CITIES, STATES

_CH = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "src", "data", "channels.json"), encoding="utf-8"))
_US = [x for r in _CH for c in r["countries"] if c["name"] == "USA" for x in c["channels"]]
_CA = [x for r in _CH for c in r["countries"] if c["name"] == "CANADA" for x in c["channels"]]
KEEP_UPPER = {"CTV", "CTV2", "CBC", "TVA", "ICI", "CHCH", "CP24", "OMNI", "TSN", "RDS", "V", "NBC", "ABC", "CBS", "FOX", "CW", "PBS", "MY", "RDI", "ARTV"}


def _clean(name):
    name = re.sub(r"^US\s*-\s*", "", name)
    name = re.sub(r"\s*\|?\s*(UHD\s*)?4K\s*$", "", name).replace("VIP ", "").replace(" HD", "").strip(" |")
    return name


ACCENTS = {"Tele": "Télé", "Meteo": "Météo", "Riviere": "Rivière", "Riviere-du-loup": "Rivière-du-Loup", "Trois-rivieres": "Trois-Rivières"}


def _word(w):
    if w in KEEP_UPPER:
        return w
    if "-" in w:
        return ACCENTS.get(w.capitalize(), "-".join(_word(x) for x in w.split("-")))
    if not w.isalpha():
        return w
    w = w.capitalize()
    return ACCENTS.get(w, w)


def _tc(name):
    out = " ".join(_word(w) for w in name.split())
    return out.replace("Radio-canada", "Radio-Canada").replace("City Montreal", "Citytv Montreal").replace("City Toronto", "Citytv Toronto")         .replace("City Vancouver", "Citytv Vancouver").replace("Météo Media", "MétéoMédia")


def us_stations(keys, abbr=None, limit=6):
    out = []
    for ch in _US:
        m = re.search(r"\(([^)]+)\)", ch)
        if not m:
            continue
        loc = m.group(1).strip()
        if any(loc == k or loc.startswith(k + " ") for k in keys) or (abbr and loc.endswith(" " + abbr)):
            nm = _clean(ch).replace("Wash D.C", "Washington DC").replace("(Philly)", "(Philadelphia)").replace("(Indy)", "(Indianapolis)")
            if not abbr:  # city page: the city is implied, show "NBC 4" rather than "NBC 4 (New York NY)"
                nm = re.sub(r"\s*\([^)]*\)", "", nm).strip()
            else:         # state page: keep the market, without the state code
                nm = re.sub(r"\s+[A-Z]{2}\)", ")", nm)
            if nm not in out:
                out.append(nm)
    return out[:limit]


def ca_stations(keys, limit=6):
    out = []
    for ch in _CA:
        up = ch.upper()
        if any(k in up for k in keys):
            nm = _tc(_clean(ch))
            if nm not in out:
                out.append(nm)
    return out[:limit]


def _fold(x):
    """Accent- and case-insensitive text for matching place names."""
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(x).lower()) if unicodedata.category(c) != "Mn")


def _list(items, conj="and"):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + f" {conj} " + items[-1]


def _first(isps):
    return isps.split(",")[0].split(" and ")[0].strip()


# ------------------------------------------------------------------ slugs
STATE_BY_ABBR = {s[2]: s for s in STATES}
US_CITY_SLUG = {c[1]: f"usa/{STATE_BY_ABBR[c[0]][0]}/{c[2]}" for c in US_CITIES if c[0] != "DC"}
PROV = {p[0]: p for p in PROVINCES}
CA_CITY_SLUG = {c[1]: f"canada/{c[0]}/{c[2]}" for c in CA_CITIES}
FR_NAMES = {"Montreal": "Montréal", "Quebec City": "Québec", "Laval": "Laval", "Gatineau": "Gatineau", "Longueuil": "Longueuil",
            "Sherbrooke": "Sherbrooke", "Trois-Rivières": "Trois-Rivières", "Saguenay": "Saguenay", "Lévis": "Lévis",
            "Terrebonne": "Terrebonne", "Brossard": "Brossard"}
FR_SLUGS = {"Quebec City": "ville-de-quebec"}

LEGACY_KW = {
    "Toronto": ["iptv toronto", "toronto iptv"], "Montreal": ["iptv montreal", "iptv montréal", "iptv montréal québec", "iptv rive nord"],
    "Vancouver": ["iptv vancouver", "vancouver iptv"], "Calgary": ["iptv calgary", "calgary iptv"],
    "Edmonton": ["iptv in edmonton", "iptv edmonton", "edmonton iptv"], "Ottawa": ["iptv ottawa", "ottawa iptv", "iptv gatineau"],
    "Winnipeg": ["iptv winnipeg", "winnipeg iptv"], "Hamilton": ["iptv hamilton", "hamilton iptv"], "Halifax": ["iptv halifax", "halifax iptv"],
}


def _nearby_links(names, slugmap, current):
    links = [f'<a href="/{slugmap[n]}/">{escape(n)}</a>' for n in names if n in slugmap and slugmap[n] != current]
    plain = [escape(n) for n in names if n not in slugmap]
    return links, plain


def _ring(cities, pos, slugmap, skip=(), n=3):
    """The next n other cities of the same province/state (wrapping around), as links. Every city page therefore gets inbound links from
    its neighbours in the list, which keeps every location page well connected for crawlers and readers."""
    out = []
    for step in range(1, len(cities)):
        c = cities[(pos + step) % len(cities)]
        if c[1] in skip or c[1] == cities[pos][1] or c[1] not in slugmap:
            continue
        out.append(f'<a href="/{slugmap[c[1]]}/">{escape(c[1])}</a>')
        if len(out) == n:
            break
    return out


def _steps(place, tz):
    return f"""<h2>Get IPTV in {place} in 4 steps</h2>
<ol>
<li><strong>Choose a plan</strong> on the <a href="/iptv-plans-canada/">IPTV subscription page</a>, or start with the <a href="/try-iptv-canada/">free 24-hour trial</a>.</li>
<li><strong>Get your login</strong> by email and WhatsApp, usually within minutes, any time of day ({tz} time included).</li>
<li><strong>Install an app</strong> — <a href="/tivimate/">TiviMate</a> on a <a href="/iptv-firestick/">Firestick</a>, or an app on your <a href="/iptv-samsung-tv/">smart TV</a> or <a href="/iptv-apple-tv/">Apple TV</a>.</li>
<li><strong>Watch</strong> live TV, sports, movies and series on every screen in your home.</li>
</ol>"""


# ------------------------------------------------------------------ USA
def _h1_place(city, abbr):
    """City name for the H1; adds the state/province when the same name exists in both countries (Richmond BC / VA)."""
    shared = {x[1] for x in US_CITIES} & {x[1] for x in CA_CITIES}
    return f"{city}, {abbr}" if city in shared else city


def us_city(c):
    abbr, city, cslug, teams, nearby, note, tz_override, keys = c
    st = STATE_BY_ABBR[abbr]
    sslug, sname, _, _, tz_state, isps, _ = st
    tz = tz_override or tz_state
    slug = US_CITY_SLUG[city]
    stations = us_stations(keys)
    links, plain = _nearby_links(nearby, US_CITY_SLUG, slug)
    near_html = _list(links + plain) if (links or plain) else ""
    same = [x for x in US_CITIES if x[0] == abbr]
    more = _ring(same, [x[1] for x in same].index(city), US_CITY_SLUG, skip=set(nearby))
    more_html = f"<p>More {sname} city guides: {_list(more)}.</p>" if more else ""
    st_txt = _list(stations) if stations else "national network feeds from ABC, CBS, NBC and FOX"
    team0 = teams[0] if teams else "local"
    teams_li = "".join(f"<li>{escape(t)}</li>" for t in teams)
    body = f"""
<h2>Why {city} is switching to IPTV</h2>
<p>{note}</p>
{local_note(city)}
<p>IPTV streams live TV over your internet connection instead of a cable line, so there’s no box rental, no technician and no contract — just an app on the TVs and phones you already own.</p>

<h2>Local channels and sports in {city}</h2>
<p>Your lineup includes {st_txt}, plus ESPN, FS1, NBA TV, NHL Network and hundreds of US channels. Teams {city} viewers follow:</p>
<ul>{teams_li}</ul>
<p>See every league on our <a href="/iptv-sports/">sports IPTV page</a>.</p>

<h2>Does IPTV work with {city} internet providers?</h2>
<p>Yes. IPTV runs on top of any home internet — common providers in {sname} include {isps}, plus 5G home internet and Starlink. You need about 10 Mbps for HD and 25 Mbps per screen for 4K; most {city} plans offer far more.</p>
{_steps(city, tz)}
{f"<h2>IPTV near {city}</h2><p>We also serve {near_html} — and <a href='/usa/{sslug}/'>every city in {sname}</a>.</p>{more_html}" if near_html else f"<p>See all <a href='/usa/{sslug}/'>IPTV guides for {sname}</a>.</p>{more_html}"}
"""
    faq = [
        (f"Is IPTV available in {city}, {abbr}?", f"<p>Yes. IPTVMaple works anywhere in {city} and across {sname} — all you need is an internet connection.</p>"),
        (f"Can I watch local {city} channels?", f"<p>Yes — the lineup includes {st_txt}, along with national networks and sports channels.</p>"),
        (f"Can I watch {team0} games on IPTV?", f"<p>Yes. The sports networks and league channels that carry {team0} games are included in every plan, in HD and 4K where available.</p>"),
        (f"Do I need to change my internet provider in {city}?", f"<p>No. IPTV works with {_first(isps)} and every other provider in {sname}. Keep your internet and drop only the TV part of your bill.</p>"),
        (f"Will the TV guide show {tz} time?", f"<p>Yes. Set your IPTV app or device to {tz} time and the program guide lines up with your clock.</p>"),
    ]
    rel = [US_CITY_SLUG[n] for n in nearby if n in US_CITY_SLUG and US_CITY_SLUG[n] != slug][:3]
    return dict(
        slug=slug, hub="usa", trail=[("USA", "/usa/"), (sname, f"/usa/{sslug}/")], locale="en-US",
        service_area=("City", f"{city}, {abbr}"),
        title=f"IPTV {city}, {abbr} – Live TV, Sports & 4K | IPTVMaple",
        description=f"IPTV in {city}, {abbr}: local stations, {team0} games and 50,000+ channels in 4K. Works with {_first(isps)} and any internet. Try it free for 24h.",
        kicker=f"IPTV {sname}", h1=f'IPTV in <span class="grad-text">{escape(_h1_place(city, abbr))}</span>',
        lead=f"Live TV, local news and {escape(team0)} games in 4K — streamed over the internet you already have in {escape(city)}.",
        crumb=city, blurb=f"Local channels and {team0} in {city}.",
        answer=f"<p><strong>IPTV in {city}</strong> works over any home internet connection — {_first(isps)}, 5G home internet or Starlink. IPTVMaple gives {city} households 50,000+ live channels including {st_txt}, every sports network and 300,000+ movies and series, from $9 with a free 24-hour trial.</p>",
        body=body, faq=faq, related=rel + ["iptv-sports"],
        keywords=[f"iptv {city.lower()}", f"{city.lower()} iptv", f"iptv in {city.lower()}"],
    )


def us_state(st):
    sslug, sname, abbr, capital, tz, isps, note = st
    cities = [c for c in US_CITIES if c[0] == abbr and c[0] != "DC"]
    dc = next((c for c in US_CITIES if c[0] == "DC"), None) if abbr == "DC" else None
    keys = sum((c[7] for c in cities), []) + (dc[7] if dc else [])
    stations = us_stations(keys, abbr, limit=8)
    teams = []
    for c in cities + ([dc] if dc else []):
        for t in c[3]:
            if t not in teams:
                teams.append(t)
    teams = teams[:10]
    st_txt = _list(stations) if stations else "national network feeds from ABC, CBS, NBC and FOX"
    city_links = _list(f'<a href="/{US_CITY_SLUG[c[1]]}/">{escape(c[1])}</a>' for c in cities)
    _ix = [x[0] for x in STATES].index(sslug)
    _others = [STATES[(_ix + k) % len(STATES)] for k in range(1, 5)]
    state_more = "<p>More state guides: " + _list(f'<a href="/usa/{o[0]}/">{escape(o[1])}</a>' for o in _others) + ".</p>"
    teams_html = f"<p>Teams {sname} viewers follow include:</p><ul>{''.join(f'<li>{escape(t)}</li>' for t in teams)}</ul>" if teams else \
        f"<p>{sname} has no major-league teams of its own, so league packages and national sports networks — all included — matter even more.</p>"
    body = f"""
<h2>IPTV in {sname}: what to know</h2>
<p>{note}</p>
<p>IPTV works anywhere in {sname} with an internet connection — big city, suburb or rural town. There’s no installer, no box rental and no contract.</p>

<h2>Local stations and sports</h2>
<p>The lineup includes {st_txt}, plus ESPN, FS1, NBA TV, NHL Network and PPV events.</p>
{teams_html}

<h2>Internet providers in {sname}</h2>
<p>IPTV works with {isps}, as well as 5G home internet and Starlink. Plan on 10 Mbps for HD and 25 Mbps per screen for 4K.</p>
{f"<h2>{sname} city guides</h2><p>Local details for {city_links}.</p>" if cities else ""}
{_steps(sname, tz)}
{state_more}
"""
    faq = [
        (f"Is IPTV available in {sname}?", f"<p>Yes — everywhere in {sname} with internet, from {capital} to the smallest towns.</p>"),
        (f"Which internet providers work with IPTV in {sname}?", f"<p>All of them, including {isps}, plus 5G home internet and Starlink.</p>"),
        (f"Are {sname} local channels included?", f"<p>Yes — including {st_txt} — along with national networks and sports channels.</p>"),
        (f"What time zone is the TV guide in for {sname}?", f"<p>Set your app or device to {tz} time and the guide matches your local listings.</p>"),
    ]
    return dict(
        slug=f"usa/{sslug}", hub="usa", trail=[("USA", "/usa/")], locale="en-US", service_area=("State", sname),
        children=[US_CITY_SLUG[c[1]] for c in cities],
        title=("IPTV Washington, D.C.: Local Channels & Sports | IPTVMaple" if abbr == "DC" else
               f"IPTV {sname}: Live TV & Sports in Every City | IPTVMaple" if len(sname) <= 11 else f"IPTV {sname}: Live TV & Sports in 4K | IPTVMaple"),
        description=f"IPTV in {sname}: local stations, {teams[0] if teams else 'national sports'} and 50,000+ channels in 4K on any device. Works with {_first(isps)}. Try free for 24h.",
        kicker="IPTV USA", h1=f'IPTV in <span class="grad-text">{escape(sname)}</span>',
        lead=f"Live TV, local stations and sports across {escape(sname)} — no cable box, no contract.",
        crumb=sname, blurb=f"{len(cities)} city guide{'s' if len(cities) != 1 else ''} · {isps.split(',')[0]}" if cities else f"IPTV across {sname}",
        answer=f"<p><strong>IPTV in {sname}</strong> streams live TV over any internet connection — {_first(isps)}, 5G home internet or Starlink. IPTVMaple includes {st_txt}, every major sports network and 300,000+ movies and series, from $9 with a free 24-hour trial.</p>",
        body=body, faq=faq, related=["usa", "best-iptv-canada"],
        keywords=[f"iptv {sname.lower()}", f"{sname.lower()} iptv"],
    )


# ------------------------------------------------------------------ Canada
def ca_city(c):
    pslug, city, cslug, teams, nearby, note, extra, keys = c
    pv = PROV[pslug]
    _, pname, abbr, _, tz, isps, _ = pv
    slug = CA_CITY_SLUG[city]
    stations = ca_stations(keys)
    links, plain = _nearby_links(nearby, CA_CITY_SLUG, slug)
    near_html = _list(links + plain) if (links or plain) else ""
    same = [x for x in CA_CITIES if x[0] == pslug]
    more = _ring(same, [x[1] for x in same].index(city), CA_CITY_SLUG, skip=set(nearby))
    more_html = f"<p>More {pname} city guides: {_list(more)}.</p>" if more else ""
    st_txt = _list(stations) if stations else "CBC, CTV, Global and Citytv national feeds"
    # Only call stations "local" when the city's own name is in them (e.g. CBC Toronto in Toronto). Elsewhere (CBC Calgary on the
    # Edmonton page) they are the nearest regional feeds in our lineup, and the page says so instead of implying a local station.
    local_st = any(_fold(city) in _fold(x) for x in stations)
    regional = bool(stations) and not local_st
    if regional:
        st_txt = "regional feeds such as " + st_txt
    team0 = teams[0].split(" (")[0] if teams else "local"
    fr = pslug == "quebec" or city in ("Moncton", "Ottawa")
    alternates = []
    if pslug == "quebec":
        fr_url = f"/ca/fr/canada/quebec/{FR_SLUGS.get(city, cslug)}/"
        alternates = [("en-CA", f"/ca/{slug}/"), ("fr-CA", fr_url)]
    body = f"""
<h2>Why {city} is switching to IPTV</h2>
<p>{note}</p>
{local_note(city)}
{extra}
<h2>Local channels and sports in {city}</h2>
<p>Your lineup includes {st_txt}, plus TSN, Sportsnet{', RDS, TVA Sports' if fr else ''} and every national network. Teams {city} viewers follow:</p>
<ul>{''.join(f'<li>{escape(t)}</li>' for t in teams)}</ul>
<p>More in our <a href="/nhl-iptv/">NHL IPTV guide</a> and on <a href="/iptv-sports/">sports IPTV</a>.</p>

<h2>Does IPTV work with my {city} internet provider?</h2>
<p>Yes. IPTV works with {isps} and any other ISP in {pname}. You don’t need to change provider or rent a TV box. For 4K, 25 Mbps per screen is plenty.</p>
{_steps(city, tz)}
{f"<h2>IPTV near {city}</h2><p>We also serve {near_html} — and <a href='/canada/{pslug}/'>every city in {pname}</a>.</p>{more_html}" if near_html else more_html}
{"<p><strong>En français :</strong> <a href='" + alternates[1][1] + "'>IPTV " + FR_NAMES.get(city, city) + "</a>.</p>" if alternates else ""}{"<p><strong>En français :</strong> <a href='/fr/canada/nouveau-brunswick/'>IPTV au Nouveau-Brunswick</a>.</p>" if pslug == "new-brunswick" else ""}
"""
    faq = [
        (f"Is IPTV available in {city}?", f"<p>Yes. IPTVMaple works anywhere in {city} and across {pname} — all you need is an internet connection.</p>"),
        (f"Do I need to change my internet provider in {city}?", f"<p>No. IPTV works with {isps} and every other ISP. Keep your internet plan and cancel only the cable TV part if you want.</p>"),
        ((f"Can I watch local {city} channels?", f"<p>Yes, including {st_txt}, plus national Canadian networks.</p>") if not regional else
         (f"Are {city} local channels included?", f"<p>The lineup carries {st_txt}, plus every national Canadian network. If you need a specific {city} station, ask our team on WhatsApp before you subscribe and we’ll tell you exactly what is included.</p>")),
        (f"Can I watch {team0} games on IPTV?", f"<p>Yes — the Canadian sports networks that carry {team0} games are included in every plan.</p>"),
    ]
    rel = [CA_CITY_SLUG[n] for n in nearby if n in CA_CITY_SLUG and CA_CITY_SLUG[n] != slug][:3]
    return dict(
        slug=slug, hub="canada", trail=[("Canada", "/canada/"), (pname, f"/canada/{pslug}/")], service_area=("City", f"{city}, {abbr}"),
        alternates=alternates,
        title=f"IPTV {city}, {abbr} – Live TV & Sports in 4K | IPTVMaple",
        description=f"IPTV in {city}, {abbr}: {stations[0] if stations else 'Canadian channels'}, {team0} games and 50,000+ channels in 4K — no cable contract. Try IPTVMaple free for 24h.",
        kicker=f"IPTV {pname}", h1=f'IPTV in <span class="grad-text">{escape(_h1_place(city, abbr))}</span>',
        lead=f"Live TV, local news and every {escape(team0)} game in 4K — delivered over the internet you already have in {escape(city)}.",
        crumb=city, blurb=f"Local channels, {team0} and 4K in {city}.",
        answer=f"<p><strong>IPTV in {city}</strong> works over any home internet connection — {_first(isps)} or a smaller provider. IPTVMaple gives {city} households 50,000+ live channels, including {st_txt}, all the sports networks and 300,000+ movies and series, from $9/month with a free 24-hour trial.</p>",
        body=body, faq=faq, related=rel + ["nhl-iptv"],
        keywords=LEGACY_KW.get(city, []) + [f"iptv {city.lower()}", f"{city.lower()} iptv"],
    )


def ca_province(pv):
    pslug, pname, abbr, capital, tz, isps, note = pv
    cities = [c for c in CA_CITIES if c[0] == pslug]
    stations = ca_stations(sum((c[7] for c in cities), []), limit=8)
    teams = []
    for c in cities:
        for t in c[3]:
            if t not in teams:
                teams.append(t)
    st_txt = _list(stations) if stations else "CBC, CTV, Global and Citytv national feeds"
    city_links = _list(f'<a href="/{CA_CITY_SLUG[c[1]]}/">{escape(c[1])}</a>' for c in cities)
    alternates = [("en-CA", "/ca/canada/quebec/"), ("fr-CA", "/ca/iptv-quebec/")] if pslug == "quebec" else \
        [("en-CA", "/ca/canada/new-brunswick/"), ("fr-CA", "/ca/fr/canada/nouveau-brunswick/")] if pslug == "new-brunswick" else []
    _keys = list(PROV)
    _px = _keys.index(pslug) if pslug in _keys else 0
    _po = [PROV[_keys[(_px + k) % len(_keys)]] for k in range(1, 4)]
    prov_more = "<p>More province guides: " + _list(f'<a href="/canada/{o[0]}/">{escape(o[1])}</a>' for o in _po) + ".</p>"
    body = f"""
<h2>IPTV in {pname}: what to know</h2>
<p>{note}</p>
<p>IPTV works anywhere in {pname} with an internet connection — no installer, no box rental and no contract.</p>

<h2>Local stations and sports</h2>
<p>The lineup includes {st_txt}, plus TSN, Sportsnet, RDS, TVA Sports and every national network.</p>
{f"<ul>{''.join(f'<li>{escape(t)}</li>' for t in teams[:10])}</ul>" if teams else ""}

<h2>Internet providers in {pname}</h2>
<p>IPTV works with {isps} and any other provider. Plan on 10 Mbps for HD and 25 Mbps per screen for 4K.</p>
{f"<h2>{pname} city guides</h2><p>Local details for {city_links}.</p>" if cities else ""}
{_steps(pname, tz)}
{prov_more}
{"<p><strong>En français :</strong> <a href='" + alternates[1][1] + "'>IPTV " + ("Québec" if pslug == "quebec" else "Nouveau-Brunswick") + "</a>.</p>" if alternates else ""}
"""
    faq = [
        (f"Is IPTV available in {pname}?", f"<p>Yes — everywhere in {pname} with internet, from {capital} to the smallest communities.</p>"),
        (f"Which internet providers work with IPTV in {pname}?", f"<p>All of them, including {isps}.</p>"),
        (f"Are {pname} local channels included?", f"<p>Yes — including {st_txt} — plus national English and French networks.</p>"),
        (f"What time zone is the TV guide in for {pname}?", f"<p>Set your app or device to {tz} time and the program guide matches your local listings.</p>"),
    ]
    return dict(
        slug=f"canada/{pslug}", hub="canada", trail=[("Canada", "/canada/")], service_area=("State", pname),
        children=[CA_CITY_SLUG[c[1]] for c in cities], alternates=alternates,
        title=f"IPTV {pname}: Live TV & Sports in Every City | IPTVMaple" if len(pname) <= 11 else f"IPTV {pname}: Live TV & Sports | IPTVMaple",
        description=f"IPTV in {pname}: {stations[0] if stations else 'Canadian channels'}, {teams[0].split(' (')[0] if teams else 'national sports'} and 50,000+ channels in 4K. Works with {_first(isps)}. Try free 24h.",
        kicker="IPTV Canada", h1=f'IPTV in <span class="grad-text">{escape(pname)}</span>',
        lead=f"Live TV, local stations and sports across {escape(pname)} — no cable box, no contract.",
        crumb=pname, blurb=f"{len(cities)} city guide{'s' if len(cities) != 1 else ''} · {_first(isps)}" if cities else f"IPTV across {pname}",
        answer=f"<p><strong>IPTV in {pname}</strong> streams live TV over any internet connection — {_first(isps)} or another provider. IPTVMaple includes {st_txt}, every sports network and 300,000+ movies and series, from $9 with a free 24-hour trial.</p>",
        body=body, faq=faq, related=["canada", "best-iptv-canada"],
        keywords=[f"iptv {pname.lower()}", f"{pname.lower()} iptv"],
    )


# ------------------------------------------------------------------ French Quebec / New Brunswick
def fr_city(c):
    pslug, city, cslug, teams, nearby, note, extra, keys = c
    nom = FR_NAMES[city]
    frslug = f"fr/canada/quebec/{FR_SLUGS.get(city, cslug)}"
    stations = ca_stations(keys)
    st_txt = _list(stations, "et") if stations else "TVA, ICI Radio-Canada Télé et Noovo"
    fr_regional = bool(stations) and not any(_fold(nom) in _fold(x) for x in stations)
    if fr_regional:
        st_txt = "des chaînes régionales comme " + st_txt
    team0 = teams[0].split(" (")[0] if teams else "vos équipes"
    voisins = [FR_NAMES[n] for n in nearby if n in FR_NAMES and n != city]
    near = _list([f'<a href="/fr/canada/quebec/{FR_SLUGS.get(n, CA_CITY_SLUG[n].split("/")[-1])}/">{FR_NAMES[n]}</a>' for n in nearby if n in FR_NAMES and n != city], "et")
    _qc = [x[1] for x in CA_CITIES if x[0] == "quebec" and x[1] in FR_NAMES]
    _qi = _qc.index(city) if city in _qc else 0
    _qo = [n for n in (_qc[(_qi + k) % len(_qc)] for k in range(1, len(_qc))) if n != city and n not in nearby][:3]
    fr_more = ("<p>Autres villes : " + _list([f'<a href="/fr/canada/quebec/{FR_SLUGS.get(n, CA_CITY_SLUG[n].split("/")[-1])}/">{FR_NAMES[n]}</a>' for n in _qo], "et") + ".</p>") if _qo else ""
    body = f"""
<h2>Pourquoi passer à l’IPTV à {nom}</h2>
<p>L’IPTV diffuse la télé par Internet plutôt que par le câble : pas de terminal à louer, pas de technicien, pas de contrat. À {nom}, elle fonctionne avec Vidéotron, Bell, Cogeco, Fizz et tous les autres fournisseurs.</p>
{local_note(city, fr=True)}

<h2>Chaînes locales et sport à {nom}</h2>
<p>La programmation comprend {st_txt}, ainsi que RDS, TVA Sports, TSN, Sportsnet et toutes les chaînes nationales. Équipes suivies à {nom} :</p>
<ul>{''.join(f'<li>{escape(t)}</li>' for t in teams)}</ul>

<h2>Commencer en 4 étapes</h2>
<ol>
<li>Choisissez un <a href="/abonnement-iptv/">abonnement IPTV</a> ou l’<a href="/try-iptv-canada/">essai gratuit de 24 h</a>.</li>
<li>Recevez vos identifiants par courriel et WhatsApp, en quelques minutes.</li>
<li>Installez une application — voir <a href="/iptv-sur-firestick/">IPTV sur Fire TV Stick</a> ou <a href="/iptv-sur-smart-tv/">sur téléviseur intelligent</a>.</li>
<li>Regardez en direct ou en rattrapage, en HD et 4K.</li>
</ol>
{f"<h2>IPTV près de {nom}</h2><p>Nous servons aussi {near} — et <a href='/iptv-quebec/'>tout le Québec</a>.</p>" if near else ""}
{fr_more}
<p><em>In English:</em> <a href="/{CA_CITY_SLUG[city]}/">IPTV in {city}</a>.</p>
"""
    faq = [
        (f"L’IPTV fonctionne-t-elle à {nom}?", f"<p>Oui, partout à {nom} avec n’importe quel fournisseur Internet : Vidéotron, Bell, Cogeco, Fizz ou autre.</p>"),
        ((f"Les chaînes locales de {nom} sont-elles incluses?", f"<p>Oui, dont {st_txt}, plus toutes les chaînes nationales en français et en anglais.</p>") if not fr_regional else
         (f"Les chaînes de {nom} sont-elles incluses?", f"<p>La programmation comprend {st_txt}, plus toutes les chaînes nationales en français et en anglais. Pour une station locale précise, écrivez-nous sur WhatsApp avant de vous abonner.</p>")),
        (f"Puis-je regarder les matchs de {team0}?", f"<p>Oui, sur les réseaux sportifs inclus dans chaque forfait (RDS, TVA Sports, TSN, Sportsnet).</p>"),
        ("Le soutien est-il offert en français?", "<p>Oui, notre équipe répond en français 24/7 par WhatsApp et par courriel.</p>"),
    ]
    return dict(
        slug=frslug, hub="fr", lang="fr", trail=[("IPTV Québec", "/iptv-quebec/")], service_area=("City", f"{nom}, QC"),
        alternates=[("en-CA", f"/ca/{CA_CITY_SLUG[city]}/"), ("fr-CA", f"/ca/{frslug}/")],
        title=(f"IPTV {nom} : télé en direct et sport en 4K | IPTVMaple" if len(nom) <= 12 else f"IPTV {nom} : télé en direct et sport | IPTVMaple"),
        description=f"IPTV à {nom} : {stations[0] if stations else 'TVA et ICI Radio-Canada'}, {team0} et 50 000+ chaînes en 4K, sans contrat. Essai gratuit de 24 h, soutien en français.",
        kicker="IPTV Québec", h1=f'IPTV à <span class="grad-text">{escape(nom)}</span>',
        lead=f"Vos chaînes québécoises, le sport et des milliers de films en 4K — sur la connexion Internet que vous avez déjà à {escape(nom)}.",
        crumb=nom, blurb=f"Chaînes locales et sport à {nom}.",
        answer=f"<p><strong>L’IPTV à {nom}</strong> fonctionne avec n’importe quelle connexion Internet. IPTVMaple inclut {st_txt}, RDS, TVA Sports et plus de 50 000 chaînes, ainsi que 300 000 films et séries, dès 9 $ avec un essai gratuit de 24 heures.</p>",
        body=body, faq=faq, related=["iptv-quebec", "abonnement-iptv"],
        cta_title=f"Prêt à regarder à {nom}?",
        keywords=[f"iptv {nom.lower()}"],
    )


def fr_new_brunswick():
    stations = ca_stations(["MONCTON", "ACADIE"])
    st_txt = _list(stations, "et") if stations else "ICI Radio-Canada Acadie"
    return dict(
        slug="fr/canada/nouveau-brunswick", hub="fr", lang="fr", trail=[("IPTV Québec", "/iptv-quebec/")], service_area=("State", "Nouveau-Brunswick"),
        alternates=[("en-CA", "/ca/canada/new-brunswick/"), ("fr-CA", "/ca/fr/canada/nouveau-brunswick/")],
        title="IPTV Nouveau-Brunswick : télé bilingue en 4K | IPTVMaple",
        description="IPTV au Nouveau-Brunswick : ICI Radio-Canada Acadie, TVA, RDS et 50 000+ chaînes en 4K, en français et en anglais. Essai gratuit 24 h.",
        kicker="IPTV Acadie", h1='IPTV au <span class="grad-text">Nouveau-Brunswick</span>',
        lead="La seule province officiellement bilingue : vos chaînes en français et en anglais dans un seul abonnement.",
        crumb="Nouveau-Brunswick", blurb="Chaînes acadiennes, françaises et anglaises.",
        answer=f"<p><strong>L’IPTV au Nouveau-Brunswick</strong> fonctionne avec Bell, Rogers et tous les autres fournisseurs. IPTVMaple inclut {st_txt}, TVA, RDS, TVA Sports et les réseaux anglais, dès 9 $ avec un essai gratuit de 24 h.</p>",
        body=f"""
<h2>Français et anglais, une seule programmation</h2>
<p>À Moncton, Dieppe, Edmundston, Bathurst ou Fredericton, recevez {st_txt}, TVA, Noovo, RDS et TVA Sports, ainsi que CBC, CTV, Global, TSN et Sportsnet.</p>
<h2>Heure de l’Atlantique</h2>
<p>Réglez votre application à l’heure de l’Atlantique pour que le guide télé corresponde à votre horaire. Le rattrapage vous permet de voir les matchs de l’Ouest le lendemain.</p>
<h2>Commencer</h2>
<p>Demandez l’<a href="/try-iptv-canada/">essai gratuit de 24 h</a> ou choisissez un <a href="/abonnement-iptv/">abonnement IPTV</a>. Guide d’installation : <a href="/iptv-sur-firestick/">IPTV sur Fire TV Stick</a>.</p>
<p><em>In English:</em> <a href="/canada/new-brunswick/">IPTV in New Brunswick</a> · <a href="/{CA_CITY_SLUG['Moncton']}/">IPTV Moncton</a>.</p>
""",
        faq=[
            ("L’IPTV fonctionne-t-elle au Nouveau-Brunswick?", "<p>Oui, partout dans la province avec n’importe quelle connexion Internet.</p>"),
            ("Les chaînes acadiennes sont-elles incluses?", f"<p>Oui, dont {st_txt}.</p>"),
            ("Puis-je avoir les chaînes en anglais aussi?", "<p>Oui, toutes les chaînes canadiennes anglaises sont incluses dans le même forfait.</p>"),
            ("Le soutien est-il en français?", "<p>Oui, 24/7 par WhatsApp et courriel.</p>"),
        ],
        related=["iptv-quebec", "abonnement-iptv"], keywords=["iptv nouveau-brunswick", "iptv acadie"],
    )


# ------------------------------------------------------------------ hubs
def hubs():
    usa = dict(
        slug="usa", hub="usa", hub_page=True, locale="en-US", children=[f"usa/{s[0]}" for s in STATES],
        title="IPTV USA: Live TV & Sports in All 50 States | IPTVMaple",
        description="IPTV in the USA: local stations, ESPN, NFL, NBA, NHL and MLB channels plus 50,000+ channels in 4K in every state. No contract — try IPTVMaple free for 24h.",
        kicker="IPTV USA", h1='IPTV in the <span class="grad-text">USA</span>',
        lead="Local stations, every sports network and 300,000+ movies & series in all 50 states — over the internet you already have.",
        crumb="USA", blurb="All 50 states and 100+ city guides.",
        answer="<p><strong>IPTV works in every US state</strong> over any internet connection — cable, fibre, 5G home internet or Starlink. IPTVMaple includes local ABC, CBS, NBC and FOX stations for major markets, ESPN, FS1, NFL, NBA, NHL and MLB channels, and 300,000+ movies and series, from $9 with a free 24-hour trial.</p>",
        body=f"""
<h2>Why Americans are cutting the cord with IPTV</h2>
<p>US cable bills often pass $100 a month once sports and regional networks are added, and many streaming apps now cost $15–$25 each. IPTV puts live local news, national networks, sports and on-demand movies in one subscription — with no box rental and no contract.</p>
<h2>Local stations from coast to coast</h2>
<p>The lineup carries local network affiliates for dozens of US markets — from New York, Los Angeles and Chicago to Salt Lake City, Omaha and Honolulu. Check the city guides below or search the <a href="/channels-list/">channels list</a> for your market.</p>
<h2>Pick your state</h2>
<p>Choose your state for local stations, teams, internet providers and city guides.</p>
""",
        faq=[
            ("Does IPTVMaple work in the USA?", "<p>Yes. It works in every state over any internet connection. Prices are in US dollars.</p>"),
            ("Are local US channels included?", "<p>Yes, local network affiliates for dozens of US markets, plus national networks and sports channels.</p>"),
            ("Can I watch the NFL, NBA, NHL and MLB?", "<p>Yes, the national sports networks and league channels are included in every plan.</p>"),
            ("Is there a free trial in the US?", "<p>Yes, 24 hours of full access with no credit card.</p>"),
        ],
        related=["canada", "best-iptv-canada", "iptv-sports"], keywords=["iptv usa", "iptv united states", "us iptv"],
    )
    canada = dict(
        slug="canada", hub="canada", hub_page=True, children=[f"canada/{p[0]}" for p in PROVINCES],
        title="IPTV Canada by Province: Local Channels | IPTVMaple",
        description="IPTV in every Canadian province and territory: local CBC, CTV, Global, TVA and ICI stations, TSN, Sportsnet and RDS, plus 50,000+ channels in 4K. Try free 24h.",
        kicker="IPTV Canada", h1='IPTV across <span class="grad-text">Canada</span>',
        lead="Local stations in English and French, every Canadian sports network and 300,000+ movies & series — in every province and territory.",
        crumb="Canada", blurb="Every province and 80 city guides.",
        answer="<p><strong>IPTV works in every province and territory</strong> over any internet connection — Bell, Rogers, Telus, Vidéotron, SaskTel, Eastlink, Northwestel or Starlink. IPTVMaple includes local CBC, CTV, Global, Citytv, TVA and ICI stations, TSN, Sportsnet, RDS and TVA Sports, from $9 with a free 24-hour trial.</p>",
        body="""
<h2>Local stations in both official languages</h2>
<p>From CTV Vancouver to CBC Halifax and TVA Québec, the lineup carries regional stations across the country, plus ICI Radio-Canada’s regional feeds.</p>
<h2>Every Canadian team</h2>
<p>All seven Canadian NHL teams, the Raptors, the Blue Jays, every CFL club and the Canadian MLS and CPL sides — on TSN, Sportsnet, RDS and TVA Sports.</p>
<h2>Pick your province</h2>
<p>Choose your province or territory for local stations, teams, internet providers and city guides. En français : <a href="/iptv-quebec/">IPTV Québec</a>.</p>
""",
        faq=[
            ("Does IPTV work everywhere in Canada?", "<p>Yes — anywhere with internet, including rural and northern communities using Starlink.</p>"),
            ("Are French channels included?", "<p>Yes: TVA, ICI Radio-Canada, Noovo, Télé-Québec, RDS and TVA Sports.</p>"),
            ("Are prices in Canadian dollars?", "<p>Prices are in US dollars; your bank converts automatically.</p>"),
            ("Is there a free trial?", "<p>Yes, 24 hours of full access with no credit card.</p>"),
        ],
        related=["usa", "iptv-quebec", "best-iptv-canada"], keywords=["canada iptv provinces", "iptv canada province"],
    )
    return [usa, canada]


def all_geo():
    pages = hubs()
    pages += [us_state(s) for s in STATES]
    pages += [us_city(c) for c in US_CITIES if c[0] != "DC"]
    pages += [ca_province(p) for p in PROVINCES]
    pages += [ca_city(c) for c in CA_CITIES]
    pages += [fr_city(c) for c in CA_CITIES if c[0] == "quebec"]
    pages.append(fr_new_brunswick())
    return pages


PAGES = all_geo()
OLD_CITY_SLUGS = {f"iptv-{k}": CA_CITY_SLUG[v] for k, v in [("toronto", "Toronto"), ("montreal", "Montreal"), ("vancouver", "Vancouver"),
                  ("calgary", "Calgary"), ("edmonton", "Edmonton"), ("ottawa", "Ottawa"), ("winnipeg", "Winnipeg"),
                  ("hamilton", "Hamilton"), ("halifax", "Halifax")]}
