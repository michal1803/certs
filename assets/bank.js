/* The question bank is private: it is not in the public page files. After
   sign-in with the owner's GitHub account the Worker hands it over
   (GET /bank/<exam>); it goes back into the page exactly as it was, then the
   study and exam scripts start. Without access: a sign-in screen. */
(() => {
  const examId = document.documentElement.dataset.exam;
  const list = document.getElementById("questionsList");
  const API = (self.PUSH_URL || "").replace(/\/$/, "");
  const SCRIPTS = ["assets/core.js", "assets/study.js", "assets/exam-flow.js"];
  let started = false, loading = false, lock = null;

  function start() {
    if (started) return;
    started = true;
    lock?.remove();
    // In order: the model (core) first, then study and the exam flow.
    SCRIPTS.forEach(src => { const s = document.createElement("script"); s.src = src; s.async = false; document.body.appendChild(s); });
  }
  // A page that still carries its bank (local development): use it as it is.
  if (list?.querySelector(".q-card")) return start();

  const COPY = {
    out: ["Exam Hub jest prywatny", "Pytania są dostępne po zalogowaniu kontem GitHub właściciela.", "login", "Zaloguj przez GitHub"],
    expired: ["Sesja wygasła", "Zaloguj się ponownie, żeby wczytać pytania.", "login", "Zaloguj przez GitHub"],
    forbidden: ["Brak dostępu", "To konto GitHub nie ma dostępu do pytań. Wyloguj się i zaloguj kontem właściciela.", "logout", "Wyloguj"],
    error: ["Nie udało się wczytać pytań", "Sprawdź połączenie i spróbuj ponownie.", "retry", "Spróbuj ponownie"],
    wait: ["Wczytuję pytania…", "", "", ""],
  };
  function show(state) {
    const [h, p, act, label] = COPY[state];
    if (!lock) {
      lock = document.createElement("div");
      lock.className = "xf";
      lock.setAttribute("lang", "pl");
      document.body.appendChild(lock);
      lock.addEventListener("click", e => {
        const b = e.target.closest("[data-gate]");
        if (!b) return;
        if (b.dataset.gate === "login") window.HubSync?.login();
        else if (b.dataset.gate === "logout") window.HubSync?.logout().then(() => show("out"));
        else load();
      });
    }
    lock.innerHTML = `<div class="xf-screen"><div class="xf-col xf-body" role="main">
      <div class="xf-top"><a class="btn btn-quiet" href="index.html">Strona główna</a></div>
      <div class="xf-head"><h1 tabindex="-1">${h}</h1>${p ? `<p>${p}</p>` : ""}</div>
      ${act ? `<button class="btn btn-primary btn-block" type="button" data-gate="${act}" style="margin-top:20px">${label}</button>` : ""}
    </div></div>`;
    lock.querySelector("h1").focus({ preventScroll: true });
  }

  async function load() {
    if (started || loading) return;
    const token = window.HubSync?.token;
    // Back from GitHub (#auth=…): sync.js is still exchanging the code; hub:auth will call again.
    if (!token) return show(/^#auth=/.test(location.hash) ? "wait" : "out");
    loading = true;
    show("wait");
    try {
      const res = await fetch(`${API}/bank/${encodeURIComponent(examId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) return show("expired");
      if (res.status === 403) return show("forbidden");
      if (!res.ok) throw new Error(String(res.status));
      list.innerHTML = await res.text();
      start();
    } catch (e) {
      show("error");
    } finally {
      loading = false;
    }
  }
  window.addEventListener("hub:auth", () => load());
  load();
})();
