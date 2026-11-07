# iptvmapletv.com

The IPTVMaple website: a fast, hand-built static site (no WordPress, no page builder)
hosted on **Cloudflare Pages**.

- Push to `main` → GitHub Actions runs `python build.py` and deploys to production.
- Open a pull request → it gets its own preview URL (shown in the Actions run summary).
- Cloudflare's own Git build is not used (the site needs `python build.py` first). Keep automatic
  deployments off in Pages → Settings → Builds, so only GitHub Actions deploys.

## How it's organised

| Path | What to edit there |
| --- | --- |
| `sitegen/config.py` | Contact details (WhatsApp, email), analytics IDs, promo bar, navigation, footer links |
| `src/data/plans.json` | **Prices**, plan URLs, per-plan SEO title/description, and the plan feature list |
| `src/data/faq.json` | FAQ questions and answers (home, pricing, order pages) |
| `src/data/reviews.json` | Customer reviews and WhatsApp feedback |
| `src/data/recent-orders.json` | Real confirmed orders for the purchase notification card on every page (see `docs/SALES-NOTIFICATIONS.md`) |
| `src/data/channels.json` | The channels list (regions → countries → channels) |
| `src/data/setup-guides.json` | Device setup guides on /how-it-works/ |
| `src/data/media.json` | Channel logos, posters and device logos used on the homepage |
| `src/content/*.html` | Long-form pages (about, legal, guides, landing pages). SEO meta is the JSON at the top of each file |
| `sitegen/pages.py` | Page layouts and section copy (homepage, pricing, order pages, channels…) |
| `sitegen/components.py` | Shared sections: pricing table, FAQ, reviews, forms, CTA band |
| `sitegen/seo_content/*.py` | SEO landing pages (apps, devices, sports, cities, guides, French Québec pages) — one dict per page |
| `sitegen/seo_content/geo*.py` | Location pages: `/usa/{state}/{city}/`, `/canada/{province}/{city}/`, French Quebec `/fr/canada/quebec/…` — data in `geo_us_data.py` / `geo_ca_data.py`, local stations pulled from channels.json |
| `sitegen/seo.py` | The single template every SEO page uses (title block, quick answer, FAQ schema, breadcrumbs, related links) |
| `docs/seo-keyword-map.csv` | Every keyword from the keyword research → the page that targets it, or why it was excluded |
| `src/static/css/site.css` | The whole design system (colours, type, components) — tokens at the top |
| `src/static/js/site.js` | Menu, pricing switcher, channel search, setup tabs, order form |
| `src/static/images/` | Images (old `/wp-content/uploads/...` URLs redirect here) |
| `src/static/_redirects`, `_headers` | Redirects and response headers |
| `functions/api/ajax.js` | Receives order / free-trial / referral forms |
| `worker/worker.js` | Free-trial Worker `iptv-trial-iptvmapletv` (same setup as the other sites): creates the 24h line, emails the login, hourly reminder/follow-up emails. KV `TRIALS` = namespace "iptvmapletv". Secrets on the Worker: `RESEND_KEY`, `PANEL_API_KEY`. Deployed by `.github/workflows/deploy-trial-worker.yml` |
| `functions/api/leads.js` | Lists saved form submissions |
| `tools/` | One-time scripts used to import content from the old WordPress site |

`public/` is generated — never edit it; it's rebuilt on every deploy.

## Build & preview locally

Requires Python 3.12+ (no packages needed).

```bash
python build.py
python -m http.server 8000 --directory public
```

Then open http://localhost:8000. The build fails if any internal link or image is broken.
To also run the form functions locally: `npm install` then `npm run dev` (Wrangler).

## Common edits

- **Change a price:** edit `price` / `original` in `src/data/plans.json`, push.
- **Change the WhatsApp number:** edit the `/go/wa` line at the top of `src/static/_redirects` (every WhatsApp button links to `/go/wa`).
- **Change the success screens** (full-screen checkmark after a free trial or an order): edit `CELEBRATE` in `src/static/js/site.js`. Preview them on any page with `?celebrate=trial` or `?celebrate=order`.
- **Add a FAQ:** add `{"q": "...", "a": "<p>...</p>"}` to `src/data/faq.json`.
- **Add a text page:** create `src/content/<slug>.html` (copy the meta block from an existing one) and
  add it to `PROSE` in `sitegen/pages.py`.
- **Add an SEO page:** copy a dict in `sitegen/seo_content/<cluster>.py`, change slug/title/description/content. It is added to
  its hub page, the sitemap and `llms.txt` automatically. The build fails on duplicate titles/descriptions or broken links.
- **Redirect an old URL:** add `/old/ /new/ 301` near the top of `src/static/_redirects`.

## Form submissions

Orders, free-trial requests and referrals are handled by `functions/api/ajax.js`:

- saved to the Cloudflare KV namespace `iptvmapletv-com-leads` (binding `LEADS`, see `wrangler.toml`);
- viewable at `https://iptvmapletv.com/api/leads?key=<ADMIN_KEY>` (secret variable on the Pages project);
- optionally pushed to any webhook via `NOTIFY_WEBHOOK_URL` (Pages project → Settings → Variables and Secrets);
- a hidden honeypot field silently drops most spam bots;
- successful submissions fire a GA4 `generate_lead` event and a Reddit `Lead` event.

## Deployment secrets (GitHub → Settings → Secrets and variables → Actions)

- `CLOUDFLARE_API_TOKEN` — token with *Cloudflare Pages: Edit* permission
- `CLOUDFLARE_ACCOUNT_ID`
