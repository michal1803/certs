/* Study mode: one question per screen with instant feedback, community
   comments after answering, stars, and a smart queue (wrong and new
   questions first, mastered ones later). Questions come from Hub (core.js);
   their markup is never changed. Progress is per browser. */
(() => {
  const { esc, load, store, plural, shuffle, icon, profile: P, questions, order, domainOf, examId, motion, pop, removeAfterClose } = Hub;
  if (!P) return;
  const KEY = `study:${examId}:v1`;
  const SESSION_KEY = `study-session:${examId}`;
  const LETTERS = "abcdefgh";
  const RECENT = 4; // a missed question comes back after this many others

  /* ---------- progress store (migrates the old study page once) ---------- */
  let S = load(KEY, null);
  if (!S || S.v !== 1) {
    S = { v: 1, ans: {}, stars: [], order: "smart" };
    const legacy = load(P.storage.progress, null);
    const legacyUi = load(P.storage.ui, {});
    Object.entries(legacy?.state || {}).forEach(([id, st]) => {
      if (questions[id] && st?.answered && st?.counted) {
        S.ans[id] = { sel: Array.isArray(st.selected) ? st.selected : [], ok: !!st.wasCorrect, at: legacy.savedAt || Date.now(), n: 1, streak: st.wasCorrect ? 1 : 0 };
      }
    });
    S.stars = (legacyUi.stars || []).filter(id => questions[id]);
  }
  function save() {
    // Summary for the launcher, which cannot read the question bank.
    const summary = {};
    P.domains.forEach(d => { summary[d.id] = { total: 0, seen: 0, ok: 0 }; });
    order.forEach(id => {
      const s = summary[questions[id].domain]; if (!s) return;
      s.total++;
      const a = S.ans[id];
      if (a) { s.seen++; if (a.ok) s.ok++; }
    });
    S.summary = summary;
    S.wrong = order.filter(id => S.ans[id] && !S.ans[id].ok).length;
    S.starCount = S.stars.length;
    S.savedAt = Date.now();
    store(KEY, S);
  }

  /* ---------- session: what you saw, in order, so Back works ---------- */
  let session = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; } })();
  if (!session || !Array.isArray(session.history)) session = { history: [], pos: -1, scope: { domain: "", set: "all" }, revealed: {} };
  const saveSession = () => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} };
  let draft = {};          // unchecked selections per question in this view
  let peeked = {};         // answers revealed without counting
  let revealPending = null; // question whose answer was just checked (plays the reveal)
  let lastRendered = null;

  const scopeFromHash = () => {
    const m = location.hash.match(/^#nauka(?:=([a-z-]+))?$/);
    return m ? (m[1] && P.domains.some(d => d.id === m[1]) ? m[1] : "") : null;
  };

  function inScope(id) {
    const q = questions[id], sc = session.scope;
    if (sc.domain && q.domain !== sc.domain) return false;
    if (sc.set === "new") return !S.ans[id];
    if (sc.set === "wrong") return !!S.ans[id] && !S.ans[id].ok;
    if (sc.set === "star") return S.stars.includes(id);
    return true;
  }

  function pickNext() {
    const cur = session.history[session.pos];
    const pool = order.filter(inScope);
    if (!pool.length) return null;
    if (S.order === "bank") {
      const i = cur ? pool.indexOf(cur) : -1;
      return pool[(i + 1) % pool.length];
    }
    const recent = new Set(session.history.slice(-RECENT));
    const candidates = pool.filter(id => !recent.has(id) && id !== cur);
    const list = candidates.length ? candidates : pool.filter(id => id !== cur);
    if (!list.length) return pool[0];
    const now = Date.now();
    const score = id => {
      const a = S.ans[id];
      if (!a) return 1;                      // new
      if (!a.ok) return 0;                   // missed: soonest
      return 2 + a.streak - Math.min(1, (now - a.at) / 864e5 / 7); // mastered: later, older first
    };
    const best = Math.min(...list.map(score));
    return shuffle(list.filter(id => score(id) - best < 0.25))[0];
  }

  /* ---------- root ---------- */
  const root = document.createElement("div");
  root.className = "xf sv";
  root.setAttribute("lang", "pl");
  document.body.appendChild(root);
  const live = document.createElement("div");
  live.setAttribute("aria-live", "polite");
  live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
  document.body.appendChild(live);
  const announce = msg => { live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 30); };
  const $ = sel => root.querySelector(sel);

  function goTo(id, push = true) {
    if (!id) return renderEmpty();
    if (push) {
      session.history = session.history.slice(0, session.pos + 1);
      session.history.push(id);
      if (session.history.length > 200) session.history = session.history.slice(-200);
      session.pos = session.history.length - 1;
    }
    saveSession();
    render();
  }
  const next = () => {
    motion.dir = "next";
    if (session.pos < session.history.length - 1) { session.pos++; saveSession(); return render(); }
    goTo(pickNext());
  };
  const back = () => { if (session.pos > 0) { motion.dir = "prev"; session.pos--; saveSession(); render(); } };

  function mastered() {
    const ids = order.filter(id => !session.scope.domain || questions[id].domain === session.scope.domain);
    return { ok: ids.filter(id => S.ans[id]?.ok).length, total: ids.length };
  }

  function scopeLabel() {
    const sc = session.scope;
    const set = { all: "", new: "nowe", wrong: "błędne", star: "z gwiazdką" }[sc.set];
    const dom = sc.domain ? domainOf(sc.domain).label : "Wszystkie";
    return set ? `${dom} · ${set}` : dom;
  }

  function topBar() {
    const m = mastered();
    const id = session.history[session.pos];
    const starred = id && S.stars.includes(id);
    return `
      <div class="xf-top">
        <a class="pill icon-btn" href="index.html" aria-label="Wróć do listy egzaminów" title="Egzaminy">${icon("home")}</a>
        <button class="pill sv-scope" data-act="list" aria-haspopup="dialog">${icon("list")}<span>${esc(scopeLabel())}</span></button>
        ${id ? `<button class="pill icon-btn sv-star" data-act="star" aria-pressed="${starred}" aria-label="${starred ? "Usuń gwiazdkę" : "Dodaj gwiazdkę"}" title="Gwiazdka">${icon("star")}</button>` : `<span class="pill-gap"></span>`}
      </div>
      <div class="sv-mastery"><span>Opanowane <b>${m.ok}</b> z ${m.total}</span><span class="xf-progress" aria-hidden="true"><i style="width:${m.total ? m.ok / m.total * 100 : 0}%"></i></span></div>`;
  }

  function renderEmpty() {
    const sc = session.scope;
    const why = sc.set === "wrong" ? "Nie masz błędnych odpowiedzi w tym zakresie." : sc.set === "star" ? "Nie dodałeś jeszcze gwiazdek w tym zakresie." : sc.set === "new" ? "Odpowiedziałeś już na wszystkie pytania w tym zakresie." : "Brak pytań w tym zakresie.";
    root.innerHTML = `<div class="xf-screen"><div class="xf-col xf-body">${topBar()}
      <section class="card xf-section" style="margin-top:16px"><h1 class="sv-h1" tabindex="-1">Nic do nauki</h1><p class="muted">${why}</p>
      <button class="btn btn-primary btn-block" data-act="all">Ucz się ze wszystkich pytań</button></section></div></div>`;
    $("h1").focus({ preventScroll: true });
  }

  function communityHTML(q, open) {
    const votes = {};
    q.comments.forEach(c => { const a = String(c.answer || "").toUpperCase().trim(); if (a) votes[a] = (votes[a] || 0) + 1; });
    const voteLine = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<span class="sv-vote"><b>${esc(a)}</b> ${n}</span>`).join("");
    return `
      <details class="sv-comments"${open ? " open" : ""}>
        <summary>${icon("chat")}<span>Komentarze społeczności (${q.comments.length})</span>${voteLine ? `<span class="sv-votes" aria-label="Głosy">${voteLine}</span>` : ""}</summary>
        <div class="sv-comments-body">
          ${q.comments.length ? q.comments.map(c => `
            <article class="sv-comment">
              <p class="sv-comment-head"><b>${esc(c.user || "anonim")}</b>${c.answer ? `<span class="sv-vote">głos: ${esc(c.answer)}</span>` : ""}</p>
              <p>${esc(c.text || "").replace(/\n/g, "<br>")}</p>
            </article>`).join("") : `<p class="muted">Brak komentarzy dla tego pytania.</p>`}
          <p class="small muted">Komentarze pochodzą od społeczności i mogą być błędne.</p>
          ${q.link ? `<a class="btn btn-quiet sv-ext" href="${esc(q.link)}" target="_blank" rel="noopener">${icon("external")}Dyskusja na ExamTopics</a>` : ""}
        </div>
      </details>`;
  }

  function render() {
    const id = session.history[session.pos];
    if (!id) return renderEmpty();
    const q = questions[id];
    const keyed = q.correct.length > 0 && q.options.length > 0;
    const rec = session.revealed[id];            // answered/peeked during this session view
    const checked = !!rec;
    const multi = q.correct.length > 1;
    const chosen = rec?.sel || draft[id] || [];
    const prior = S.ans[id];
    const justChecked = revealPending === id; revealPending = null;
    const changed = id !== lastRendered; lastRendered = id;
    const cardMotion = justChecked ? "is-checked" : changed ? `xf-enter-${motion.dir}` : "";
    motion.dir = "next";
    document.title = `${P.title} · nauka`;

    const parts = q.parts.map(p => p.kind === "text"
      ? `<div class="xf-qtext">${p.html}</div>`
      : `<div class="xf-exhibit">${p.srcs.map(src => `<figure><figcaption>${esc(p.label)}</figcaption><a href="${esc(src)}" target="_blank" rel="noopener" title="Otwórz obrazek w pełnym rozmiarze"><img src="${esc(src)}" alt="${esc(p.label)}" loading="lazy" data-src="${esc(src)}"></a></figure>`).join("")}</div>`).join("");

    let answerBlock = "";
    if (keyed) {
      answerBlock = `
        ${multi && !checked ? `<p class="xf-hint" data-hint>Wybierz ${q.correct.length}. Zaznaczono ${chosen.length}.</p>` : ""}
        <fieldset class="xf-opts"${checked ? " disabled" : ""}>
          <legend>Odpowiedzi${multi ? `, wybierz ${q.correct.length}` : ""}</legend>
          ${q.options.map(o => {
            const isC = q.correct.includes(o.val), mine = chosen.includes(o.val);
            const state = !checked ? "" : isC ? " is-correct" : mine ? " is-wrong" : " is-dim";
            const tag = !checked ? "" : isC && mine ? "Twoja · poprawna" : isC ? "Poprawna" : mine ? "Twoja" : "";
            return `<label class="xf-opt${state}">
              <input type="${multi ? "checkbox" : "radio"}" name="sv-ans" value="${esc(o.val)}"${mine ? " checked" : ""}>
              <span class="xf-mark" aria-hidden="true"></span>
              <span class="xf-letter">${esc(o.val)}</span>
              <span class="xf-opt-text">${tag ? `<span class="sv-tag">${isC ? icon("check") : icon("x")}${tag}</span>` : ""}${o.html}</span>
            </label>`;
          }).join("")}
        </fieldset>`;
      if (checked) {
        const ok = rec.kind === "answer" && rec.ok;
        answerBlock += rec.kind === "peek"
          ? `<p class="sv-result neutral">${icon("eye")}<span>Podejrzana odpowiedź: <b>${q.correct.join(", ")}</b>. Nie liczy się do postępu.</span></p>`
          : `<p class="sv-result ${ok ? "ok" : "bad"}">${icon(ok ? "check" : "x")}<span>${ok ? "Dobrze." : `Źle. Poprawna odpowiedź: <b>${q.correct.join(", ")}</b>.`}</span></p>`;
        answerBlock += `<div class="sv-after"><button class="btn btn-quiet" data-act="retry">${icon("undo")}Odpowiedz jeszcze raz</button></div>`;
        answerBlock += communityHTML(q, false);
      } else {
        answerBlock += `<div class="sv-after"><button class="btn btn-quiet" data-act="peek">${icon("eye")}Pokaż odpowiedź</button></div>`;
      }
    } else {
      // Hotspot / drag & drop: no answer key in the bank.
      if (!checked) {
        answerBlock = `<p class="note">${icon("info")}<span>To pytanie jest typu hotspot lub drag &amp; drop. Rozwiąż je w głowie albo na kartce, potem porównaj z komentarzami.</span></p>
          <div class="sv-after"><button class="btn btn-block" data-act="reveal">${icon("eye")}Pokaż pole i komentarze</button></div>`;
      } else {
        answerBlock = `
          <p class="note warn">${icon("info")}<span>Baza nie ma oficjalnego rozwiązania tego pytania. Porównaj swoją odpowiedź z komentarzami społeczności i dyskusją.</span></p>
          ${q.answerArea.length ? `<div class="xf-exhibit">${q.answerArea.map(src => `<figure><figcaption>Pole odpowiedzi z pytania (bez rozwiązania)</figcaption><img src="${esc(src)}" alt="Pole odpowiedzi" loading="lazy" data-src="${esc(src)}"></figure>`).join("")}</div>` : ""}
          ${communityHTML(q, true)}
          ${rec.kind === "self"
            ? `<p class="sv-result ${rec.ok ? "ok" : "bad"}">${icon(rec.ok ? "check" : "x")}<span>${rec.ok ? "Oznaczone jako: wiedziałem." : "Oznaczone jako: nie wiedziałem. Wróci w kolejce."}</span></p>`
            : `<div class="sv-self"><p><b>Jak poszło?</b></p><div class="sv-self-btns"><button class="btn" data-self="0">${icon("x")}Nie wiedziałem</button><button class="btn" data-self="1">${icon("check")}Wiedziałem</button></div></div>`}`;
      }
    }

    const canBack = session.pos > 0;
    const hasDraft = (draft[id] || []).length > 0;
    const primary = checked
      ? `<button class="btn btn-primary" data-act="next">Dalej${icon("right")}</button>`
      : keyed && hasDraft
        ? `<button class="btn btn-primary" data-act="check">Sprawdź</button>`
        : `<button class="btn" data-act="next">Pomiń${icon("right")}</button>`;

    root.innerHTML = `
      <div class="xf-screen"><div class="xf-col xf-body">
        ${topBar()}
        <article class="card xf-q ${cardMotion}" aria-labelledby="sv-qh">
          <div class="sv-meta"><span class="sv-num">${esc(q.num)}</span><span class="sv-dom">${esc(domainOf(q.domain).label)}</span>${prior ? `<span class="tag ${prior.ok ? "pass" : "fail"} sv-prev">${icon(prior.ok ? "check" : "x")}${prior.ok ? "ostatnio dobrze" : "ostatnio źle"}</span>` : `<span class="tag neutral sv-prev">nowe</span>`}</div>
          <h1 id="sv-qh" class="sv-hidden" tabindex="-1">Pytanie ${esc(q.num)}</h1>
          ${parts}
          ${answerBlock}
        </article>
      </div>
      <nav class="xf-bar" aria-label="Nawigacja nauki"><div class="xf-bar-inner" style="grid-template-columns:1fr 1.5fr">
        <button class="btn" data-act="back"${canBack ? "" : " disabled"}>${icon("left")}Wstecz</button>
        ${primary}
      </div></nav></div>`;
    root.querySelectorAll(".xf-exhibit img").forEach(img => img.addEventListener("error", () => {
      img.closest("figure").innerHTML = `<p class="xf-imgfail">Nie udało się wczytać obrazka. <a href="${esc(img.dataset.src)}" target="_blank" rel="noopener">Otwórz w nowej karcie</a></p>`;
    }, { once: true }));
    applyLimit(q, checked);
    root.scrollTop = 0;
    $("#sv-qh").focus({ preventScroll: true });
  }

  function applyLimit(q, checked) {
    if (checked || q.correct.length < 2) return;
    const boxes = Array.from(root.querySelectorAll(".xf-opts input"));
    const n = boxes.filter(b => b.checked).length;
    boxes.forEach(b => { b.disabled = !b.checked && n >= q.correct.length; });
    const hint = $("[data-hint]");
    if (hint) hint.textContent = `Wybierz ${q.correct.length}. Zaznaczono ${n}.`;
  }

  function record(id, ok, sel, kind) {
    const prev = S.ans[id];
    S.ans[id] = { sel, ok, at: Date.now(), n: (prev?.n || 0) + 1, streak: ok ? (prev?.ok ? prev.streak + 1 : 1) : 0 };
    if (kind === "self") S.ans[id].self = true;
    save();
  }

  function check() {
    const id = session.history[session.pos], q = questions[id];
    const sel = draft[id] || [];
    if (!sel.length) return;
    const ok = sel.length === q.correct.length && sel.every(v => q.correct.includes(v));
    record(id, ok, sel, "answer");
    session.revealed[id] = { kind: "answer", ok, sel };
    revealPending = id;
    delete draft[id];
    saveSession();
    render();
    announce(ok ? "Dobrze" : `Źle, poprawna odpowiedź ${q.correct.join(", ")}`);
  }

  /* ---------- question list sheet ---------- */
  function openList() {
    const dlg = document.createElement("dialog");
    dlg.className = "xf-sheet sv-sheet";
    dlg.setAttribute("aria-labelledby", "sv-list-h");
    const sc = session.scope;
    const sets = [["all", "Wszystkie"], ["new", "Nowe"], ["wrong", "Błędne"], ["star", "Gwiazdki"]];
    dlg.innerHTML = `<div class="xf-sheet-in">
      <div class="xf-sheet-head"><h2 id="sv-list-h">Pytania</h2><button class="btn btn-quiet icon-btn" data-close aria-label="Zamknij">${icon("close")}</button></div>
      <div class="sv-search">${icon("search")}<input type="search" placeholder="Szukaj w pytaniach, np. peering, Q120" aria-label="Szukaj w pytaniach" autocomplete="off"></div>
      <div class="xf-chips" role="group" aria-label="Zestaw">${sets.map(([k, l]) => `<button class="chip" data-set="${k}" aria-pressed="${sc.set === k}">${l}</button>`).join("")}</div>
      <div class="field"><label for="sv-dom">Domena</label><select class="select" id="sv-dom"><option value="">Wszystkie domeny</option>${P.domains.map(d => `<option value="${d.id}"${sc.domain === d.id ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
      <div class="field"><span class="sv-label">Kolejność</span><div class="seg" role="radiogroup" aria-label="Kolejność">
        <button role="radio" aria-checked="${S.order !== "bank"}" data-order="smart">Mądra kolejka</button>
        <button role="radio" aria-checked="${S.order === "bank"}" data-order="bank">Jak w bazie</button></div></div>
      <div class="field"><span class="sv-label">Motyw</span><div class="seg" role="radiogroup" aria-label="Motyw">
        ${[["system", "Systemowy"], ["light", "Jasny"], ["dark", "Ciemny"]].map(([k, l]) => `<button role="radio" aria-checked="${(window.HubTheme?.get() || "system") === k}" data-theme-choice="${k}">${l}</button>`).join("")}</div></div>
      <p class="small muted" data-count></p>
      <ul class="xf-list sv-list" data-list></ul>
      <button class="btn btn-quiet sv-reset" data-reset>Wyczyść postęp nauki</button>
    </div>`;
    root.appendChild(dlg);
    const input = dlg.querySelector("input");
    let jumped = false;
    const fill = () => {
      const term = input.value.trim().toLowerCase();
      const ids = order.filter(inScope).filter(id => !term || questions[id].num.toLowerCase() === term || questions[id].text.toLowerCase().includes(term));
      dlg.querySelector("[data-count]").textContent = `${ids.length} ${plural(ids.length, "pytanie", "pytania", "pytań")}`;
      dlg.querySelector("[data-list]").innerHTML = ids.slice(0, 300).map(id => {
        const q = questions[id], a = S.ans[id];
        const st = !a ? `<span class="s s-lock">nowe</span>` : a.ok ? `<span class="s s-done">${icon("check")}dobrze</span>` : `<span class="s s-open">${icon("x")}źle</span>`;
        return `<li><button class="xf-row" data-jump="${id}"><span class="n">${esc(q.num.replace(/^Q/, ""))}</span><span class="t">${esc(q.text.slice(0, 140))}</span>${st}<span class="time">${S.stars.includes(id) ? icon("star", "gwiazdka") : ""}</span></button></li>`;
      }).join("") || `<li class="note">${icon("info")}<span>Nic nie pasuje do wyszukiwania i filtrów.</span></li>`;
    };
    fill();
    input.addEventListener("input", fill);
    dlg.querySelector("#sv-dom").addEventListener("change", e => { session.scope.domain = e.target.value; saveSession(); fill(); });
    dlg.addEventListener("click", e => {
      if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
      const set = e.target.closest("[data-set]");
      if (set) { session.scope.set = set.dataset.set; dlg.querySelectorAll("[data-set]").forEach(b => b.setAttribute("aria-pressed", String(b === set))); saveSession(); return fill(); }
      const ord = e.target.closest("[data-order]");
      if (ord) { S.order = ord.dataset.order; save(); dlg.querySelectorAll("[data-order]").forEach(b => b.setAttribute("aria-checked", String(b === ord))); return; }
      const th = e.target.closest("[data-theme-choice]");
      if (th) { window.HubTheme?.set(th.dataset.themeChoice); dlg.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", String(b === th))); return; }
      const jump = e.target.closest("[data-jump]");
      if (jump) { jumped = true; dlg.close(); return goTo(jump.dataset.jump); }
      if (e.target.closest("[data-reset]")) { dlg.close(); return confirmReset(); }
    });
    dlg.addEventListener("close", () => {
      setTimeout(() => dlg.remove(), 260);
      if (jumped) return;  // goTo already rendered the chosen question
      const cur = session.history[session.pos];
      if (!cur || !inScope(cur)) goTo(pickNext()); else render();
    });
    dlg.showModal();
  }

  function confirmReset() {
    const dlg = document.createElement("dialog");
    dlg.className = "xf-dialog";
    dlg.innerHTML = `<h2>Wyczyścić postęp nauki?</h2><p>Usuniesz odpowiedzi i statystyki dla ${esc(P.title)}. Gwiazdki i wyniki egzaminów zostaną.</p>
      <div class="xf-actions"><button class="btn" data-no>Anuluj</button><button class="btn btn-primary" data-yes>Wyczyść</button></div>`;
    root.appendChild(dlg);
    dlg.addEventListener("click", e => {
      if (e.target.closest("[data-yes]")) { S.ans = {}; save(); session = { history: [], pos: -1, scope: session.scope, revealed: {} }; dlg.close(); goTo(pickNext()); }
      else if (e.target.closest("[data-no]") || e.target === dlg) dlg.close();
    });
    removeAfterClose(dlg);
    dlg.showModal();
    dlg.querySelector("[data-no]").focus();
  }

  /* ---------- events ---------- */
  root.addEventListener("click", e => {
    const t = e.target.closest("[data-act],[data-self]");
    if (!t || t.disabled) return;
    const id = session.history[session.pos];
    if (t.dataset.self !== undefined) {
      const ok = t.dataset.self === "1";
      record(id, ok, [], "self");
      session.revealed[id] = { kind: "self", ok };
      revealPending = id;
      saveSession();
      return render();
    }
    switch (t.dataset.act) {
      case "check": return check();
      case "next": return next();
      case "back": return back();
      case "list": return openList();
      case "all": session.scope = { domain: "", set: "all" }; saveSession(); return goTo(pickNext());
      case "star": {
        S.stars = S.stars.includes(id) ? S.stars.filter(x => x !== id) : [...S.stars, id];
        save();
        const on = S.stars.includes(id);
        t.setAttribute("aria-pressed", String(on));
        pop(t.querySelector(".icon"));
        t.setAttribute("aria-label", on ? "Usuń gwiazdkę" : "Dodaj gwiazdkę");
        return announce(on ? "Dodano gwiazdkę" : "Usunięto gwiazdkę");
      }
      case "peek": session.revealed[id] = { kind: "peek", sel: [] }; revealPending = id; saveSession(); return render();
      case "reveal": session.revealed[id] = { kind: "reveal" }; revealPending = id; saveSession(); return render();
      case "retry": delete session.revealed[id]; delete draft[id]; saveSession(); return render();
    }
  });
  root.addEventListener("change", e => {
    if (!e.target.closest(".xf-opts")) return;
    const id = session.history[session.pos];
    draft[id] = Array.from(root.querySelectorAll(".xf-opts input:checked")).map(b => b.value);
    applyLimit(questions[id], false);
    // Swap Pomiń ↔ Sprawdź without re-rendering the card.
    const bar = root.querySelector(".xf-bar-inner");
    const p = bar.lastElementChild;
    const want = draft[id].length ? "check" : "next";
    if (p.dataset.act !== want) {
      p.outerHTML = want === "check" ? `<button class="btn btn-primary" data-act="check">Sprawdź</button>` : `<button class="btn" data-act="next">Pomiń${icon("right")}</button>`;
    }
  });

  document.addEventListener("keydown", e => {
    if (document.body.classList.contains("xf-active") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.target instanceof Element && e.target.matches("input[type=search], input[type=text], textarea, select")) return;
    const k = e.key.toLowerCase();
    const opts = Array.from(root.querySelectorAll(".xf-opts:not([disabled]) input"));
    let idx = LETTERS.indexOf(k);
    if (idx < 0 && /^[1-8]$/.test(k)) idx = parseInt(k, 10) - 1;
    if (idx >= 0 && idx < opts.length) {
      e.preventDefault();
      const box = opts[idx];
      if (box.disabled) return;
      box.checked = box.type === "radio" ? true : !box.checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      box.focus({ preventScroll: true });
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement) && !(e.target instanceof HTMLElement && e.target.closest("summary"))) {
      const p = root.querySelector(".xf-bar-inner").lastElementChild;
      if (p) { e.preventDefault(); p.click(); }
    } else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    else if (k === "s") { e.preventDefault(); root.querySelector('[data-act="star"]')?.click(); }
  });

  /* ---------- start ---------- */
  function boot() {
    const fromHash = scopeFromHash();
    if (fromHash !== null && fromHash !== session.scope.domain) {
      session.scope = { domain: fromHash, set: "all" };
      session.history = []; session.pos = -1; session.revealed = {};
    }
    save();
    if (session.pos >= 0 && questions[session.history[session.pos]]) render();
    else goTo(pickNext());
  }
  window.addEventListener("hashchange", () => { if (!/^#egzamin/.test(location.hash)) boot(); });
  boot();
})();
