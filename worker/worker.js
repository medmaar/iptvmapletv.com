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
 * Abuse protection: honeypot, email checks and a daily cap (TRIAL_DAILY_LIMIT, default 60; past it the form
 * falls back to the manual lead flow). Repeat requests from the same email, WhatsApp number or IP are allowed.
 *
 * Worker secrets (Cloudflare → Workers & Pages → iptv-trial-iptvmapletv → Settings → Variables and Secrets):
 *   RESEND_KEY, PANEL_API_KEY, optional DEMO_USERNAME / DEMO_PASSWORD
 * Deployed by .github/workflows/deploy-trial-worker.yml.
 */

const SITE = "iptvmapletv.com";
const SITE_URL = "https://iptvmapletv.com";
const PANEL_API = "https://activationpanel.ru/api/api.php";
const PANEL_HOST = "http://vpn.fanjerseysonline.com"; // main portal: M3U links and first server in trial emails
const ALT_HOST = "http://line.trxdnscloud.ru"; // second portal URL shown in trial emails
const PANEL_PACK = "USA - All";
const FROM_EMAIL = "IPTVMaple <help@iptvmapletv.com>";
const ADMIN_EMAIL = "help@iptvmapletv.com";
const WA_NUMBER = "17828026280";
const WA_LABEL = "+1 782-802-6280";

const DAY = 24 * 60 * 60;
const TRIAL_HOURS = 24;
const SUBJECT = "Your IPTVMaple free trial is ready — 24h access activated ✓";
const KV_TTL = 30 * DAY;
const ALLOWED_ORIGIN = /^https:\/\/((www\.)?iptvmapletv\.com|([a-z0-9-]+\.)?iptvmapletv-com\.pages\.dev)$/;

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com", "burnermail.io", "moakt.com",
]);

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const timeout = (ms) => AbortSignal.timeout(ms);

async function createTrial({ name, email, country, whatsapp, env }) {
  const kv = env.TRIALS;
  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: "invalid", message: "Please enter a valid email address." };
  if (DISPOSABLE.has(email.split("@")[1])) return { status: "invalid", message: "Please use your real email address — your login is sent there." };

  const today = new Date().toISOString().slice(0, 10);
  const dayCount = await kv.get(`day:${today}`);
  if (+dayCount >= (+env.TRIAL_DAILY_LIMIT || 60)) return { status: "manual", reason: "daily automatic trial limit reached" };
  if (!env.RESEND_KEY) return { status: "manual", reason: "RESEND_KEY secret not set" };

  // Count the attempt before calling the panel so a burst of requests can't drain panel credits.
  await kv.put(`day:${today}`, String(+dayCount + 1), { expirationTtl: 2 * DAY });

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
  // A repeat request from the same email replaces the earlier record (latest login drives the reminder emails).
  await kv.put(`trial:${email}`, JSON.stringify(trial), { expirationTtl: KV_TTL });
  try {
    const keys = JSON.parse((await kv.get("__keys__")) || "[]");
    if (!keys.includes(email)) { keys.push(email); await kv.put("__keys__", JSON.stringify(keys), { expirationTtl: 90 * DAY }); }
  } catch (err) { console.error("__keys__ update failed", err.message); }

  try {
    trial.welcome_email_id = await sendEmail(env, email, trialSubject(), welcomeEmail(name, username, password, m3uUrl));
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
    result = await createTrial({ name, email, country, whatsapp, env });
  } catch (err) {
    result = { status: "manual", reason: `error: ${err.message}` };
  }
  if (result.trial) {
    await notifyTeam(env, result.trial, { page: get("page"), ipCountry: request.cf?.country, emailed: result.status === "sent", reason: result.reason });
  }
  switch (result.status) {
    case "sent": return res({ success: true, email: result.trial.email });
    case "invalid": return res({ success: false, message: result.message }, 400);
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
        await sendEmail(env, email, trialSubject(), reminderEmail(name, username, password, m3uUrl), welcome_email_id);
        trial.reminder_sent = true;
        await env.TRIALS.put(key, JSON.stringify(trial), { expirationTtl: KV_TTL });
        reminders++;
        console.log(`[cron] Reminder → ${email}`);
      } catch (e) { console.error(`[cron] Reminder failed ${email}:`, e.message); }
    }
    if (!trial.followup_sent && now >= expiry) {
      try {
        await sendEmail(env, email, trialSubject(), followupEmail(name), welcome_email_id);
        trial.followup_sent = true;
        await env.TRIALS.put(key, JSON.stringify(trial), { expirationTtl: KV_TTL });
        followups++;
        console.log(`[cron] Follow-up → ${email}`);
      } catch (e) { console.error(`[cron] Follow-up failed ${email}:`, e.message); }
    }
  }
  return { trials: emails.length, reminders, followups };
}

// ── invoice emails (generated by invoice-emails/build.mjs from kit.js and sites.mjs; edit those, not this block) ──

