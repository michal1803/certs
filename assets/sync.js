/* Sign in with GitHub and keep progress in sync across devices (the push
   Worker, push/, also serves /auth and /sync). Without signing in nothing
   changes: progress stays in this browser only.

   Merging is per item, so two devices never overwrite each other:
   - study answers: the newer answer to each question wins (a.at);
   - stars: a log of star/unstar times per question (S.starLog);
   - exam history: union of attempts by finish time.
   After a pull that changed something, "hub:synced" fires with the keys. */
(() => {
  const API = (self.PUSH_URL || "").replace(/\/$/, "");
  const AUTH_KEY = "exam-hub:auth";
  const SYNCED = /^(study:[a-z0-9-]+:v1|exam-history:[a-z0-9-]+:v1)$/;
  const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let auth = load(AUTH_KEY, null);       // { token, user: {id, login, name, avatar}, lastSync }
  let state = auth ? "idle" : "out";      // out | idle | syncing | error
  let timer = null, dirty = false, running = null;
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const setState = s => { state = s; emit("hub:auth", { state, user: auth?.user || null, lastSync: auth?.lastSync || null }); };

  async function call(method, path, body, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive: !!opts.keepalive });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && auth) { signOutLocal("Sesja wygasła. Zaloguj się ponownie."); }
    if (!res.ok) throw Object.assign(new Error(data.error || res.status), { status: res.status });
    return data;
  }

  /* ---------- validate ----------
     Synced data comes from the server, so it is untrusted: keep only known
     fields with the right types before anything is merged or rendered. */
  const num = (x, lo = 0, hi = 9e15) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
  const QID = /^q\d{1,4}$/, DOM = /^[a-z-]{1,40}$/;
  function cleanAnswer(a) {
    if (!a || typeof a !== "object") return null;
    const out = {
      sel: Array.isArray(a.sel) ? a.sel.filter(v => typeof v === "string" && /^[A-H]$/.test(v)).slice(0, 8) : [],
      ok: a.ok === true, at: num(a.at), n: num(a.n, 0, 1e6) | 0, streak: num(a.streak, 0, 1e6) | 0,
      box: num(a.box, 0, window.SRS.DAYS.length - 1) | 0, due: num(a.due),
    };
    if (typeof a.d === "string" && DOM.test(a.d)) out.d = a.d;
    if (a.guess === true) out.guess = true;
    if (a.self === true) out.self = true;
    return out;
  }
  function cleanStudy(S, totalsFrom) {
    if (!S || typeof S !== "object") return null;
    const ans = {}, starLog = {};
    Object.entries(S.ans && typeof S.ans === "object" ? S.ans : {}).forEach(([id, a]) => { const c = QID.test(id) && cleanAnswer(a); if (c) ans[id] = c; });
    const log = S.starLog && typeof S.starLog === "object" ? S.starLog : Object.fromEntries((Array.isArray(S.stars) ? S.stars : []).map(id => [id, num(S.savedAt)]));
    Object.entries(log).forEach(([id, t]) => { if (QID.test(id) && Number.isFinite(Number(t))) starLog[id] = Number(t); });
    // Domain totals describe the question bank: trust this device's copy over the server's.
    const totals = {};
    Object.entries((totalsFrom || S).summary || {}).forEach(([d, x]) => { if (DOM.test(d)) totals[d] = num(x?.total, 0, 1e4) | 0; });
    return { v: 1, order: S.order === "bank" ? "bank" : "smart", savedAt: num(S.savedAt), ans, starLog, totals };
  }
  const cleanHistory = list => (Array.isArray(list) ? list : [])
    .map(h => h && typeof h === "object" ? { at: num(h.at, 0, Date.now() + 864e5), count: num(h.count, 0, 1000) | 0, pct: num(h.pct, 0, 100) | 0, untimed: h.untimed === true } : null)
    .filter(h => h && h.at > 0);

  /* ---------- merge ---------- */
  function mergeStudy(local, remote) {
    const a = cleanStudy(local), b = cleanStudy(remote, local);
    if (!a && !b) return null;
    const x = a || b, y = b || a;
    const ans = { ...x.ans };
    Object.entries(y.ans).forEach(([id, r]) => { if (!ans[id] || r.at > ans[id].at) ans[id] = r; });
    // Star log: positive time = starred then, negative = unstarred then; the later one wins.
    const starLog = { ...x.starLog };
    Object.entries(y.starLog).forEach(([id, t]) => { if (!(id in starLog) || Math.abs(t) > Math.abs(starLog[id])) starLog[id] = t; });
    const newer = y.savedAt > x.savedAt ? y : x;
    const totals = Object.keys(a?.totals || {}).length ? a.totals : (b?.totals || {});
    // Launcher summary rebuilt from each answer's domain (a.d), never taken from the server.
    const summary = {};
    Object.entries(totals).forEach(([d, t]) => { summary[d] = { total: t, seen: 0, ok: 0 }; });
    Object.values(ans).forEach(r => { const s = r.d && summary[r.d]; if (s) { s.seen++; if (window.SRS.mastered(r)) s.ok++; } });
    const stars = Object.keys(starLog).filter(id => starLog[id] > 0);
    return { v: 1, order: newer.order, savedAt: Math.max(x.savedAt, y.savedAt), ans, starLog, stars, summary,
      wrong: Object.values(ans).filter(r => !r.ok).length, starCount: stars.length };
  }
  function mergeHistory(a, b) {
    const seen = new Set();
    return [...cleanHistory(a), ...cleanHistory(b)].filter(h => !seen.has(h.at) && seen.add(h.at)).sort((x, y) => y.at - x.at).slice(0, 10);
  }
  const merge = (key, a, b) => key.startsWith("study:") ? mergeStudy(a, b) : mergeHistory(a, b);
  const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };

  /* ---------- sync ---------- */
  async function sync({ keepalive = false } = {}) {
    if (!auth || !API) return;
    if (running) { dirty = true; return running; }
    dirty = false;
    setState("syncing");
    running = (async () => {
      const { items } = await call("GET", "/sync", null, { keepalive });
      const keys = new Set([...Object.keys(localStorage).filter(k => SYNCED.test(k)), ...Object.keys(items).filter(k => SYNCED.test(k))]);
      const changed = [], push = {};
      keys.forEach(k => {
        const localRaw = localStorage.getItem(k), remoteRaw = items[k]?.value ?? null;
        const merged = merge(k, parse(localRaw), parse(remoteRaw));
        if (merged == null) return;
        const out = JSON.stringify(merged);
        if (out !== localRaw) { try { localStorage.setItem(k, out); changed.push(k); } catch (e) {} }
        if (out !== remoteRaw) push[k] = out;
      });
      if (Object.keys(push).length) await call("PUT", "/sync", { items: push }, { keepalive });
      auth.lastSync = Date.now(); store(AUTH_KEY, auth);
      if (changed.length) { emit("hub:synced", { changed }); window.HubDue?.publish(); }
      setState("idle");
    })().catch(e => { if (auth) setState(navigator.onLine ? "error" : "idle"); }).finally(() => { running = null; if (dirty && auth) schedule(); });
    return running;
  }
  // Called after local writes; batches a burst of answers into one round trip.
  function schedule(ms = 4000) {
    if (!auth) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => sync(), ms);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && dirty && auth) { clearTimeout(timer); sync({ keepalive: true }); } });
  window.addEventListener("online", () => { if (auth) sync(); });

  /* ---------- sign in / out ---------- */
  /* Sign-in is bound to this browser: it keeps a random verifier and sends
     only its hash. A sign-in link made by someone else carries a code this
     browser cannot exchange, so nobody can log you into their account. */
  const PKCE_KEY = "exam-hub:pkce";
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  async function login() {
    const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
    store(PKCE_KEY, { v: verifier, exp: Date.now() + 10 * 60000 });
    const challenge = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    location.href = `${API}/auth/login?challenge=${challenge}&return=${encodeURIComponent(location.href.split("#")[0])}`;
  }
  function signOutLocal(msg) {
    auth = null;
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    setState("out");
    if (msg) emit("hub:auth-message", msg);
  }
  async function logout(everywhere = false) {
    if (dirty) await sync().catch(() => {});
    await call("POST", everywhere ? "/auth/logout-all" : "/auth/logout").catch(() => {});
    signOutLocal(everywhere ? "Wylogowano na wszystkich urządzeniach. Postęp zostaje w tej przeglądarce." : "Wylogowano. Postęp zostaje w tej przeglądarce.");
  }
  async function deleteAccount() {
    await call("DELETE", "/account");
    signOutLocal("Konto i zapisany na serwerze postęp zostały usunięte. Postęp w tej przeglądarce został.");
  }

  // Back from GitHub: #auth=<one-time code> or #auth-error=<reason>.
  const m = location.hash.match(/^#auth(-error)?=([^&]*)/);
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    if (m[1]) setTimeout(() => emit("hub:auth-message", m[2] === "access_denied" ? "Logowanie anulowane." : "Nie udało się zalogować przez GitHub. Spróbuj ponownie."), 0);
    else if (API) {
      const pkce = load(PKCE_KEY, null);
      try { localStorage.removeItem(PKCE_KEY); } catch (e) {}
      if (!pkce || pkce.exp < Date.now()) {
        // Not started here (or too old): never accept it, and keep any current session.
        setTimeout(() => emit("hub:auth-message", "Ten link logowania nie pochodzi z tej przeglądarki. Zaloguj się przyciskiem „Zaloguj przez GitHub”."), 0);
        if (auth) setTimeout(() => sync(), 0);
        return publish();
      }
      setState("syncing");
      fetch(`${API}/auth/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: m[2], verifier: pkce.v }) })
        .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error); return d; }))
        .then(d => { auth = { token: d.token, user: d.user, lastSync: null }; store(AUTH_KEY, auth); emit("hub:auth-message", `Zalogowano jako ${d.user.login}. Postęp będzie się synchronizował.`); return sync(); })
        .catch(() => { signOutLocal("Nie udało się zalogować. Spróbuj ponownie."); });
    }
  } else if (auth) {
    setTimeout(() => sync(), 0);
  }

  function publish() {
  window.HubSync = {
    available: !!API,
    get state() { return state; },
    get user() { return auth?.user || null; },
    get lastSync() { return auth?.lastSync || null; },
    login, logout, deleteAccount, schedule, sync,
  };
  }
  publish();
})();
