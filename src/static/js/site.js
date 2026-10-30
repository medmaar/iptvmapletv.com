/* IPTVMaple — site behaviour. No dependencies. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  document.documentElement.classList.add("js");

  /* header: shadow on scroll + mobile menu */
  const header = $(".header");
  const onScroll = () => header && header.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const menuBtn = $(".menu-btn");
  if (menuBtn) {
    const toggle = (open) => {
      document.body.classList.toggle("menu-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    };
    menuBtn.addEventListener("click", () => toggle(!document.body.classList.contains("menu-open")));
    $$(".mobile-nav a").forEach((a) => a.addEventListener("click", () => toggle(false)));
    addEventListener("keydown", (e) => e.key === "Escape" && toggle(false));
  }

  /* reveal on scroll */
  const io = "IntersectionObserver" in window && new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px" });
  $$(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("is-in")));

  /* reviews sliders: the track slides left/right one slide at a time; dots, swipe, auto-advance (paused on hover/focus) */
  $$("[data-carousel]").forEach((c) => {
    const track = $(".rv-track", c), slides = $$(".rv-slide", c), dots = $$(".rv-dots button", c);
    if (slides.length < 2) return;
    let i = 0, timer;
    const show = (n) => {
      i = (n + slides.length) % slides.length;
      track.style.transform = `translateX(calc(${-i * 100}% - ${i * 20}px))`;
      slides.forEach((s, k) => s.setAttribute("aria-hidden", String(k !== i)));
      dots.forEach((d, k) => d.setAttribute("aria-current", String(k === i)));
    };
    const play = () => { clearInterval(timer); if (!matchMedia("(prefers-reduced-motion: reduce)").matches) timer = setInterval(() => show(i + 1), 6000); };
    dots.forEach((d, k) => d.addEventListener("click", () => { show(k); play(); }));
    let x0 = null;
    c.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; clearInterval(timer); }, { passive: true });
    c.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
      play();
    });
    c.addEventListener("mouseenter", () => clearInterval(timer));
    c.addEventListener("mouseleave", play);
    c.addEventListener("focusin", () => clearInterval(timer));
    show(0);
    play();
  });

  /* pricing: connection switcher */
  $$("[data-pricing]").forEach((root) => {
    const data = JSON.parse($("script[type='application/json']", root).textContent);
    const tabs = $$(".seg button", root);
    const render = (n) => {
      const set = data.find((d) => d.devices === n);
      tabs.forEach((t, k) => {
        const on = +t.dataset.devices === n;
        t.setAttribute("aria-selected", String(on));
        if (on) t.parentElement.style.setProperty("--i", k);
      });
      set.plans.forEach((p, i) => {
        const card = $$(".plan", root)[i];
        $(".amt", card).textContent = p.price;
        $("s", card).textContent = "$" + p.original;
        $(".per-month", card).textContent = p.months > 1 ? `≈ $${(p.price / p.months).toFixed(2)}/mo` : "Billed monthly";
        $(".plan-sub", card).textContent = `${n} simultaneous ${n > 1 ? "connections" : "connection"}`;
        $(".js-conn", card).textContent = `${n} ${n > 1 ? "devices" : "device"} at the same time`;
        const a = $(".btn", card);
        a.href = `/${p.slug}/`;
      });
    };
    tabs.forEach((t) => t.addEventListener("click", () => render(+t.dataset.devices)));
  });

  /* tabs (setup guides) */
  $$("[data-tabs]").forEach((root) => {
    const btns = $$("[role='tab']", root);
    btns.forEach((b) => b.addEventListener("click", () => {
      btns.forEach((x) => {
        const on = x === b;
        x.setAttribute("aria-selected", String(on));
        document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
      });
    }));
  });

  /* channels: search + region filter */
  const chRoot = $("[data-channels]");
  if (chRoot) {
    const input = $("input[type='search']", chRoot);
    const regionBtns = $$(".region-tabs button", chRoot);
    const countries = $$(".country", chRoot);
    const groups = $$("[data-region]", chRoot);
    const empty = $(".empty", chRoot);
    let region = "all";
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const html = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      countries.forEach((c) => {
        const inRegion = region === "all" || c.closest("[data-region]").dataset.region === region;
        const lis = $$("li", c);
        let hit = false;
        const nameHit = q && c.dataset.name.includes(q);
        lis.forEach((li) => {
          const t = li.dataset.t || (li.dataset.t = li.textContent);
          if (!q) { li.hidden = false; li.textContent = t; return; }
          const m = t.toLowerCase().includes(q);
          hit ||= m;
          li.hidden = !(m || nameHit);
          const safe = html(t);
          li.innerHTML = m ? safe.replace(new RegExp(esc(html(q)), "ig"), (x) => `<mark>${x}</mark>`) : safe;
        });
        const vis = inRegion && (!q || hit || nameHit);
        c.hidden = !vis;
        c.open = !!(q && vis && hit);
        if (vis) shown++;
      });
      groups.forEach((g) => (g.hidden = !$$(".country:not([hidden])", g).length));
      empty.style.display = shown ? "none" : "block";
    };
    input.addEventListener("input", apply);
    regionBtns.forEach((b) => b.addEventListener("click", () => {
      region = b.dataset.region;
      regionBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      apply();
    }));
  }

  /* free trial: the trial worker creates the line and emails the login. Returns a response shaped like
     /api/ajax's, or null when the trial can't be automated right now (the form then falls back to the
     manual lead flow below, so the team sends the trial by hand). */
  const autoTrial = async (url, fd) => {
    let res, body;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: fd.get("name-1"), email: fd.get("email-1"), whatsapp: fd.get("phone-1"), country: fd.get("address-1-country"),
        website: fd.get("website"), page: location.pathname }) });
      body = await res.json();
    } catch (_) { return null; }
    if (body.success) return { success: true, data: { success: true, email: body.email || fd.get("email-1") } };
    if (body.message) return { success: true, data: { success: false, message: body.message } };
    return null;
  };

  /* order / trial / referral forms -> /api/ajax (Pages Function) */
  $$("form[data-lead-form]").forEach((form) => {
    const btn = $("button[type='submit']", form);
    const msg = $(".form-msg", form);
    const setErr = (field, text) => {
      const input = form.elements[field];
      if (!input) return;
      input.setAttribute("aria-invalid", text ? "true" : "false");
      const e = input.closest(".field").querySelector(".err");
      if (e) e.textContent = text || "";
    };
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      msg.className = "form-msg";
      let bad = false;
      $$("[required]", form).forEach((i) => {
        const empty = !i.value.trim();
        setErr(i.name, empty ? "Required" : "");
        bad ||= empty;
      });
      $$("input[type='email']", form).forEach((e) => {
        if (e.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)) { setErr(e.name, "Enter a valid email"); bad = true; }
      });
      $$("input[type='tel']", form).forEach((t) => {
        if (t.value && t.value.replace(/\D/g, "").length < 7) { setErr(t.name, "Enter a valid phone number"); bad = true; }
      });
      if (bad) { $("[aria-invalid='true']", form)?.focus(); return; }

      btn.disabled = true; btn.classList.add("is-loading");
      try {
        const fd = new FormData(form);
        fd.set("current_url", location.href);
        let json = form.dataset.trialEndpoint && await autoTrial(form.dataset.trialEndpoint, fd);
        if (!json) json = await (await fetch("/api/ajax", { method: "POST", body: fd })).json();
        if (!json.success || !json.data || json.data.success === false) {
          const e = new Error(json.data?.message || "Something went wrong");
          e.shown = !!json.data?.message;
          throw e;
        }
        const type = form.dataset.leadForm;
        try {
          window.gtag && gtag("event", "generate_lead", { form_type: type, value: +form.dataset.value || 0, currency: "USD" });
          window.rdt && rdt("track", "Lead");
        } catch (_) {}
        // Plan orders: email the client their payment invoice. Fire-and-forget, never blocks the order.
        if (type === "order") {
          fetch("https://iptv-trial-iptvmapletv.medmaar.workers.dev/invoice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: fd.get("name-1") || "", email: fd.get("email-1") || "", plan: `${fd.get("plan") || ""} — $${form.dataset.value || ""}` }),
            keepalive: true,
          }).catch(() => {});
        }
        if (json.data.url) { location.href = json.data.url; return; }
        form.reset();
        const card = form.closest(".order-card"), done = card && $("[data-success]", card);
        if (done) {
          const to = $("[data-success-email]", done);
          if (to && json.data.email) to.textContent = json.data.email;
          $("[data-success-hide]", card).hidden = true;
          done.hidden = false;
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          done.focus({ preventScroll: true });
          return;
        }
        msg.textContent = json.data.message;
        msg.className = "form-msg is-ok";
      } catch (err) {
        msg.textContent = err.shown ? err.message : "Sorry — we couldn't send your details. Please try again or message us on WhatsApp.";
        msg.className = "form-msg is-error";
      } finally {
        btn.disabled = false; btn.classList.remove("is-loading");
      }
    });
    $$("input, select", form).forEach((i) => i.addEventListener("input", () => setErr(i.name, "")));
  });

  /* big confirmation panel -> back to the form */
  $$("[data-success-again]").forEach((b) => b.addEventListener("click", () => {
    const card = b.closest(".order-card");
    $("[data-success]", card).hidden = true;
    $("[data-success-hide]", card).hidden = false;
    $("input:not([type=hidden])", card)?.focus();
  }));

  /* referral: reveal form */
  $$("[data-show]").forEach((b) => b.addEventListener("click", () => {
    const t = document.getElementById(b.dataset.show);
    t.hidden = false;
    t.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => $("input:not([type=hidden])", t)?.focus({ preventScroll: true }), 500);
  }));

  /* recent plan activity: entries come only from src/data/recent-orders.json, inlined into every page at build time
     (no API call, no storage, no flags). Runs for every visitor on every page; an empty file -> nothing is shown.
     Each notification is on screen for 4 s, then 10 s pass before the next; the order is shuffled on every page load
     and reshuffled each time the list runs out. */
  (() => {
    const VISIBLE = 4000, GAP = 10000, CYCLE = VISIBLE + GAP;
    const ago = (iso) => {
      const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
      if (m < 60) return m + " min ago";
      const h = Math.round(m / 60);
      if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
      const d = Math.round(h / 24);
      return d + (d === 1 ? " day ago" : " days ago");
    };
    /* "2026-10-04" -> "Oct 4"; full ISO time -> "3 hours ago"; no date -> "" (meta line hidden) */
    const when = (at) => {
      const t = Date.parse(at || "");
      if (isNaN(t) || t > Date.now() + 36e5) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return new Date(t).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
      return ago(at);
    };
    /* "12 Months" / "1 Month" -> "12 Month Plan" / "1 Month Plan"; anything else is shown as written */
    const planLabel = (p) => { const m = /^(\d+)\s*Months?$/i.exec(p || ""); return m ? m[1] + " Month Plan" : p; };
    const start = () => {
      let items;
      try { items = JSON.parse(document.getElementById("sale-data")?.textContent || "[]"); } catch (e) { return; }
      if (!Array.isArray(items) || !items.length) return;
      const card = document.createElement("aside");
      card.className = "sale-toast";
      card.setAttribute("aria-label", "Recent plan activity");
      card.innerHTML = '<span class="sale-avatar" aria-hidden="true"></span><div class="sale-body" role="status" aria-live="polite" aria-atomic="true"><p class="sale-line"></p><p class="sale-meta"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.7 1.2 2-.1.7 1.9 1.6 1.2-.6 2 .6 2-1.6 1.2-.7 1.9-2-.1L8 14.5l-1.7-1.2-2 .1-.7-1.9-1.6-1.2.6-2-.6-2 1.6-1.2.7-1.9 2 .1z"/><path d="M5.6 8.2l1.6 1.6 3.3-3.4" fill="none" stroke="#0b0c12" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sale-time"></span></p></div><button type="button" class="sale-x" aria-label="Hide notifications"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>';
      document.body.appendChild(card);
      const av = card.querySelector(".sale-avatar"), line = card.querySelector(".sale-line"), meta = card.querySelector(".sale-meta"), time = card.querySelector(".sale-time");
      /* random order per visit: walk a shuffled copy, reshuffle when it runs out, never the same card twice in a row */
      const shuffle = (a) => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
      let deck = [], last;
      const next = () => {
        if (!deck.length) {
          deck = shuffle(items.slice());
          if (deck.length > 1 && deck[0] === last) [deck[0], deck[1]] = [deck[1], deck[0]];
        }
        return (last = deck.shift());
      };
      let hideT, nextT, hold = false, done = false;
      const hide = () => { if (!hold) card.classList.remove("is-on"); };
      const show = () => {
        if (done) return;
        const x = next();
        av.textContent = (x.first || "?").charAt(0).toUpperCase();
        const b = document.createElement("b");
        b.textContent = x.first;
        line.replaceChildren(b, " from " + x.place + " \u2014 ", Object.assign(document.createElement("b"), { textContent: planLabel(x.plan) }));
        time.textContent = when(x.at);
        meta.hidden = !time.textContent;
        card.classList.remove("is-on");
        void card.offsetWidth; /* restart the timer-line animation */
        card.classList.add("is-on");
        hideT = setTimeout(hide, VISIBLE);
        nextT = setTimeout(show, CYCLE);
      };
      /* hovering or focusing the card keeps it on screen (WCAG 2.2.1); it leaves shortly after */
      const pause = () => { hold = true; card.classList.add("is-paused"); };
      const resume = () => { hold = false; card.classList.remove("is-paused"); clearTimeout(hideT); hideT = setTimeout(hide, 800); };
      card.addEventListener("mouseenter", pause);
      card.addEventListener("mouseleave", resume);
      card.addEventListener("focusin", pause);
      card.addEventListener("focusout", resume);
      card.querySelector(".sale-x").addEventListener("click", () => {
        done = true; hold = false; clearTimeout(hideT); clearTimeout(nextT); card.classList.remove("is-on");
      });
      /* do not burn through entries while the tab is in the background */
      document.addEventListener("visibilitychange", () => {
        if (done) return;
        clearTimeout(nextT);
        if (document.hidden) { clearTimeout(hideT); hold = false; card.classList.remove("is-on"); }
        else nextT = setTimeout(show, GAP);
      });
      nextT = setTimeout(show, GAP);
    };
    "requestIdleCallback" in window ? requestIdleCallback(start, { timeout: 4000 }) : setTimeout(start, 2500);
  })();
  // ---------- M3U playlist checker (/iptv-checker/): parses pasted text locally, nothing is sent anywhere
  (() => {
    const box = $("[data-m3u-check]");
    if (!box) return;
    const input = $("#m3u-input", box), out = $("[data-m3u-out]", box);
    const attr = (line, name) => { const m = line.match(new RegExp(name + '="([^"]*)"', "i")); return m ? m[1].trim() : ""; };
    const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
    const run = () => {
      const lines = input.value.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
      out.textContent = "";
      if (!lines.length) { out.append(el("p", "Paste a playlist first.", "m3u-warn")); return; }
      const header = lines[0].toUpperCase().startsWith("#EXTM3U");
      const epg = header ? (attr(lines[0], "url-tvg") || attr(lines[0], "x-tvg-url")) : "";
      const items = []; let cur = null;
      for (const l of lines) {
        if (l.toUpperCase().startsWith("#EXTINF")) cur = { info: l };
        else if (!l.startsWith("#") && cur) { cur.url = l; items.push(cur); cur = null; }
      }
      const groups = new Map(), urls = new Map();
      let live = 0, movies = 0, series = 0, noId = 0, noLogo = 0, catchup = 0;
      for (const it of items) {
        const g = attr(it.info, "group-title") || "(no group)";
        groups.set(g, (groups.get(g) || 0) + 1);
        urls.set(it.url, (urls.get(it.url) || 0) + 1);
        if (/\/movie\//i.test(it.url)) movies++; else if (/\/series\//i.test(it.url)) series++; else live++;
        if (!attr(it.info, "tvg-id")) noId++;
        if (!attr(it.info, "tvg-logo")) noLogo++;
        if (/catchup|tvg-rec|timeshift/i.test(it.info)) catchup++;
      }
      const dupes = [...urls.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);
      const fmt = (n) => n.toLocaleString("en-CA");
      const rows = [
        ["Valid #EXTM3U header", header ? "Yes" : "No: most apps will reject this list", !header],
        ["Entries", fmt(items.length), !items.length],
        ["Groups", fmt(groups.size)],
        ["Live channels", fmt(live)], ["Movies", fmt(movies)], ["Series episodes", fmt(series)],
        ["EPG link in header", epg || "None: add your provider’s EPG link in the player", !epg],
        ["Entries without tvg-id (no guide)", fmt(noId), noId > 0],
        ["Entries without a logo", fmt(noLogo)],
        ["Duplicate stream URLs", fmt(dupes), dupes > 0],
        ["Entries with catch-up tags", fmt(catchup)],
      ];
      const table = el("table"), tb = el("tbody");
      for (const [k, v, warn] of rows) { const tr = el("tr"); tr.append(el("td", k), el("td", v, warn ? "m3u-warn" : "")); tb.append(tr); }
      table.append(tb); out.append(table);
      const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (top.length) {
        out.append(el("p", "Largest groups:", "m3u-sub"));
        const ul = el("ul");
        top.forEach(([g, n]) => ul.append(el("li", g + ": " + fmt(n))));
        out.append(ul);
      }
      if (!items.length) out.append(el("p", "No #EXTINF entries followed by a stream URL were found.", "m3u-warn"));
    };
    $("[data-m3u-run]", box).addEventListener("click", run);
    $("[data-m3u-file]", box).addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then((t) => { input.value = t; run(); });
    });
  })();
})();
