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
  async fetch(request, env) { return handleFetch(request, env); },
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
  "emoji": "🍁",
  "logo": null,
  "tagline": "Live TV, sports, movies &amp; series in 4K",
  "accent": "#FF2D4A",
  "accent2": "#E0247A",
  "accentText": "#FF2D4A",
  "onAccent": "#FFFFFF",
  "badgeInk": "#FF2D4A",
  "c": {
    "page": "#06070B",
    "surface": "#111216",
    "raised": "#1B1C20",
    "line": "#303134",
    "soft": "#E6E6E7",
    "text": "#CDCDCE",
    "muted": "#969799",
    "faint": "#767779"
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
  "deviceLabel": "",
  "plans": [
    {
      "months": 1,
      "price": 9,
      "url": "/1-month-iptv-canada/",
      "was": 18
    },
    {
      "months": 6,
      "price": 39,
      "url": "/6-month-iptv-unlimited/",
      "was": 78
    },
    {
      "months": 12,
      "price": 49,
      "url": "/12-month-iptv-unlimited/",
      "was": 98
    }
  ],
  "highlights": [
    [
      "🥊",
      "PPV, UFC, Boxing &amp; F1"
    ],
    [
      "🏀",
      "NBA, NHL &amp; NFL packages"
    ],
    [
      "🎬",
      "300,000+ movies &amp; series"
    ]
  ]
};

const EMAIL_TEXT = {
  "hi": "Hi {name},",
  "hiAnon": "Hi there,",
  "teamSign": "See you on the big screen,",
  "team": "The {brand} Team",
  "xtream": "Xtream Codes login",
  "server": "Server",
  "username": "Username",
  "password": "Password",
  "m3u": "M3U link",
  "m3uHint": "For apps that ask for a single playlist link",
  "passLabel": "Your access pass",
  "admit": "Admit 1 · 24h",
  "credsAgain": "Your login, in case you need it",
  "w_pre": "Your 24-hour pass is live. Your login is inside and setup takes about 2 minutes.",
  "w_eyebrow": "Free trial activated",
  "w_title": "Your 24-hour pass is live.",
  "w_lead": "We've unlocked every country and every language so you can test absolutely everything. Go on, push it to its limits.",
  "w_note": "Channel list feels long? Just ask and we'll hide the regions or categories you don't need.",
  "stepsTitle": "On screen in 3 steps",
  "steps": [
    [
      "Install an IPTV app",
      "IPTV Smarters Pro, TiviMate or IBO Player, on Firestick, Smart TV, Android, iPhone or PC."
    ],
    [
      "Enter your login",
      "Choose Xtream Codes and type in the server, username and password above, or paste the M3U link."
    ],
    [
      "Press play",
      "Open Live TV and enjoy. That's it."
    ]
  ],
  "tryTitle": "Try these before your pass runs out",
  "helpBtn": "💬 Need a hand? WhatsApp us",
  "helpLine": "Or just reply to this email. Real people, quick answers.",
  "r_pre": "About 4 hours left on your free trial. Keep the same login and make it permanent.",
  "r_eyebrow": "Trial ending soon",
  "r_title": "4 hours left on your pass.",
  "r_lead": "Don't let the screen go dark. Keep the same login, the same quality and every channel. Just make it permanent.",
  "r_used": "20h watched",
  "r_left": "4h left",
  "f_pre": "Your free trial has ended. Pick a plan and you're back in within minutes.",
  "f_eyebrow": "Trial ended",
  "f_title": "That was the trailer.<br>Ready for the full movie?",
  "f_lead": "Your 24 hours are up, but everything you watched is still right here. Pick a plan below and you'll be back in within minutes, with the same quality and no interruptions.",
  "plansTitle": "Pick your plan",
  "plansSub": "Tap a plan to open its page and order in about a minute.",
  "perMonth": "just {price} a month",
  "perMonthShort": "{price} a month",
  "m1": "1 Month",
  "mN": "{n} Months",
  "device": "1 device",
  "choose": "Choose",
  "chooseFeatured": "Get this plan →",
  "badgeBest": "Best value",
  "badgePopular": "Most popular",
  "allPlans": "Compare all plans →",
  "replyTitle": "📩 The fastest way?",
  "replyBody": "Simply reply <strong>\"YES\"</strong> to this email and we'll activate your subscription in minutes. No form, no hassle.",
  "trust": [
    "⚡ Activated in minutes",
    "📺 The quality you just tried",
    "💬 Real people on WhatsApp"
  ],
  "ps": "P.S. Not sure which plan fits? Reply with how many screens you watch on and we'll pick the right one for you.",
  "f_help": "💬 Help me choose on WhatsApp",
  "footerWhy": "You're receiving this because you requested a free trial on {domain}.",
  "plansLink": "Plans",
  "waText": "Hi {brand}! I have a question about my free trial."
};