const INVOICE = (() => {
const SITE = {
  "name": "IPTVMaple",
  "domain": "iptvmapletv.com",
  "url": "https://iptvmapletv.com",
  "lang": "en",
  "email": "help@iptvmapletv.com",
  "from": "help@iptvmapletv.com",
  "admin": "help@iptvmapletv.com",
  "logo": {
    "src": "https://iptv-trial-iptvmapletv.medmaar.workers.dev/email/logo.png?v=2",
    "w": 190,
    "h": 44
  },
  "head": "#06070B",
  "headLine": "#06070B",
  "btn": "#FF2D4A",
  "onBtn": "#FFFFFF",
  "accent": "#CC243B",
  "wa": "17828026280",
  "waLabel": "+1 782-802-6280"
};

// Invoice email for paid plans (1, 3, 6, 12 months). Free trials never come here.
// The site's order form POSTs { name, email, plan } to /invoice right after its order email is sent.
// Static sites load /invoice.js instead, which does that POST after a successful EmailJS order send.
// Needs SITE (brand, contacts, lang, cur, map, manual) defined above it and env.RESEND_KEY.
// The payment link (full URL, LINKS below) is picked by the order's amount only: USD and EUR amounts use the same links,
// SITE.map turns another currency's price into the USD price first (GBP on mojo4k.uk).
// The client's email shows the price in the site's own currency (SITE.cur).
// Unknown amount → the client gets nothing and the site inbox gets a notice instead.
// SITE.manual → the client gets nothing and the site inbox gets the order to invoice by hand.
// INVOICE_MODE (below) does the same for every order while it is "notify_owner".

// Who gets the email when a client orders a paid plan. Flip this one line to switch.
//   "notify_owner": the client gets nothing; the site inbox (SITE.admin) gets a sale notification
//                   with the order and its payment link, to invoice the client by hand.
//   "send_client":  the client gets the invoice email with the payment link; the site inbox gets a copy notice.
const INVOICE_MODE = "send_client";

const LINKS = {
  // 9 has no link on purpose: a $9 order stays manual (the site inbox gets it, no payment link).
  18: "https://copperkitepress.gumroad.com/l/Flutter?wanted=true",
  27: "http://www.copperkitepressbooks.com/l/Dragon?wanted=true",
  29: "https://www.thewordshome.com/l/unaVolta?wanted=true",
  36: "http://www.copperkitepressbooks.com/l/Trailhead?wanted=true",
  39: "http://www.copperkitepressbooks.com/l/Pebble?wanted=true",
  45: "http://www.copperkitepressbooks.com/l/Farmyard?wanted=true",
  49: "http://www.copperkitepressbooks.com/l/WhiskersandWags?wanted=true",
  50: "https://www.thewordshome.com/l/CapolavoriePagine?wanted=true",
  69: "https://copperkitepress.gumroad.com/l/KeyChanges?wanted=true",
  75: "http://www.copperkitepressbooks.com/l/Rainforest?wanted=true",
  89: "http://www.copperkitepressbooks.com/l/Lab?wanted=true",
  99: "http://www.copperkitepressbooks.com/l/Trivia?wanted=true",
  105: "https://copperkitepress.gumroad.com/l/Parrot?wanted=true",
  120: "http://www.copperkitepressbooks.com/l/Junction?wanted=true",
  135: "https://www.copperkitepressbooks.com/l/Casebook?wanted=true",
  140: "http://www.copperkitepressbooks.com/l/PassporttoTrivia?wanted=true",
  175: "http://www.copperkitepressbooks.com/l/WordsoftheRainforest?wanted=true",
  180: "http://www.copperkitepressbooks.com/l/WagsSpot?wanted=true",
  225: "http://www.copperkitepressbooks.com/l/CopperKite?wanted=true",
};

// The message text is Mo's, word for word; the other languages are straight translations of it.
const TEXT = {
  en: {
    subject: "Your secure payment invoice",
    hi: "Hi {name},", hiAnon: "Hi there,",
    intro: "Please find below your secure payment invoice for {what}:",
    preheader: "Your secure payment invoice for {what} is ready.",
    order: "Order", amount: "Amount", pay: "Pay securely",
    note: "Please note that the invoice description may differ due to our payment provider’s requirements. This does not affect your order — your subscription remains exactly as agreed.",
    activation: "Once your payment is completed, activation usually takes <strong>between 5 minutes and 2 hours</strong>.",
    screenshot: "Please send us a screenshot of your payment confirmation email after payment so we can verify your order and proceed with activation as quickly as possible.",
    thanks: "Thank you!", team: "The {brand} Team",
    why: "You are receiving this email because you placed an order on {domain}.",
    waText: "Hi {brand}! Here is my payment confirmation.",
    months: { 1: "one month", 3: "three months", 6: "six months", 12: "one year" },
    plan: { 1: "1 Month", 3: "3 Months", 6: "6 Months", 12: "12 Months" },
    devices: (n) => `${n} Device${n > 1 ? "s" : ""}`, withDevices: (what, n) => `${what} (${n} devices)`,
  },
  fr: {
    subject: "Votre facture de paiement sécurisée",
    hi: "Bonjour {name},", hiAnon: "Bonjour,",
    intro: "Veuillez trouver ci-dessous votre facture de paiement sécurisée pour {what}&nbsp;:",
    preheader: "Votre facture de paiement sécurisée pour {what} est prête.",
    order: "Commande", amount: "Montant", pay: "Payer en toute sécurité",
    note: "Veuillez noter que la description de la facture peut différer en raison des exigences de notre prestataire de paiement. Cela n’affecte pas votre commande — votre abonnement reste exactement tel que convenu.",
    activation: "Une fois votre paiement effectué, l’activation prend généralement <strong>entre 5 minutes et 2 heures</strong>.",
    screenshot: "Veuillez nous envoyer une capture d’écran de votre e-mail de confirmation de paiement après le paiement, afin que nous puissions vérifier votre commande et procéder à l’activation le plus rapidement possible.",
    thanks: "Merci&nbsp;!", team: "L’équipe {brand}",
    why: "Vous recevez cet e-mail car vous avez passé une commande sur {domain}.",
    waText: "Bonjour {brand} ! Voici ma confirmation de paiement.",
    months: { 1: "un mois", 3: "trois mois", 6: "six mois", 12: "un an" },
    plan: { 1: "1 mois", 3: "3 mois", 6: "6 mois", 12: "12 mois" },
    devices: (n) => `${n} appareil${n > 1 ? "s" : ""}`, withDevices: (what, n) => `${what} (${n} appareils)`,
  },
  de: {
    subject: "Ihre sichere Zahlungsrechnung",
    hi: "Hallo {name},", hiAnon: "Hallo,",
    intro: "anbei finden Sie Ihre sichere Zahlungsrechnung für {what}:",
    preheader: "Ihre sichere Zahlungsrechnung für {what} ist bereit.",
    order: "Bestellung", amount: "Betrag", pay: "Sicher bezahlen",
    note: "Bitte beachten Sie, dass die Rechnungsbeschreibung aufgrund der Anforderungen unseres Zahlungsanbieters abweichen kann. Dies hat keinen Einfluss auf Ihre Bestellung — Ihr Abonnement bleibt genau wie vereinbart.",
    activation: "Sobald Ihre Zahlung abgeschlossen ist, dauert die Aktivierung in der Regel <strong>zwischen 5 Minuten und 2 Stunden</strong>.",
    screenshot: "Bitte senden Sie uns nach der Zahlung einen Screenshot Ihrer Zahlungsbestätigungs-E-Mail, damit wir Ihre Bestellung überprüfen und die Aktivierung so schnell wie möglich durchführen können.",
    thanks: "Vielen Dank!", team: "Ihr {brand}-Team",
    why: "Sie erhalten diese E-Mail, weil Sie eine Bestellung auf {domain} aufgegeben haben.",
    waText: "Hallo {brand}! Hier ist meine Zahlungsbestätigung.",
    months: { 1: "einen Monat", 3: "drei Monate", 6: "sechs Monate", 12: "ein Jahr" },
    plan: { 1: "1 Monat", 3: "3 Monate", 6: "6 Monate", 12: "12 Monate" },
    devices: (n) => `${n} ${n > 1 ? "Geräte" : "Gerät"}`, withDevices: (what, n) => `${what} (${n} Geräte)`,
  },
  no: {
    subject: "Din sikre betalingsfaktura",
    hi: "Hei {name},", hiAnon: "Hei,",
    intro: "Her er din sikre betalingsfaktura for {what}:",
    preheader: "Din sikre betalingsfaktura for {what} er klar.",
    order: "Bestilling", amount: "Beløp", pay: "Betal trygt",
    note: "Vær oppmerksom på at fakturabeskrivelsen kan avvike på grunn av kravene fra betalingsleverandøren vår. Dette påvirker ikke bestillingen din — abonnementet ditt er nøyaktig som avtalt.",
    activation: "Når betalingen er fullført, tar aktiveringen vanligvis <strong>mellom 5 minutter og 2 timer</strong>.",
    screenshot: "Send oss et skjermbilde av e-posten med betalingsbekreftelsen etter at du har betalt, slik at vi kan bekrefte bestillingen din og aktivere abonnementet så raskt som mulig.",
    thanks: "Tusen takk!", team: "Hilsen {brand}",
    why: "Du mottar denne e-posten fordi du har lagt inn en bestilling på {domain}.",
    waText: "Hei {brand}! Her er betalingsbekreftelsen min.",
    months: { 1: "én måned", 3: "tre måneder", 6: "seks måneder", 12: "ett år" },
    plan: { 1: "1 måned", 3: "3 måneder", 6: "6 måneder", 12: "12 måneder" },
    devices: (n) => `${n} ${n > 1 ? "tilkoblinger" : "tilkobling"}`, withDevices: (what, n) => `${what} (${n} tilkoblinger)`,
  },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace";
const C = { page: "#F2F3F5", card: "#FFFFFF", ink: "#14171F", body: "#4B5161", muted: "#8A8F9C", line: "#E6E8EC", box: "#F7F8FA" };
const NO_NAME = ["anonymous", "anonym", "(not provided)", "not provided", "ikke oppgitt", "non renseigné", "nicht angegeben", "-", "—"];

const T = () => TEXT[SITE.lang] || TEXT.en;

// The price as the client saw it on the site: "$49 USD", "49 €", "£39", "1215 kr".
function money(n, cur, html = true) {
  const sp = html ? "&nbsp;" : " ", lang = SITE.lang;
  const v = Number.isInteger(n) ? String(n) : Number(n).toFixed(2).replace(".", lang === "en" ? "." : ",");
  if (cur === "EUR") return lang === "en" ? `€${v}` : `${v}${sp}€`;
  if (cur === "GBP") return `£${v}`;
  if (cur === "NOK") return `${v}${sp}kr`;
  if (!html) return `$${v}`;
  return lang === "en" ? `$${v} USD` : lang === "fr" ? `${v}${sp}$${sp}US` : `${v}${sp}USD`;
}
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// Reads the order out of whatever plan text the site sends, in any of its languages:
// "12 Months - 1 Device — $49", "6 Monate / 1 Verbindung / 39€", "1 Jahr IPTV Abo für 2 Geräte – 89 € (2 Geräte, 1 Jahr)",
// "2 appareils — 12 mois — 69€", "12 Months · 2 Devices — £62", "12 måneder – 3 tilkoblinger – kr 1215"
// → { amount (site's own price), cur (site's currency), usd (invoice price), months, devices }
function parsePlan(plan) {
  const s = String(plan || "").replace(/\s+/g, " ");
  const num = (v) => Number(String(v).replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  const CUR = { "$": "USD", "€": "EUR", "£": "GBP", usd: "USD", eur: "EUR", gbp: "GBP" };
  let amount = null, cur = null;
  const sym = s.match(/([$€£])\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(€|\$|£|USD|EUR|GBP)/i);
  const nok = s.match(/(?:\bkr\.?|\bNOK)\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:kr\b|NOK\b)/i);
  if (sym) { amount = num(sym[2] || sym[3]); cur = CUR[(sym[1] || sym[4]).toLowerCase()]; }
  else if (nok) { amount = num(nok[1] || nok[2]); cur = "NOK"; }
  cur = SITE.cur || cur || "USD";
  const usd = amount == null ? null : SITE.map ? SITE.map[amount] ?? null : cur === "NOK" ? null : amount;
  const year = /(?:^|[^\d])(?:1|one|un|ein|ett)\s*(?:years?|an|ans|année|jahr|år)(?![a-zà-ÿ])/i.test(s);
  const m = s.match(/(\d+)\s*(?:months?|mois|monate?|måned(?:er)?|maaned(?:er)?)(?![a-zà-ÿ])/i) || s.match(/(?:^|[^\w])(\d+)m(?![a-zà-ÿ\d])/i);
  const months = m ? Number(m[1]) : year ? 12 : null;
  const d = s.match(/(\d+)\s*(?:devices?|connections?|connexions?|appareils?|écrans?|ger(?:ä|a)te?|verbindung(?:en)?|tilkobling(?:er)?|enhet(?:er)?)(?![a-zà-ÿ])/i);
  return { amount, cur, usd, months, devices: d ? Number(d[1]) : 1 };
}

function describe({ months, devices }) {
  const t = T(), base = t.months[months] || t.months[12];
  return devices > 1 ? t.withDevices(base, devices) : base;
}

function summary({ months, devices }) {
  const t = T();
  return `${t.plan[months] || ""} · ${t.devices(devices)}`.replace(/^ · /, "");
}

function linkFor(usd) {
  return Number.isInteger(usd) && LINKS[usd] ? LINKS[usd] : null;
}

function greeting(name) {
  const full = String(name || "").trim(), first = full.split(/\s+/)[0] || "";
  return !first || NO_NAME.includes(full.toLowerCase()) ? T().hiAnon : fmt(T().hi, { name: esc(first) });
}

function invoiceEmail({ name, parsed, link }) {
  const S = SITE, t = T(), what = describe(parsed);
  const vars = { brand: esc(S.name), domain: S.domain };
  const p = (html, extra = "") => `<p style="margin:0 0 16px;font-size:16px;line-height:25px;color:${C.body};${extra}">${html}</p>`;
  const wa = `${S.waUrl || `https://wa.me/${S.wa}`}?text=${encodeURIComponent(fmt(t.waText, { brand: S.name }))}`;
  return `<!DOCTYPE html>
<html lang="${S.lang === "no" ? "nb" : S.lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(S.name)}</title>
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
  img{border:0;outline:none;text-decoration:none}a{text-decoration:none}
  @media only screen and (max-width:620px){.o{padding:12px 8px!important}.x{padding-left:22px!important;padding-right:22px!important}.b{padding-left:18px!important;padding-right:18px!important}.v{display:block!important;width:100%!important;text-align:left!important;padding-top:0!important;border-top:0!important}.l{display:block!important;width:100%!important;padding-bottom:2px!important}}
</style></head>
<body style="margin:0;padding:0;background-color:${C.page};" bgcolor="${C.page}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${fmt(t.preheader, { what: esc(what) })}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" class="o" style="padding:24px 10px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="max-width:600px;background-color:${C.card};border-radius:10px;border-collapse:separate;font-family:${FONT};">
  <tr><td align="center" bgcolor="${S.head}" style="background-color:${S.head};border-bottom:1px solid ${S.headLine || S.head};border-radius:10px 10px 0 0;padding:24px 20px;">
    <a href="${S.url}" target="_blank"><img src="${S.logo.src}" width="${S.logo.w}" height="${S.logo.h}" alt="${esc(S.name)}" style="display:block;margin:0 auto;max-width:100%;height:auto;color:${S.head === "#FFFFFF" ? C.ink : "#FFFFFF"};font:700 22px ${FONT};"></a>
  </td></tr>
  <tr><td class="x" style="padding:32px 40px 8px;">
    ${p(greeting(name), `color:${C.ink};font-weight:600;`)}
    ${p(fmt(t.intro, { what: esc(what) }))}
  </td></tr>
  <tr><td class="x" style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.box}" style="background-color:${C.box};border:1px solid ${C.line};border-top:3px solid ${S.btn};border-radius:8px;border-collapse:separate;">
      <tr><td class="b" style="padding:22px 26px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="l" style="padding:0 0 10px;font-size:14px;line-height:22px;color:${C.muted};">${t.order}</td>
              <td class="v" align="right" style="padding:0 0 10px;font-size:15px;line-height:22px;font-weight:700;color:${C.ink};">${esc(summary(parsed))}</td></tr>
          <tr><td class="l" style="padding:10px 0 18px;border-top:1px solid ${C.line};font-size:14px;line-height:22px;color:${C.muted};">${t.amount}</td>
              <td class="v" align="right" style="padding:10px 0 18px;border-top:1px solid ${C.line};font-size:20px;line-height:24px;font-weight:800;color:${C.ink};">${money(parsed.amount, parsed.cur)}</td></tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${S.btn}" style="background-color:${S.btn};border-radius:6px;">
            <a href="${esc(link)}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:16px;line-height:20px;font-weight:700;color:${S.onBtn || "#FFFFFF"};border-radius:6px;">${t.pay} &rarr;</a>
          </td></tr></table>
        <div style="margin:16px 0 0;padding:10px 12px;background-color:${C.card};border:1px solid ${C.line};border-radius:6px;font-family:${MONO};font-size:14px;line-height:21px;word-break:break-all;"><a href="${esc(link)}" target="_blank" style="color:${S.accent};font-weight:700;">${esc(link)}</a></div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="x" style="padding:0 40px 12px;">
    ${p(t.note)}
    ${p(t.activation.replace("<strong>", `<strong style="color:${C.ink};">`))}
    ${p(t.screenshot, `padding:14px 16px;background-color:${C.box};border-left:3px solid ${S.btn};border-radius:4px;color:${C.ink};`)}
  </td></tr>
  <tr><td class="x" style="padding:0 40px 36px;">
    <div style="border-top:1px solid ${C.line};padding-top:22px;">
      ${p(`${t.thanks}<br><strong style="color:${C.ink};">${fmt(t.team, vars)}</strong>`, "margin:0;")}
    </div>
  </td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};">
  <tr><td align="center" style="padding:20px 16px 4px;font-size:12px;line-height:20px;color:${C.muted};">
    <a href="${S.url}" target="_blank" style="color:${C.muted};">${S.domain}</a>
    &nbsp;&middot;&nbsp; <a href="${wa}" target="_blank" style="color:${C.muted};">WhatsApp${S.waLabel ? "&nbsp;" + esc(S.waLabel).replace(/ /g, "&nbsp;") : ""}</a>
    &nbsp;&middot;&nbsp; <a href="mailto:${S.email}" style="color:${C.muted};">${S.email}</a><br>
    ${fmt(t.why, vars)}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

// Served at /invoice.js for the static sites' order pages. After an EmailJS order send succeeds
// (emailjs.send, emailjs.sendForm or a fetch to api.emailjs.com), it posts the order to /invoice.
// It never changes what the page does, does nothing on a failed send, and posts each order once
// (EmailJS v4's emailjs.send goes through fetch, so both hooks see the same order).
function hookScript(base) {
  return `(function(){
var U=${JSON.stringify(base + "/invoice")},seen={};
function post(p){try{
  var email=String(p.from_email||p.email||p.reply_to||"").trim();
  var plan=String(p.plan||"");if(p.price&&plan.indexOf(p.price)<0)plan+=" — "+p.price;
  if(!plan||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return;
  var k=email.toLowerCase()+"|"+plan;if(seen[k]&&Date.now()-seen[k]<60000)return;seen[k]=Date.now();
  var body=JSON.stringify({name:String(p.from_name||p.full_name||p.name||""),email:email,plan:plan});
  (window.__ivFetch||fetch)(U,{method:"POST",headers:{"Content-Type":"application/json"},body:body,keepalive:true}).catch(function(){});
}catch(e){}}
function after(pr,p){try{if(pr&&pr.then)pr.then(function(){post(p);},function(){});}catch(e){}return pr;}
function formObj(f){var o={};try{if(typeof f==="string")f=document.querySelector(f);new FormData(f).forEach(function(v,k){o[k]=v;});}catch(e){}return o;}
if(!window.__ivFetch){window.__ivFetch=window.fetch;window.fetch=function(u,o){
  var pr=window.__ivFetch.apply(this,arguments);
  try{if(String(u&&u.url||u).indexOf("api.emailjs.com")>-1&&o&&typeof o.body==="string"){var b=JSON.parse(o.body);
    pr.then(function(r){if(r&&r.ok)post(b.template_params||{});},function(){});}}catch(e){}
  return pr;};}
function wrap(){var e=window.emailjs;if(!e||!e.send||e.__iv)return !!(e&&e.__iv);
  var s=e.send,sf=e.sendForm;
  e.send=function(a,b,p){return after(s.apply(this,arguments),p||{});};
  if(sf)e.sendForm=function(a,b,f){var o=formObj(f);return after(sf.apply(this,arguments),o);};
  e.__iv=1;return true;}
if(!wrap()){var n=0,t=setInterval(function(){if(wrap()||++n>200)clearInterval(t);},50);}
})();`;
}

const cors = (origin) => ({ "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" });
const json = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });

async function send(env, from, to, subject, html, replyTo) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_KEY || env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend (${res.status}): ${await res.text()}`);
}

// GET <base>/invoice.js and POST <base>/invoice ("/invoice" on the Workers, "/api/invoice" on Pages).
// Returns null for any other request.
async function handle(request, env) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/invoice.js") && request.method === "GET") {
    return new Response(hookScript(url.origin + url.pathname.slice(0, -"/invoice.js".length)), { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  }
  if (!url.pathname.endsWith("/invoice")) return null;
  const origin = request.headers.get("Origin") || "";
  const host = origin.replace(/^https?:\/\/(www\.)?/, "");
  if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "not found" }, 404, origin);
  // Only the site's own pages may ask for an invoice.
  if (host !== SITE.domain) return json({ error: "unknown site" }, 403, origin);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, origin); }
  const name = String(body.name || "").trim().slice(0, 100);
  const email = String(body.email || "").trim().slice(0, 200);
  const planText = String(body.plan || "").slice(0, 300);
  // A form without the client's email falls back to the site's own address: nothing to send then.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.toLowerCase().endsWith("@" + SITE.domain) || !planText) {
    return json({ success: true, invoice: false }, 200, origin);
  }
  // No plan length in the text means it isn't a plan order (a lead or trial form): nothing to do.
  const parsed = parsePlan(planText);
  if (!parsed.months) return json({ success: true, invoice: false }, 200, origin);

  const link = linkFor(parsed.usd);
  const S = SITE, from = `${S.name} <${S.from || S.email}>`, admin = S.admin || S.email;
  const who = `${name || "-"} / ${email}`, price = parsed.amount == null ? "?" : money(parsed.amount, parsed.cur, false);
  const facts = `Name: ${esc(name || "-")}<br>Email: ${esc(email)}<br>Plan: ${esc(planText)}`;
  try {
    // Manual mode (INVOICE_MODE, or SITE.manual on a site that is always manual): only the site inbox hears about the sale.
    if (S.manual || INVOICE_MODE !== "send_client") {
      const pay = link ? `<br>Payment link for $${parsed.usd}: <a href="${link}">${link}</a>` : "<br>Payment link: none for this amount";
      await send(env, from, admin, `sale / ${S.domain} / ${price} / ${who}`,
        `<p>New sale on ${S.domain}. Invoices are manual right now, so nothing was emailed to the client. Please deliver the order and send the invoice yourself.</p><p>${facts}<br>Price: ${esc(price)}${pay}</p>`, email);
      return json({ success: true, invoice: false }, 200, origin);
    }
    if (!link) {
      await send(env, from, admin, `invoice NOT sent / ${S.domain} / ${price} / ${who}`,
        `<p>No payment link matches this order, so no invoice was emailed to the client. Please send it by hand.</p><p>${facts}<br>Price read: ${esc(price)}</p>`, email);
      return json({ success: true, invoice: false }, 200, origin);
    }
    await send(env, from, email, T().subject, invoiceEmail({ name, parsed, link }), S.email);
    await send(env, from, admin, `invoice / ${S.domain} / $${parsed.usd} / ${who}`,
      `<p>Invoice emailed to the client.</p><p>${facts}<br>Price shown to the client: ${esc(price)}<br>Link ($${parsed.usd}): <a href="${link}">${link}</a></p>`, email);
    return json({ success: true, invoice: true }, 200, origin);
  } catch (err) {
    console.error("[invoice]", err.message);
    return json({ success: false, error: err.message }, 500, origin);
  }
}

