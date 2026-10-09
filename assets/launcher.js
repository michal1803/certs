/* Launcher: one card per exam profile (assets/exam-data.js).
   Study starts the question list; Exam opens the exam flow on the exam page. */
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } };
  const pad = n => String(n).padStart(2, "0");
  const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); return `${h ? h + ":" + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)}:${pad(s % 60)}`; };
  const plural = (n, one, few, many) => { if (n === 1) return one; const d = n % 10, t = n % 100; return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many; };
  const date = ts => new Date(ts).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });

  const list = document.getElementById("exams");
  const saved = load("exam-hub:launcher", {});

  list.innerHTML = Object.entries(window.EXAM_PROFILES).map(([id, p]) => {
    const mode = saved[id] === "study" ? "study" : "exam";
    const attempt = load(`exam-attempt:${id}:v1`, null);
    const running = attempt && attempt.status === "running" && attempt.seen?.length;
    const last = load(`exam-history:${id}:v1`, [])[0];
    const total = p.all.length;
    const study = load(`study:${id}:v1`, null);
    const okTotal = study?.summary ? Object.values(study.summary).reduce((s, x) => s + x.ok, 0) : 0;
    return `
    <article class="card exam" aria-labelledby="h-${id}">
      <div>
        <h2 id="h-${id}">${esc(p.title)}</h2>
        <p class="meta">${esc(p.vendor)} · ${total} ${plural(total, "pytanie", "pytania", "pytań")} w bazie</p>
      </div>
      ${running ? `<div class="resume">
        <p>Niedokończony egzamin: pytanie ${attempt.current + 1} z ${attempt.count}${attempt.deadline ? ` · zostało ${clock(attempt.deadline - Date.now())}` : ""}</p>
        <a class="btn btn-primary btn-block" href="${esc(p.href)}#egzamin">Wróć do egzaminu</a>
      </div>` : ""}
      <div class="seg" role="tablist" aria-label="Tryb">
        <button role="tab" id="t-${id}-exam" aria-controls="p-${id}-exam" aria-selected="${mode === "exam"}" data-mode="exam" data-exam="${id}">Egzamin</button>
        <button role="tab" id="t-${id}-study" aria-controls="p-${id}-study" aria-selected="${mode === "study"}" data-mode="study" data-exam="${id}">Nauka</button>
      </div>
      <div role="tabpanel" id="p-${id}-exam" aria-labelledby="t-${id}-exam"${mode === "exam" ? "" : " hidden"}>
        <ul class="facts">
          <li>${p.exam.minutes} min</li>
          <li>${p.exam.passing ? `próg ${p.exam.passing.score}/${p.exam.passing.scale}` : "próg niepublikowany"}</li>
        </ul>
        <div class="field">
          <label for="c-${id}">Liczba pytań</label>
          <select class="select" id="c-${id}" data-count="${id}">${p.exam.counts.map(n => `<option value="${n}"${n === p.exam.defaultCount ? " selected" : ""}>${n} ${plural(n, "pytanie", "pytania", "pytań")}</option>`).join("")}</select>
        </div>
        <ul class="split" data-split="${id}" aria-label="Pytania z każdej domeny"></ul>
        ${p.weightsAreProxy ? `<p class="note">${esc(p.vendor)} nie publikuje wag domen. Proporcje liczymy z liczby celów egzaminacyjnych w każdej domenie.</p>` : ""}
        ${last ? `<p class="history">Ostatni wynik: ${last.pct}% · ${last.count} ${plural(last.count, "pytanie", "pytania", "pytań")} · ${date(last.at)}${last.untimed ? " · bez limitu" : ""}</p>` : ""}
        <button class="btn btn-primary btn-block" data-start-exam="${id}">${running ? "Nowy egzamin" : "Przejdź do egzaminu"}</button>
      </div>
      <div role="tabpanel" id="p-${id}-study" aria-labelledby="t-${id}-study"${mode === "study" ? "" : " hidden"}>
        ${study?.summary ? `<ul class="facts">
          <li>Opanowane ${okTotal} z ${total}</li>
          <li>Błędne ${study.wrong || 0}</li>
          <li>Gwiazdki ${study.starCount || 0}</li>
        </ul>
        <ul class="split mastery" aria-label="Opanowane pytania w każdej domenie">${p.domains.map(d => { const s = study.summary[d.id] || { total: 0, ok: 0 }; return `<li><span>${esc(d.label)}</span><span class="bar" aria-hidden="true"><i style="width:${s.total ? s.ok / s.total * 100 : 0}%"></i></span><b>${s.ok}/${s.total}</b></li>`; }).join("")}</ul>`
        : `<p class="muted">Jedno pytanie na ekranie z natychmiastową odpowiedzią i komentarzami społeczności. Najpierw nowe i błędne pytania, opanowane wracają rzadziej.</p>`}
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

  function renderSplit(id) {
    const p = window.EXAM_PROFILES[id];
    const n = parseInt(document.getElementById(`c-${id}`).value, 10);
    const q = window.examQuotas(p, n);
    const max = Math.max(...Object.values(q), 1);
    const ul = document.querySelector(`[data-split="${id}"]`);
    if (ul.children.length === p.domains.length) {
      // Same domains, new counts: let the bars glide to their new length.
      p.domains.forEach((d, k) => { const li = ul.children[k]; li.querySelector("i").style.width = q[d.id] / max * 100 + "%"; li.querySelector("b").textContent = q[d.id]; });
      return;
    }
    ul.innerHTML = p.domains.map((d, k) =>
      `<li><span>${esc(d.label)}</span><span class="bar" aria-hidden="true"><i class="grow" style="width:${q[d.id] / max * 100}%;--d:${200 + k * 40}ms"></i></span><b>${q[d.id]}</b></li>`).join("");
  }
  Object.keys(window.EXAM_PROFILES).forEach(renderSplit);

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
  document.querySelectorAll("[role=tab]").forEach(t => { t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1; });

  // Theme picker in the footer.
  const picker = document.querySelector(".theme-pick");
  if (picker && window.HubTheme) {
    const mark = () => picker.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.themeChoice === HubTheme.get())));
    mark();
    picker.addEventListener("click", e => { const b = e.target.closest("[data-theme-choice]"); if (b) { HubTheme.set(b.dataset.themeChoice); mark(); } });
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
