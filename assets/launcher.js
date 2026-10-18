/* Launcher: a small tabbed app over the exam profiles (assets/exam-data.js).
   One exam is in focus (switcher in the header); three tabs show what to do
   next (Nauka), the mock exam (Egzamin) and progress per domain (Postęp).
   Account, reminder and appearance live in the settings sheet. */
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const pad = n => String(n).padStart(2, "0");
  const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); return `${h ? h + ":" + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)}:${pad(s % 60)}`; };
  const plural = (n, one, few, many) => { if (n === 1) return one; const d = n % 10, t = n % 100; return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many; };
  const pytan = n => `${n} ${plural(n, "pytanie", "pytania", "pytań")}`;
  // Stored values (some arrive through sync) are only ever shown as numbers.
  const int = x => { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; };
  const date = ts => new Date(ts).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });

  // Reminders and the app shortcut open index.html#szybkie: go straight to the exam with most due.
  const quick = () => location.replace(`${window.EXAM_PROFILES[window.HubDue.pick()].href}#szybkie`);
  window.addEventListener("hashchange", () => { if (location.hash === "#szybkie") quick(); });
  if (location.hash === "#szybkie") return quick();

  const ICONS = {
    chev: '<path d="m9 18 6-6-6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const GH = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

  /* ---------- which exam, which tab ---------- */
  const PROFILES = window.EXAM_PROFILES;
  // Biggest bank first: it is the one most people come for.
  const IDS = Object.keys(PROFILES).sort((a, b) => PROFILES[b].all.length - PROFILES[a].all.length);
  const EXAM_KEY = "exam-hub:exam";
  let exam = IDS.includes(load(EXAM_KEY, "")) ? load(EXAM_KEY, "") : IDS[0];
  const TABS = { nauka: "Nauka", egzamin: "Egzamin", postep: "Postęp" };
  const tabFromHash = () => location.hash.slice(1) in TABS ? location.hash.slice(1) : null;
  let tab = tabFromHash() || "nauka";

  const view = document.getElementById("view");
  const switcher = document.getElementById("exam-switch");
  const tabbar = document.querySelector(".tabbar");

  /* Everything the tabs show about one exam, read fresh from storage. */
  function facts(id) {
    const p = PROFILES[id], now = Date.now();
    const study = load(`study:${id}:v1`, null);
    const ans = study?.ans && typeof study.ans === "object" ? Object.entries(study.ans).filter(([q]) => p.all.includes(q)).map(([, a]) => a) : [];
    const summary = study?.summary || {};
    const domains = p.domains.map(d => {
      const s = summary[d.id];
      // Mastered = right three times with growing gaps (box 3+), as in study mode.
      const ok = ans.filter(a => a.d === d.id && a.ok && int(a.box) >= window.SRS.MASTERED).length;
      return { d, ok, total: int(s?.total) || null };
    });
    const attempt = load(`exam-attempt:${id}:v1`, null);
    const running = attempt && attempt.status === "running" && Array.isArray(attempt.seen) && attempt.seen.length ? attempt : null;
    const upcoming = ans.map(a => Number(a.due)).filter(d => Number.isFinite(d) && d > now);
    return {
      p, seen: ans.length,
      mastered: ans.filter(a => a.ok && int(a.box) >= window.SRS.MASTERED).length,
      wrong: ans.filter(a => !a.ok).length,
      stars: Array.isArray(study?.stars) ? study.stars.filter(q => p.all.includes(q)).length : 0,
      due: window.HubDue.count(id, now),
      nextDue: upcoming.length ? Math.min(...upcoming) : null,
      domains, running,
      history: load(`exam-history:${id}:v1`, []).filter(h => h && typeof h === "object").slice(0, 10),
    };
  }

  /* ---------- pieces ---------- */
  const bar = (part, whole) => `<span class="bar" aria-hidden="true"><i style="width:${whole ? Math.min(100, part / whole * 100) : 0}%"></i></span>`;
  const row = (href, title, sub, n = "") => `<li><a class="row" href="${esc(href)}"><span class="row-t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${n !== "" ? `<span class="row-n">${n}</span>` : ""}${icon("chev")}</a></li>`;
  const header = (h, sub) => `<div class="view-head"><h1 tabindex="-1">${h}</h1>${sub ? `<p>${sub}</p>` : ""}</div>`;

  function resumeCard(f) {
    const a = f.running, left = a.deadline ? a.deadline - Date.now() : null;
    const drill = !!f.p.exam.drill;
    return `<section class="card hero" aria-labelledby="hero-h">
      <h2 id="hero-h">Niedokończony ${drill ? "trening" : "egzamin"}</h2>
      <p>Pytanie ${int(a.current) + 1} z ${int(a.count)}${left === null ? " · bez limitu czasu" : left > 0 ? ` · zostało ${clock(left)}. Zegar biegnie dalej, jak na prawdziwym egzaminie.` : ". Czas minął: wynik czeka."}</p>
      <a class="btn btn-primary btn-block" href="${esc(f.p.href)}#egzamin">${left !== null && left <= 0 ? "Zobacz wynik" : "Wróć do egzaminu"}</a>
    </section>`;
  }

  function masteryLine(f) {
    const total = f.p.all.length;
    return `<div class="meter"><span>Opanowane <b>${f.mastered}</b> z ${total}</span>${bar(f.mastered, total)}</div>`;
  }

  /* ---------- Nauka: one next step ---------- */
  function nauka(f) {
    const p = f.p, href = p.href;
    let hero, heroIs;
    if (f.running) { hero = resumeCard(f); heroIs = "resume"; }
    else if (f.due) {
      heroIs = "quick";
      hero = `<section class="card hero" aria-labelledby="hero-h">
        <h2 id="hero-h">${f.due} ${plural(f.due, "pytanie czeka", "pytania czekają", "pytań czeka")} na powtórkę</h2>
        <p>Szybka piątka bierze ${f.due >= 5 ? "5 z nich" : f.due === 1 ? "je i dobiera nowe" : "je i dobiera nowe"}. Zajmie ok. 3 minuty.</p>
        <a class="btn btn-primary btn-block" href="${esc(href)}#szybkie">Szybka piątka</a>
        ${masteryLine(f)}
      </section>`;
    } else if (f.seen) {
      heroIs = "all";
      hero = `<section class="card hero" aria-labelledby="hero-h">
        <h2 id="hero-h">Powtórki na dziś zrobione</h2>
        <p>${f.nextDue ? `Następne pytania wrócą ${window.SRS.when(f.nextDue, Date.now())}. ` : ""}W międzyczasie ucz się nowych pytań.</p>
        <a class="btn btn-primary btn-block" href="${esc(href)}#nauka">Ucz się dalej</a>
        ${masteryLine(f)}
      </section>`;
    } else {
      heroIs = "quick";
      hero = `<section class="card hero" aria-labelledby="hero-h">
        <h2 id="hero-h">Zacznij od pięciu pytań</h2>
        <p>Odpowiedź sprawdzasz od razu, a komentarze społeczności wyjaśniają dlaczego. Dobre odpowiedzi wracają po 1, 3, 7, 14 i 30 dniach, żeby zostały w pamięci.</p>
        <a class="btn btn-primary btn-block" href="${esc(href)}#szybkie">Szybka piątka</a>
      </section>`;
    }
    const rows = [
      heroIs !== "quick" ? row(`${href}#szybkie`, "Szybka piątka", f.due ? `${f.due} do powtórki · ok. 3 min` : "5 pytań · ok. 3 min") : "",
      heroIs !== "all" ? row(`${href}#nauka:wszystkie`, "Wszystkie pytania", "Najpierw błędne i zaległe, potem nowe", "") : "",
      f.wrong ? row(`${href}#nauka:bledne`, "Błędne odpowiedzi", "Pytania, na które ostatnio odpowiedziałeś źle", f.wrong) : "",
      f.stars ? row(`${href}#nauka:gwiazdki`, "Z gwiazdką", "Pytania, które oznaczyłeś", f.stars) : "",
      row("#postep", "Jedna domena", "Wybierz ją w zakładce Postęp"),
    ].join("");
    return `${header(esc(p.title), `${esc(p.vendor)} · ${pytan(p.all.length)} w bazie`)}
      ${hero}
      <h2 class="list-h">Inne sposoby nauki</h2>
      <ul class="rows">${rows}</ul>
      ${statusLines(f)}`;
  }

  // Quiet lines under Nauka: the reminder, and (once there is something to lose) sync.
  function statusLines(f) {
    const r = load("exam-hub:remind", {});
    const time = /^\d\d:\d\d$/.test(r.time || "") ? r.time : "19:00";
    const lines = [];
    lines.push(r.push
      ? `<p class="status">${icon("bell")}<span>Przypomnienie codziennie o ${esc(time)}</span><button class="link" type="button" data-open="remind">Zmień</button></p>`
      : `<p class="status">${icon("bell")}<span>Kilka minut dziennie wystarczy.</span><button class="link" type="button" data-open="remind">Ustaw przypomnienie</button></p>`);
    const sync = window.HubSync;
    if (sync?.available && !sync.user && f.seen >= 10 && !load("exam-hub:nudge-sync", false)) {
      lines.push(`<p class="status">${icon("cloud")}<span>Zaloguj się, żeby mieć ten postęp na telefonie i komputerze.</span><button class="link" type="button" data-open="konto">Zaloguj</button><button class="icon-link" type="button" data-dismiss-sync aria-label="Nie pokazuj więcej">${icon("close")}</button></p>`);
    }
    return `<div class="status-lines">${lines.join("")}</div>`;
  }

  /* ---------- Egzamin: the real parameters, one start ---------- */
  function egzamin(f) {
    const p = f.p, x = p.exam, drill = x.drill;
    const counts = x.counts.length > 1 ? `${x.counts[0]}–${x.counts[x.counts.length - 1]} pytań` : pytan(x.counts[0]);
    const chips = drill
      ? [`ok. 1 min na pytanie`, counts, "próg niepublikowany"]
      : [`${x.minutes} min`, counts, x.passing ? `próg ${x.passing.score}/${x.passing.scale}` : "próg niepublikowany"];
    const lead = drill
      ? `Prawdziwy egzamin ${esc(p.vendor)} trwa ${drill.realMinutes} minut i ma ${esc(drill.realCount)} pytań. Baza ma ich ${p.all.length}, więc to trening w tym samym tempie, nie pełna symulacja.`
      : `Pytania losowane w proporcjach domen z oficjalnego opisu egzaminu. Możesz oznaczać pytania i wracać do nich przed oddaniem.`;
    const card = f.running ? resumeCard(f) : `<section class="card hero" aria-labelledby="hero-h">
        <h2 id="hero-h">${drill ? "W tempie prawdziwego egzaminu" : "Jak na prawdziwym egzaminie"}</h2>
        <ul class="facts">${chips.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
        <p>${lead}</p>
        <a class="btn btn-primary btn-block" href="${esc(p.href)}#egzamin">${drill ? "Przygotuj trening" : "Przygotuj egzamin"}</a>
        <p class="small muted">Liczbę pytań i tryb bez limitu czasu wybierzesz na następnym ekranie.</p>
      </section>`;
    const pass = h => x.passing ? int(h.pct) / 100 >= x.passing.score / x.passing.scale : null;
    const hist = f.history.length ? `<ul class="rows plain">${f.history.map(h => {
      const ok = pass(h);
      return `<li><div class="row"><span class="row-t"><b>${int(h.pct)}%</b><span>${esc(date(int(h.at)))} · ${pytan(int(h.count))}${h.untimed ? " · bez limitu" : ""}</span></span>${ok === null ? "" : `<span class="tag ${ok ? "pass" : "fail"}">${icon(ok ? "check" : "x")}${ok ? "zdany" : "niezdany"}</span>`}</div></li>`;
    }).join("")}</ul>${x.passing ? `<p class="small muted">Zdany lub niezdany to szacunek: ${esc(p.vendor)} skaluje wynik, więc próg ${x.passing.score} to nie to samo co ${Math.round(x.passing.score / x.passing.scale * 100)}%.</p>` : ""}`
      : `<p class="empty">Tu pojawią się wyniki Twoich egzaminów.</p>`;
    return `${header(drill ? "Trening na czas" : "Egzamin próbny", esc(p.title))}
      ${card}
      <h2 class="list-h">Twoje wyniki</h2>
      ${hist}`;
  }

  /* ---------- Postęp: domains you can tap to study ---------- */
  function postep(f) {
    const p = f.p;
    if (!f.seen) {
      return `${header("Postęp", esc(p.title))}
        <section class="card hero" aria-labelledby="hero-h">
          <h2 id="hero-h">Jeszcze nic tu nie ma</h2>
          <p>Po pierwszych odpowiedziach zobaczysz tu, które domeny już umiesz, a które wymagają pracy.</p>
          <a class="btn btn-block" href="${esc(p.href)}#szybkie">Szybka piątka</a>
        </section>`;
    }
    const last = f.history[0];
    return `${header("Postęp", esc(p.title))}
      <ul class="facts stats">
        <li><b>${f.mastered}</b><span>opanowane z ${p.all.length}</span></li>
        <li><b>${f.due}</b><span>do powtórki</span></li>
        <li><b>${f.wrong}</b><span>błędne</span></li>
        <li><b>${f.stars}</b><span>z gwiazdką</span></li>
      </ul>
      <h2 class="list-h">Domeny</h2>
      <p class="small muted list-note">Opanowane to trzy dobre odpowiedzi z rosnącymi odstępami. Dotknij domeny, żeby uczyć się tylko z niej.</p>
      <ul class="rows domains">${f.domains.map(({ d, ok, total }) => `<li><a class="row" href="${esc(p.href)}#nauka=${esc(d.id)}">
        <span class="row-t"><b>${esc(d.name)}</b>${bar(ok, total || 0)}</span>
        <span class="row-n">${ok}${total ? `/${total}` : ""}</span>${icon("chev")}</a></li>`).join("")}</ul>
      ${last ? `<h2 class="list-h">Ostatni egzamin</h2><p class="last-exam"><b>${int(last.pct)}%</b> · ${esc(date(int(last.at)))} · ${pytan(int(last.count))}. <a href="#egzamin" data-tab-link="egzamin">Wszystkie wyniki</a></p>` : ""}`;
  }

  /* ---------- paint ---------- */
  function paintSwitch() {
    switcher.innerHTML = IDS.length > 1 ? IDS.map(id => `<button type="button" data-exam="${id}" aria-pressed="${id === exam}">${esc(PROFILES[id].short || PROFILES[id].title)}</button>`).join("") : "";
  }
  function paint(focus = false) {
    const f = facts(exam);
    view.innerHTML = tab === "egzamin" ? egzamin(f) : tab === "postep" ? postep(f) : nauka(f);
    view.dataset.tab = tab;
    tabbar.querySelectorAll("[data-tab]").forEach(a => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.title = tab === "nauka" ? "Exam Hub" : `${TABS[tab]} · Exam Hub`;
    if (focus) view.querySelector("h1").focus({ preventScroll: true });
  }
  function go(next, focus = true) {
    if (!(next in TABS)) return;
    tab = next;
    history.replaceState(null, "", `#${tab}`);
    paint(focus);
    window.scrollTo(0, 0);
  }

  paintSwitch();
  paint();

  switcher.addEventListener("click", e => {
    const b = e.target.closest("[data-exam]");
    if (!b || b.dataset.exam === exam) return;
    exam = b.dataset.exam; store(EXAM_KEY, exam);
    paintSwitch(); paint();
    switcher.querySelector(`[data-exam="${exam}"]`).focus();
  });
  tabbar.addEventListener("click", e => {
    const a = e.target.closest("[data-tab]");
    if (!a) return;
    e.preventDefault(); go(a.dataset.tab);
  });
  view.addEventListener("click", e => {
    const t = e.target.closest('a[href^="#"]');
    if (t && t.getAttribute("href").slice(1) in TABS) { e.preventDefault(); return go(t.getAttribute("href").slice(1)); }
    const o = e.target.closest("[data-open]");
    if (o) return openSettings(o.dataset.open);
    if (e.target.closest("[data-dismiss-sync]")) { store("exam-hub:nudge-sync", true); paint(); view.querySelector("h1").focus({ preventScroll: true }); }
  });
  window.addEventListener("hashchange", () => {
    const t = tabFromHash();
    if (t && t !== tab) go(t);
    else if (location.hash === "#konto" || location.hash === "#przypomnienie") deepLink();
  });
  // Drawn again when synced progress arrives from another device.
  window.addEventListener("hub:synced", () => paint());
  // Returning from a study session (bfcache) or after a while: counts move.
  window.addEventListener("pageshow", e => { if (e.persisted) paint(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !sheet.open) paint(); });

  /* ---------- settings sheet ---------- */
  const sheet = document.getElementById("settings");
  const gear = document.getElementById("open-settings");
  function openSettings(section) {
    if (!sheet.open) sheet.showModal();
    const target = section === "remind" ? document.getElementById("remind") : section === "konto" ? document.getElementById("konto") : null;
    if (target) {
      target.scrollIntoView({ block: "start" });
      (target.querySelector("button, input") || target).focus({ preventScroll: true });
    }
  }
  gear.addEventListener("click", () => openSettings());
  sheet.addEventListener("click", e => { if (e.target === sheet || e.target.closest("[data-close]")) sheet.close(); });
  sheet.addEventListener("close", () => { paint(); gear.focus({ preventScroll: true }); });
  // Links from other pages: index.html#przypomnienie / #konto open the sheet there.
  function deepLink() {
    const section = location.hash === "#przypomnienie" ? "remind" : "konto";
    history.replaceState(null, "", "#nauka");
    openSettings(section);
  }
  if (location.hash === "#konto" || location.hash === "#przypomnienie") deepLink();

  // Theme.
  const themePick = sheet.querySelector("[data-theme-pick]");
  const markTheme = () => themePick.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === window.HubTheme.get())));
  markTheme();
  themePick.addEventListener("click", e => { const b = e.target.closest("[data-theme-choice]"); if (b) { window.HubTheme.set(b.dataset.themeChoice); markTheme(); } });

  // Single-key shortcuts in study and exam (WCAG 2.1.4); only offered with a keyboard and mouse.
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const slot = sheet.querySelector("[data-shortcuts-slot]");
    let on = true; try { on = localStorage.getItem("exam-hub:shortcuts") !== "off"; } catch (e) {}
    slot.innerHTML = `<label class="switch"><span><b>Skróty klawiszowe</b><br><span class="small muted">Litery i cyfry wybierają odpowiedź w nauce i na egzaminie.</span></span><input type="checkbox" data-shortcuts${on ? " checked" : ""}></label>`;
    slot.addEventListener("change", e => { try { localStorage.setItem("exam-hub:shortcuts", e.target.checked ? "on" : "off"); } catch (err) {} });
  }

  // Ask the browser to keep this site's data (Safari otherwise clears it after
  // 7 days without a visit). Firefox would show a prompt for it, so not there.
  if (navigator.storage?.persist && !/Firefox\//.test(navigator.userAgent)) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});

  /* ---------- account: sign in with GitHub to sync progress ---------- */
  const acct = document.getElementById("account");
  let acctMsg = "";
  // Only GitHub's avatar host (also allowed by the CSP).
  const avatar = (u, size) => typeof u.avatar === "string" && u.avatar.startsWith("https://avatars.githubusercontent.com/") ? `<img src="${esc(u.avatar + (u.avatar.includes("?") ? "&" : "?") + "s=" + size * 2)}" alt="" width="${size}" height="${size}">` : "";
  function paintGear() {
    const u = window.HubSync?.user;
    const pic = u ? avatar(u, 28) : "";
    gear.innerHTML = pic || icon("gear");
    gear.classList.toggle("has-avatar", !!pic);
    gear.setAttribute("aria-label", u ? `Ustawienia i konto (${u.login})` : "Ustawienia i konto");
  }
  function paintAccount() {
    paintGear();
    const sync = window.HubSync;
    if (!sync?.available) return;
    const u = sync.user;
    const note = sync.state === "syncing" ? "Synchronizuję…" : sync.state === "error" ? "Nie udało się zsynchronizować. Spróbuję ponownie." : sync.lastSync ? `Zsynchronizowano o ${new Date(sync.lastSync).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : "";
    acct.innerHTML = u ? `
      <div class="acct-who">${avatar(u, 40)}<div><b>${esc(u.login)}</b><span class="small muted" data-acct-note>${esc(note)}</span></div></div>
      <div class="acct-menu">
        <button class="btn" type="button" data-acct="sync">Synchronizuj teraz</button>
        <button class="btn" type="button" data-acct="logout">Wyloguj</button>
        <button class="btn btn-quiet" type="button" data-acct="logout-all">Wyloguj na wszystkich urządzeniach</button>
      </div>
      <p class="small muted">Na serwerze zapisujemy tylko identyfikator, login, nazwę i avatar z GitHuba oraz postęp nauki i wyniki egzaminów. Nie mamy dostępu do Twoich repozytoriów.</p>
      <button class="btn btn-quiet acct-del" type="button" data-acct="delete">Usuń konto i dane z serwera</button>`
      : `<p class="small muted">Bez logowania postęp, gwiazdki i wyniki zostają w tej przeglądarce. Po zalogowaniu przez GitHub synchronizują się między Twoimi urządzeniami.</p>
         <button class="btn btn-gh" type="button" data-acct="login">${GH}Zaloguj przez GitHub</button>`;
    if (acctMsg) acct.insertAdjacentHTML("beforeend", `<p class="acct-msg" role="status">${esc(acctMsg)}</p>`);
  }
  window.addEventListener("hub:auth", () => { paintAccount(); if (!sheet.open) paint(); });
  window.addEventListener("hub:auth-message", e => { acctMsg = e.detail; paintAccount(); openSettings("konto"); });
  acct.addEventListener("click", e => {
    const b = e.target.closest("[data-acct]");
    if (!b) return;
    const act = b.dataset.acct, sync = window.HubSync;
    acctMsg = "";
    if (act === "login") return sync.login();
    if (act === "sync") return sync.sync();
    if (act === "logout") return sync.logout();
    if (act === "logout-all") return sync.logout(true);
    if (act === "delete") {
      const dlg = document.createElement("dialog");
      dlg.className = "xf-dialog";
      dlg.setAttribute("aria-labelledby", "del-h");
      dlg.innerHTML = `<h2 id="del-h">Usunąć konto?</h2><p>Usuniemy z serwera Twój login i cały zapisany postęp. Postęp w tej przeglądarce zostanie. Tego nie da się cofnąć.</p>
        <div class="xf-actions"><button class="btn btn-danger" data-yes>Usuń konto</button><button class="btn btn-primary" data-no>Anuluj</button></div>`;
      document.body.appendChild(dlg);
      dlg.addEventListener("click", ev => {
        if (ev.target.closest("[data-yes]")) { dlg.close(); sync.deleteAccount().catch(() => { acctMsg = "Nie udało się usunąć konta. Spróbuj ponownie."; paintAccount(); }); }
        else if (ev.target.closest("[data-no]") || ev.target === dlg) dlg.close();
      });
      dlg.addEventListener("close", () => setTimeout(() => dlg.remove(), 260));
      dlg.showModal();
      dlg.querySelector("[data-no]").focus();
    }
  });
  paintAccount();

  window.HubDue.publish();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