return { handle, hookScript, invoiceEmail, parsePlan, describe, linkFor, money };
})();

// ── end invoice emails ──

// ── order notification ──
// The site's order, referral and manual free-trial forms POST { type, plan, price, name, email, whatsapp, country,
// friend_*, page } here after /api/ajax has accepted them, and the site inbox gets the order email
// ("iptvmapletv.com - 12 Months — $89 / name / email", reply-to the client). The Pages Function only stores
// leads in KV, so without this nobody is emailed when an order comes in. No dedupe: every order is emailed.
async function handleOrderNotice(request, env) {
  if (new URL(request.url).pathname !== "/order") return null;
  const headers = cors(request);
  const res = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return res({ success: false, error: "POST only" }, 405);
  // Only the site's own pages send orders here.
  if (!ALLOWED_ORIGIN.test(request.headers.get("Origin") || "")) return res({ success: false, error: "unknown site" }, 403);
  let body;
  try { body = await request.json(); } catch { return res({ success: false, error: "Invalid JSON" }, 400); }
  const get = (k) => String(body[k] || "").trim().slice(0, 200);
  if (get("website")) return res({ success: true });
  const type = ["order", "referral", "free-trial"].includes(get("type")) ? get("type") : "order";
  const name = get("name"), email = get("email"), plan = get("plan"), price = get("price").replace(/[^\d.]/g, "");
  if (!name && !email) return res({ success: false, error: "empty" }, 400);
  if (!env.RESEND_KEY) return res({ success: false, error: "RESEND_KEY secret not set" }, 500);
  const who = `${name || "-"} / ${email || "-"}`;
  const subject = type === "referral" ? `${SITE} - Referral / ${who}`
    : type === "free-trial" ? `${SITE} - Free trial (manual) / ${who}`
    : `${SITE} - ${plan || "Order"}${price ? ` — $${price}` : ""} / ${who}`;
  const row = (k, v) => `<tr><td style="color:#888;width:130px;">${k}</td><td>${esc(v || "—")}</td></tr>`;
  const title = type === "referral" ? "New referral" : type === "free-trial" ? "New free trial request (send by hand)" : "New order";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;padding:20px;">
  <h2 style="color:#ff2d4a;margin-top:0;">${title} — ${SITE}</h2>
  <table cellpadding="6" cellspacing="0" border="0">
    ${type === "order" ? row("Plan", plan) + row("Price", price ? `$${price}` : "") : ""}${row("Name", name)}${row("Email", email)}${row("WhatsApp", get("whatsapp"))}${row("Country", get("country"))}
    ${type === "referral" ? row("Friend's name", get("friend_name")) + row("Friend's phone", get("friend_phone")) + row("Friend's email", get("friend_email")) : ""}
    ${row("Page", get("page"))}${row("IP country", request.cf?.country)}${row("Received", new Date().toISOString())}
  </table></body></html>`;
  try {
    const payload = { from: env.TRIAL_FROM_EMAIL || FROM_EMAIL, to: env.TRIAL_ADMIN_EMAIL || ADMIN_EMAIL, subject, html };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) payload.reply_to = email;
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!sent.ok) throw new Error(`Resend ${sent.status}: ${(await sent.text()).slice(0, 200)}`);
    return res({ success: true });
  } catch (err) {
    console.error("[order_notice]", err.message);
    return res({ success: false, error: err.message }, 502);
  }
}

export default {
  async fetch(request, env) { return (await INVOICE.handle(request, env)) || (await handleOrderNotice(request, env)) || tkLogoResponse(request) || handleFetch(request, env); },
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

  const data = await panelGet(env, { action: "new", type: "m3u", sub: "99", pack, note: `Trial / ${SITE} / ${email} | ${whatsapp || ""}`, notes: `Trial / ${SITE} / ${email} | ${whatsapp || ""}` });
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
  "home": "/",
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
    "step": "#06070B",
    "hero": "#06070B",
    "heroEnd": "#56131F",
    "heroInk": "#FFFFFF",
    "heroSub": "#CDCDCE",
    "tagBg": "#1F2023",
    "tagInk": "#E65095",
    "heroBtn": "#FF2D4A",
    "heroOnBtn": "#FFFFFF",
    "code": "#FFF5F6",
    "codeLine": "#FFA1AE",
    "soft": "#FFEAED"
  },
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
  ],
  "wa": "17828026280",
  "waLabel": "+1 782-802-6280",
  "host": PANEL_HOST,
  "altHost": ALT_HOST,
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
  ],
  "s": {
    "bg": "#06070B",
    "glow": "#3D0F19",
    "glow2": "#250B1B",
    "mid": "#0D0E12",
    "card": "#121317",
    "panel": "#050508",
    "code": "#1A1B1F",
    "line": "#292A2D",
    "ink": "#FFFFFF",
    "body": "#C8C8C9",
    "muted": "#8F8F91",
    "accent": "#FF2D4A",
    "accent2": "#E0247A",
    "onAccent": "#FFFFFF",
    "head": "#212226",
    "head2": "#3C232A",
    "badge": "#461922",
    "tag": "#E33A87",
    "link": "#E33A87",
    "pill": false
  }
};

// IPTVMaple header logo (PNG), served at /email/logo.png for the emails.
const EMAIL_LOGO_PNG = "iVBORw0KGgoAAAANSUhEUgAAAXwAAABYCAMAAADBc7xsAAAWfmNhQlgAABZ+anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFlhqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjA2YWM4YjNkLWUwZGMtNDNlOC1iY2MzLTYwYmZjYjdjOTA0YwAAAAOTanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuGp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNoXQRJWwvFlxqdMF0qdsTrigAAAGxjYm9yo2lkYzpmb3JtYXRpaW1hZ2UvcG5namluc3RhbmNlSUR4LHhtcDppaWQ6ZWVjODNjZDItM2E1ZS00YzFkLWI1MmMtMmYzNDhlMGUyOGY5bHJlbGF0aW9uc2hpcGhwYXJlbnRPZgAAAeJqdW1iAAAAQWp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuYWN0aW9ucy52MgAAAAAYYzJzaC/1UqvjeRaHYIWtTiET4AIAAAGZY2JvcqJnYWN0aW9uc4KiZmFjdGlvbmtjMnBhLm9wZW5lZGpwYXJhbWV0ZXJzoWtpbmdyZWRpZW50c4GiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIFz1uILlb+vmzpZyNt54vzu9hWP7nSVtwp6QrowLh3+6pGZhY3Rpb254HWNvbS5hbnRocm9waWMuY2xhdWRlLnByb3ZpZGVkanBhcmFtZXRlcnOheB9jb20uYW50aHJvcGljLm9yaWdpbi1jb25maWRlbmNlZ3Vua25vd25rZGVzY3JpcHRpb254ZkNsYXVkZSBwcm92aWRlZCB0aGlzIGZpbGUgYXQgdGhlIHJlcXVlc3Qgb2YgYSB1c2VyIGFuZCBtYXkgaGF2ZSBjcmVhdGVkIG9yIG1vZGlmaWVkIHRoZSBmaWxlIGNvbnRlbnRzLm1zb2Z0d2FyZUFnZW50oWRuYW1lZkNsYXVkZXJhbGxBY3Rpb25zSW5jbHVkZWT1AAAAyGp1bWIAAABAanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5oYXNoLmRhdGEAAAAAGGMyc2j/IUOu4I1ML1C+vGU3+ZdUAAAAgGNib3KlY2FsZ2ZzaGEyNTZjcGFkTQAAAAAAAAAAAAAAAABkaGFzaFggQafkLgoIo/bLOhAZxQlnYQSLu3o3efk/2NjJj8Hp/9hkbmFtZW5qdW1iZiBtYW5pZmVzdGpleGNsdXNpb25zgaJlc3RhcnQYIWZsZW5ndGgZFooAAAI+anVtYgAAACdqdW1kYzJjbAARABCAAACqADibcQNjMnBhLmNsYWltLnYyAAAAAg9jYm9ypWNhbGdmc2hhMjU2aXNpZ25hdHVyZXhNc2VsZiNqdW1iZj0vYzJwYS91cm46YzJwYTowNmFjOGIzZC1lMGRjLTQzZTgtYmNjMy02MGJmY2I3YzkwNGMvYzJwYS5zaWduYXR1cmVqaW5zdGFuY2VJRHgseG1wOmlpZDpmYzQ3MjA4NS00ZjgyLTQ0MTYtOWQ2Ni1iMmY3NTQzN2I4YTByY3JlYXRlZF9hc3NlcnRpb25zg6JjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmluZ3JlZGllbnQudjNkaGFzaFggXPW4guVv6+bOlnI23ni/O72FY/udJW3CnpCujAuHf7qiY3VybHgqc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5hY3Rpb25zLnYyZGhhc2hYIFvk+LG7Usmh5hva0hZzT8mdzdSIW4tjWvGPROvb+QOzomN1cmx4KXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaGFzaC5kYXRhZGhhc2hYILb2JGSSWPc9kBWp3ZiGv4J/fzxv3q9PdSS0vPNvqWVddGNsYWltX2dlbmVyYXRvcl9pbmZvo2RuYW1lb0FudGhyb3BpYyBGaWxlc2d2ZXJzaW9uZTEuMC4wa3NwZWNWZXJzaW9uZTIuNC4wAAAQOGp1bWIAAAAoanVtZGMyY3MAEQAQgAAAqgA4m3EDYzJwYS5zaWduYXR1cmUAAAAQCGNib3LShFkCEqIBJhghWQIKMIICBjCCAY2gAwIBAgIUQOWgCu7COdC+uIP6BkIFPWdVEwAwCgYIKoZIzj0EAwMwSTEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxLjAsBgNVBAMTJUFudGhyb3BpYyBDb250ZW50IENyZWRlbnRpYWxzIFJvb3QgQ0EwHhcNMjYwODA3MTg0MzU2WhcNMjgwODA2MTk0MzU2WjBEMRcwFQYDVQQKEw5BbnRocm9waWMsIFBCQzEpMCcGA1UEAxMgQW50aHJvcGljIENsYXVkZSBDb250ZW50IFNpZ25pbmcwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASYegpry1AYBRTVNL1CpTlbROnY3dey+UrsF9C3phYrATN3ZHf93Mo8RQN0KOUuOn19P4oWNFWe5n2/She9N7eTo1gwVjAOBgNVHQ8BAf8EBAMCB4AwFQYDVR0lBA4wDAYKKwYBBAGD6F4CATAMBgNVHRMBAf8EAjAAMB8GA1UdIwQYMBaAFM5R4gSBTmRbI/jjxM+aPpzB11zCMAoGCCqGSM49BAMDA2cAMGQCMDFzHRSeAXrSy1WOzkbhPZ6Km2wGTmZ/2gK18k8BQGXyqz88Rdrz6CTX9flAnYNVxgIwcF9c3fVhqmJKpi+UhasNUMko69cyX6STPfta3Q8EjyzDjzoyrol46FP6VFHhvUcJoWNwYWRZDZ4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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";

const EMAIL_TEXT = {
  "subject": "Your {brand} free trial",
  "hi": "Hi {name},",
  "hiAnon": "Hi there,",
  "w_pre": "Your free trial login details are inside.",
  "w_tag": "Free trial · 24 hours",
  "w_title": "Welcome to {brand}",
  "w_intro": "Your free trial is active for the next 24 hours. Here are your login details.",
  "xtream": "Xtream Codes",
  "m3u": "M3U playlist",
  "username": "Username",
  "password": "Password",
  "server": "Server URL",
  "backup": "Backup server",
  "copyNote": "Copy these into an IPTV app. They do not open in a browser.",
  "howTitle": "How to start",
  "steps": [
    "Install <strong>IPTV Smarters Pro</strong>, <strong>TiviMate</strong> or <strong>IBO Player</strong> on your TV, phone or computer.",
    "Choose <strong>Xtream Codes</strong> and enter your username, password and server URL. Or paste the M3U playlist.",
    "Press play and enjoy."
  ],
  "help": "Need help? Reply to this email or",
  "wa": "message us on WhatsApp",
  "team": "The {brand} Team",
  "r_pre": "About 4 hours of your free trial are left.",
  "r_tag": "About 4 hours left",
  "r_title": "Your free trial ends soon",
  "r_intro": "Subscribe now to keep watching. Your login stays the same.",
  "f_pre": "Your free trial has ended.",
  "f_tag": "Trial ended",
  "f_title": "Your free trial has ended",
  "f_intro": "Thanks for trying {brand}. Subscribe to get back in with the same login.",
  "plans": "See plans",
  "m1": "1 month",
  "mN": "{n} months",
  "year": "12 months",
  "device1": "1 device",
  "deviceN": "{n} devices",
  "best": "Best price",
  "plansTitle": "Choose your plan",
  "plansSub": "Tap a price to go straight to checkout.",
  "replyYes": "Or reply <strong>YES</strong> and we will set it up for you.",
  "loginAgain": "Your login",
  "footer": "You received this because you requested a free trial on {domain}."
};

// Simple trial email kit: logo on a dark brand background, one card with a short welcome,
// the login details, a 3-line guide and one support line. No emojis.
// Login values are plain monospace text, never links (split into spans so mail apps don't auto-link).
// Needs EMAIL_BRAND and EMAIL_TEXT defined above it.

const TK_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const TK_MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

function tkEsc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function tkFmt(str, vars = {}) { return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }
function tkT(key, vars = {}) { return tkFmt(EMAIL_TEXT[key], { brand: tkEsc(EMAIL_BRAND.name), domain: EMAIL_BRAND.domain, ...vars }); }
function tkHi(name) {
  const full = String(name || "").trim(), first = full.split(/\s+/)[0] || "";
  if (!first || EMAIL_BRAND.noName.includes(full.toLowerCase())) return EMAIL_TEXT.hiAnon;
  return tkFmt(EMAIL_TEXT.hi, { name: tkEsc(first) });
}
function tkMoney(n) { const m = EMAIL_BRAND.money; return m.pre + (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", m.dec)) + m.post; }
function tkLink(url, campaign) { const abs = /^https?:/.test(url) ? url : EMAIL_BRAND.url + url; return abs + (abs.includes("?") ? "&" : "?") + "utm_source=trial_email&utm_medium=email&utm_campaign=" + campaign; }
function tkWa() { return `https://wa.me/${EMAIL_BRAND.wa}?text=${encodeURIComponent(EMAIL_BRAND.name + ": free trial")}`; }
function tkServers() { return [...new Set([EMAIL_BRAND.host, EMAIL_BRAND.altHost].filter(Boolean))]; }
function tkM3u(u) { u = String(u || ""); const alt = EMAIL_BRAND.altHost; return alt && u.startsWith(alt + "/") ? EMAIL_BRAND.host + u.slice(alt.length) : u; }
function tkPlain(v) { return String(v ?? "").split(/(?=[.:/?&=])/).map(p => `<span>${tkEsc(p)}</span>`).join(""); }

function tkLogoResponse(request) {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/email/logo.png") return null;
  const bin = atob(EMAIL_LOGO_PNG), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
}

// ── layout ───────────────────────────────────────────────────────────────────

function tkShell(preheader, card) {
  const B = EMAIL_BRAND, S = B.s;
  return `<!DOCTYPE html>
<html lang="${B.lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${tkEsc(B.name)}</title>
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
  a[x-apple-data-detectors], .tk-code a, #MessageViewBody .tk-code a { color:inherit !important; text-decoration:none !important; font:inherit !important; pointer-events:none; cursor:text; }
  u + #tk-body .tk-code a { color:inherit !important; text-decoration:none !important; }
  @media only screen and (max-width:620px) {
    .tk-outer { padding:28px 12px 8px !important; }
    .tk-pad { padding-left:22px !important; padding-right:22px !important; }
    .tk-h1 { font-size:26px !important; line-height:32px !important; }
    .tk-half { display:block !important; width:100% !important; padding:0 !important; }
    .tk-panel { padding:18px 14px 8px !important; }
    .tk-code { font-size:14px !important; padding:11px 12px !important; }
  }
</style>
</head>
<body id="tk-body" style="margin:0;padding:0;width:100%;background-color:${S.bg};" bgcolor="${S.bg}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${S.bg}" style="background-color:${S.bg};background-image:linear-gradient(165deg,${S.glow} 0%,${S.bg} 30%,${S.mid} 65%,${S.glow2} 100%);">
<tr><td align="center" class="tk-outer" style="padding:40px 16px 12px;">
<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${TK_FONT};">
  <tr><td align="center" style="padding:0 0 30px;">
    <a href="${tkLink(B.home, "header")}" target="_blank" style="text-decoration:none;">${S.pill ? `<span style="display:inline-block;padding:12px 22px;border-radius:14px;background-color:#FFFFFF;">` : ""}<img src="${B.logo.src}" width="${B.logo.w}" height="${B.logo.h}" alt="${tkEsc(B.name)}" style="display:block;margin:0 auto;width:${B.logo.w}px;max-width:100%;height:auto;color:#FFFFFF;font:700 24px ${TK_FONT};">${S.pill ? "</span>" : ""}</a>
  </td></tr>
  <tr><td bgcolor="${S.card}" style="background-color:${S.card};border:1px solid ${S.line};border-radius:20px;overflow:hidden;">
    <div style="height:4px;line-height:4px;font-size:4px;background-color:${S.accent};background-image:linear-gradient(90deg,${S.accent} 0%,${S.accent2} 100%);border-radius:20px 20px 0 0;">&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${card}</table>
  </td></tr>
  <tr><td align="center" style="padding:24px 16px 28px;font-size:12px;line-height:19px;color:${S.muted};">
    <a href="${tkLink(B.home, "footer")}" target="_blank" style="color:${S.muted};text-decoration:none;font-weight:600;">${B.domain}</a><br>
    ${tkT("footer")}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function tkRow(inner, pad = "0 36px 28px") { return `<tr><td class="tk-pad" style="padding:${pad};">${inner}</td></tr>`; }

// Small tag, headline, one or two short lines.
function tkTop(tag, title, intro, name) {
  const S = EMAIL_BRAND.s;
  return tkRow(`
    <div style="margin:0 0 14px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${S.tag};">${tag}</div>
    <div class="tk-h1" style="margin:0 0 14px;font-size:30px;line-height:36px;font-weight:800;color:${S.ink};">${title}</div>
    <div style="font-size:16px;line-height:25px;color:${S.body};"><strong style="color:${S.ink};">${tkHi(name)}</strong><br>${intro}</div>`, "36px 36px 28px");
}

function tkField(label, value) {
  const S = EMAIL_BRAND.s;
  return `<div style="margin:0 0 12px;">
      <div style="margin:0 0 6px;font-size:11px;line-height:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${S.muted};">${label}</div>
      <div class="tk-code" style="padding:12px 14px;background-color:${S.code};border:1px solid ${S.line};border-radius:10px;font-family:${TK_MONO};font-size:16px;line-height:22px;font-weight:600;color:${S.ink};word-break:break-all;-webkit-user-select:all;user-select:all;">${tkPlain(value)}</div>
    </div>`;
}

function tkGroupTitle(text, first) {
  const S = EMAIL_BRAND.s;
  return `<div style="margin:${first ? 0 : "10px"} 0 14px;font-size:14px;line-height:18px;font-weight:800;color:${S.ink};"><span style="display:inline-block;width:8px;height:8px;margin:0 8px 1px 0;border-radius:4px;background-color:${S.accent};"></span>${text}</div>`;
}

// The login details. Username and password first, then servers, then the M3U playlist.
function tkLogins(username, password, m3uUrl, title) {
  const S = EMAIL_BRAND.s, T = EMAIL_TEXT, [main, backup] = tkServers();
  return tkRow(`
    ${title ? `<div style="margin:0 0 14px;font-size:18px;line-height:24px;font-weight:800;color:${S.ink};">${title}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${S.panel}" style="background-color:${S.panel};border-radius:14px;"><tr><td class="tk-panel" style="padding:22px 22px 12px;">
      ${tkGroupTitle(T.xtream, true)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="tk-half" width="50%" valign="top" style="padding:0 6px 0 0;">${tkField(T.username, username)}</td>
        <td class="tk-half" width="50%" valign="top" style="padding:0 0 0 6px;">${tkField(T.password, password)}</td>
      </tr></table>
      ${tkField(T.server, main)}
      ${backup ? tkField(T.backup, backup) : ""}
      <div style="height:1px;line-height:1px;font-size:1px;background-color:${S.line};margin:8px 0 18px;">&nbsp;</div>
      ${tkGroupTitle(T.m3u)}
      ${tkField("M3U URL", tkM3u(m3uUrl))}
    </td></tr></table>
    <div style="margin:12px 2px 0;font-size:13px;line-height:19px;color:${S.muted};">${T.copyNote}</div>`);
}

function tkSteps() {
  const S = EMAIL_BRAND.s, T = EMAIL_TEXT;
  const rows = T.steps.map((t, i) => `<tr>
      <td width="38" valign="top" style="padding:0 0 14px;"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;background-color:${S.accent};color:${S.onAccent};font-size:13px;font-weight:800;text-align:center;">${i + 1}</div></td>
      <td valign="top" style="padding:2px 0 14px;font-size:15px;line-height:22px;color:${S.body};">${t.replace(/<strong>/g, `<strong style="color:${S.ink};">`)}</td>
    </tr>`).join("");
  return tkRow(`<div style="margin:0 0 16px;font-size:18px;line-height:24px;font-weight:800;color:${S.ink};">${T.howTitle}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`, "6px 36px 16px");
}

function tkHelp() {
  const B = EMAIL_BRAND, S = B.s, T = EMAIL_TEXT;
  return tkRow(`<div style="border-top:1px solid ${S.line};padding-top:22px;font-size:15px;line-height:23px;color:${S.body};">
      ${T.help} <a href="${tkWa()}" target="_blank" style="color:${S.link};font-weight:700;text-decoration:none;">${T.wa}</a>.<br>
      <span style="color:${S.ink};font-weight:700;">${tkT("team")}</span>
    </div>`, "0 36px 34px");
}

function tkButton(href, label) {
  const S = EMAIL_BRAND.s;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="${S.accent}" style="background-color:${S.accent};border-radius:999px;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${TK_FONT};font-size:16px;line-height:20px;font-weight:800;color:${S.onAccent};text-decoration:none;border-radius:999px;">${label}</a>
      </td></tr></table>`;
}

function tkTerm(m) { const T = EMAIL_TEXT; return m === 1 ? T.m1 : m === 12 ? T.year : tkFmt(T.mN, { n: m }); }

function tkPlanRows(plans, campaign) {
  const S = EMAIL_BRAND.s, T = EMAIL_TEXT, top = Math.max(...plans.map(p => p.months));
  return plans.map((p, i) => `<tr><td style="${i ? `border-top:1px solid ${S.line};` : ""}padding:0;">
      <a href="${tkLink(p.url, campaign)}" target="_blank" style="display:block;padding:13px 16px;text-decoration:none;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-size:15px;line-height:21px;color:${S.body};">${tkTerm(p.months)}${p.months === top && plans.length > 2 ? `&nbsp; <span style="display:inline-block;padding:2px 8px;border-radius:999px;background-color:${S.badge};font-size:11px;line-height:15px;font-weight:800;color:${S.tag};">${T.best}</span>` : ""}</td>
          <td align="right" style="font-size:16px;line-height:21px;font-weight:800;color:${S.ink};white-space:nowrap;">${tkMoney(p.price)}&nbsp;<span style="color:${S.tag};">&rsaquo;</span></td>
        </tr></table></a></td></tr>`).join("");
}

// Plans as linked rows. all = one block per device count (1 to 5), else the 1-device plans only.
function tkPlans(campaign, all) {
  const B = EMAIL_BRAND, S = B.s, T = EMAIL_TEXT;
  const groups = (all ? B.grid : B.grid.slice(0, 1)).map(g => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${S.panel}" style="background-color:${S.panel};border:1px solid ${S.line};border-radius:14px;border-collapse:separate;margin:0 0 14px;">
      ${all ? `<tr><td bgcolor="${S.head}" style="background-color:${S.head};background-image:linear-gradient(90deg,${S.head} 0%,${S.head2} 100%);border-radius:13px 13px 0 0;padding:11px 16px;font-size:15px;line-height:20px;font-weight:800;color:#FFFFFF;"><span style="display:inline-block;width:8px;height:8px;margin:0 8px 1px 0;border-radius:4px;background-color:${S.accent};"></span>${g.devices === 1 ? T.device1 : tkFmt(T.deviceN, { n: g.devices })}</td></tr>` : ""}
      ${tkPlanRows(g.plans, campaign)}
    </table>`).join("");
  return tkRow(`
    ${all ? `<div style="margin:0 0 4px;font-size:18px;line-height:24px;font-weight:800;color:${S.ink};">${T.plansTitle}</div><div style="margin:0 0 16px;font-size:14px;line-height:20px;color:${S.muted};">${T.plansSub}</div>` : ""}
    ${groups}
    <div style="padding-top:6px;">${tkButton(tkLink(B.plansUrl, campaign), T.plans)}</div>
    ${B.replyYes ? `<div style="margin:14px 2px 0;font-size:14px;line-height:21px;color:${S.muted};">${T.replyYes.replace("<strong>", `<strong style="color:${S.ink};">`)}</div>` : ""}`, "0 36px 30px");
}

// ── the three customer emails ─────────────────────────────────────────────────

function welcomeEmail(name, username, password, m3uUrl) {
  const T = EMAIL_TEXT;
  return tkShell(T.w_pre, `
    ${tkTop(T.w_tag, tkT("w_title"), tkT("w_intro"), name)}
    ${tkLogins(username, password, m3uUrl)}
    ${tkSteps()}
    ${tkHelp()}`);
}

function reminderEmail(name, username, password, m3uUrl) {
  const T = EMAIL_TEXT;
  return tkShell(T.r_pre, `
    ${tkTop(T.r_tag, T.r_title, tkT("r_intro"), name)}
    ${tkPlans("trial_reminder")}
    ${tkLogins(username, password, m3uUrl, T.loginAgain)}
    ${tkHelp()}`);
}

function followupEmail(name) {
  const T = EMAIL_TEXT;
  return tkShell(T.f_pre, `
    ${tkTop(T.f_tag, T.f_title, tkT("f_intro"), name)}
    ${tkPlans("trial_followup", true)}
    ${tkHelp()}`);
}

function trialSubject() { return tkT("subject"); }

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
