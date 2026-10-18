/* Launcher: one card per exam profile (assets/exam-data.js).
   Study starts the question list; Exam opens the exam flow on the exam page. */
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } };
  const pad = n => String(n).padStart(2, "0");
  const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); return `${h ? h + ":" + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)}:${pad(s % 60)}`; };
  const plural = (n, one, few, many) => { if (n === 1) return one; const d = n % 10, t = n % 100; return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many; };
  // Stored values (some arrive through sync) are only ever shown as numbers.
  const int = x => { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; };
  const date = ts => new Date(ts).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });

  // Reminders and the app shortcut open index.html#szybkie: go straight to the exam with most due.
  const quick = () => location.replace(`${window.EXAM_PROFILES[window.HubDue.pick()].href}#szybkie`);
  window.addEventListener("hashchange", () => { if (location.hash === "#szybkie") quick(); });
  if (location.hash === "#szybkie") return quick();

  const list = document.getElementById("exams");
  const saved = load("exam-hub:launcher", {});

  // Drawn again when synced progress arrives from another device.
  function paint() {
  list.innerHTML = Object.entries(window.EXAM_PROFILES).map(([id, p]) => {
    const mode = saved[id] === "study" ? "study" : "exam";
    const attempt = load(`exam-attempt:${id}:v1`, null);
    const running = attempt && attempt.status === "running" && attempt.seen?.length;
    const last = load(`exam-history:${id}:v1`, [])[0];
    const total = p.all.length;
    const study = load(`study:${id}:v1`, null);
    const okTotal = study?.summary ? Object.values(study.summary).reduce((s, x) => s + int(x?.ok), 0) : 0;
    // Counted live: questions fall due while the app is closed.
    const due = window.HubDue.count(id);
    return `
    <article class="card exam" aria-labelledby="h-${id}">
      <div>
        <h2 id="h-${id}">${esc(p.title)}</h2>
        <p class="meta">${esc(p.vendor)} · ${total} ${plural(total, "pytanie", "pytania", "pytań")} w bazie</p>
      </div>
      <a class="btn btn-block quick" href="${esc(p.href)}#szybkie"><b>Szybka piątka</b><span>${due ? `${due} do powtórki` : "5 pytań · ok. 3 min"}</span></a>
      ${running ? `<div class="resume">
        <p>Niedokończony egzamin: pytanie ${int(attempt.current) + 1} z ${int(attempt.count)}${attempt.deadline ? ` · zostało ${clock(attempt.deadline - Date.now())}` : ""}</p>
        <a class="btn btn-primary btn-block" href="${esc(p.href)}#egzamin">Wróć do egzaminu</a>
      </div>` : ""}
      <div class="seg" role="tablist" aria-label="Tryb">
        <button role="tab" id="t-${id}-exam" aria-controls="p-${id}-exam" aria-selected="${mode === "exam"}" data-mode="exam" data-exam="${id}">Egzamin</button>
        <button role="tab" id="t-${id}-study" aria-controls="p-${id}-study" aria-selected="${mode === "study"}" data-mode="study" data-exam="${id}">Nauka</button>
      </div>
      <div role="tabpanel" id="p-${id}-exam" aria-labelledby="t-${id}-exam"${mode === "exam" ? "" : " hidden"}>
        <ul class="facts">
          <li data-minutes="${id}">${window.examMinutes(p, p.exam.defaultCount)} min</li>
          <li>${p.exam.passing ? `próg ${p.exam.passing.score}/${p.exam.passing.scale}` : "próg niepublikowany"}</li>
        </ul>
        <div class="field">
          <label for="c-${id}">Liczba pytań</label>
          <select class="select" id="c-${id}" data-count="${id}">${p.exam.counts.map(n => `<option value="${n}"${n === p.exam.defaultCount ? " selected" : ""}>${n} ${plural(n, "pytanie", "pytania", "pytań")}</option>`).join("")}</select>
        </div>
        <ul class="split" data-split="${id}" aria-label="Pytania z każdej domeny"></ul>
        ${p.weightsAreProxy ? `<p class="note">${esc(p.vendor)} nie publikuje wag domen. Proporcje liczymy z liczby celów egzaminacyjnych w każdej domenie.</p>` : ""}
        ${last ? `<p class="history">Ostatni wynik: ${int(last.pct)}% · ${int(last.count)} ${plural(int(last.count), "pytanie", "pytania", "pytań")} · ${esc(date(int(last.at)))}${last.untimed ? " · bez limitu" : ""}</p>` : ""}
        <button class="btn btn-primary btn-block" data-start-exam="${id}">${running ? "Nowy egzamin" : "Przejdź do egzaminu"}</button>
      </div>
      <div role="tabpanel" id="p-${id}-study" aria-labelledby="t-${id}-study"${mode === "study" ? "" : " hidden"}>
        ${study?.summary ? `<ul class="facts">
          <li>Opanowane ${okTotal} z ${total}</li>
          <li>Do powtórki ${due}</li>
          <li>Błędne ${int(study.wrong)}</li>
          <li>Gwiazdki ${int(study.starCount)}</li>
        </ul>
        <ul class="split mastery" aria-label="Opanowane pytania w każdej domenie">${p.domains.map(d => { const x = study.summary[d.id], s = { total: int(x?.total), ok: int(x?.ok) }; return `<li><span>${esc(d.label)}</span><span class="bar" aria-hidden="true"><i style="width:${s.total ? s.ok / s.total * 100 : 0}%"></i></span><b>${s.ok}/${s.total}</b></li>`; }).join("")}</ul>`
        : `<p class="muted">Jedno pytanie na ekranie z natychmiastową odpowiedzią i komentarzami społeczności. Najpierw błędne i te, których termin powtórki minął. Każda dobra odpowiedź wydłuża odstęp: 1, 3, 7, 14, 30 dni.</p>`}
        <div class="field">
          <label for="s-${id}">Zakres</label>
          <select class="select" id="s-${id}">
            <option value="">Wszystkie domeny</option>
            ${p.domains.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-primary btn-block" data-start-study="${id}">${study?.summary ? "Ucz się dalej" : "Zacznij naukę"}</button>
      </div>
    </article>`;
  }).join("");
  Object.keys(window.EXAM_PROFILES).forEach(renderSplit);
  document.querySelectorAll("[role=tab]").forEach(t => { t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1; });
  }
  paint();
  window.addEventListener("hub:synced", paint);

  function renderSplit(id) {
    const p = window.EXAM_PROFILES[id];
    const n = parseInt(document.getElementById(`c-${id}`).value, 10);
    const q = window.examQuotas(p, n);
    const max = Math.max(...Object.values(q), 1);
    document.querySelector(`[data-minutes="${id}"]`).textContent = `${window.examMinutes(p, n)} min`;
    const ul = document.querySelector(`[data-split="${id}"]`);
    if (ul.children.length === p.domains.length) {
      // Same domains, new counts: let the bars glide to their new length.
      p.domains.forEach((d, k) => { const li = ul.children[k]; li.querySelector("i").style.width = q[d.id] / max * 100 + "%"; li.querySelector("b").textContent = q[d.id]; });
      return;
    }
    ul.innerHTML = p.domains.map((d, k) =>
      `<li><span>${esc(d.label)}</span><span class="bar" aria-hidden="true"><i class="grow" style="width:${q[d.id] / max * 100}%;--d:${200 + k * 40}ms"></i></span><b>${q[d.id]}</b></li>`).join("");
  }

  list.addEventListener("change", e => { const id = e.target.dataset.count; if (id) renderSplit(id); });

  list.addEventListener("click", e => {
    const tab = e.target.closest("[role=tab]");
    if (tab) return selectTab(tab);
    const ex = e.target.closest("[data-start-exam]");
    if (ex) {
      const id = ex.dataset.startExam, p = window.EXAM_PROFILES[id];
      location.href = `${p.href}#egzamin=${document.getElementById(`c-${id}`).value}`;
      return;
    }
    const st = e.target.closest("[data-start-study]");
    if (st) {
      const id = st.dataset.startStudy, p = window.EXAM_PROFILES[id];
      const dom = document.getElementById(`s-${id}`).value;
      location.href = `${p.href}#nauka${dom ? "=" + dom : ""}`;
    }
  });

  // Tabs: arrow keys move between the two modes.
  list.addEventListener("keydown", e => {
    const tab = e.target.closest("[role=tab]");
    if (!tab || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const other = tab.parentElement.querySelector(`[role=tab]:not([data-mode="${tab.dataset.mode}"])`);
    e.preventDefault(); selectTab(other); other.focus();
  });

  function selectTab(tab) {
    const id = tab.dataset.exam;
    tab.parentElement.querySelectorAll("[role=tab]").forEach(t => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    saved[id] = tab.dataset.mode;
    try { localStorage.setItem("exam-hub:launcher", JSON.stringify(saved)); } catch (err) {}
  }

  // Theme picker in the footer.
  const picker = document.querySelector(".theme-pick");
  if (picker && window.HubTheme) {
    const mark = () => picker.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.themeChoice === HubTheme.get())));
    mark();
    picker.addEventListener("click", e => { const b = e.target.closest("[data-theme-choice]"); if (b) { HubTheme.set(b.dataset.themeChoice); mark(); } });
  }

  // Ask the browser to keep this site's data (Safari otherwise clears it after
  // 7 days without a visit). Firefox would show a prompt for it, so not there.
  if (navigator.storage?.persist && !/Firefox\//.test(navigator.userAgent)) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});

  /* Account: sign in with GitHub to sync progress across devices. */
  const acct = document.getElementById("account");
  const GH = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  let acctMsg = "";
  function paintAccount() {
    const sync = window.HubSync;
    if (!acct || !sync?.available) return;
    acct.hidden = false;
    const u = sync.user;
    const note = sync.state === "syncing" ? "Synchronizuję…" : sync.state === "error" ? "Nie udało się zsynchronizować. Spróbuję ponownie." : sync.lastSync ? `Zsynchronizowano ${new Date(sync.lastSync).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : "";
    acct.innerHTML = u ? `
      <div class="acct-who">
        ${u.avatar ? `<img src="${esc(u.avatar + (u.avatar.includes("?") ? "&" : "?") + "s=80")}" alt="" width="40" height="40">` : ""}
        <div><b>${esc(u.login)}</b><span class="small muted" data-acct-note>${esc(note)}</span></div>
      </div>
      <details class="acct-more"><summary class="btn btn-quiet">Konto</summary>
        <div class="acct-menu">
          <button class="btn" type="button" data-acct="sync">Synchronizuj teraz</button>
          <button class="btn" type="button" data-acct="logout">Wyloguj</button>
          <button class="btn btn-quiet acct-del" type="button" data-acct="delete">Usuń konto i dane z serwera</button>
          <p class="small muted">Na serwerze zapisujemy tylko login, nazwę i avatar z GitHuba oraz postęp nauki i wyniki egzaminów. Nie mamy dostępu do Twoich repozytoriów.</p>
        </div>
      </details>`
      : `<button class="btn btn-gh" type="button" data-acct="login">${GH}Zaloguj przez GitHub</button>
         <span class="small muted">Postęp na telefonie i komputerze, bez przenoszenia plików.</span>`;
    if (acctMsg) acct.insertAdjacentHTML("beforeend", `<p class="acct-msg" role="status">${esc(acctMsg)}</p>`);
  }
  window.addEventListener("hub:auth", paintAccount);
  window.addEventListener("hub:auth-message", e => { acctMsg = e.detail; paintAccount(); });
  acct?.addEventListener("click", e => {
    const b = e.target.closest("[data-acct]");
    if (!b) return;
    const act = b.dataset.acct, sync = window.HubSync;
    acctMsg = "";
    if (act === "login") return sync.login();
    if (act === "sync") return sync.sync();
    if (act === "logout") return sync.logout();
    if (act === "delete") {
      const dlg = document.createElement("dialog");
      dlg.className = "xf-dialog";
      dlg.innerHTML = `<h2>Usunąć konto?</h2><p>Usuniemy z serwera Twój login i cały zapisany postęp. Postęp w tej przeglądarce zostanie. Tego nie da się cofnąć.</p>
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