// Trial email kit: welcome, 4-hours-left reminder and trial-ended follow-up.
// Dark, table-based, inline-styled HTML that holds up in Gmail, Outlook, Apple Mail
// and Yahoo, on phones and desktops, in light and dark mode.
// Needs EMAIL_BRAND (site look, plans, contacts) and EMAIL_TEXT (copy) defined above it.

const TK_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TK_MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

function tkEsc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tkFmt(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
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

function tkWa(text) {
  return `https://wa.me/${EMAIL_BRAND.wa}?text=${encodeURIComponent(tkFmt(text, { brand: EMAIL_BRAND.name }))}`;
}

function tkServer(m3uUrl) {
  try { return new URL(m3uUrl).origin; } catch { return EMAIL_BRAND.host; }
}

// ── building blocks ───────────────────────────────────────────────────────────

function tkShell(preheader, body) {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  const logo = B.logo
    ? `<img src="${B.logo.src}" width="${B.logo.w}" height="${B.logo.h}" alt="${tkEsc(B.name)}" style="display:block;border:0;outline:none;width:${B.logo.w}px;height:${B.logo.h}px;color:#ffffff;font:800 22px ${TK_FONT};">`
    : `<span style="font:800 22px/28px ${TK_FONT};color:#ffffff;letter-spacing:-0.3px;">${B.emoji ? B.emoji + "&nbsp;" : ""}${tkEsc(B.name)}</span>`;
  return `<!DOCTYPE html>
<html lang="${B.lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${tkEsc(B.name)}</title>
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  :root { color-scheme: dark light; supported-color-schemes: dark light; }
  @media only screen and (max-width:620px) {
    .tk-outer { padding:0 !important; }
    .tk-card { border-radius:0 !important; }
    .tk-pad { padding-left:20px !important; padding-right:20px !important; }
    .tk-h1 { font-size:30px !important; line-height:36px !important; }
    .tk-val { font-size:17px !important; }
    .tk-col { display:block !important; width:100% !important; box-sizing:border-box; padding-left:0 !important; padding-right:0 !important; }
    .tk-gap { padding-bottom:10px !important; }
    .tk-hide-sm { display:none !important; }
    .tk-price { font-size:40px !important; line-height:44px !important; }
  }
</style>
<!--[if mso]><style>* { font-family:Arial,sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;background-color:${C.page};" bgcolor="${C.page}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${tkEsc(preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" class="tk-outer" style="padding:28px 12px 36px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
  <tr><td class="tk-pad" style="padding:6px 8px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><a href="${tkLink("/", "header")}" target="_blank" style="text-decoration:none;">${logo}</a></td>
      <td valign="middle" align="right" class="tk-hide-sm" style="font:600 12px/16px ${TK_FONT};color:${C.muted};letter-spacing:0.3px;">${tkEsc(B.tagline)}</td>
    </tr></table>
  </td></tr>
  <tr><td class="tk-card" bgcolor="${C.surface}" style="background-color:${C.surface};border:1px solid ${C.line};border-radius:24px;overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td height="6" bgcolor="${B.accent}" style="height:6px;font-size:0;line-height:0;background-color:${B.accent};background-image:linear-gradient(90deg,${B.accent},${B.accent2});">&nbsp;</td></tr>
    </table>
    ${body}
  </td></tr>
  <tr><td align="center" class="tk-pad" style="padding:26px 20px 4px;font:13px/21px ${TK_FONT};color:${C.muted};">
    <a href="${tkLink("/", "footer")}" target="_blank" style="color:#ffffff;font-weight:800;text-decoration:none;">${tkEsc(B.name)}</a> &middot; ${tkEsc(B.tagline)}<br>
    <a href="${tkWa(T.waText)}" target="_blank" style="color:${C.muted};text-decoration:underline;">WhatsApp ${tkEsc(B.waLabel)}</a> &middot;
    <a href="mailto:${B.email}" style="color:${C.muted};text-decoration:underline;">${B.email}</a> &middot;
    <a href="${tkLink(B.plansUrl, "footer")}" target="_blank" style="color:${C.muted};text-decoration:underline;">${T.plansLink}</a>
  </td></tr>
  <tr><td align="center" style="padding:6px 20px 0;font:12px/18px ${TK_FONT};color:${C.faint};">${tkFmt(T.footerWhy, { domain: B.domain })}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function tkHero(eyebrow, title, lead, name) {
  const B = EMAIL_BRAND, C = B.c;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="tk-pad" style="padding:34px 36px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="${B.accent}" style="background-color:${B.accent};border-radius:999px;padding:6px 14px;font:800 11px/14px ${TK_FONT};letter-spacing:1.6px;text-transform:uppercase;color:${B.onAccent};">${eyebrow}</td>
        </tr></table>
        <p style="margin:22px 0 6px;font:600 16px/22px ${TK_FONT};color:${C.soft};">${tkHi(name)}</p>
        <h1 class="tk-h1" style="margin:0 0 14px;font:800 36px/42px ${TK_FONT};letter-spacing:-0.8px;color:#ffffff;">${title}</h1>
        <p style="margin:0;font:16px/26px ${TK_FONT};color:${C.text};">${lead}</p>
      </td></tr>
    </table>`;
}

function tkSection(inner, pad = "26px 36px 0") {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="tk-pad" style="padding:${pad};">${inner}</td></tr>
    </table>`;
}

function tkH2(text, sub) {
  const C = EMAIL_BRAND.c;
  return `<h2 style="margin:0 0 ${sub ? 4 : 14}px;font:800 21px/28px ${TK_FONT};letter-spacing:-0.3px;color:#ffffff;">${text}</h2>`
    + (sub ? `<p style="margin:0 0 16px;font:14px/21px ${TK_FONT};color:${C.muted};">${sub}</p>` : "");
}

function tkButton(href, label, bg, color, full) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" ${full ? 'width="100%"' : ""} style="margin:0 auto;"><tr>
      <td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:999px;">
        <a href="${href}" target="_blank" style="display:block;padding:15px 28px;font:800 16px/20px ${TK_FONT};color:${color};text-decoration:none;border-radius:999px;">${label}</a>
      </td>
    </tr></table>`;
}

function tkField(label, value, last) {
  const C = EMAIL_BRAND.c;
  return `
      <tr><td style="padding:14px 20px;${last ? "" : `border-bottom:1px solid ${C.line};`}">
        <div style="font:700 11px/14px ${TK_FONT};letter-spacing:1.4px;text-transform:uppercase;color:${C.muted};">${label}</div>
        <div class="tk-val" style="margin-top:5px;font:700 19px/26px ${TK_MONO};color:#ffffff;word-break:break-all;">${tkEsc(value)}</div>
      </td></tr>`;
}

// The login, styled as a ticket: the thing they keep coming back to for 24 hours.
function tkPass(username, password, m3uUrl, compact) {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.raised}" style="background-color:${C.raised};border:2px solid ${B.accent};border-radius:18px;border-collapse:separate;">
        <tr><td bgcolor="${B.accent}" style="background-color:${B.accent};background-image:linear-gradient(90deg,${B.accent},${B.accent2});border-radius:15px 15px 0 0;padding:13px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font:800 13px/18px ${TK_FONT};letter-spacing:1.4px;text-transform:uppercase;color:${B.onAccent};">&#127903;&#65039;&nbsp; ${compact ? T.credsAgain : T.passLabel}</td>
            <td align="right" style="font:800 12px/18px ${TK_MONO};letter-spacing:1px;text-transform:uppercase;color:${B.onAccent};white-space:nowrap;">${compact ? "" : T.admit}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 20px 0;font:700 12px/16px ${TK_FONT};color:${B.accentText};">${T.xtream}</td></tr>
        ${tkField(T.server, tkServer(m3uUrl))}
        ${tkField(T.username, username)}
        ${tkField(T.password, password, true)}
        <tr><td style="padding:0 20px;"><div style="border-top:2px dashed ${C.line};height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>
        <tr><td style="padding:14px 20px 18px;">
          <div style="font:700 11px/14px ${TK_FONT};letter-spacing:1.4px;text-transform:uppercase;color:${C.muted};">${T.m3u}</div>
          <div style="margin:2px 0 8px;font:12px/17px ${TK_FONT};color:${C.faint};">${T.m3uHint}</div>
          <div style="padding:11px 13px;border-radius:10px;background-color:${C.page};border:1px solid ${C.line};font:12px/19px ${TK_MONO};color:${B.accentText};word-break:break-all;">${tkEsc(m3uUrl)}</div>
        </td></tr>
      </table>`;
}

function tkSteps() {
  const B = EMAIL_BRAND, C = B.c;
  return EMAIL_TEXT.steps.map(([title, text], i) => `
        <tr>
          <td valign="top" width="48" style="padding:0 0 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="34" height="34" align="center" valign="middle" bgcolor="${B.accent}" style="width:34px;height:34px;background-color:${B.accent};border-radius:50%;font:800 16px/34px ${TK_FONT};color:${B.onAccent};">${i + 1}</td>
            </tr></table>
          </td>
          <td valign="top" style="padding:3px 0 16px;">
            <div style="font:700 16px/22px ${TK_FONT};color:#ffffff;">${title}</div>
            <div style="margin-top:3px;font:14px/22px ${TK_FONT};color:${C.text};">${text}</div>
          </td>
        </tr>`).join("");
}

function tkTiles(items) {
  const C = EMAIL_BRAND.c;
  const w = Math.floor(100 / items.length);
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${items.map(([icon, text], i) => `
        <td class="tk-col tk-gap" width="${w}%" valign="top" style="padding:0 ${i < items.length - 1 ? 5 : 0}px 0 ${i ? 5 : 0}px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.raised}" style="background-color:${C.raised};border:1px solid ${C.line};border-radius:14px;border-collapse:separate;"><tr>
            <td style="padding:16px 16px 15px;">
              <div style="font-size:26px;line-height:30px;">${icon}</div>
              <div style="margin-top:8px;font:700 14px/20px ${TK_FONT};color:#ffffff;">${text}</div>
            </td>
          </tr></table>
        </td>`).join("")}
      </tr></table>`;
}

