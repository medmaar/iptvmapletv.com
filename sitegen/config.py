"""Site-wide settings. Change contact details, analytics IDs and navigation here."""
from urllib.parse import quote

SITE_URL = "https://iptvmapletv.com"
NAME = "IPTVMaple"
LEGAL_NAME = "IPTVMaple 4K"
TAGLINE = "Premium 4K IPTV for Canada"
DEFAULT_OG = "/brand/og-default.jpg"
YEAR = 2026

EMAIL = "help@iptvmapletv.com"
EMAIL_SUBJECT = "Hi IPTVmaple - question about your IPTV service"
EMAIL_BODY = "Hi IPTVmaple,\n\nI am interested in your IPTV service and would like to get more information.\n\nThank you."
MAILTO = f"mailto:{EMAIL}?subject={quote(EMAIL_SUBJECT)}&body={quote(EMAIL_BODY)}"

# Every WhatsApp button links to /go/wa. That path redirects to the real number
# (see src/static/_redirects), so each website has its own link and the number
# can be changed in one place.
WHATSAPP_URL = "/go/wa"

# Free-trial worker (worker/worker.js): creates the trial line and emails the login.
TRIAL_WORKER_URL = "https://iptv-trial-iptvmapletv.medmaar.workers.dev"

GOOGLE_TAGS = ["GT-WF62KHHF", "G-JJR5ECP8RV"]
REDDIT_PIXEL = "a2_g8z3rkvzo68a"
GOOGLE_SITE_VERIFICATION = "9QinAgZmvCoRQKS99jjmNbTDzV5TcQVUZ8VnO2poI0M"

PROMO = ("🎁 Refer 1 friend · get 6 months FREE", "/ca/refer-a-friend/")

NAV = [
    ("Home", "/ca/"),
    ("Pricing", "/ca/iptv-plans-canada/"),
    ("Channels", "/ca/channels-list/"),
    ("How it works", "/ca/how-it-works/"),
    ("Referral", "/ca/refer-a-friend/"),
    ("Free trial", "/ca/try-iptv-canada/"),
    ("Contact", "/ca/contact/"),
]

FOOTER = [
    ("Service", [("Pricing", "/ca/iptv-plans-canada/"), ("Free 24h trial", "/ca/try-iptv-canada/"), ("Channels list", "/ca/channels-list/"), ("How it works", "/ca/how-it-works/")]),
    ("Company", [("About us", "/ca/about-iptvmaple/"), ("Referral program", "/ca/refer-a-friend/"), ("Contact us", "/ca/contact/"), ("Cord-cutting guide", "/ca/cord-cutting-guide/")]),
    ("Guides", [("All IPTV guides", "/ca/iptv-guides/"), ("Best IPTV Canada", "/ca/best-iptv-canada/"), ("IPTV price", "/ca/iptv-price/"), ("IPTV providers", "/ca/iptv-providers/"),
                ("Is IPTV legal?", "/ca/is-iptv-legal-in-canada/"), ("IPTV apps", "/ca/iptv-apps/"), ("IPTV devices", "/ca/iptv-devices/"), ("Sports IPTV", "/ca/iptv-sports/"),
                ("IPTV near me", "/ca/iptv-near-me/"), ("IPTV Canada", "/ca/canada/"), ("IPTV USA", "/ca/usa/"), ("International IPTV", "/ca/iptv-international/"),
                ("IPTV Québec (FR)", "/ca/iptv-quebec/")]),
    ("Legal", [("Terms & conditions", "/ca/terms/"), ("Privacy policy", "/ca/privacy/"), ("Refund policy", "/ca/refund/"), ("Disclaimer (DMCA)", "/ca/disclaimer/")]),
]
