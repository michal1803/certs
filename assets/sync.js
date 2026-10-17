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

  /* ---------- merge ---------- */
  const starLogOf = S => {
    if (S.starLog) return S.starLog;
    const t = S.savedAt || 0, log = {};
    (S.stars || []).forEach(id => { log[id] = t; });
    return log;
  };
  function mergeStudy(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ans = { ...a.ans };
    Object.entries(b.ans || {}).forEach(([id, x]) => { if (!ans[id] || (x.at || 0) > (ans[id].at || 0)) ans[id] = x; });
    // Star log: positive time = starred then, negative = unstarred then; the later one wins.
    const la = starLogOf(a), lb = starLogOf(b), starLog = { ...la };
    Object.entries(lb).forEach(([id, t]) => { if (!(id in starLog) || Math.abs(t) > Math.abs(starLog[id])) starLog[id] = t; });
    const newer = (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
    const S = { ...newer, ans, starLog, stars: Object.keys(starLog).filter(id => starLog[id] > 0) };
    // Launcher summary from each answer's domain (a.d); totals come from the bank.
    const sum = {};
    Object.entries(newer.summary || a.summary || b.summary || {}).forEach(([d, s]) => { sum[d] = { total: s.total, seen: 0, ok: 0 }; });
    Object.values(ans).forEach(x => { const s = x.d && sum[x.d]; if (s) { s.seen++; if (window.SRS.mastered(x)) s.ok++; } });
    S.summary = sum;
    S.wrong = Object.values(ans).filter(x => !x.ok).length;
    S.starCount = S.stars.length;
    return S;
  }
  function mergeHistory(a, b) {
    const seen = new Set();
    return [...(a || []), ...(b || [])].filter(h => !seen.has(h.at) && seen.add(h.at)).sort((x, y) => y.at - x.at).slice(0, 10);
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
  function login() {
    location.href = `${API}/auth/login?return=${encodeURIComponent(location.href.split("#")[0])}`;
  }
  function signOutLocal(msg) {
    auth = null;
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    setState("out");
    if (msg) emit("hub:auth-message", msg);
  }
  async function logout() {
    if (dirty) await sync().catch(() => {});
    await call("POST", "/auth/logout").catch(() => {});
    signOutLocal("Wylogowano. Postęp zostaje w tej przeglądarce.");
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
      setState("syncing");
      fetch(`${API}/auth/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: m[2] }) })
        .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error); return d; }))
        .then(d => { auth = { token: d.token, user: d.user, lastSync: null }; store(AUTH_KEY, auth); emit("hub:auth-message", `Zalogowano jako ${d.user.login}. Postęp będzie się synchronizował.`); return sync(); })
        .catch(() => { signOutLocal("Nie udało się zalogować. Spróbuj ponownie."); });
    }
  } else if (auth) {
    setTimeout(() => sync(), 0);
  }

  window.HubSync = {
    available: !!API,
    get state() { return state; },
    get user() { return auth?.user || null; },
    get lastSync() { return auth?.lastSync || null; },
    login, logout, deleteAccount, schedule, sync,
  };
})();