function tkHelp(label) {
  const C = EMAIL_BRAND.c;
  return tkSection(`
      ${tkButton(tkWa(EMAIL_TEXT.waText), label, "#25D366", "#05290f")}
      <p style="margin:12px 0 0;text-align:center;font:14px/21px ${TK_FONT};color:${C.muted};">${EMAIL_TEXT.helpLine}</p>`, "28px 36px 0");
}

function tkReplyYes() {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  if (!B.replyYes) return "";
  return tkSection(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.raised}" style="background-color:${C.raised};border-left:4px solid ${B.accent};border-radius:12px;"><tr>
        <td style="padding:18px 20px;">
          <div style="font:800 15px/22px ${TK_FONT};color:#ffffff;">${T.replyTitle}</div>
          <div style="margin-top:4px;font:15px/23px ${TK_FONT};color:${C.text};">${T.replyBody}</div>
        </td>
      </tr></table>`);
}

function tkSign() {
  const C = EMAIL_BRAND.c, T = EMAIL_TEXT;
  return tkSection(`
      <p style="margin:0;font:15px/24px ${TK_FONT};color:${C.text};">${T.teamSign}<br><strong style="color:#ffffff;">${tkFmt(T.team, { brand: tkEsc(EMAIL_BRAND.name) })}</strong></p>`, "28px 36px 34px");
}

function tkMonths(m) {
  return m === 1 ? EMAIL_TEXT.m1 : tkFmt(EMAIL_TEXT.mN, { n: m });
}

function tkBadge(p) {
  const B = EMAIL_BRAND;
  if (p.badge === false) return "";
  const pick = (own, dflt) => (own === false ? "" : own || dflt);
  return p.badge || (p.months === 12 ? pick(B.badgeBest, EMAIL_TEXT.badgeBest) : p.months === 6 ? pick(B.badgePopular, EMAIL_TEXT.badgePopular) : "");
}

// Every plan is its own link to that plan's page: the best-value plan as a big
// hero card, the others as full-width rows that fit any screen without media queries.
function tkPlans(campaign) {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  const plans = B.plans.slice().sort((a, b) => a.months - b.months);
  const featured = plans.find(p => p.months === 12) || plans[plans.length - 1];
  const rest = plans.filter(p => p !== featured);
  const fUrl = tkLink(featured.url, campaign);
  const fBadge = tkBadge(featured);

  const hero = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B.accent}" style="background-color:${B.accent};background-image:linear-gradient(135deg,${B.accent},${B.accent2});border-radius:18px;"><tr>
        <td style="padding:0;">
          <a href="${fUrl}" target="_blank" style="display:block;padding:22px 24px 24px;text-decoration:none;color:${B.onAccent};">
            ${fBadge ? `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background-color:${B.onAccent};font:800 11px/14px ${TK_FONT};letter-spacing:1.4px;text-transform:uppercase;color:${B.badgeInk};">&#9733; ${fBadge}</span>` : ""}
            <span style="display:block;margin-top:12px;font:800 22px/28px ${TK_FONT};color:${B.onAccent};">${tkMonths(featured.months)} <span style="font-weight:600;opacity:0.85;">&middot; ${B.deviceLabel || T.device}</span></span>
            <span style="display:block;margin-top:4px;">
              <span class="tk-price" style="font:900 48px/54px ${TK_FONT};letter-spacing:-1.5px;color:${B.onAccent};">${tkMoney(featured.price)}</span>
              ${featured.was ? `<span style="font:600 16px/20px ${TK_FONT};color:${B.onAccent};opacity:0.75;text-decoration:line-through;">&nbsp;${tkMoney(featured.was)}</span>` : ""}
            </span>
            <span style="display:block;margin-top:2px;font:600 15px/21px ${TK_FONT};color:${B.onAccent};opacity:0.9;">${featured.months > 1 ? tkFmt(T.perMonth, { price: tkMoney(Math.round(featured.price / featured.months * 100) / 100) }) : "&nbsp;"}</span>
            <span style="display:inline-block;margin-top:16px;padding:13px 24px;border-radius:999px;background-color:${B.onAccent};font:800 16px/20px ${TK_FONT};color:${B.badgeInk};">${T.chooseFeatured}</span>
          </a>
        </td>
      </tr></table>`;

  const rows = rest.map(p => {
    const url = tkLink(p.url, campaign);
    const badge = tkBadge(p);
    const per = p.months > 1 ? tkFmt(T.perMonthShort, { price: tkMoney(Math.round(p.price / p.months * 100) / 100) }) : (B.deviceLabel || T.device);
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.raised}" style="margin-top:10px;background-color:${C.raised};border:1px solid ${badge ? B.accent : C.line};border-radius:14px;border-collapse:separate;"><tr>
        <td valign="middle" style="padding:0;">
          <a href="${url}" target="_blank" style="display:block;padding:15px 8px 15px 18px;text-decoration:none;">
            <span style="display:block;font:800 17px/22px ${TK_FONT};color:#ffffff;">${tkMonths(p.months)}${badge ? ` <span style="display:inline-block;margin-left:4px;padding:2px 8px;border-radius:999px;background-color:${B.accent};font:800 10px/14px ${TK_FONT};letter-spacing:1px;text-transform:uppercase;color:${B.onAccent};vertical-align:2px;white-space:nowrap;">${badge}</span>` : ""}</span>
            <span style="display:block;margin-top:2px;font:13px/18px ${TK_FONT};color:${C.muted};">${per}</span>
          </a>
        </td>
        <td valign="middle" align="right" style="padding:0;white-space:nowrap;">
          <a href="${url}" target="_blank" style="display:block;padding:15px 18px 15px 8px;text-decoration:none;white-space:nowrap;">
            ${p.was ? `<span style="font:600 13px/18px ${TK_FONT};color:${C.faint};text-decoration:line-through;">${tkMoney(p.was)}</span>&nbsp;` : ""}<span style="font:900 24px/28px ${TK_FONT};color:#ffffff;">${tkMoney(p.price)}</span>
            <span style="display:inline-block;margin-left:8px;padding:7px 12px;border-radius:999px;background-color:${B.accent};font:800 13px/16px ${TK_FONT};color:${B.onAccent};vertical-align:3px;">${T.choose}&nbsp;&rarr;</span>
          </a>
        </td>
      </tr></table>`;
  }).join("");

  return `${hero}${rows}
      <p style="margin:16px 0 0;text-align:center;font:700 14px/20px ${TK_FONT};"><a href="${tkLink(B.plansUrl, campaign)}" target="_blank" style="color:${B.accentText};text-decoration:none;">${T.allPlans}</a></p>`;
}

