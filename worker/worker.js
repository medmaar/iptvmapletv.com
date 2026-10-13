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
const PANEL_HOST = "http://vpn.fanjerseysonline.com";
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
const P = (html, extra = "") => `<p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:14px;line-height:1.65;color:#555555;${extra}">${html}</p>`;

function wrap(content) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f2f2f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f2f4;padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background-color:#06070b;padding:30px 40px;text-align:center;border-bottom:3px solid #ff2d4a;">
      <img src="${SITE_URL}/brand/icon-192.png" width="56" height="56" alt="" style="display:block;margin:0 auto 10px;border:0;">
      <h1 style="margin:0;font-family:Arial,sans-serif;font-size:26px;font-weight:bold;color:#ffffff;">IPTVMaple</h1>
      <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#a4aaba;">Live TV, sports, movies &amp; series in 4K</p>
    </td></tr>
    <tr><td style="padding:36px 40px;">${content}</td></tr>
    <tr><td style="background-color:#f8f8f9;border-top:1px solid #eeeeee;padding:18px 40px;text-align:center;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#999999;">© ${new Date().getFullYear()} IPTVMaple · <a href="${SITE_URL}" style="color:#ff2d4a;text-decoration:none;">iptvmapletv.com</a></p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function row(label, value, last) {
  return `<tr><td style="padding:11px 0;${last ? "" : "border-bottom:1px solid #e8e8e8;"}">
    <p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:11px;color:#888888;text-transform:uppercase;">${label}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#222222;font-weight:bold;word-break:break-all;">${esc(value)}</p></td></tr>`;
}

const firstName = (name) => esc(String(name).trim().split(/\s+/)[0] || "there");
const hi = (name) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;color:#333333;">Hi ${firstName(name)},</p>`;
const link = (text, url) => `<a href="${url}" style="color:#ff2d4a;font-weight:bold;text-decoration:none;">${text}</a>`;
const wa = () => link(WA_LABEL, `https://wa.me/${WA_NUMBER}`);
const signoff = `<p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#555555;">Best regards,<br><strong>The IPTVMaple Team</strong></p>`;
const btn = (text, url) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td style="background-color:#ff2d4a;border-radius:8px;padding:13px 28px;"><a href="${url}" style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${text}</a></td></tr></table>`;

function credBox(username, password, m3u) {
  return `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#333333;">Xtream Codes login</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8f8f9;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:18px;"><tr><td style="padding:8px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row("Server", PANEL_HOST)}${row("Username", username)}${row("Password", password, true)}</table>
    </td></tr></table>
    <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#333333;">M3U link</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8f8f9;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:26px;"><tr><td style="padding:14px 20px;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#ff2d4a;word-break:break-all;">${esc(m3u)}</p>
    </td></tr></table>`;
}

function welcomeEmail(name, username, password, m3u) {
  return wrap(`${hi(name)}
    ${P("Your free trial is ready! 🎉 You have <strong>24 hours of full access</strong> to live TV, sports, movies and series.")}
    ${P("All countries and languages are unlocked so you can test everything. If the channel list feels too long, just ask us and we’ll hide the regions or categories you don’t need.", "font-size:13px;color:#777777;font-style:italic;margin-bottom:22px;")}
    ${credBox(username, password, m3u)}
    ${P(`Not sure which app to use? Our ${link("setup guides", `${SITE_URL}/how-it-works/`)} cover Firestick, Smart TVs, Android, iPhone and more.`)}
    ${btn("Set up my device →", `${SITE_URL}/how-it-works/`)}
    ${P(`Need help? Reply to this email or message us on WhatsApp at ${wa()}.`)}
    ${P(`Enjoying it? ${link("See our plans", `${SITE_URL}/iptv-plans-canada/`)} to keep watching after your trial.`)}
    ${signoff}`);
}

function reminderEmail(name, username, password, m3u) {
  return wrap(`${hi(name)}
    ${P("Your free trial <strong>ends in 4 hours</strong> ⏳ and we’d love for you to stay.")}
    ${P("Live sports, Canadian and international channels, movies and series in HD and 4K, on the devices you already own.")}
    ${P("Here’s your login again in case you need it:", "margin-bottom:18px;")}
    ${credBox(username, password, m3u)}
    ${P("<strong>Keep watching without interruption:</strong> pick a plan before your trial ends. 👇")}
    ${btn("View our plans →", `${SITE_URL}/iptv-plans-canada/`)}
    ${P(`Questions? Reply to this email or message us on WhatsApp at ${wa()}.`)}
    ${signoff}`);
}

function followupEmail(name) {
  return wrap(`${hi(name)}
    ${P("Your free trial has ended. Thanks for trying IPTVMaple!")}
    ${P("Everything you watched is still one step away: the live sports, the movies and series, and the 4K quality.")}
    ${P("Choose the plan that fits you and you’re back in. 👇", "margin-bottom:22px;")}
    ${btn("Choose my plan →", `${SITE_URL}/iptv-plans-canada/`)}
    ${P(`Not sure which plan is right? Reply to this email or message us on WhatsApp at ${wa()} and we’ll help you pick.`)}
    ${signoff}`);
}

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
