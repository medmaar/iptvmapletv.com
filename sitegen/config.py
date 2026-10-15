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

PROMO = ("🎁 Refer 1 friend · get 6 months FREE", "/refer-a-friend/")

NAV = [
    ("Home", "/"),
    ("Pricing", "/iptv-plans-canada/"),
    ("Channels", "/channels-list/"),
    ("How it works", "/how-it-works/"),
    ("Referral", "/refer-a-friend/"),
    ("Free trial", "/try-iptv-canada/"),
    ("Contact", "/contact/"),
]

FOOTER = [
    ("Service", [("Pricing", "/iptv-plans-canada/"), ("Free 24h trial", "/try-iptv-canada/"), ("Channels list", "/channels-list/"), ("How it works", "/how-it-works/")]),
    ("Company", [("About us", "/about-iptvmaple/"), ("Referral program", "/refer-a-friend/"), ("Contact us", "/contact/"), ("Cord-cutting guide", "/cord-cutting-guide/")]),
    ("Guides", [("All IPTV guides", "/iptv-guides/"), ("Best IPTV Canada", "/best-iptv-canada/"), ("IPTV price", "/iptv-price/"), ("IPTV providers", "/iptv-providers/"),
                ("Is IPTV legal?", "/is-iptv-legal-in-canada/"), ("IPTV apps", "/iptv-apps/"), ("IPTV devices", "/iptv-devices/"), ("Sports IPTV", "/iptv-sports/"),
                ("IPTV near me", "/iptv-near-me/"), ("IPTV Canada", "/canada/"), ("IPTV USA", "/usa/"), ("International IPTV", "/iptv-international/"),
                ("IPTV Québec (FR)", "/iptv-quebec/")]),
    ("Legal", [("Terms & conditions", "/terms/"), ("Privacy policy", "/privacy/"), ("Refund policy", "/refund/"), ("Disclaimer (DMCA)", "/disclaimer/")]),
]