function tkTrust() {
  const C = EMAIL_BRAND.c;
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${EMAIL_TEXT.trust.map((t, i) => `<td class="tk-col" align="center" width="33%" style="padding:${i ? "8px" : "0"} 4px 0;font:700 13px/19px ${TK_FONT};color:${C.soft};">${t}</td>`).join("")}
      </tr></table>`;
}

// 20 of 24 hours used, as a bar: easier to feel than a sentence.
function tkProgress() {
  const B = EMAIL_BRAND, C = B.c, T = EMAIL_TEXT;
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:999px;border-collapse:separate;"><tr>
        <td width="83%" height="14" bgcolor="${B.accent}" style="height:14px;background-color:${B.accent};background-image:linear-gradient(90deg,${B.accent2},${B.accent});border-radius:999px 0 0 999px;font-size:0;line-height:0;">&nbsp;</td>
        <td width="17%" height="14" bgcolor="${C.line}" style="height:14px;background-color:${C.line};border-radius:0 999px 999px 0;font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-top:8px;font:700 13px/18px ${TK_FONT};color:${C.muted};">${T.r_used}</td>
        <td align="right" style="padding-top:8px;font:800 13px/18px ${TK_FONT};color:${B.accentText};">&#9203; ${T.r_left}</td>
      </tr></table>`;
}

