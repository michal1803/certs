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

  /* Add to home screen, as an app: where the browser offers installing
     (Android, Chrome and Edge on a computer) it is one button; opened from the
     icon, the next step is the daily reminder. iPhone offers no install
     prompt to pages: there the band points at Safari's own Share menu. */
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Opened inside another app (Messenger, Instagram, Gmail, Google app): adding happens in Safari.
  const inApp = /FBAN|FBAV|Instagram|Line\/|GSA\/|Messenger|Gmail/i.test(navigator.userAgent);
  const BAND_HIDDEN = "exam-hub:install-band-hidden";
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; paint(); });
  window.addEventListener("appinstalled", () => { installEvent = null; paint(); });

  const ICONS = {
    chev: '<path d="m9 18 6-6-6-6"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/>',
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
  /* Signature: each domain is a transit line. Its length is the domain's share
     of the bank, with ten stations along it, lit up to the mastered share;
     the open ring marks where the line continues from. */
  const lineOf = (k, ok, total, max, stations) =>
    window.HubLine(k, total ? ok / total : 0, max && total ? Math.max(40, total / max * 100) : 100, stations);
  // The domains as one network; each line opens study for its domain.
  function network(f, full = false) {
    const max = Math.max(0, ...f.domains.map(x => x.total || 0));
    return `<ul class="network${full ? " full" : ""}">${f.domains.map(({ d, ok, total }, k) => `<li><a class="net-row" href="${esc(f.p.href)}#nauka=${esc(d.id)}" aria-label="Ucz się: ${esc(d.name)}. Opanowane ${ok}${total ? ` z ${total}` : ""}.">
      <span class="net-name" lang="en">${esc(full ? d.name : d.label)}</span>${lineOf(k, ok, total, max, full ? 10 : 6)}<span class="net-n">${ok}${total ? `<small>/${total}</small>` : ""}</span>${full ? icon("chev") : ""}</a></li>`).join("")}</ul>`;
  }
  const row = (href, title, sub, n = "") => `<li><a class="row" href="${esc(href)}"><span class="row-t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${n !== "" ? `<span class="row-n">${n}</span>` : ""}${icon("chev")}</a></li>`;
  const header = (h, sub) => `<div class="view-head"><h1 tabindex="-1">${h}</h1>${sub ? `<p>${sub}</p>` : ""}</div>`;

  function resumeCard(f) {
    const a = f.running, left = a.deadline ? a.deadline - Date.now() : null;
    const drill = !!f.p.exam.drill;
    return `<section class="hero" aria-labelledby="hero-h">
      <h2 id="hero-h">Niedokończony ${drill ? "trening" : "egzamin"}</h2>
      <p>Pytanie ${int(a.current) + 1} z ${int(a.count)}${left === null ? " · bez limitu czasu" : left > 0 ? ` · zostało ${clock(left)}. Zegar biegnie dalej, jak na prawdziwym egzaminie.` : ". Czas minął: wynik czeka."}${left === null ? "." : ""}</p>
      <a class="btn btn-primary btn-block" href="${esc(f.p.href)}#egzamin">${left !== null && left <= 0 ? "Zobacz wynik" : "Wróć do egzaminu"}</a>
    </section>`;
  }

  // Nauka keeps its own step on top; an unfinished exam waits as the first row.
  function resumeRow(f) {
    const a = f.running, left = a.deadline ? a.deadline - Date.now() : null;
    const sub = `Pytanie ${int(a.current) + 1} z ${int(a.count)}${left === null ? " · bez limitu czasu" : left > 0 ? ` · zostało ${clock(left)}` : " · czas minął, wynik czeka"}`;
    return row(`${f.p.href}#egzamin`, `Niedokończony ${f.p.exam.drill ? "trening" : "egzamin"}`, sub);
  }

  /* ---------- Nauka: one next step ---------- */
  function nauka(f) {
    const p = f.p, href = p.href;
    let hero, heroIs;
    if (f.due) {
      heroIs = "quick";
      hero = `<section class="hero" aria-labelledby="hero-h">
        <h2 id="hero-h" class="due"><b>${f.due}</b> <span>${plural(f.due, "pytanie czeka", "pytania czekają", "pytań czeka")} na powtórkę</span></h2>
        <p>Szybka piątka bierze ${f.due >= 5 ? "5 z nich" : f.due === 1 ? "je i dobiera nowe" : "je i dobiera nowe"}. Zajmie ok. 3 minuty.</p>
        <a class="btn btn-primary btn-block" href="${esc(href)}#szybkie">Szybka piątka</a>
      </section>`;
    } else if (f.seen) {
      heroIs = "all";
      hero = `<section class="hero" aria-labelledby="hero-h">
        <h2 id="hero-h">Powtórki na dziś zrobione</h2>
        <p>${f.nextDue ? `Następne pytania wrócą ${window.SRS.when(f.nextDue, Date.now())}. ` : ""}W międzyczasie ucz się nowych pytań.</p>
        <a class="btn btn-primary btn-block" href="${esc(href)}#nauka:wszystkie">Ucz się dalej</a>
      </section>`;
    } else {
      heroIs = "quick";
      hero = `<section class="hero" aria-labelledby="hero-h">
        <h2 id="hero-h">Zacznij od pięciu pytań</h2>
        <p>Odpowiedź sprawdzasz od razu, a komentarze społeczności wyjaśniają dlaczego. Dobre odpowiedzi wracają po 1, 3, 7, 14 i 30 dniach, żeby zostały w pamięci.</p>
        <a class="btn btn-primary btn-block" href="${esc(href)}#szybkie">Szybka piątka</a>
      </section>`;
    }
    const rows = [
      f.running ? resumeRow(f) : "",
      heroIs !== "quick" ? row(`${href}#szybkie`, "Szybka piątka", f.due ? `${f.due} do powtórki · ok. 3 min` : "5 pytań · ok. 3 min") : "",
      heroIs !== "all" ? row(`${href}#nauka:wszystkie`, "Wszystkie pytania", "Najpierw błędne i zaległe, potem nowe", "") : "",
      f.wrong ? row(`${href}#nauka:bledne`, "Błędne odpowiedzi", "Ostatnia odpowiedź była błędna", f.wrong) : "",
      f.stars ? row(`${href}#nauka:gwiazdki`, "Z gwiazdką", "Twoje oznaczone pytania", f.stars) : "",
    ].join("");
    return `${header(esc(p.title), `${esc(p.vendor)} · ${pytan(p.all.length)} w bazie`)}
      ${hero}
      <h2 class="list-h">Twoja sieć <span>opanowane ${f.mastered} z ${p.all.length}</span></h2>
      ${network(f)}
      <p class="small muted list-note">Linia to domena, stacje świecą, gdy pytania są opanowane. Dotknij linii, żeby uczyć się tylko jej.</p>
      <h2 class="list-h">Inne trasy</h2>
      <ul class="rows">${rows}</ul>
      ${deviceBand()}
      ${statusLines(f)}`;
  }

  // Install (browser that offers it) or, opened from the icon, turn on the reminder.
  const notifyOffer = () => standalone && window.HubRemind && !window.HubRemind.on() && "Notification" in window && Notification.permission !== "denied";
  function deviceBand() {
    if (!standalone && installEvent) return `<section class="device-band" aria-labelledby="band-h">
        <div><h2 id="band-h">Dodaj Exam Hub do ekranu</h2><p>Otwierasz go jedną ikoną, na pełnym ekranie, a codzienne przypomnienie przychodzi jak z aplikacji.</p></div>
        <button class="btn" type="button" data-install>Zainstaluj aplikację</button>
      </section>`;
    if (!standalone && ios && !load(BAND_HIDDEN, false)) return `<section class="device-band ios" aria-labelledby="band-h">
        <div><h2 id="band-h">Dodaj Exam Hub do ekranu</h2>
        <p>${inApp ? "Otwórz tę stronę w Safari, potem stuknij" : "Stuknij"} <b class="share">${icon("share")}Udostępnij</b> na pasku Safari i wybierz <b>Do ekranu początkowego</b>. Z ikony Exam Hub otwiera się jak aplikacja i działa codzienne przypomnienie.</p></div>
        <button class="link" type="button" data-band-hide>Nie teraz</button>
      </section>`;
    if (notifyOffer()) return `<section class="device-band" aria-labelledby="band-h">
        <div><h2 id="band-h">Wszystko gotowe</h2><p>Exam Hub działa jak aplikacja na tym urządzeniu. Włącz przypomnienie, a codziennie o ${esc(window.HubRemind.time())} dostaniesz szybką piątkę.</p></div>
        <button class="btn" type="button" data-notify>${icon("bell")}Włącz powiadomienia</button>
      </section>`;
    return "";
  }

  // Quiet lines under Nauka: the reminder, and (once there is something to lose) sync.
  function statusLines(f) {
    const r = load("exam-hub:remind", {});
    const time = /^\d\d:\d\d$/.test(r.time || "") ? r.time : "19:00";
    const lines = [];
    if (!notifyOffer()) lines.push(r.push
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
    const counts = x.counts.length === 2 ? `${x.counts[0]} lub ${x.counts[1]} pytań` : x.counts.length > 2 ? `${x.counts[0]}–${x.counts[x.counts.length - 1]} pytań` : pytan(x.counts[0]);
    const chips = drill
      ? [`ok. 1 min na pytanie`, counts, "próg niepublikowany"]
      : [`${x.minutes} min`, counts, x.passing ? `próg ${x.passing.score}/${x.passing.scale}` : "próg niepublikowany"];
    const lead = drill
      ? `Prawdziwy egzamin ${esc(p.vendor)} trwa ${drill.realMinutes} minut i ma ${esc(drill.realCount)} pytań${drill.realCountUnofficial ? " (dane nieoficjalne)" : ""}. Baza ma ich ${p.all.length}, więc to trening w tym samym tempie, nie pełna symulacja.`
      : `Pytania losowane w proporcjach domen z oficjalnego opisu egzaminu. Możesz oznaczać pytania i wracać do nich przed oddaniem.`;
    const card = f.running ? resumeCard(f) : `<section class="hero" aria-labelledby="hero-h">
        <h2 id="hero-h">${drill ? "W tempie prawdziwego egzaminu" : "Jak na prawdziwym egzaminie"}</h2>
        <ul class="facts">${chips.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
        <p>${lead}</p>
        <a class="btn btn-primary btn-block" href="${esc(p.href)}#egzamin=nowy">${drill ? "Przygotuj trening" : "Przygotuj egzamin"}</a>
        <p class="small muted">Liczbę pytań i tryb bez limitu czasu wybierzesz na następnym ekranie.</p>
      </section>`;
    const pass = h => x.passing ? int(h.pct) >= window.passPct(x.passing) : null;
    const hist = f.history.length ? `<ul class="rows plain">${f.history.map(h => {
      const ok = pass(h);
      return `<li><div class="row"><span class="row-t"><b>${int(h.pct)}%</b><span>${esc(date(int(h.at)))} · ${pytan(int(h.count))}${h.untimed ? " · bez limitu" : ""}</span></span>${ok === null ? "" : `<span class="tag ${ok ? "pass" : "fail"}">${icon(ok ? "check" : "x")}${ok ? "zdany" : "niezdany"}</span>`}</div></li>`;
    }).join("")}</ul>${x.passing ? `<p class="small muted">Zdany lub niezdany to szacunek: ${esc(p.vendor)} skaluje wynik nieliniowo, więc „zdany” liczymy dopiero od ${window.passPct(x.passing)}% punktów.</p>` : ""}`
      : `<p class="empty">Tu pojawią się wyniki Twoich ${drill ? "treningów" : "egzaminów"}.</p>`;
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
        <section class="hero" aria-labelledby="hero-h">
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
      <p class="small muted list-note">Opanowane to trzy dobre odpowiedzi z rosnącymi odstępami. Długość linii to liczba pytań w domenie. Dotknij domeny, żeby uczyć się tylko z niej.</p>
      ${network(f, true)}
      ${last ? `<h2 class="list-h">Ostatni egzamin</h2><p class="last-exam"><b>${int(last.pct)}%</b> · ${esc(date(int(last.at)))} · ${pytan(int(last.count))}. <a href="#egzamin" data-tab-link="egzamin">Wszystkie wyniki</a></p>` : ""}`;
  }

  /* ---------- paint ---------- */
  function paintSwitch() {
    switcher.innerHTML = IDS.length > 1 ? IDS.map((id, k) => `<button type="button" data-exam="${id}" aria-pressed="${id === exam}"><i style="--c:var(--l${PROFILES[id].line || k + 1})" aria-hidden="true"></i>${esc(PROFILES[id].short || PROFILES[id].title)}</button>`).join("") : "";
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
    if (e.target.closest("[data-install]") && installEvent) {
      const ev = installEvent;
      ev.prompt();
      ev.userChoice.finally(() => { installEvent = null; paint(); });
      return;
    }
    if (e.target.closest("[data-band-hide]")) { store(BAND_HIDDEN, true); paint(); return; }
    const n = e.target.closest("[data-notify]");
    if (n) { n.disabled = true; turnOn(); return; }
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
  let opener = null;
  function openSettings(section) {
    if (!sheet.open) { opener = document.activeElement; sheet.showModal(); }
    const target = section === "remind" ? document.getElementById("remind") : section === "konto" ? document.getElementById("konto") : null;
    if (target) {
      target.scrollIntoView({ block: "start" });
      (target.querySelector("button, input") || target).focus({ preventScroll: true });
    }
  }
  gear.addEventListener("click", () => openSettings());
  sheet.addEventListener("click", e => { if (e.target === sheet || e.target.closest("[data-close]")) sheet.close(); });
  sheet.addEventListener("close", () => {
    if (acctDetail) { acctDetail = false; paintAccount(); }
    const back = opener && document.contains(opener) && opener !== document.body ? opener : gear;
    paint();
    // paint() redraws the view, so a button inside it is a new node: find it again.
    const again = back.dataset?.open ? view.querySelector(`[data-open="${back.dataset.open}"]`) : back;
    (again || gear).focus({ preventScroll: true });
  });
  // Links from other pages: index.html#przypomnienie / #konto open the sheet there.
  function deepLink() {
    const section = location.hash === "#przypomnienie" ? "remind" : "konto";
    history.replaceState(null, "", "#nauka");
    openSettings(section);
  }

  // Theme.
  const themePick = sheet.querySelector("[data-theme-pick]");
  const markTheme = () => themePick.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === window.HubTheme.get())));
  markTheme();
  themePick.addEventListener("click", e => { const b = e.target.closest("[data-theme-choice]"); if (b) { window.HubTheme.set(b.dataset.themeChoice); markTheme(); } });
  // Text size of questions, answers and comments.
  const textPick = sheet.querySelector("[data-text-pick]");
  const markText = () => textPick.querySelectorAll("[data-text-choice]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.textChoice === window.HubTheme.text())));
  markText();
  textPick.addEventListener("click", e => { const b = e.target.closest("[data-text-choice]"); if (b) { window.HubTheme.setText(b.dataset.textChoice); markText(); } });

  // Single-key shortcuts in study and exam (WCAG 2.1.4); only offered with a keyboard and mouse.
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const slot = sheet.querySelector("[data-shortcuts-slot]");
    let on = true; try { on = localStorage.getItem("exam-hub:shortcuts") !== "off"; } catch (e) {}
    slot.innerHTML = `<label class="switch"><span><b>Skróty klawiszowe</b><br><span class="small muted">Litery i cyfry wybierają odpowiedź.</span></span><input type="checkbox" data-shortcuts${on ? " checked" : ""}></label>`;
    slot.addEventListener("change", e => { try { localStorage.setItem("exam-hub:shortcuts", e.target.checked ? "on" : "off"); } catch (err) {} });
  }

  // Ask the browser to keep this site's data (Safari otherwise clears it after
  // 7 days without a visit). Firefox would show a prompt for it, so not there.
  if (navigator.storage?.persist && !/Firefox\//.test(navigator.userAgent)) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});

  /* ---------- account: sign in with GitHub to sync progress ---------- */
  const acct = document.getElementById("account");
  let acctMsg = "";
  let acctDetail = false;   // the Account subview of Settings is open
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
    if (!u) acctDetail = false;
    sheet.classList.toggle("acct-detail", acctDetail);
    // The dialog's title names the view it shows.
    sheet.querySelector("#settings-h").textContent = acctDetail ? "Konto" : "Ustawienia";
    acct.innerHTML = u && acctDetail ? `
      <button class="link acct-back" type="button" data-acct="close">${icon("back")}Wróć do ustawień</button>
      <div class="acct-who">${avatar(u, 48)}<div><b>${esc(u.login)}</b><span class="small muted" data-acct-note>${esc(note)}</span></div></div>
      <button class="btn btn-block" type="button" data-acct="sync">Synchronizuj teraz</button>
      <ul class="acct-list">
        <li><button type="button" data-acct="logout">Wyloguj</button></li>
        <li><button type="button" data-acct="logout-all">Wyloguj na wszystkich urządzeniach</button></li>
        <li><button type="button" data-acct="export">Zapisz kopię postępu do pliku</button></li>
        <li><button type="button" data-acct="import">Wczytaj kopię z pliku</button></li>
        <li><button type="button" class="acct-del" data-acct="delete">Usuń konto i dane z serwera</button></li>
      </ul>
      <p class="small muted">Na serwerze jest tylko identyfikator, login, nazwa i avatar z GitHuba oraz postęp nauki. Bez dostępu do repozytoriów.</p>`
      : u ? `
      <button class="acct-row" type="button" data-acct="open" aria-label="Konto ${esc(u.login)}: ${esc(note || "zalogowano")}">
        ${avatar(u, 40)}<span><b>${esc(u.login)}</b><span class="small muted" data-acct-note>${esc(note)}</span></span>${icon("chev")}
      </button>`
      : `<p class="small muted">Zaloguj się, żeby mieć pytania i postęp na każdym urządzeniu.</p>
         <button class="btn btn-gh" type="button" data-acct="login">${GH}Zaloguj przez GitHub</button>
         <p class="small acct-files">Kopia postępu: <button class="link" type="button" data-acct="export">zapisz do pliku</button> · <button class="link" type="button" data-acct="import">wczytaj z pliku</button></p>`;
    if (acctMsg) acct.insertAdjacentHTML("beforeend", `<p class="acct-msg" role="status">${esc(acctMsg)}</p>`);
  }
  window.addEventListener("hub:auth", () => { paintAccount(); if (!sheet.open) paint(); });
  window.addEventListener("hub:auth-message", e => { acctMsg = e.detail; paintAccount(); openSettings("konto"); });
  acct.addEventListener("click", e => {
    const b = e.target.closest("[data-acct]");
    if (!b) return;
    const act = b.dataset.acct, sync = window.HubSync;
    acctMsg = "";
    if (act === "open" || act === "close") {
      acctDetail = act === "open";
      paintAccount();
      // Into the subview: its back button; out of it: the row that opened it.
      return acct.querySelector(acctDetail ? "[data-acct=close]" : "[data-acct=open]")?.focus();
    }
    if (act === "login") return sync.login();
    if (act === "sync") return sync.sync();
    if (act === "export") return exportFile();
    if (act === "import") return importFile();
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
  /* Backup file: progress, stars and exam results of this browser. */
  function exportFile() {
    const data = window.HubSync.exportData();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `exam-hub-postep-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    acctMsg = Object.keys(data.items).length ? "Zapisano plik z kopią postępu." : "Nie ma jeszcze postępu do zapisania.";
    paintAccount();
  }
  function importFile() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const n = window.HubSync.importData(JSON.parse(await file.text()));
        acctMsg = n ? "Wczytano kopię. Postęp połączono z tym w przeglądarce." : "Ta kopia nie wnosi niczego nowego.";
      } catch (e) {
        acctMsg = "To nie jest plik kopii Exam Hub.";
      }
      paintAccount(); paint();
    }, { once: true });
    input.click();
  }

  paintAccount();
  // After the account is drawn, so #konto can focus its sign-in button.
  if (location.hash === "#konto" || location.hash === "#przypomnienie") deepLink();

  window.HubDue.publish();

  // Turn the reminder on; if it did not happen (no permission, no network) the settings say why.
  const turnOn = () => window.HubRemind.enable().catch(() => false).then(on => { paint(); if (!on) openSettings("remind"); });

  // Repaint when the reminder state is known (remind.js loads after this file).
  window.addEventListener("hub:remind", () => { if (tab === "nauka" && !sheet.open) paint(); });

  // First time opened from the icon: ask once, softly, before the browser's own permission prompt.
  window.addEventListener("load", () => setTimeout(() => {
    if (!notifyOffer() || Notification.permission !== "default" || load("exam-hub:standalone-seen", false)) return;
    store("exam-hub:standalone-seen", true);
    const dlg = document.createElement("dialog");
    dlg.className = "xf-dialog";
    dlg.setAttribute("aria-labelledby", "first-h");
    dlg.innerHTML = `<h2 id="first-h">Włączyć codzienne przypomnienie?</h2>
      <p>Raz dziennie o ${esc(window.HubRemind.time())} przypomnimy o szybkiej piątce z pytań, które czekają na powtórkę. Godzinę zmienisz w ustawieniach.</p>
      <div class="xf-actions"><button class="btn" data-no>Nie teraz</button><button class="btn btn-primary" data-yes>Włącz powiadomienia</button></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", ev => {
      if (ev.target.closest("[data-yes]")) { dlg.close(); turnOn(); }
      else if (ev.target.closest("[data-no]") || ev.target === dlg) dlg.close();
    });
    dlg.addEventListener("close", () => setTimeout(() => dlg.remove(), 260));
    dlg.showModal();
    dlg.querySelector("[data-yes]").focus();
  }, 1200));

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    // Once a worker is active, ask it to cache the exam pages for offline use.
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(r => r.active?.postMessage("warm")).catch(() => {}));
  }
})();
