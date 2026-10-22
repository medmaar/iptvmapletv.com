/**
 * IPTVMaple (iptvmapletv.com) — Free Trial Worker
 * Same setup as the other sites' trial workers (iptv-trial-maplestreamtv, iptv-trial-mojo4kde…):
 * - POST / (from the /try-iptv-canada/ form): creates a 24h line on the activation panel
 *   (or uses DEMO_USERNAME/DEMO_PASSWORD as a shared fallback), stores it in the TRIALS KV namespace
 *   (trial:<email> + the __keys__ index read by iptv-kv-reader), emails the login via Resend and
 *   sends the team a copy
 * - Every hour: T-4h reminder + T=0 follow-up email. The account is at the Workers Free limit of 5 cron
 *   triggers, so .github/workflows/trial-followups.yml calls POST /followups hourly instead (throttled to
 *   one run per 10 minutes; it only sends emails that are due). The scheduled() handler is kept in case
 *   a cron trigger becomes available.
 * - GET /?debug → panel reachability + KV key count (no secrets)
 * Abuse protection: honeypot, email checks, one trial per inbox and per WhatsApp number,
 * 3 trials per IP per day, and a daily cap (TRIAL_DAILY_LIMIT, default 60).
 *
 * Worker secrets (Cloudflare → Workers & Pages → iptv-trial-iptvmapletv → Settings → Variables and Secrets):
 *   RESEND_KEY, PANEL_API_KEY, optional DEMO_USERNAME / DEMO_PASSWORD
 * Deployed by .github/workflows/deploy-trial-worker.yml.
 */

const SITE = "iptvmapletv.com";
const SITE_URL = "https://iptvmapletv.com";
const PANEL_API = "https://activationpanel.ru/api/api.php";
const PANEL_HOST = "http://line.trxdnscloud.ru";
const PANEL_PACK = "USA - All";
const FROM_EMAIL = "IPTVMaple <help@iptvmapletv.com>";
const ADMIN_EMAIL = "help@iptvmapletv.com";
const WA_NUMBER = "17828026280";
const WA_LABEL = "+1 782-802-6280";

const DAY = 24 * 60 * 60;
const TRIAL_HOURS = 24;
const SUBJECT = "Your IPTVMaple free trial is ready — 24h access activated ✓";
const PER_IP_PER_DAY = 3;
const KV_TTL = 30 * DAY;
const ALLOWED_ORIGIN = /^https:\/\/((www\.)?iptvmapletv\.com|([a-z0-9-]+\.)?iptvmapletv-com\.pages\.dev)$/;

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com", "burnermail.io", "moakt.com",
]);

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

