/* Study mode: one question per screen with instant feedback, community
   comments after answering, stars, and a smart queue (missed, due and new
   questions in turn, see SRS.MIX; the rest later). Questions come from Hub (core.js);
   their markup is never changed. Progress is per browser. */
(() => {
  const { esc, load, store, plural, shuffle, icon, profile: P, questions, order, domainOf, examId, motion, pop, removeAfterClose, reduced } = Hub;
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
  // Each answer carries its domain (so the launcher and sync can summarise
  // without the bank) and stars get a change log (so sync can merge them).
  function prepare() {
    Object.entries(S.ans).forEach(([id, a]) => { SRS.migrate(a); if (!a.d && questions[id]) a.d = questions[id].domain; });
    if (!S.starLog) { S.starLog = {}; S.stars.forEach(id => { S.starLog[id] = S.savedAt || Date.now(); }); }
  }
  prepare();
  function save() {
    // Summary for the launcher, which cannot read the question bank.
    const summary = {};
    // ok = mastered (box 3+), not just "last answer right".
    P.domains.forEach(d => { summary[d.id] = { total: 0, seen: 0, ok: 0 }; });
    order.forEach(id => {
      const s = summary[questions[id].domain]; if (!s) return;
      s.total++;
      const a = S.ans[id];
      if (a) { s.seen++; if (SRS.mastered(a)) s.ok++; }
    });
    S.summary = summary;
    S.wrong = order.filter(id => S.ans[id] && !S.ans[id].ok).length;
    S.starCount = S.stars.length;
    S.savedAt = Date.now();
    store(KEY, S);
    clearTimeout(save.t); save.t = setTimeout(() => window.HubDue?.publish(), 400);
    window.HubSync?.schedule();
  }

  /* ---------- session: what you saw, in order, so Back works ---------- */
  let session = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; } })();
  if (!session || !Array.isArray(session.history)) session = { history: [], pos: -1, scope: { domain: "", set: "all" }, revealed: {} };
  /* Quick five: a short session of QUICK distinct questions (session.quick),
     opened from #szybkie (launcher button, app shortcut, reminder). While it
     runs the hash is #szybka, so a reload resumes it and #szybkie starts anew. */
  const QUICK = 5;
  const quickDone = () => !!session.quick && session.quick.done.length >= session.quick.n;
  const keyed = id => questions[id].correct.length > 0 && questions[id].options.length > 0;
  const saveSession = () => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} };
  let draft = {};          // unchecked selections per question in this view
  let peeked = {};         // answers revealed without counting
  let revealPending = null; // question whose answer was just checked (plays the reveal)
  let lastRendered = null;

  const scopeFromHash = () => {
    // Sets opened from the launcher or the exam results.
    const set = { "#nauka:egzamin": "exam", "#nauka:bledne": "wrong", "#nauka:gwiazdki": "star", "#nauka:wszystkie": "all" }[location.hash];
    if (set) return "@" + set;
    const m = location.hash.match(/^#nauka(?:=([a-z-]+))?$/);
    return m ? (m[1] && P.domains.some(d => d.id === m[1]) ? m[1] : "") : null;
  };
  const examFocus = () => { try { return JSON.parse(sessionStorage.getItem(`study-focus:${examId}`)) || []; } catch (e) { return []; } };

  function inScope(id) {
    const q = questions[id], sc = session.scope;
    if (sc.domain && q.domain !== sc.domain) return false;
    if (sc.set === "new") return !S.ans[id];
    if (sc.set === "due") return SRS.isDue(S.ans[id], Date.now());
    if (sc.set === "wrong") return !!S.ans[id] && !S.ans[id].ok;
    if (sc.set === "star") return S.stars.includes(id);
    if (sc.set === "exam") return examFocus().includes(id);
    return true;
  }

  function pickNext() {
    const cur = session.history[session.pos];
    let pool = order.filter(inScope);
    if (session.quick) {
      // Distinct questions, and ones you can answer by tapping (hotspots need images and comments).
      pool = pool.filter(id => !session.quick.done.includes(id));
      if (pool.some(keyed)) pool = pool.filter(keyed);
    }
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
    const byKind = { missed: [], due: [], new: [], later: [] };
    list.forEach(id => byKind[SRS.kind(S.ans[id], now)].push(id));
    const have = {};
    Object.keys(byKind).forEach(k => { have[k] = byKind[k].length > 0; });
    if (!session.mix) session.mix = {};
    const kind = SRS.nextKind(session.mix, have);
    const top = SRS.urgent(byKind[kind], S.ans, kind);
    // Mix domains: avoid the domain you just saw when another is as urgent.
    const other = cur ? top.filter(id => questions[id].domain !== questions[cur].domain) : [];
    return shuffle(other.length ? other : top)[0];
  }

  /* ---------- root ---------- */
  const root = document.createElement("div");
  root.className = "xf sv";
  root.setAttribute("lang", "pl");
  document.body.appendChild(root);
  const live = document.createElement("div");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("lang", "pl");
  live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
  document.body.appendChild(live);
  const announce = msg => { live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 30); };
  const $ = sel => root.querySelector(sel);

  function goTo(id, push = true) {
    if (!id && session.quick?.done.length) { session.quick.n = session.quick.done.length; saveSession(); return renderQuickDone(); }
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
    if (quickDone()) return renderQuickDone();
    if (session.pos < session.history.length - 1) { session.pos++; saveSession(); return render(); }
    goTo(pickNext());
  };
  const back = () => { if (session.pos > 0) { motion.dir = "prev"; session.pos--; saveSession(); render(); } };

  function mastered() {
    const ids = order.filter(id => !session.scope.domain || questions[id].domain === session.scope.domain);
    const now = Date.now();
    return { ok: ids.filter(id => SRS.mastered(S.ans[id])).length, due: ids.filter(id => SRS.isDue(S.ans[id], now)).length, total: ids.length };
  }

  function scopeLabel() {
    const sc = session.scope;
    const set = { all: "", due: "do powtórki", new: "nowe", wrong: "błędne", star: "z gwiazdką", exam: "błędne z egzaminu" }[sc.set];
    const dom = sc.domain ? domainOf(sc.domain).label : "Wszystkie";
    return set ? `${dom} · ${set}` : dom;
  }

  function topBar(noStar = false) {
    if (session.quick) {
      const k = session.quick.done.length, n = session.quick.n;
      return `
      <div class="xf-top">
        <a class="pill icon-btn" href="index.html#nauka" aria-label="Strona główna" title="Strona główna">${icon("home")}</a>
        <button class="pill sv-scope" data-act="quit-quick" title="Zakończ szybką piątkę i ucz się dalej">${icon("close")}<span>Szybka piątka</span></button>
        <span class="pill-gap"></span>
      </div>
      <div class="sv-mastery"><span>Pytanie <b>${Math.min(k + 1, n)}</b> z ${n}</span><span class="xf-progress" aria-hidden="true"><i style="width:${k / n * 100}%"></i></span></div>`;
    }
    const m = mastered();
    const id = noStar ? null : session.history[session.pos];
    const starred = id && S.stars.includes(id);
    return `
      <div class="xf-top">
        <a class="pill icon-btn" href="index.html#nauka" aria-label="Strona główna" title="Strona główna">${icon("home")}</a>
        <button class="pill sv-scope" data-act="list" aria-haspopup="dialog">${icon("list")}<span>${esc(scopeLabel())}</span></button>
        ${id ? `<button class="pill icon-btn sv-star" data-act="star" aria-pressed="${starred}" aria-label="${starred ? "Usuń gwiazdkę" : "Dodaj gwiazdkę"}" title="Gwiazdka">${icon("star")}</button>` : `<span class="pill-gap"></span>`}
      </div>
      <div class="sv-mastery"><span>Opanowane <b>${m.ok}</b> z ${m.total}${m.due ? ` · do powtórki ${m.due}` : ""}</span><span class="xf-progress" aria-hidden="true"><i style="width:${m.total ? m.ok / m.total * 100 : 0}%"></i></span></div>`;
  }

  function startQuick() {
    session = { history: [], pos: -1, scope: { domain: "", set: "all" }, revealed: {}, quick: { n: QUICK, done: [] } };
    draft = {}; peeked = {};
    history.replaceState(null, "", "#szybka");
    goTo(pickNext());
  }

  function renderQuickDone() {
    const now = Date.now(), qk = session.quick;
    session.quick.finished = true; saveSession();
    const rows = qk.done.map(id => ({ q: questions[id], a: S.ans[id] }));
    const ok = rows.filter(r => r.a?.ok).length;
    const dueLeft = order.filter(id => SRS.isDue(S.ans[id], now)).length;
    const nextDue = Math.min(...order.map(id => S.ans[id]).filter(a => a && a.due > now).map(a => a.due));
    const after = dueLeft ? `Do powtórki ${plural(dueLeft, "zostało", "zostały", "zostało")} ${dueLeft} ${plural(dueLeft, "pytanie", "pytania", "pytań")}.`
      : Number.isFinite(nextDue) ? `Nic więcej nie czeka na powtórkę. Następne pytania wrócą ${SRS.when(nextDue, now)}.` : "";
    document.title = `${P.title} · szybka piątka`;
    root.innerHTML = `<div class="xf-screen"><div class="xf-col xf-body" role="main">
      <section class="card xf-section sv-quick" aria-labelledby="sv-quick-h">
        <h1 id="sv-quick-h" class="sv-h1" tabindex="-1">Szybka piątka: ${ok} z ${rows.length}</h1>
        ${after ? `<p class="muted">${after}</p>` : ""}
        <ul class="xf-list sv-quick-list">${rows.map(({ q, a }) => `<li><span class="xf-row">
          <span class="n">${esc(q.num.replace(/^Q/, ""))}</span>
          <span class="t" lang="en">${esc(Hub.preview(q, 120))}</span>
          ${a?.ok ? `<span class="s s-done">${icon("check")}${SRS.when(a.due, now)}</span>` : `<span class="s s-bad">${icon("x")}wróci</span>`}
        </span></li>`).join("")}</ul>
        <button class="btn btn-quiet" data-act="quit-quick">${icon("book")}Ucz się dalej bez limitu</button>
        ${load("exam-hub:remind", {}).push ? "" : `<p class="small muted">Kilka minut dziennie wystarczy. <a href="index.html#przypomnienie">Ustaw codzienne przypomnienie</a></p>`}
      </section>
    </div>
    <nav class="xf-bar" aria-label="Szybka piątka"><div class="xf-bar-inner" style="grid-template-columns:1fr 1.5fr">
      <a class="btn" href="index.html#nauka">Strona główna</a>
      <button class="btn btn-primary" data-act="quick-again">Jeszcze ${QUICK} pytań</button>
    </div></nav></div>`;
    root.scrollTop = 0;
    $("h1").focus({ preventScroll: true });
    announce(`Koniec. ${ok} z ${rows.length} dobrze.`);
  }

  function renderEmpty() {
    const sc = session.scope;
    const why = sc.set === "due" ? "Nic nie czeka na powtórkę w tym zakresie. Wróć później albo ucz się nowych pytań." : sc.set === "wrong" ? "Nie masz błędnych odpowiedzi w tym zakresie." : sc.set === "star" ? "Brak pytań z gwiazdką w tym zakresie." : sc.set === "new" ? "Wszystkie pytania w tym zakresie mają już odpowiedź." : "Brak pytań w tym zakresie.";
    root.innerHTML = `<div class="xf-screen"><div class="xf-col xf-body" role="main">${topBar(true)}
      <section class="card xf-section" style="margin-top:16px"><h1 class="sv-h1" tabindex="-1">Nic do nauki</h1><p class="muted">${why}</p>
      <button class="btn btn-primary btn-block" data-act="all">Ucz się ze wszystkich pytań</button>
      <button class="btn btn-block" data-act="list">Zmień filtr</button></section></div></div>`;
    $("h1").focus({ preventScroll: true });
  }

  function communityHTML(q, open) {
    // Still on their way from the private bank (assets/bank.js): a placeholder that hub:comments replaces.
    if (q.comments === null) return `<details class="sv-comments" data-cq="${q.id}"${open ? " open" : ""}>
        <summary>${icon("chat")}<span>Komentarze społeczności</span></summary>
        <div class="sv-comments-body"><p class="muted">Wczytuję komentarze…</p></div>
      </details>`;
    const votes = {};
    q.comments.forEach(c => { const a = String(c.answer || "").toUpperCase().trim(); if (a) votes[a] = (votes[a] || 0) + 1; });
    const voteLine = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<span class="sv-vote"><b>${esc(a)}</b> ${n}</span>`).join("");
    return `
      <details class="sv-comments"${open ? " open" : ""}>
        <summary>${icon("chat")}<span>Komentarze społeczności (${q.comments.length})</span>${voteLine ? `<span class="sv-votes" aria-label="Głosy">${voteLine}</span>` : ""}</summary>
        <div class="sv-comments-body">
          ${q.comments.length ? q.comments.map(c => `
            <article class="sv-comment" lang="en">
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
    document.title = `${P.title} · ${session.quick ? "szybka piątka" : "nauka"}`;

    const parts = q.parts.map(p => p.kind === "text"
      ? `<div class="xf-qtext" lang="en">${p.html}</div>`
      : `<div class="xf-exhibit">${p.srcs.map(src => `<figure><figcaption>${esc(p.label)}</figcaption><a href="${esc(src)}" target="_blank" rel="noopener" title="Otwórz obrazek w pełnym rozmiarze"><img src="${esc(src)}" alt="${esc(p.label)}: zrzut ekranu bez opisu tekstowego" loading="lazy" data-src="${esc(src)}"><span class="zoom" aria-hidden="true">${icon("search")}Powiększ</span></a></figure>`).join("")}</div>`).join("");

    let answerBlock = "";
    if (keyed) {
      answerBlock = `
        ${multi && !checked ? `<p class="xf-hint" data-hint>${countHint(q, chosen.length)}</p>` : ""}
        <fieldset class="xf-opts"${checked ? " disabled" : ""}>
          <legend>Odpowiedzi${multi ? (q.pickAll ? ", zaznacz wszystkie poprawne" : `, wybierz ${q.correct.length}`) : ""}</legend>
          ${q.options.map(o => {
            const isC = q.correct.includes(o.val), mine = chosen.includes(o.val);
            const state = !checked ? "" : isC ? " is-correct" : mine ? " is-wrong" : " is-dim";
            const tag = !checked ? "" : isC && mine ? "Twoja · poprawna" : isC ? "Poprawna" : mine ? "Twoja" : "";
            return `<label class="xf-opt${state}">
              <input type="${multi ? "checkbox" : "radio"}" name="sv-ans" value="${esc(o.val)}"${mine ? " checked" : ""}>
              <span class="xf-mark" aria-hidden="true"></span>
              <span class="xf-letter">${esc(o.val)}</span>
              <span class="xf-opt-text" lang="en">${tag ? `<span class="sv-tag" lang="pl">${isC ? icon("check") : icon("x")}${tag}</span>` : ""}${o.html}</span>
            </label>`;
          }).join("")}
        </fieldset>`;
      if (checked) {
        const ok = rec.kind === "answer" && rec.ok;
        answerBlock += rec.kind === "peek"
          ? `<p class="sv-result neutral">${icon("eye")}<span>Podejrzana odpowiedź: <b>${q.correct.join(", ")}</b>. Nie liczy się do postępu.</span></p>`
          : `<p class="sv-result ${ok ? "ok" : "bad"}">${icon(ok ? "check" : "x")}<span>${ok ? `Dobrze. ${nextLine(rec)}` : `Źle. Poprawna odpowiedź: <b>${q.correct.join(", ")}</b>. Komentarze są otwarte poniżej: błąd najlepiej wyjaśnić od razu.`}</span></p>`;
        answerBlock += `<div class="sv-after"><button class="btn btn-quiet" data-act="retry">${icon("undo")}Odpowiedz jeszcze raz</button></div>`;
        // A confident miss is the error people remember best once corrected: open the explanation.
        answerBlock += communityHTML(q, rec.kind === "answer" && !rec.ok);
      } else {
        answerBlock += `<div class="sv-after"><button class="btn btn-quiet" data-act="peek">${icon("eye")}Pokaż odpowiedź</button></div>`;
      }
    } else {
      // Hotspot / drag & drop: no answer key in the bank.
      // The card's own answer area (or its "no options" note), as the original showed it.
      const area = q.answerBlock ? `<section class="answer-block" lang="en">
          <h3>${esc(q.answerBlock.title)}</h3>${q.answerBlock.note ? `<p>${esc(q.answerBlock.note)}</p>` : ""}
          ${q.answerArea.length ? `<div class="xf-exhibit">${q.answerArea.map(src => `<figure><a href="${esc(src)}" target="_blank" rel="noopener" title="Otwórz obrazek w pełnym rozmiarze"><img src="${esc(src)}" alt="Answer Area" loading="lazy" data-src="${esc(src)}"><span class="zoom" aria-hidden="true">${icon("search")}Powiększ</span></a></figure>`).join("")}</div>` : ""}
        </section>`
        : q.emptyNote ? `<p class="note" lang="en">${icon("info")}<span>${esc(q.emptyNote)}</span></p>` : "";
      if (!checked) {
        answerBlock = `${area}
          <div class="sv-after"><button class="btn btn-block" data-act="reveal">${icon("chat")}Pokaż komentarze i oceń się</button></div>`;
      } else {
        answerBlock = `${area}
          ${rec.kind === "self"
            ? `<p class="sv-result ${rec.ok ? "ok" : "bad"}">${icon(rec.ok ? "check" : "x")}<span>${rec.ok ? `Oznaczone: wiem. ${nextLine(rec)}` : "Oznaczone: nie wiem. Wróci w kolejce."}</span></p>`
            : `<div class="sv-self"><p><b>Jak poszło?</b></p><div class="sv-self-btns"><button class="btn" data-self="0">${icon("x")}Nie wiem</button><button class="btn" data-self="1">${icon("check")}Wiem</button></div></div>`}
          ${communityHTML(q, true)}`;
      }
    }


    root.innerHTML = `
      <div class="xf-screen"><div class="xf-col xf-body" role="main">
        ${topBar()}
        <article class="card xf-q ${cardMotion}" aria-labelledby="sv-qh">
          <div class="sv-meta"><span class="sv-num">${esc(q.num)}</span><span class="sv-dom">${esc(domainOf(q.domain).label)}</span>${prior ? `<span class="tag ${prior.ok ? "pass" : "fail"} sv-prev">${icon(prior.ok ? "check" : "x")}${prior.ok ? "ostatnio dobrze" : "ostatnio źle"}</span>` : `<span class="tag neutral sv-prev">nowe</span>`}</div>
          <h1 id="sv-qh" class="sv-hidden" tabindex="-1">Pytanie ${esc(q.num)}</h1>
          ${parts}
          ${answerBlock}
        </article>
      </div>
      <nav class="xf-bar" aria-label="Nawigacja nauki">${barHTML(id, checked, keyed)}</nav></div>`;
    root.querySelectorAll(".xf-exhibit img").forEach(img => img.addEventListener("error", () => {
      img.closest("figure").innerHTML = `<p class="xf-imgfail">Nie udało się wczytać obrazka. <a href="${esc(img.dataset.src)}" target="_blank" rel="noopener">Otwórz w nowej karcie</a></p>`;
    }, { once: true }));
    Hub.eagerFirstImage(root);
    applyLimit(q, checked);
    // After "Sprawdź" bring the verdict into view (it can sit below the fold on a phone);
    // on the next frame, so it does not force a layout in the middle of rendering.
    if (justChecked) requestAnimationFrame(() => $(".sv-result, .sv-self")?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" }));
    else root.scrollTop = 0;
    $("#sv-qh").focus({ preventScroll: true });
  }

  // "Choose all that apply" gives no count and no cap: both would give the answer away.
  const countHint = (q, n) => q.pickAll ? `Zaznacz wszystkie poprawne. Zaznaczono ${n}.` : `Wybierz ${q.correct.length}. Zaznaczono ${n}.`;
  function applyLimit(q, checked) {
    if (checked || q.correct.length < 2) return;
    const boxes = Array.from(root.querySelectorAll(".xf-opts input"));
    const n = boxes.filter(b => b.checked).length;
    if (!q.pickAll) boxes.forEach(b => { b.disabled = !b.checked && n >= q.correct.length; });
    const hint = $("[data-hint]");
    if (hint) hint.textContent = countHint(q, n);
  }

  /* Bottom bar: Wstecz + Pomiń, or once an answer is chosen Wstecz +
     Sprawdź (the primary, last, is what Enter presses). */
  function barHTML(id, checked, keyedQ) {
    const back = `<button class="btn" data-act="back"${session.pos > 0 ? "" : " disabled"}>${icon("left")}Wstecz</button>`;
    const parts = checked ? [back, `<button class="btn btn-primary" data-act="next">Dalej${icon("right")}</button>`]
      : keyedQ && (draft[id] || []).length ? [back, `<button class="btn btn-primary" data-act="check">Sprawdź</button>`]
      : [back, `<button class="btn" data-act="next">Pomiń${icon("right")}</button>`];
    return `<div class="xf-bar-inner" style="grid-template-columns:1fr 1.5fr">${parts.join("")}</div>`;
  }

  // Returns what the result line needs: next due date and whether it moved.
  function record(id, ok, sel, kind) {
    const prev = S.ans[id], now = Date.now();
    const { box, due } = SRS.step(prev, ok, now);
    S.ans[id] = { sel, ok, at: now, n: (prev?.n || 0) + 1, streak: ok ? (prev?.ok ? prev.streak + 1 : 1) : 0, box, due, d: questions[id].domain };
    if (kind === "self") S.ans[id].self = true;
    if (session.quick && !session.quick.done.includes(id)) session.quick.done.push(id);
    save();
    return { due, early: !!prev && prev.ok && due === prev.due };
  }
  const nextLine = rec => !rec.due ? "" : rec.early
    ? `Termin powtórki jeszcze nie minął, więc poziom się nie zmienia (powtórka ${SRS.when(rec.due, Date.now())}).`
    : `Następna powtórka ${SRS.when(rec.due, Date.now())}.`;

  function check() {
    const id = session.history[session.pos], q = questions[id];
    const sel = draft[id] || [];
    if (!sel.length) return;
    const ok = sel.length === q.correct.length && sel.every(v => q.correct.includes(v));
    session.revealed[id] = { kind: "answer", ok, sel, ...record(id, ok, sel, "answer") };
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
    const sets = [["all", "Wszystkie"], ["due", "Do powtórki"], ["new", "Nowe"], ["wrong", "Błędne"], ["star", "Gwiazdki"], ...(examFocus().length ? [["exam", "Z egzaminu"]] : [])];
    dlg.innerHTML = `<div class="xf-sheet-in">
      <div class="xf-sheet-head"><h2 id="sv-list-h">Pytania</h2><button class="btn btn-quiet icon-btn" data-close aria-label="Zamknij">${icon("close")}</button></div>
      <div class="sv-search">${icon("search")}<input type="search" placeholder="Szukaj w pytaniach, np. peering, Q120" aria-label="Szukaj w pytaniach" autocomplete="off"></div>
      <div class="xf-chips" role="group" aria-label="Zestaw">${sets.map(([k, l]) => `<button class="chip" data-set="${k}" aria-pressed="${sc.set === k}">${l}</button>`).join("")}</div>
      <div class="field"><label for="sv-dom">Domena</label><select class="select" id="sv-dom"><option value="">Wszystkie domeny</option>${P.domains.map(d => `<option value="${d.id}"${sc.domain === d.id ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
      <p class="small muted" data-count></p>
      <ul class="xf-list sv-list" data-list></ul>
      <details class="sv-more"><summary>Więcej opcji</summary>
        <div class="sv-more-in">
          <div class="field"><span class="sv-label" id="sv-order-l">Kolejność</span><div class="seg" role="group" aria-labelledby="sv-order-l">
            <button type="button" aria-pressed="${S.order !== "bank"}" data-order="smart">Mądra kolejka</button>
            <button type="button" aria-pressed="${S.order === "bank"}" data-order="bank">Jak w bazie</button></div></div>
          ${Hub.shortcuts.html()}
          <button class="btn btn-quiet sv-reset" data-reset>Wyczyść postęp nauki</button>
        </div>
      </details>
    </div>`;
    root.appendChild(dlg);
    const input = dlg.querySelector("input");
    let jumped = false;
    const fill = () => {
      const term = input.value.trim().toLowerCase();
      const ids = order.filter(inScope).filter(id => !term || questions[id].num.toLowerCase() === term || questions[id].search.includes(term));
      dlg.querySelector("[data-count]").textContent = `${ids.length} ${plural(ids.length, "pytanie", "pytania", "pytań")}`;
      dlg.querySelector("[data-list]").innerHTML = ids.slice(0, 300).map(id => {
        const q = questions[id], a = S.ans[id];
        const st = !a ? `<span class="s s-lock">nowe</span>` : a.ok ? `<span class="s s-done">${icon("check")}${SRS.mastered(a) ? "opanowane" : "dobrze"}</span>` : `<span class="s s-bad">${icon("x")}źle</span>`;
        return `<li><button class="xf-row" data-jump="${id}"><span class="n">${esc(q.num.replace(/^Q/, ""))}</span><span class="t" lang="en">${esc(Hub.preview(q))}</span>${st}<span class="time">${S.stars.includes(id) ? icon("star", "gwiazdka") : ""}</span></button></li>`;
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
      if (ord) { S.order = ord.dataset.order; save(); dlg.querySelectorAll("[data-order]").forEach(b => b.setAttribute("aria-pressed", String(b === ord))); return; }
      const jump = e.target.closest("[data-jump]");
      if (jump) { jumped = true; dlg.close(); return goTo(jump.dataset.jump); }
      if (e.target.closest("[data-reset]")) { dlg.close(); return confirmReset(); }
    });
    dlg.addEventListener("close", () => {
      setTimeout(() => dlg.remove(), 260);
      if (jumped) return;  // goTo already rendered the chosen question
      const cur = session.history[session.pos];
      if (!cur || !inScope(cur)) goTo(pickNext()); else render();
      if ($("#sv-qh")) $('[data-act="list"]')?.focus({ preventScroll: true });
    });
    dlg.showModal();
  }

  function confirmReset() {
    const dlg = document.createElement("dialog");
    dlg.className = "xf-dialog";
    dlg.setAttribute("aria-labelledby", "sv-reset-h");
    dlg.innerHTML = `<h2 id="sv-reset-h">Wyczyścić postęp nauki?</h2><p>Usuniesz odpowiedzi i statystyki dla ${esc(P.title)}. Gwiazdki i wyniki egzaminów zostaną.</p>
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
      session.revealed[id] = { kind: "self", ok, ...record(id, ok, [], "self") };
      revealPending = id;
      saveSession();
      return render();
    }
    switch (t.dataset.act) {
      case "check": return check();
      case "next": return next();
      case "back": return back();
      case "list": return openList();
      case "quick-again": return startQuick();
      case "quit-quick": {
        const finished = quickDone();
        session.quick = null; saveSession(); history.replaceState(null, "", "#nauka");
        return session.pos >= 0 && !finished ? render() : goTo(pickNext());
      }
      case "all": session.scope = { domain: "", set: "all" }; saveSession(); return goTo(pickNext());
      case "star": {
        S.stars = S.stars.includes(id) ? S.stars.filter(x => x !== id) : [...S.stars, id];
        S.starLog[id] = S.stars.includes(id) ? Date.now() : -Date.now();
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
    const want = draft[id].length ? "check" : "next";
    if (bar.lastElementChild.dataset.act !== want) bar.outerHTML = barHTML(id, false, true);
  });

  document.addEventListener("keydown", e => {
    if (document.body.classList.contains("xf-active") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.target instanceof Element && e.target.matches("input[type=search], input[type=text], textarea, select")) return;
    const k = e.key.toLowerCase();
    const opts = Array.from(root.querySelectorAll(".xf-opts:not([disabled]) input"));
    const keys = Hub.shortcuts.on();
    let idx = keys ? LETTERS.indexOf(k) : -1;
    if (keys && idx < 0 && /^[1-8]$/.test(k)) idx = parseInt(k, 10) - 1;
    if (idx >= 0 && idx < opts.length) {
      e.preventDefault();
      const box = opts[idx];
      if (box.disabled) return;
      box.checked = box.type === "radio" ? true : !box.checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      box.focus({ preventScroll: true });
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement) && !(e.target instanceof HTMLElement && e.target.closest("summary"))) {
      const p = root.querySelector(".xf-bar-inner")?.lastElementChild;
      if (p?.classList.contains("btn-primary")) { e.preventDefault(); p.click(); }
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target instanceof Element && e.target.matches("input[type=radio], input[type=checkbox]")) {
      return; // native radio-group arrows move the choice, not the question
    } else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    else if (k === "s" && keys) { e.preventDefault(); root.querySelector('[data-act="star"]')?.click(); }
  });

  // Comments landed after the question was drawn: swap in the real panel, keeping it open or shut.
  window.addEventListener("hub:comments", () => {
    root.querySelectorAll("details[data-cq]").forEach(d => {
      const q = questions[d.dataset.cq];
      if (q && q.comments !== null) d.outerHTML = communityHTML(q, d.open);
    });
  });

  /* ---------- start ---------- */
  function boot() {
    // An exam covers the whole screen: draw nothing (and load no images) under it.
    if (Hub.examHash()) return;
    if (location.hash === "#szybkie" || location.hash === "#szybka") {
      save();
      if (location.hash === "#szybkie" || !session.quick) return startQuick();
      if (session.quick.finished) return renderQuickDone();
      return session.pos >= 0 && questions[session.history[session.pos]] ? render() : goTo(pickNext());
    }
    if (session.quick) { session.quick = null; saveSession(); }
    const fromHash = scopeFromHash();
    if (fromHash?.startsWith("@")) {
      session.scope = { domain: "", set: fromHash.slice(1) };
      session.history = []; session.pos = -1; session.revealed = {};
      history.replaceState(null, "", "#nauka");
    } else if (fromHash) {
      // A domain link (launcher Postęp, exam results) always starts that domain afresh.
      session.scope = { domain: fromHash, set: "all" };
      session.history = []; session.pos = -1; session.revealed = {};
      history.replaceState(null, "", "#nauka");
    }
    save();
    if (session.pos >= 0 && questions[session.history[session.pos]]) render();
    else goTo(pickNext());
  }
  // Leaving the exam: the exam lifts `inert` in its own handler, which may run
  // after this one, so lift it here first or the heading cannot take focus.
  window.addEventListener("hashchange", () => { if (!Hub.examHash()) { root.inert = false; boot(); } });
  // Another device's answers arrived: reload progress and redraw what is on screen.
  window.addEventListener("hub:synced", e => {
    if (!e.detail.changed.includes(KEY)) return;
    S = load(KEY, S); prepare();
    if (document.querySelector("dialog[open]") || document.body.classList.contains("xf-active")) return;
    if (session.quick?.finished) renderQuickDone(); else if (session.pos >= 0) render();
  });
  boot();
})();