// ── the three customer emails ─────────────────────────────────────────────────

function welcomeEmail(name, username, password, m3uUrl) {
  const T = EMAIL_TEXT, C = EMAIL_BRAND.c;
  return tkShell(T.w_pre, `
    ${tkHero(T.w_eyebrow, T.w_title, T.w_lead, name)}
    ${tkSection(tkPass(username, password, m3uUrl))}
    ${tkSection(`<p style="margin:0;font:italic 14px/21px ${TK_FONT};color:${C.muted};">${T.w_note}</p>`, "14px 36px 0")}
    ${tkSection(`${tkH2(T.stepsTitle)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tkSteps()}</table>`, "30px 36px 0")}
    ${tkSection(`${tkH2(T.tryTitle)}${tkTiles(EMAIL_BRAND.highlights)}`, "14px 36px 0")}
    ${tkHelp(T.helpBtn)}
    ${tkSign()}`);
}

function reminderEmail(name, username, password, m3uUrl) {
  const T = EMAIL_TEXT;
  return tkShell(T.r_pre, `
    ${tkHero("&#9203; " + T.r_eyebrow, T.r_title, T.r_lead, name)}
    ${tkSection(tkProgress(), "22px 36px 0")}
    ${tkReplyYes()}
    ${tkSection(`${tkH2(T.plansTitle, T.plansSub)}${tkPlans("trial_reminder")}`, "30px 36px 0")}
    ${tkSection(tkPass(username, password, m3uUrl, true), "30px 36px 0")}
    ${tkHelp(T.helpBtn)}
    ${tkSign()}`);
}

function followupEmail(name) {
  const T = EMAIL_TEXT, C = EMAIL_BRAND.c;
  return tkShell(T.f_pre, `
    ${tkHero(T.f_eyebrow, T.f_title, T.f_lead, name)}
    ${tkReplyYes()}
    ${tkSection(`${tkH2(T.plansTitle, T.plansSub)}${tkPlans("trial_followup")}`, "30px 36px 0")}
    ${tkSection(tkTrust(), "24px 36px 0")}
    ${tkHelp(T.f_help)}
    ${tkSection(`<p style="margin:0;font:15px/24px ${TK_FONT};color:${C.text};">${T.ps}</p>`, "26px 36px 0")}
    ${tkSign()}`);
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