// gmail ignores dots and +tags; everyone else ignores +tags. One trial per real inbox.
function inboxKey(email) {
  let [user, domain] = email.toLowerCase().split("@");
  user = user.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") { user = user.replace(/\./g, ""); domain = "gmail.com"; }
  return `${user}@${domain}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const timeout = (ms) => AbortSignal.timeout(ms);

async function createTrial({ name, email, country, whatsapp, ip, env }) {
  const kv = env.TRIALS;
  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: "invalid", message: "Please enter a valid email address." };
  if (DISPOSABLE.has(email.split("@")[1])) return { status: "invalid", message: "Please use your real email address — your login is sent there." };

  const inbox = inboxKey(email);
  const phone = String(whatsapp || "").replace(/\D/g, "");
  const today = new Date().toISOString().slice(0, 10);
  const [byEmail, byInbox, byPhone, ipCount, dayCount] = await Promise.all([
    kv.get(`trial:${email}`),
    kv.get(`inbox:${inbox}`),
    kv.get(`phone:${phone}`),
    ip ? kv.get(`ip:${ip}`) : null,
    kv.get(`day:${today}`),
  ]);
  if (byEmail || byInbox || byPhone) return { status: "duplicate" };
  if (+ipCount >= PER_IP_PER_DAY) return { status: "rate_limited" };
  if (+dayCount >= (+env.TRIAL_DAILY_LIMIT || 60)) return { status: "manual", reason: "daily automatic trial limit reached" };
  if (!env.RESEND_KEY) return { status: "manual", reason: "RESEND_KEY secret not set" };

  // Count the attempt before calling the panel so a burst of requests can't drain panel credits.
  await Promise.all([
    ip && kv.put(`ip:${ip}`, String(+ipCount + 1), { expirationTtl: DAY }),
    kv.put(`day:${today}`, String(+dayCount + 1), { expirationTtl: 2 * DAY }),
  ]);

  let creds;
  try {
    creds = await panelLine(env, email, whatsapp);
  } catch (err) {
    if (env.DEMO_USERNAME && env.DEMO_PASSWORD) {
      console.log(`[create_demo] panel failed (${err.message}), using shared demo login`);
      creds = { username: env.DEMO_USERNAME, password: env.DEMO_PASSWORD, shared: true };
    } else {
      return { status: "manual", reason: `panel: ${err.message}` };
    }
  }

  const { username, password } = creds;
  const m3uUrl = `${PANEL_HOST}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
  const now = Date.now();
  // Same record shape as the other sites, so iptv-kv-reader and the follow-up dashboard read it as-is.
  const trial = { name, email, country, whatsapp, site: SITE, username, password, m3uUrl, expiry: now + TRIAL_HOURS * 3600e3,
                  reminder_sent: false, followup_sent: false, welcome_email_id: null, shared_demo: !!creds.shared, created_at: now };
  // Record the trial before emailing so a retry can never create a second line.
  await Promise.all([
    kv.put(`trial:${email}`, JSON.stringify(trial), { expirationTtl: KV_TTL }),
    kv.put(`inbox:${inbox}`, email, { expirationTtl: 180 * DAY }),
    phone && kv.put(`phone:${phone}`, email, { expirationTtl: 180 * DAY }),
  ]);
  try {
    const keys = JSON.parse((await kv.get("__keys__")) || "[]");
    if (!keys.includes(email)) { keys.push(email); await kv.put("__keys__", JSON.stringify(keys), { expirationTtl: 90 * DAY }); }
  } catch (err) { console.error("__keys__ update failed", err.message); }

  try {
    trial.welcome_email_id = await sendEmail(env, email, SUBJECT, welcomeEmail(name, username, password, m3uUrl));
    await kv.put(`trial:${email}`, JSON.stringify(trial), { expirationTtl: KV_TTL });
  } catch (err) {
    return { status: "manual", reason: `email: ${err.message}`, trial };
  }
  return { status: "sent", trial };
}

async function notifyTeam(env, trial, extra) {
  try {
    await sendEmail(env, env.TRIAL_ADMIN_EMAIL || ADMIN_EMAIL, `Automation / ${SITE} / trial / ${trial.name} / ${trial.email}`, adminEmail(trial, extra));
  } catch (err) { console.error("[email_admin]", err.message); }
}

