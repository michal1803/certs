/* Exam flow: a separate, one-question-per-screen exam that mirrors the real
   exam profile (assets/exam-data.js). It reads questions from the page's
   .q-card markup without changing it, and keeps its own attempt state, so
   study progress is never touched.
   Entry: exam page with #egzamin (or #egzamin=<count>). */
(() => {
  const EXAM_ID = document.documentElement.dataset.exam;
  const P = EXAM_PROFILE;
  const ATTEMPT_KEY = `exam-attempt:${EXAM_ID}:v1`;
  const HISTORY_KEY = `exam-history:${EXAM_ID}:v1`;
  const LETTER_KEYS = "abcdefgh";

  const { esc, load, store, clock, plural, shuffle, icon, questions, domainOf } = Hub;
  const $ = (sel, root = document) => root.querySelector(sel);
  const mins = ms => Math.max(0, Math.round(ms / 60000));

  const scorable = Object.values(questions).filter(q => q.correct.length && q.options.length);

  function buildPool(count) {
    const byDomain = {};
    scorable.forEach(q => (byDomain[q.domain] ||= []).push(q.id));
    const available = {};
    Object.entries(byDomain).forEach(([d, ids]) => { available[d] = ids.length; });
    const quotas = window.examQuotas(P, count, available);
    return shuffle(Object.entries(quotas).flatMap(([d, n]) => shuffle(byDomain[d] || []).slice(0, n)));
  }

  /* ---------- attempt state ---------- */
  let A = load(ATTEMPT_KEY, null);
  if (A && A.v !== 1) A = null;
  const save = () => store(ATTEMPT_KEY, A);
  let screen = null;       // "start" | "question" | "review" | "results"
  let enteredAt = 0;       // when the current question became visible
  let tick = null;
  let reviewFilter = "all";
  let resultsFilter = "all";

  function startAttempt(count, untimed) {
    const pool = buildPool(count);
    const now = Date.now();
    A = {
      v: 1, status: "running", count: pool.length, pool, current: 0,
      answers: {}, flags: [], locked: [], spent: {}, seen: [],
      startedAt: now, deadline: untimed ? null : now + P.exam.minutes * 60000,
      warned: [], timeUp: false, finishedAt: null,
    };
    save();
  }

  function flushTime() {
    if (!A || A.status !== "running" || screen !== "question" || !enteredAt) return;
    const id = A.pool[A.current];
    const now = Date.now();
    A.spent[id] = (A.spent[id] || 0) + (now - enteredAt);
    enteredAt = now;
  }

  function remaining() { return A.deadline ? A.deadline - Date.now() : null; }

  /* ---------- root ---------- */
  const root = document.createElement("div");
  root.className = "xf";
  root.hidden = true;
  root.setAttribute("lang", "pl");
  document.body.appendChild(root);
  const live = document.createElement("div");
  live.className = "sr-live";
  live.setAttribute("aria-live", "polite");
  live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
  document.body.appendChild(live);
  const announce = msg => { live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 30); };

  function open() {
    document.body.classList.add("xf-active");
    root.hidden = false;
    document.title = `${P.title} · egzamin`;
    if (A && A.status === "running" && remaining() !== null && remaining() <= 0) finish(true);
    if (A && A.status === "running" && A.seen.length) showQuestion(A.current);
    else if (A && A.status === "finished" && A.showResults) showResults();
    else showStart();
  }
  function close() {
    flushTime(); if (A) save();
    stopTick();
    document.body.classList.remove("xf-active");
    root.hidden = true;
  }

  function startTick() {
    stopTick();
    tick = setInterval(() => {
      if (!A || A.status !== "running") return stopTick();
      const r = remaining();
      const el = $(".xf-clock", root);
      if (el) renderClock(el);
      if (r !== null) {
        for (const m of [10, 5]) {
          if (r <= m * 60000 && r > 0 && !A.warned.includes(m)) {
            A.warned.push(m); save();
            toast(`Zostało ${m} minut`);
          }
        }
        if (r <= 0) finish(true);
      }
    }, 1000);
  }
  function stopTick() { if (tick) clearInterval(tick); tick = null; }

  function renderClock(el) {
    const r = remaining();
    if (r === null) {
      el.innerHTML = `${icon("clock")}<span>${clock(Date.now() - A.startedAt)}</span>`;
      el.setAttribute("aria-label", `Czas od startu ${clock(Date.now() - A.startedAt)}, bez limitu`);
      return;
    }
    el.innerHTML = `${icon("clock")}<span>${clock(r)}</span>`;
    el.setAttribute("aria-label", `Pozostały czas ${clock(r)}`);
    el.classList.toggle("low", r <= 10 * 60000 && r > 0);
    el.classList.toggle("out", r <= 0);
  }

  let toastTimer = null;
  function toast(msg) {
    let t = $(".xf-toast", root);
    if (!t) { t = document.createElement("div"); t.className = "xf-toast"; t.setAttribute("role", "status"); root.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  /* ---------- start screen ---------- */
  function showStart() {
    screen = "start"; stopTick();
    const hashCount = parseInt((location.hash.match(/egzamin=(\d+)/) || [])[1], 10);
    const counts = P.exam.counts;
    const count = counts.includes(hashCount) ? hashCount : P.exam.defaultCount;
    const running = A && A.status === "running" && A.seen.length;
    root.innerHTML = `
      <div class="xf-screen"><div class="xf-col xf-body">
        <div class="xf-top"><a class="btn btn-quiet" href="index.html">${icon("left")}Egzaminy</a></div>
        <div class="xf-head"><h1 tabindex="-1">${esc(P.title)}</h1><p>Symulacja egzaminu ${esc(P.vendor)}: ten sam czas i te same proporcje domen.</p></div>
        ${running ? `
        <section class="card xf-section" aria-labelledby="resume-h">
          <h2 id="resume-h">Niedokończony egzamin</h2>
          <p>Pytanie ${A.current + 1} z ${A.count}${A.deadline ? ` · zostało ${clock(remaining())}` : " · bez limitu czasu"}. Zegar biegnie dalej, tak jak na prawdziwym egzaminie.</p>
          <button class="btn btn-primary btn-block" data-act="resume">Wróć do egzaminu</button>
          <button class="btn btn-block" data-act="abandon">Porzuć i zacznij od nowa</button>
        </section>` : ""}
        <section class="card xf-section" aria-labelledby="setup-h">
          <h2 id="setup-h">Ustawienia</h2>
          <div class="field"><label for="xf-count">Liczba pytań</label>
            <select class="select" id="xf-count">${counts.map(n => `<option value="${n}"${n === count ? " selected" : ""}>${n} ${plural(n, "pytanie", "pytania", "pytań")}</option>`).join("")}</select></div>
          <div class="xf-facts">
            <div><b data-f="count">${count}</b><span>pytań</span></div>
            <div><b>${P.exam.minutes}</b><span>minut</span></div>
            <div><b>${P.exam.passing ? P.exam.passing.score : "brak"}</b><span>${P.exam.passing ? `próg z ${P.exam.passing.scale}` : "progu"}</span></div>
          </div>
          <div><h3 class="small muted" style="margin-bottom:8px">Pytania z każdej domeny</h3><ul class="split" data-split></ul></div>
          ${P.weightsAreProxy ? `<p class="note">${icon("info")}<span>${esc(P.vendor)} nie publikuje wag domen ani progu. Proporcje liczymy z liczby celów egzaminacyjnych w każdej domenie.</span></p>` : ""}
          <label class="switch"><span><b>Bez limitu czasu</b><br><span class="small muted">Dla nauki w swoim tempie. Prawdziwy egzamin ma ${P.exam.minutes} minut.</span></span><input type="checkbox" id="xf-untimed"></label>
        </section>
        <section class="card xf-section" aria-labelledby="rules-h">
          <h2 id="rules-h">Jak to działa</h2>
          <ul class="xf-rules">
            <li>Jedno pytanie na ekranie. Możesz oznaczać pytania i wracać do nich przed oddaniem.</li>
            <li>Komentarze, wyszukiwarka i podpowiedzi są niedostępne do końca egzaminu.</li>
            <li>Typy pytań: ${esc(P.exam.questionTypes)}. Pytania bez klucza odpowiedzi (hotspot, drag &amp; drop) zostają w trybie Nauka.</li>
            ${P.exam.rules?.seriesNoReturn ? "<li>Do pytań z serii Tak/Nie nie można wrócić po przejściu dalej, tak jak na egzaminie Microsoft.</li>" : ""}
            ${P.exam.rules?.learnUrl ? "<li>Możesz otworzyć Microsoft Learn w nowej karcie. Zegar w tym czasie biegnie.</li>" : ""}
            <li>Zamknięcie strony nie przerywa egzaminu: po powrocie wracasz do tego samego pytania.</li>
          </ul>
        </section>
        <div class="xf-actions"><button class="btn btn-primary btn-block" data-act="begin">${running ? "Zacznij nowy egzamin" : "Rozpocznij egzamin"}</button></div>
        <p class="small muted" style="margin-top:16px">Źródło zasad: oficjalna strona egzaminu, sprawdzone ${esc(P.exam.verified)}. Nieoficjalne narzędzie, niezwiązane z ${esc(P.vendor)}.</p>
      </div></div>`;
    const sel = $("#xf-count", root);
    const renderSplit = () => {
      const n = parseInt(sel.value, 10);
      const avail = {};
      scorable.forEach(q => { avail[q.domain] = (avail[q.domain] || 0) + 1; });
      const q = window.examQuotas(P, n, avail);
      const max = Math.max(...Object.values(q), 1);
      $("[data-split]", root).innerHTML = P.domains.map(d => `<li><span>${esc(d.label)}</span><span class="bar" aria-hidden="true"><i style="width:${(q[d.id] / max) * 100}%"></i></span><b>${q[d.id]}</b></li>`).join("");
      $('[data-f="count"]', root).textContent = n;
    };
    sel.addEventListener("change", renderSplit);
    renderSplit();
    root.scrollTop = 0;
    $("h1", root).focus({ preventScroll: true });
  }

  /* ---------- question screen ---------- */
  function isLocked(i) { return A.locked.includes(A.pool[i]); }

  function leaveCurrent() {
    flushTime();
    const id = A.pool[A.current];
    if (questions[id].series && !A.locked.includes(id)) A.locked.push(id);
  }

  function go(i) {
    if (i < 0 || i >= A.count || i === A.current && screen === "question") return;
    if (isLocked(i)) return;
    if (screen === "question") leaveCurrent();
    showQuestion(i);
  }

  function prevIndex() { for (let i = A.current - 1; i >= 0; i--) if (!isLocked(i)) return i; return -1; }

  function showQuestion(i) {
    screen = "question";
    A.current = i;
    const id = A.pool[i];
    const q = questions[id];
    const firstVisit = !A.seen.includes(id);
    if (firstVisit) A.seen.push(id);
    save();
    enteredAt = Date.now();
    const chosen = A.answers[id] || [];
    const multi = q.correct.length > 1;
    const flagged = A.flags.includes(id);
    const last = i === A.count - 1;
    const prev = prevIndex();
    const parts = q.parts.map(p => p.kind === "text"
      ? `<div class="xf-qtext">${p.html}</div>`
      : `<div class="xf-exhibit">${p.srcs.map(src => `<figure><figcaption>${esc(p.label)}</figcaption><a href="${esc(src)}" target="_blank" rel="noopener" title="Otwórz obrazek w pełnym rozmiarze"><img src="${esc(src)}" alt="${esc(p.label)} do pytania ${i + 1}" loading="lazy" data-src="${esc(src)}"></a></figure>`).join("")}</div>`).join("");
    root.innerHTML = `
      <div class="xf-screen"><div class="xf-col xf-body">
        <div class="xf-top">
          <button class="pill xf-pos" data-act="nav" aria-haspopup="dialog" aria-label="Pytanie ${i + 1} z ${A.count}. Otwórz listę pytań">${icon("grid")}<b>${i + 1}</b><span>z ${A.count}</span></button>
          <div class="right">
            ${P.exam.rules?.learnUrl ? `<a class="pill icon-btn" href="${esc(P.exam.rules.learnUrl)}" target="_blank" rel="noopener" aria-label="Otwórz Microsoft Learn w nowej karcie" title="Microsoft Learn">${icon("book")}</a>` : ""}
            <div class="pill xf-clock" role="timer"></div>
          </div>
        </div>
        <div class="xf-progress" aria-hidden="true"><i style="width:${(i + 1) / A.count * 100}%"></i></div>
        <article class="card xf-q xf-anim" aria-labelledby="xf-qh">
          <h2 id="xf-qh" tabindex="-1">Pytanie ${i + 1} z ${A.count}</h2>
          ${q.series ? `<p class="note warn">${icon("lock")}<span>Pytanie z serii. Po przejściu dalej nie wrócisz do niego.</span></p>` : ""}
          ${parts}
          ${multi ? `<p class="xf-hint" data-hint>Wybierz ${q.correct.length}. Zaznaczono ${chosen.length}.</p>` : ""}
          <fieldset class="xf-opts">
            <legend>Odpowiedzi do pytania ${i + 1}${multi ? `, wybierz ${q.correct.length}` : ""}</legend>
            ${q.options.map((o, k) => `
              <label class="xf-opt">
                <input type="${multi ? "checkbox" : "radio"}" name="xf-ans" value="${esc(o.val)}"${chosen.includes(o.val) ? " checked" : ""}>
                <span class="xf-mark" aria-hidden="true"></span>
                <span class="xf-letter">${esc(o.val)}</span>
                <span class="xf-opt-text">${o.html}</span>
              </label>`).join("")}
          </fieldset>
        </article>
      </div>
      <nav class="xf-bar" aria-label="Nawigacja egzaminu"><div class="xf-bar-inner">
        <button class="btn" data-act="prev"${prev < 0 ? " disabled" : ""}>${icon("left")}Wstecz</button>
        <button class="btn xf-flag" data-act="flag" aria-pressed="${flagged}"${q.series ? ' disabled title="Pytań z serii nie można oznaczać"' : ""}>${icon("flag")}Oznacz</button>
        <button class="btn btn-primary" data-act="next">${last ? "Przegląd" : "Dalej"}${icon("right")}</button>
      </div></nav>
      </div>`;
    renderClock($(".xf-clock", root));
    startTick();
    root.querySelectorAll(".xf-exhibit img").forEach(img => img.addEventListener("error", () => {
      img.closest("figure").innerHTML = `<p class="xf-imgfail">Nie udało się wczytać obrazka do pytania. <a href="${esc(img.dataset.src)}" target="_blank" rel="noopener">Otwórz obrazek w nowej karcie</a></p>`;
    }, { once: true }));
    applyLimit(q);
    root.scrollTop = 0;
    $("#xf-qh", root).focus({ preventScroll: true });
    announce(`Pytanie ${i + 1} z ${A.count}${q.series ? ", pytanie z serii, bez powrotu" : ""}`);
  }

  function applyLimit(q) {
    if (q.correct.length < 2) return;
    const boxes = Array.from(root.querySelectorAll('.xf-opts input'));
    const n = boxes.filter(b => b.checked).length;
    boxes.forEach(b => { b.disabled = !b.checked && n >= q.correct.length; });
    const hint = $("[data-hint]", root);
    if (hint) hint.textContent = `Wybierz ${q.correct.length}. Zaznaczono ${n}.`;
  }

  function onAnswerChange() {
    const id = A.pool[A.current];
    const q = questions[id];
    const vals = Array.from(root.querySelectorAll(".xf-opts input:checked")).map(b => b.value);
    if (vals.length) A.answers[id] = vals; else delete A.answers[id];
    applyLimit(q);
    flushTime();
    save();
  }

  function toggleFlag() {
    const id = A.pool[A.current];
    if (questions[id].series) return;
    const on = !A.flags.includes(id);
    A.flags = on ? [...A.flags, id] : A.flags.filter(x => x !== id);
    save();
    const b = $('[data-act="flag"]', root);
    if (b) b.setAttribute("aria-pressed", String(on));
    announce(on ? "Pytanie oznaczone do powtórki" : "Usunięto oznaczenie");
  }

  /* ---------- navigator sheet ---------- */
  function openNavigator() {
    const dlg = document.createElement("dialog");
    dlg.className = "xf-sheet";
    dlg.setAttribute("aria-labelledby", "xf-nav-h");
    dlg.innerHTML = `<div class="xf-sheet-in">
      <div class="xf-sheet-head"><h2 id="xf-nav-h">Pytania</h2><button class="btn btn-quiet icon-btn" data-close aria-label="Zamknij">${icon("close")}</button></div>
      <div class="xf-grid">${A.pool.map((id, i) => {
        const locked = A.locked.includes(id) && i !== A.current;
        const done = !!A.answers[id];
        const flag = A.flags.includes(id);
        const state = [done ? "odpowiedziane" : "bez odpowiedzi", flag ? "oznaczone" : "", locked ? "zablokowane" : "", i === A.current ? "bieżące" : ""].filter(Boolean).join(", ");
        return `<button class="xf-cell${done ? " done" : ""}${i === A.current ? " cur" : ""}" data-go="${i}"${locked ? " disabled" : ""} aria-label="Pytanie ${i + 1}: ${state}"${i === A.current ? ' aria-current="true"' : ""}>${i + 1}${flag ? `<span class="flag">${icon("flag")}</span>` : ""}</button>`;
      }).join("")}</div>
      <div class="xf-legend"><span><i class="d"></i>odpowiedziane</span><span><i></i>bez odpowiedzi</span><span>${icon("flag")}oznaczone</span>${A.locked.length ? '<span><i class="l"></i>seria, bez powrotu</span>' : ""}</div>
      <button class="btn btn-block" data-review>${icon("list")}Ekran przeglądu</button>
    </div>`;
    root.appendChild(dlg);
    dlg.addEventListener("click", e => {
      if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
      const cell = e.target.closest("[data-go]");
      if (cell) { dlg.close(); go(parseInt(cell.dataset.go, 10)); return; }
      if (e.target.closest("[data-review]")) { dlg.close(); toReview(); }
    });
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    $(".xf-cell.cur", dlg)?.focus();
  }

  /* ---------- review screen ---------- */
  function toReview() {
    if (screen === "question") leaveCurrent();
    save();
    showReview();
  }

  function showReview() {
    screen = "review";
    const open = A.pool.filter(id => !A.answers[id] && !A.locked.includes(id));
    const flagged = A.pool.filter(id => A.flags.includes(id));
    const list = A.pool.map((id, i) => ({ id, i })).filter(({ id }) =>
      reviewFilter === "open" ? !A.answers[id] : reviewFilter === "flag" ? A.flags.includes(id) : true);
    root.innerHTML = `
      <div class="xf-screen"><div class="xf-col xf-body">
        <div class="xf-top"><span></span><div class="pill xf-clock" role="timer"></div></div>
        <div class="xf-head"><h1 tabindex="-1">Przegląd</h1><p>Odpowiedzi: ${A.count - A.pool.filter(id => !A.answers[id]).length} z ${A.count}. Sprawdź pytania bez odpowiedzi i oznaczone, zanim zakończysz.</p></div>
        <div class="xf-chips" role="group" aria-label="Filtr" style="margin:12px 0">
          <button class="chip" data-filter="all" aria-pressed="${reviewFilter === "all"}">Wszystkie ${A.count}</button>
          <button class="chip" data-filter="open" aria-pressed="${reviewFilter === "open"}">Bez odpowiedzi ${A.pool.filter(id => !A.answers[id]).length}</button>
          <button class="chip" data-filter="flag" aria-pressed="${reviewFilter === "flag"}">Oznaczone ${flagged.length}</button>
        </div>
        <ul class="xf-list">${list.length ? list.map(({ id, i }) => {
          const locked = A.locked.includes(id);
          const done = !!A.answers[id];
          const flag = A.flags.includes(id);
          const status = locked ? `<span class="s s-lock">${icon("lock")}${done ? "Zapisane" : "Bez odpowiedzi"}</span>`
            : done ? `<span class="s s-done">${flag ? icon("flag") : ""}Odpowiedziane</span>`
            : `<span class="s s-open">${flag ? icon("flag") : ""}Bez odpowiedzi</span>`;
          return `<li><button class="xf-row" data-go="${i}"${locked ? " disabled" : ""}><span class="n">${i + 1}</span><span class="t">${esc(questions[id].text.slice(0, 120))}</span>${status}<span class="time" aria-label="czas ${clock(A.spent[id] || 0)}">${clock(A.spent[id] || 0)}</span></button></li>`;
        }).join("") : `<li class="note">${icon("check")}<span>Nic tu nie ma: ${reviewFilter === "open" ? "każde pytanie ma odpowiedź" : "nie oznaczono żadnego pytania"}.</span></li>`}</ul>
      </div>
      <nav class="xf-bar" aria-label="Nawigacja przeglądu"><div class="xf-bar-inner" style="grid-template-columns:1fr 1.5fr">
        <button class="btn" data-act="back">${icon("left")}Pytania</button>
        <button class="btn btn-primary" data-act="finish">Zakończ egzamin</button>
      </div></nav></div>`;
    renderClock($(".xf-clock", root));
    startTick();
    root.scrollTop = 0;
    $("h1", root).focus({ preventScroll: true });
  }

  function confirmFinish() {
    const unanswered = A.pool.filter(id => !A.answers[id]).length;
    const flagged = A.flags.length;
    const dlg = document.createElement("dialog");
    dlg.className = "xf-dialog";
    dlg.setAttribute("aria-labelledby", "xf-fin-h");
    dlg.innerHTML = `<h2 id="xf-fin-h">Zakończyć egzamin?</h2>
      <p>${unanswered ? `Bez odpowiedzi: ${unanswered}. ` : "Wszystkie pytania mają odpowiedź. "}${flagged ? `Oznaczone: ${flagged}. ` : ""}Po zakończeniu nie zmienisz odpowiedzi.</p>
      <div class="xf-actions"><button class="btn" data-no>Wróć</button><button class="btn btn-primary" data-yes>Zakończ</button></div>`;
    root.appendChild(dlg);
    dlg.addEventListener("click", e => {
      if (e.target.closest("[data-yes]")) { dlg.close(); finish(false); }
      else if (e.target.closest("[data-no]") || e.target === dlg) dlg.close();
    });
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    $("[data-no]", dlg).focus();
  }

  /* ---------- scoring + results ---------- */
  function scoreQuestion(id) {
    const q = questions[id];
    const chosen = A.answers[id] || [];
    const hits = chosen.filter(v => q.correct.includes(v)).length;
    const exact = hits === q.correct.length && chosen.length === q.correct.length;
    const max = P.exam.partialCredit ? q.correct.length : 1;
    const pts = P.exam.partialCredit ? Math.max(0, hits - Math.max(0, chosen.length - q.correct.length)) : (exact ? 1 : 0);
    return { pts, max, exact, chosen };
  }

  function finish(timeUp) {
    if (!A || A.status !== "running") return;
    if (screen === "question") flushTime();
    stopTick();
    A.status = "finished";
    A.timeUp = !!timeUp;
    A.finishedAt = Date.now();
    A.showResults = true;
    let pts = 0, max = 0;
    A.pool.forEach(id => { const s = scoreQuestion(id); pts += s.pts; max += s.max; });
    const history = load(HISTORY_KEY, []);
    history.unshift({ at: A.finishedAt, count: A.count, pct: max ? Math.round(pts / max * 100) : 0, untimed: !A.deadline });
    store(HISTORY_KEY, history.slice(0, 10));
    save();
    showResults();
  }

  function showResults() {
    screen = "results"; stopTick();
    const rows = A.pool.map((id, i) => ({ id, i, q: questions[id], s: scoreQuestion(id) }));
    const pts = rows.reduce((s, r) => s + r.s.pts, 0);
    const max = rows.reduce((s, r) => s + r.s.max, 0);
    const pct = max ? pts / max : 0;
    const used = A.timeUp && A.deadline ? A.deadline - A.startedAt : (A.finishedAt || Date.now()) - A.startedAt;
    const byDomain = P.domains.map(d => {
      const rs = rows.filter(r => r.q.domain === d.id);
      const p = rs.reduce((s, r) => s + r.s.pts, 0), m = rs.reduce((s, r) => s + r.s.max, 0);
      return { d, p, m, n: rs.length };
    }).filter(x => x.n);
    const pass = P.exam.passing ? pct >= P.exam.passing.score / P.exam.passing.scale : null;
    const tag = pass === null
      ? `<span class="tag neutral">${icon("info")}Brak oficjalnego progu</span>`
      : pass ? `<span class="tag pass">${icon("check")}Zdany (szacunek)</span>` : `<span class="tag fail">${icon("x")}Niezdany (szacunek)</span>`;
    const scoreLine = P.exam.passing
      ? `<p class="xf-score">≈ ${Math.round(pct * P.exam.passing.scale)} <small>/ ${P.exam.passing.scale}</small></p>
         <p class="muted">${pts} z ${max} pkt (${Math.round(pct * 100)}%). Prawdziwy wynik ${esc(P.vendor)} jest skalowany: próg ${P.exam.passing.score} to nie to samo co ${Math.round(P.exam.passing.score / P.exam.passing.scale * 100)}%, więc to tylko przybliżenie.</p>`
      : `<p class="xf-score">${Math.round(pct * 100)}<small>%</small></p>
         <p class="muted">${pts} z ${max} pytań. ${esc(P.vendor)} nie publikuje progu zaliczenia.</p>`;
    const list = rows.filter(r => resultsFilter === "wrong" ? !r.s.exact : resultsFilter === "flag" ? A.flags.includes(r.id) : true);
    root.innerHTML = `
      <div class="xf-screen"><div class="xf-col xf-body" style="padding-bottom:40px">
        <div class="xf-top"><a class="btn btn-quiet" href="index.html">${icon("home")}Egzaminy</a></div>
        <section class="card xf-verdict" aria-labelledby="xf-res-h">
          <h1 id="xf-res-h" tabindex="-1">Wynik: ${esc(P.title)}</h1>
          ${tag}
          ${scoreLine}
          <p class="muted">Czas: ${mins(used)} min${A.deadline ? ` z ${P.exam.minutes}` : " (bez limitu)"}${A.timeUp ? ". Czas minął, egzamin oddano automatycznie" : ""}.</p>
        </section>
        <section class="card xf-section" aria-labelledby="xf-dom-h">
          <h2 id="xf-dom-h">Wynik w domenach</h2>
          <ul class="split xf-domains">${byDomain.map(x => `<li><span>${esc(x.d.label)}</span><span class="bar" aria-hidden="true"><i style="width:${x.m ? x.p / x.m * 100 : 0}%"></i></span><b>${x.m ? Math.round(x.p / x.m * 100) : 0}%</b></li>`).join("")}</ul>
          <p class="small muted">Jak na oficjalnym raporcie: krótszy pasek to słabsza domena. Domeny z małą liczbą pytań wahają się mocno.</p>
        </section>
        <div class="xf-actions" style="grid-template-columns:1fr 1fr">
          <a class="btn" href="index.html">Egzaminy</a>
          <button class="btn btn-primary" data-act="again">Nowy egzamin</button>
        </div>
        <section class="xf-section" style="padding:0" aria-labelledby="xf-ans-h">
          <h2 id="xf-ans-h" style="margin-top:12px">Twoje odpowiedzi</h2>
          <div class="xf-chips" role="group" aria-label="Filtr odpowiedzi">
            <button class="chip" data-rfilter="all" aria-pressed="${resultsFilter === "all"}">Wszystkie ${rows.length}</button>
            <button class="chip" data-rfilter="wrong" aria-pressed="${resultsFilter === "wrong"}">Błędne ${rows.filter(r => !r.s.exact).length}</button>
            <button class="chip" data-rfilter="flag" aria-pressed="${resultsFilter === "flag"}">Oznaczone ${A.flags.length}</button>
          </div>
          <div class="xf-ans">${list.map(r => `
            <details>
              <summary><span class="n"><b>${r.i + 1}</b></span>${r.s.exact ? `<span class="ok">${icon("check", "poprawnie")}</span>` : `<span class="bad">${icon("x", r.s.pts ? "częściowo" : "błędnie")}</span>`}<span class="t">${esc(r.q.text.slice(0, 140))}</span><span class="time">${clock(A.spent[r.id] || 0)}</span></summary>
              <div class="body">
                <p class="small muted">${esc(domainOf(r.q.domain).name)}${r.s.max > 1 ? ` · ${r.s.pts}/${r.s.max} pkt` : ""}</p>
                ${r.q.parts.filter(p => p.kind === "text").map(p => `<div class="xf-qtext">${p.html}</div>`).join("")}
                ${r.q.options.map(o => {
                  const isC = r.q.correct.includes(o.val), mine = r.s.chosen.includes(o.val);
                  const cls = isC ? "correct" : mine ? "wrong" : "";
                  const lbl = isC && mine ? "Twoja · poprawna" : isC ? "Poprawna" : mine ? "Twoja" : "";
                  return `<div class="opt-r ${cls}"><b>${esc(o.val)}</b><span>${o.html}</span>${lbl ? `<span class="lbl">${lbl}</span>` : ""}</div>`;
                }).join("")}
              </div>
            </details>`).join("") || `<p class="note">${icon("check")}<span>Brak pytań w tym filtrze.</span></p>`}</div>
        </section>
      </div></div>`;
    root.scrollTop = 0;
    $("#xf-res-h", root).focus({ preventScroll: true });
    announce(pass === null ? `Wynik ${Math.round(pct * 100)} procent` : `${pass ? "Zdany" : "Niezdany"}, szacunkowo ${Math.round(pct * 100)} procent`);
  }

  /* ---------- events ---------- */
  root.addEventListener("click", e => {
    const t = e.target.closest("[data-act],[data-go],[data-filter],[data-rfilter]");
    if (!t || t.disabled) return;
    if (t.dataset.go !== undefined && screen === "review") return go(parseInt(t.dataset.go, 10));
    if (t.dataset.filter) { reviewFilter = t.dataset.filter; return showReview(); }
    if (t.dataset.rfilter) { resultsFilter = t.dataset.rfilter; return showResults(); }
    switch (t.dataset.act) {
      case "begin": {
        startAttempt(parseInt($("#xf-count", root).value, 10), $("#xf-untimed", root).checked);
        return showQuestion(0);
      }
      case "resume": return showQuestion(A.current);
      case "abandon": A = null; localStorage.removeItem(ATTEMPT_KEY); return showStart();
      case "nav": return openNavigator();
      case "prev": { const p = prevIndex(); if (p >= 0) go(p); return; }
      case "next": return A.current === A.count - 1 ? toReview() : go(A.current + 1);
      case "flag": return toggleFlag();
      case "back": {
        // First open question, else where you were, else any question still reachable.
        let i = A.pool.findIndex(id => !A.locked.includes(id) && !A.answers[id]);
        if (i < 0) i = isLocked(A.current) ? A.pool.findIndex(id => !A.locked.includes(id)) : A.current;
        return i >= 0 ? showQuestion(i) : undefined;
      }
      case "finish": return confirmFinish();
      case "again": A = null; localStorage.removeItem(ATTEMPT_KEY); return showStart();
    }
  });
  root.addEventListener("change", e => { if (e.target.closest(".xf-opts")) onAnswerChange(); });

  document.addEventListener("keydown", e => {
    if (root.hidden || screen !== "question" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.target instanceof Element && e.target.matches("input[type=text], textarea, select")) return;
    const k = e.key.toLowerCase();
    const opts = Array.from(root.querySelectorAll(".xf-opts input"));
    let idx = LETTER_KEYS.indexOf(k);
    if (idx < 0 && /^[1-8]$/.test(k)) idx = parseInt(k, 10) - 1;
    if (idx >= 0 && idx < opts.length) {
      e.preventDefault();
      const box = opts[idx];
      if (box.disabled) return;
      box.checked = box.type === "radio" ? true : !box.checked;
      box.focus({ preventScroll: true });
      onAnswerChange();
    } else if (e.key === "ArrowRight") { e.preventDefault(); $('[data-act="next"]', root)?.click(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); $('[data-act="prev"]', root)?.click(); }
    else if (k === "f") { e.preventDefault(); toggleFlag(); }
  });

  document.addEventListener("visibilitychange", () => { if (document.hidden) { flushTime(); if (A) save(); } });
  window.addEventListener("pagehide", () => { flushTime(); if (A) save(); });

  /* ---------- wiring into the study page ---------- */
  const wantsExam = () => /^#egzamin(=\d+)?$/.test(location.hash);
  window.addEventListener("hashchange", () => { if (wantsExam()) open(); else if (!root.hidden) close(); });

  if (wantsExam()) open();
})();