// ------------------------------------------------------------------ HTTP
function cors(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN.test(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

async function handleFetch(request, env) {
  const headers = cors(request);
  const res = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { headers });

  if (request.method === "GET") {
    if (new URL(request.url).searchParams.has("debug")) {
      let panel;
      try { panel = env.PANEL_API_KEY ? (await panelGet(env, { action: "reseller_info" }), "reachable") : "PANEL_API_KEY not set"; }
      catch (err) { panel = `error: ${err.message}`; }
      const keys = JSON.parse((await env.TRIALS.get("__keys__")) || "[]");
      return res({ panel, resend_key_set: !!env.RESEND_KEY, demo_fallback_set: !!(env.DEMO_USERNAME && env.DEMO_PASSWORD), kv_keys: keys.length });
    }
    return new Response("IPTVMaple Trial Worker — OK", { headers });
  }
  if (request.method !== "POST") return res({ success: false, error: "POST only" }, 405);

  if (new URL(request.url).pathname === "/followups") {
    if (await env.TRIALS.get("followups:last")) return res({ ok: true, skipped: "ran in the last 10 minutes" });
    await env.TRIALS.put("followups:last", new Date().toISOString(), { expirationTtl: 600 });
    return res({ ok: true, ...(await handleScheduled(env)) });
  }

  let body;
  try { body = await request.json(); } catch { return res({ success: false, error: "Invalid JSON" }, 400); }
  const get = (k) => String(body[k] || "").trim().slice(0, 120);
  // Honeypot: real visitors never see or fill the "website" field; pretend success for bots.
  if (get("website")) return res({ success: true });
  const name = get("name"), email = get("email"), whatsapp = get("whatsapp"), country = get("country");
  if (!name || !email || whatsapp.replace(/\D/g, "").length < 7) {
    return res({ success: false, message: "Please fill in your first name, email and WhatsApp number." }, 400);
  }

  let result;
  try {
    result = await createTrial({ name, email, country, whatsapp, ip: request.headers.get("CF-Connecting-IP"), env });
  } catch (err) {
    result = { status: "manual", reason: `error: ${err.message}` };
  }
  if (result.trial) {
    await notifyTeam(env, result.trial, { page: get("page"), ipCountry: request.cf?.country, emailed: result.status === "sent", reason: result.reason });
  }
  switch (result.status) {
    case "sent": return res({ success: true, email: result.trial.email });
    case "invalid": return res({ success: false, message: result.message }, 400);
    case "duplicate":
      return res({ success: false, message: "A free trial was already sent to this email or WhatsApp number. Check your inbox and spam folder, or message us on WhatsApp for help." }, 409);
    case "rate_limited":
      return res({ success: false, message: "Too many trial requests from your connection today. Please message us on WhatsApp and we’ll help you right away." }, 429);
    default:
      // Not automated (missing secret, panel or email failure, daily cap): the site falls back to the
      // manual lead form so the team sends the trial by hand.
      console.error("[manual]", result.reason);
      return res({ success: false, manual: true }, 503);
  }
}

// ------------------------------------------------------------------ cron
async function handleScheduled(env) {
  const now = Date.now();
  const FOUR_HOURS = 4 * 3600e3;
  const emails = JSON.parse((await env.TRIALS.get("__keys__")) || "[]");
  console.log(`[cron] Checking ${emails.length} trials`);
  let reminders = 0, followups = 0;
  for (const email of emails) {
    const key = `trial:${email}`;
    let trial;
    try { const raw = await env.TRIALS.get(key); if (!raw) continue; trial = JSON.parse(raw); } catch { continue; }
    const { name, username, password, m3uUrl, expiry, welcome_email_id } = trial;

    if (!trial.reminder_sent && now >= expiry - FOUR_HOURS && now < expiry) {
      try {
        await sendEmail(env, email, SUBJECT, reminderEmail(name, username, password, m3uUrl), welcome_email_id);
        trial.reminder_sent = true;
        await env.TRIALS.put(key, JSON.stringify(trial), { expirationTtl: KV_TTL });
        reminders++;
        console.log(`[cron] Reminder → ${email}`);
      } catch (e) { console.error(`[cron] Reminder failed ${email}:`, e.message); }
    }
    if (!trial.followup_sent && now >= expiry) {
      try {
        await sendEmail(env, email, SUBJECT, followupEmail(name), welcome_email_id);
        trial.followup_sent = true;
        await env.TRIALS.put(key, JSON.stringify(trial), { expirationTtl: KV_TTL });
        followups++;
        console.log(`[cron] Follow-up → ${email}`);
      } catch (e) { console.error(`[cron] Follow-up failed ${email}:`, e.message); }
    }
  }
  return { trials: emails.length, reminders, followups };
}

export default {
  async fetch(request, env) { return tkLogoResponse(request) || handleFetch(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(handleScheduled(env)); },
};

async function panelGet(env, params) {
  const qs = new URLSearchParams({ ...params, api_key: env.PANEL_API_KEY });
  const res = await fetch(`${PANEL_API}?${qs}`, { signal: timeout(12000) });
  const text = (await res.text()).trim();
  if (!text.startsWith("[") && !text.startsWith("{")) throw new Error(`non-JSON reply: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

async function panelLine(env, email, whatsapp) {
  if (!env.PANEL_API_KEY) throw new Error("PANEL_API_KEY secret not set");
  let pack = "all";
  try {
    const list = await panelGet(env, { action: "bouquet" });
    const found = (Array.isArray(list) ? list : Object.values(list)).find((b) => (b.name || "").trim().toLowerCase() === PANEL_PACK.toLowerCase());
    if (found) pack = found.id;
  } catch (err) { console.log("trial: bouquet lookup failed", err.message); }

  const data = await panelGet(env, { action: "new", type: "m3u", sub: "99", pack, notes: `Trial / ${SITE} / ${email} | ${whatsapp || ""}` });
  const item = Array.isArray(data) ? data[0] : data;
  if (!item || String(item.status) !== "true") throw new Error(item?.message || JSON.stringify(item).slice(0, 160));
  const u = new URL(item.url || "");
  const username = u.searchParams.get("username"), password = u.searchParams.get("password");
  if (!username || !password) throw new Error("no username/password in panel reply");
  return { username, password };
}

async function sendEmail(env, to, subject, html, inReplyTo = null) {
  const payload = { from: env.TRIAL_FROM_EMAIL || FROM_EMAIL, reply_to: ADMIN_EMAIL, to, subject, html };
  // Reminder and follow-up thread under the welcome email.
  if (inReplyTo) payload.headers = { "In-Reply-To": `<${inReplyTo}>`, References: `<${inReplyTo}>` };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: timeout(10000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).id || null;
}

// ------------------------------------------------------------------ emails
// ── trial emails (generated by trial-emails/build.mjs from kit.js, sites.mjs and text.mjs; edit those, not this block) ──

const EMAIL_BRAND = {
  "name": "IPTVMaple",
  "domain": "iptvmapletv.com",
  "url": "https://iptvmapletv.com",
  "lang": "en",
  "email": "help@iptvmapletv.com",
  "logo": {
    "src": "https://iptv-trial-iptvmapletv.medmaar.workers.dev/email/logo.png?v=2",
    "w": 190,
    "h": 44
  },
  "c": {
    "page": "#F2F3F5",
    "card": "#FFFFFF",
    "head": "#06070B",
    "headLine": "#06070B",
    "ink": "#14171F",
    "body": "#4B5161",
    "muted": "#8A8F9C",
    "line": "#E6E8EC",
    "box": "#F7F8FA",
    "accent": "#CC243B",
    "btn": "#FF2D4A",
    "onBtn": "#FFFFFF",
    "step": "#06070B"
  },
  "wa": "17828026280",
  "waLabel": "+1 782-802-6280",
  "host": PANEL_HOST,
  "replyYes": false,
  "noName": [
    "nicht angegeben",
    "non renseigné",
    "ikke oppgitt",
    "not provided",
    "-",
    "—"
  ],
  "plansUrl": "/iptv-plans-canada/",
  "money": {
    "pre": "$",
    "post": "",
    "dec": "."
  },
  "grid": [
    {
      "devices": 1,
      "plans": [
        {
          "months": 1,
          "price": 9,
          "url": "/1-month-iptv-canada/"
        },
        {
          "months": 6,
          "price": 39,
          "url": "/6-month-iptv-unlimited/"
        },
        {
          "months": 12,
          "price": 49,
          "url": "/12-month-iptv-unlimited/"
        }
      ]
    },
    {
      "devices": 2,
      "plans": [
        {
          "months": 1,
          "price": 18,
          "url": "/best-iptv-for-2-devices-monthly/"
        },
        {
          "months": 6,
          "price": 69,
          "url": "/6-months-iptv-subscription/"
        },
        {
          "months": 12,
          "price": 89,
          "url": "/12-month-iptv-2-devices/"
        }
      ]
    },
    {
      "devices": 3,
      "plans": [
        {
          "months": 1,
          "price": 27,
          "url": "/1-month-iptv-3-devices/"
        },
        {
          "months": 6,
          "price": 105,
          "url": "/6-month-iptv-3-devices/"
        },
        {
          "months": 12,
          "price": 135,
          "url": "/iptvmaple-premium-iptv-streaming-for-ultimate-entertainment/"
        }
      ]
    },
    {
      "devices": 4,
      "plans": [
        {
          "months": 1,
          "price": 36,
          "url": "/1-month-iptv-4-devices/"
        },
        {
          "months": 6,
          "price": 140,
          "url": "/6-month-iptv-4-devices/"
        },
        {
          "months": 12,
          "price": 180,
          "url": "/12-month-iptv-4-devices/"
        }
      ]
    },
    {
      "devices": 5,
      "plans": [
        {
          "months": 1,
          "price": 45,
          "url": "/iptv-subscription-2/"
        },
        {
          "months": 6,
          "price": 175,
          "url": "/6-month-iptv-5-devices/"
        },
        {
          "months": 12,
          "price": 225,
          "url": "/12-month-iptv-canada/"
        }
      ]
    }
  ]
};

// IPTVMaple header logo (PNG), served at /email/logo.png for the emails.
const EMAIL_LOGO_PNG = "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";

const EMAIL_TEXT = {
  "hi": "Hi {name},",
  "hiAnon": "Hi there,",
  "w_pre": "Your login details are inside. Setup takes about 2 minutes.",
  "w_intro": "Thank you for choosing {brand}. Your 24-hour free trial is active now, with every channel, movie and series unlocked. Here are your login details.",
  "loginTitle": "Your login details",
  "loginAgain": "Your login details (unchanged)",
  "xtream": "Xtream Codes",
  "server": "Server",
  "username": "Username",
  "password": "Password",
  "m3u": "M3U link",
  "howTitle": "How to set it up",
  "steps": [
    [
      "Install an IPTV app",
      "IPTV Smarters Pro or TiviMate work on Firestick, Android TV, Smart TVs, iPhone, Android and PC."
    ],
    [
      "Add your account",
      "Choose <strong>Xtream Codes</strong> and enter the server, username and password above. If your app asks for a playlist link, paste the M3U link instead."
    ],
    [
      "Start watching",
      "Open Live TV, Movies or Series. Everything is unlocked for 24 hours."
    ]
  ],
  "helpSetup": "Need help with the setup?",
  "helpPlans": "Questions before you subscribe?",
  "helpChoose": "Not sure which plan is right for you?",
  "helpLine": "Reply to this email or message us on {wa}. We usually answer within minutes.",
  "signWelcome": "Enjoy your trial,",
  "signFollow": "Best regards,",
  "team": "The {brand} Team",
  "r_pre": "About 4 hours left. Subscribe now and keep the same login.",
  "r_hello": "Just a quick heads-up about your free trial.",
  "r_title": "Your trial ends in about 4 hours",
  "r_text": "Enjoying {brand}? Subscribe now and keep watching without interruption. Your login stays exactly the same, so there is nothing to set up again.",
  "f_pre": "Your trial has ended. Pick a plan and you are back on the same login within minutes.",
  "f_hello": "Thank you for trying {brand}.",
  "f_title": "Your free trial has ended",
  "f_text": "Subscribe today and you are back on the same login within minutes, with every channel, movie and series.",
  "f_from": "Plans start at {price}.",
  "subscribe": "Subscribe now",
  "plansTitle": "Choose your plan",
  "plansSub": "Tap any plan to go straight to its page.",
  "device1": "1 Device",
  "deviceN": "{n} Devices",
  "screens1": "watch on one screen",
  "screensN": "watch on {n} screens at once",
  "m1": "1 Month",
  "mN": "{n} Months",
  "year": "1 Year",
  "buy": "Buy",
  "replyYes": "Prefer to skip the form? Reply <strong>YES</strong> to this email and we will activate your subscription for you.",
  "footerWhy": "You are receiving this email because you requested a free trial on {domain}.",
  "plansLink": "Plans",
  "waText": "Hi {brand}! I have a question about my free trial."
};

// Trial email kit: welcome, 4-hours-left reminder and trial-ended follow-up.
// Simple layout: the site's logo on top, a greeting, the login details as the highlight,
// then the setup steps. The two follow-ups invite the customer to subscribe and list
// every plan from 1 to 5 devices, each one linking to its own page.
// Table-based and inline-styled so it holds up in Gmail, Outlook, Apple Mail and Yahoo.
// Needs EMAIL_BRAND (site look, plans, contacts) and EMAIL_TEXT (copy) defined above it.

const TK_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const TK_MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace";

function tkEsc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tkFmt(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function tkT(key, vars = {}) {
  return tkFmt(EMAIL_TEXT[key], { brand: tkEsc(EMAIL_BRAND.name), domain: EMAIL_BRAND.domain, ...vars });
}

function tkHi(name) {
  const full = String(name || "").trim();
  const first = full.split(/\s+/)[0] || "";
  if (!first || EMAIL_BRAND.noName.includes(full.toLowerCase())) return EMAIL_TEXT.hiAnon;
  return tkFmt(EMAIL_TEXT.hi, { name: tkEsc(first) });
}

function tkMoney(n) {
  const m = EMAIL_BRAND.money;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", m.dec);
  return m.pre + s + m.post;
}

function tkLink(url, campaign) {
  const abs = /^https?:/.test(url) ? url : EMAIL_BRAND.url + url;
  return abs + (abs.includes("?") ? "&" : "?") + "utm_source=trial_email&utm_medium=email&utm_campaign=" + campaign;
}

function tkWa() {
  return `https://wa.me/${EMAIL_BRAND.wa}?text=${encodeURIComponent(tkFmt(EMAIL_TEXT.waText, { brand: EMAIL_BRAND.name }).replace(/&nbsp;/g, " "))}`;
}

function tkServer(m3uUrl) {
  try { return new URL(m3uUrl).origin; } catch { return EMAIL_BRAND.host; }
}

// The site logo is served by this Worker, so it never depends on the website's own hosting.
function tkLogoResponse(request) {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/email/logo.png") return null;
  const bin = atob(EMAIL_LOGO_PNG);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
}

// ── building blocks ───────────────────────────────────────────────────────────

function tkShell(preheader, body) {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  return `<!DOCTYPE html>
<html lang="${B.lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${tkEsc(B.name)}</title>
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    .tk-outer { padding:12px 8px !important; }
    .tk-pad { padding-left:22px !important; padding-right:22px !important; }
    .tk-box { padding-left:18px !important; padding-right:18px !important; }
    .tk-lbl { display:block !important; width:100% !important; padding:12px 0 2px !important; }
    .tk-val { display:block !important; width:100% !important; padding:0 0 12px !important; border-top:0 !important; }
    .tk-cell { display:inline-block !important; width:50% !important; box-sizing:border-box; }
    .tk-cl { padding:0 4px 8px 0 !important; }
    .tk-cr { padding:0 0 8px 4px !important; }
    .tk-h1 { font-size:22px !important; line-height:29px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${C.page};" bgcolor="${C.page}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" class="tk-outer" style="padding:24px 10px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="max-width:600px;background-color:${C.card};border-radius:10px;border-collapse:separate;font-family:${TK_FONT};">
  <tr><td align="center" bgcolor="${C.head}" style="background-color:${C.head};border-bottom:1px solid ${C.headLine};border-radius:10px 10px 0 0;padding:24px 20px;">
    <a href="${tkLink("/", "header")}" target="_blank" style="text-decoration:none;"><img src="${B.logo.src}" width="${B.logo.w}" height="${B.logo.h}" alt="${tkEsc(B.name)}" style="display:block;margin:0 auto;width:${B.logo.w}px;max-width:100%;height:auto;color:${C.head === "#FFFFFF" ? C.ink : "#FFFFFF"};font:700 22px ${TK_FONT};"></a>
  </td></tr>
  ${body}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${TK_FONT};">
  <tr><td align="center" style="padding:20px 16px 4px;font-size:12px;line-height:20px;color:${C.muted};">
    <a href="${tkLink("/", "footer")}" target="_blank" style="color:${C.muted};text-decoration:none;">${B.domain}</a>
    &nbsp;&middot;&nbsp; <a href="${tkLink(B.plansUrl, "footer")}" target="_blank" style="color:${C.muted};text-decoration:none;">${T.plansLink}</a>
    &nbsp;&middot;&nbsp; <a href="${tkWa()}" target="_blank" style="color:${C.muted};text-decoration:none;">WhatsApp</a>
    &nbsp;&middot;&nbsp; <a href="mailto:${B.email}" style="color:${C.muted};text-decoration:none;">${B.email}</a><br>
    ${tkT("footerWhy")}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function tkRow(inner, pad = "0 40px 28px") {
  return `<tr><td class="tk-pad" style="padding:${pad};">${inner}</td></tr>`;
}

function tkP(html, style = "") {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:25px;color:${EMAIL_BRAND.c.body};${style}">${html}</p>`;
}

function tkH2(text) {
  return `<div style="margin:0 0 12px;font-size:17px;line-height:24px;font-weight:700;color:${EMAIL_BRAND.c.ink};">${text}</div>`;
}

function tkGreeting(name, text) {
  const C = EMAIL_BRAND.c;
  return tkRow(tkP(tkHi(name), `color:${C.ink};font-weight:600;`) + tkP(text, "margin:0;"), "32px 40px 24px");
}

function tkLabel(text, top) {
  const C = EMAIL_BRAND.c;
  return `<div style="margin:${top ? "16px 0 8px;padding-top:14px;border-top:1px solid " + C.line : "14px 0 2px"};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.accent};">${text}</div>`;
}

// The login details: the one thing the customer needs from these emails.
function tkLogins(username, password, m3uUrl, again) {
  const C = EMAIL_BRAND.c, T = EMAIL_TEXT;
  const server = tkServer(m3uUrl);
  const field = (k, v, first) => `
        <tr>
          <td class="tk-lbl" width="120" valign="top" style="padding:12px 0;${first ? "" : `border-top:1px solid ${C.line};`}font-size:14px;line-height:22px;color:${C.muted};">${k}</td>
          <td class="tk-val" style="padding:12px 0;${first ? "" : `border-top:1px solid ${C.line};`}font-family:${TK_MONO};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};word-break:break-all;">${v}</td>
        </tr>`;
  return tkRow(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.box}" style="background-color:${C.box};border:1px solid ${C.line};border-top:3px solid ${C.btn};border-radius:8px;border-collapse:separate;">
      <tr><td class="tk-box" style="padding:22px 26px 6px;">
        <div style="font-size:18px;line-height:24px;font-weight:700;color:${C.ink};">${again ? T.loginAgain : T.loginTitle}</div>
        ${tkLabel(T.xtream)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${field(T.server, `<a href="${tkEsc(server)}" style="color:${C.ink};text-decoration:none;">${tkEsc(server)}</a>`, true)}
          ${field(T.username, tkEsc(username))}
          ${field(T.password, tkEsc(password))}
        </table>
        ${tkLabel(T.m3u, true)}
        <div style="margin:0 0 18px;padding:12px 14px;background-color:${C.card};border:1px solid ${C.line};border-radius:6px;font-family:${TK_MONO};font-size:14px;line-height:21px;color:${C.ink};word-break:break-all;"><a href="${tkEsc(m3uUrl)}" style="color:${C.ink};text-decoration:none;">${tkEsc(m3uUrl)}</a></div>
      </td></tr>
    </table>`);
}

function tkSteps() {
  const C = EMAIL_BRAND.c;
  const rows = EMAIL_TEXT.steps.map(([title, text], i) => `
      <tr>
        <td width="36" valign="top" style="padding:0 0 14px;"><div style="width:24px;height:24px;line-height:24px;border-radius:12px;background-color:${C.step};color:#FFFFFF;font-size:13px;font-weight:700;text-align:center;">${i + 1}</div></td>
        <td valign="top" style="padding:2px 0 14px;font-size:15px;line-height:23px;color:${C.body};"><strong style="color:${C.ink};">${title}.</strong> ${text}</td>
      </tr>`).join("");
  return tkRow(tkH2(EMAIL_TEXT.howTitle) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`, "4px 40px 18px");
}

function tkHelp(question, sign) {
  const B = EMAIL_BRAND, C = B.c;
  const wa = `<a href="${tkWa()}" target="_blank" style="color:${C.accent};font-weight:700;text-decoration:none;">WhatsApp (${B.waLabel.replace(/ /g, "&nbsp;").replace(/-/g, "&#8209;")})</a>`;
  return tkRow(`
    <div style="border-top:1px solid ${C.line};padding-top:24px;">
      ${tkP(`${question} ${tkT("helpLine", { wa })}`)}
      ${tkP(`${sign}<br><strong style="color:${C.ink};">${tkT("team")}</strong>`, "margin:0;")}
    </div>`, "0 40px 36px");
}

function tkButton(href, label) {
  const C = EMAIL_BRAND.c;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="${C.btn}" style="background-color:${C.btn};border-radius:6px;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${TK_FONT};font-size:16px;line-height:20px;font-weight:700;color:${C.onBtn};text-decoration:none;border-radius:6px;">${label}</a>
      </td>
    </tr></table>`;
}

function tkInvite(title, text, campaign) {
  const C = EMAIL_BRAND.c;
  return tkRow(`
    <div class="tk-h1" style="margin:0 0 10px;font-size:24px;line-height:31px;font-weight:800;color:${C.ink};">${title}</div>
    ${tkP(text)}
    <div style="padding-top:6px;">${tkButton(tkLink(EMAIL_BRAND.plansUrl, campaign), EMAIL_TEXT.subscribe)}</div>`, "0 40px 32px");
}

function tkTerm(m) {
  const T = EMAIL_TEXT;
  return m === 1 ? T.m1 : m === 12 ? T.year : tkFmt(T.mN, { n: m });
}

// Every plan for 1 to 5 devices; each tile links straight to that plan's page.
function tkPlans(campaign) {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  const groups = B.grid.map(g => {
    const n = g.plans.length;
    const four = n === 4;
    const cells = g.plans.map((p, i) => `<td class="${four ? `tk-cell ${i % 2 ? "tk-cr" : "tk-cl"}` : ""}" width="${Math.floor(100 / n)}%" valign="top" style="padding:0 ${i < n - 1 ? 8 : 0}px 0 0;"><a href="${tkLink(p.url, campaign)}" target="_blank" style="display:block;padding:12px 4px;border:1px solid ${C.line};border-radius:8px;background-color:${C.card};text-align:center;text-decoration:none;">
          <span style="display:block;font-size:13px;line-height:18px;color:${C.body};">${tkTerm(p.months)}</span>
          <span style="display:block;margin-top:4px;font-size:22px;line-height:28px;font-weight:700;color:${C.ink};white-space:nowrap;">${tkMoney(p.price)}</span>
          <span style="display:block;margin-top:6px;font-size:12px;line-height:16px;font-weight:700;color:${C.accent};">${T.buy}&nbsp;&rarr;</span>
        </a></td>`).join("");
    const d = g.devices;
    return `
      <div style="margin:0 0 10px;font-size:14px;line-height:20px;font-weight:700;color:${C.ink};">${d === 1 ? T.device1 : tkFmt(T.deviceN, { n: d })}<span style="font-weight:400;color:${C.muted};">&nbsp;&nbsp;&middot;&nbsp;&nbsp;${d === 1 ? T.screens1 : tkFmt(T.screensN, { n: d })}</span></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>${cells}</tr></table>`;
  }).join("");
  return tkRow(tkH2(T.plansTitle) + tkP(T.plansSub, "margin:-6px 0 18px;font-size:14px;line-height:21px;") + groups, "0 40px 12px");
}

function tkReplyYes() {
  const B = EMAIL_BRAND, C = B.c;
  if (!B.replyYes) return "";
  return tkRow(`<div style="padding:16px 20px;background-color:${C.box};border-radius:8px;font-size:15px;line-height:23px;color:${C.body};">${EMAIL_TEXT.replyYes.replace("<strong>", `<strong style="color:${C.ink};">`)}</div>`);
}

function tkFrom() {
  const p = Math.min(...EMAIL_BRAND.grid[0].plans.map(x => x.price));
  return tkT("f_from", { price: tkMoney(p) });
}

// ── the three customer emails ─────────────────────────────────────────────────

function welcomeEmail(name, username, password, m3uUrl) {
  const T = EMAIL_TEXT;
  return tkShell(T.w_pre, `
    ${tkGreeting(name, tkT("w_intro"))}
    ${tkLogins(username, password, m3uUrl)}
    ${tkSteps()}
    ${tkHelp(T.helpSetup, T.signWelcome)}`);
}

function reminderEmail(name, username, password, m3uUrl) {
  const T = EMAIL_TEXT;
  return tkShell(T.r_pre, `
    ${tkGreeting(name, tkT("r_hello"))}
    ${tkInvite(T.r_title, tkT("r_text"), "trial_reminder")}
    ${tkPlans("trial_reminder")}
    ${tkReplyYes()}
    ${tkLogins(username, password, m3uUrl, true)}
    ${tkHelp(T.helpPlans, T.signFollow)}`);
}

function followupEmail(name) {
  const T = EMAIL_TEXT;
  return tkShell(T.f_pre, `
    ${tkGreeting(name, tkT("f_hello"))}
    ${tkInvite(T.f_title, `${tkT("f_text")} ${tkFrom()}`, "trial_followup")}
    ${tkPlans("trial_followup")}
    ${tkReplyYes()}
    ${tkHelp(T.helpChoose, T.signFollow)}`);
}

// ── end trial emails ──

function adminEmail(t, extra) {
  const r = (k, v) => `<tr><td style="color:#888;width:120px;">${k}</td><td>${esc(v || "—")}</td></tr>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;padding:20px;">
  <h2 style="color:#ff2d4a;margin-top:0;">New free trial — ${SITE}</h2>
  <table cellpadding="6" cellspacing="0" border="0">
    ${r("Name", t.name)}${r("Email", t.email)}${r("Country", t.country)}${r("WhatsApp", t.whatsapp)}${r("Page", extra.page)}${r("IP country", extra.ipCountry)}
    <tr><td colspan="2"><hr style="border:none;border-top:1px solid #eee;margin:8px 0;"></td></tr>
    ${r("Username", t.username)}${r("Password", t.password)}${r("M3U", t.m3uUrl)}
    ${r("Login type", t.shared_demo ? "Shared demo login (panel could not create a line)" : "New panel line, 24h")}
    ${r("Customer email", extra.emailed === false ? "NOT SENT — " + (extra.reason || "") : "Sent")}
  </table></body></html>`;
}
