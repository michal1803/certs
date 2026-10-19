/* Daily reminder for a quick five (index.html#szybkie). A calendar event
   works on every phone without a server, so it is always offered. */
(() => {
  const box = document.getElementById("remind");
  if (!box) return;
  const KEY = "exam-hub:remind";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const store = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  const st = Object.assign({ time: "19:00" }, load());
  const time = box.querySelector("#remind-time");
  const status = box.querySelector("[data-remind-status]");
  const say = msg => { status.textContent = msg; };
  time.value = st.time;
  time.addEventListener("change", () => { if (/^\d\d:\d\d$/.test(time.value)) { st.time = time.value; store(st); } });

  const quickUrl = new URL("index.html#szybkie", location.href).href;
  const pad = n => String(n).padStart(2, "0");

  /* iCalendar event repeating daily at the chosen local time, with an alert. */
  function ics(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const start = new Date(); start.setHours(h, m, 0, 0);
    if (start <= new Date()) start.setDate(start.getDate() + 1);
    const local = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    // Lines longer than 75 octets must be folded (CRLF + space).
    const fold = line => line.length > 60 ? line.match(/.{1,60}/g).join("\r\n ") : line;
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Exam Hub//PL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:exam-hub-quick-${Date.now()}@${location.host || "exam-hub"}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${local(start)}`,
      "DURATION:PT5M",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Exam Hub: szybka piątka",
      `DESCRIPTION:5 pytań\, ok. 3 minuty: ${quickUrl}`,
      `URL:${quickUrl}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Exam Hub: szybka piątka", "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR", "",
    ].map(fold).join("\r\n");
  }

  box.querySelector("[data-ics]").addEventListener("click", () => {
    const blob = new Blob([ics(st.time)], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href; a.download = "exam-hub-szybka-piatka.ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    say(`Otwórz pobrany plik, żeby dodać do kalendarza codzienne wydarzenie o ${st.time}. Link w wydarzeniu otwiera szybką piątkę.`);
  });

  /* ---------- push notifications (only when a push Worker is configured) ---------- */
  const API = (self.PUSH_URL || "").replace(/\/$/, "");
  const slot = box.querySelector("[data-push]");
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!API || location.protocol === "file:") return;
  if (!canPush) {
    // iPhone/iPad: push works only for the app added to the Home Screen (iOS 16.4+).
    if (ios && !standalone) { slot.hidden = false; slot.innerHTML = `<p class="small muted remind-ios">Powiadomienia na iPhonie działają po dodaniu Exam Hub do ekranu początkowego: Udostępnij, potem „Do ekranu początkowego”. Otwórz aplikację z ikony i włącz je tutaj.</p>`; }
    return;
  }

  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const b64ToBytes = s => { const b = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  async function call(path, body) {
    const res = await fetch(API + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.status), { status: res.status });
    return data;
  }
  const current = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();
  const register = sub => call("/subscribe", { subscription: sub.toJSON(), time: st.time, tz: tz() });

  // The launcher's install band and first-open prompt use the same flow (window.HubRemind).
  let onNow = false;
  window.HubRemind = { on: () => onNow, time: () => st.time, enable: () => enable().catch(e => { say("Nie udało się połączyć z serwerem powiadomień. Spróbuj później albo użyj kalendarza."); throw e; }).then(() => onNow) };
  function paint(on) {
    onNow = !!on;
    window.dispatchEvent(new Event("hub:remind"));
    slot.hidden = false;
    slot.innerHTML = on
      ? `<button class="btn" type="button" data-push-off>Wyłącz powiadomienia</button><button class="btn btn-quiet" type="button" data-push-test>Wyślij próbne</button>`
      : `<button class="btn btn-primary" type="button" data-push-on>Włącz powiadomienia</button>`;
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return say(perm === "denied" ? "Powiadomienia są zablokowane w ustawieniach przeglądarki. Odblokuj je dla tej strony albo użyj kalendarza." : "Nie włączono powiadomień.");
    say("Włączam…");
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await call("/vapid");
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await register(sub);
    st.push = true; store(st); paint(true);
    say(`Gotowe. Codziennie o ${st.time} dostaniesz przypomnienie o szybkiej piątce.`);
  }
  async function disable() {
    const sub = await current();
    if (sub) { await call("/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    st.push = false; store(st); paint(false);
    say("Powiadomienia wyłączone.");
  }
  async function test() {
    const sub = await current();
    if (!sub) return paint(false);
    try { await call("/test", { endpoint: sub.endpoint }); say("Wysłano. Powiadomienie powinno pojawić się za kilka sekund."); }
    catch (e) { say(e.status === 429 ? "Odczekaj minutę przed kolejną próbą." : e.status === 404 || e.status === 410 ? "Subskrypcja wygasła. Włącz powiadomienia jeszcze raz." : "Nie udało się wysłać. Sprawdź połączenie."); if (e.status === 404 || e.status === 410) { await sub.unsubscribe().catch(() => {}); st.push = false; store(st); paint(false); } }
  }

  slot.addEventListener("click", e => {
    const run = e.target.closest("[data-push-on]") ? enable : e.target.closest("[data-push-off]") ? disable : e.target.closest("[data-push-test]") ? test : null;
    if (!run) return;
    e.target.closest("button").disabled = true;
    run().catch(() => say("Nie udało się połączyć z serwerem powiadomień. Spróbuj później albo użyj kalendarza.")).finally(() => slot.querySelectorAll("button").forEach(b => { b.disabled = false; }));
  });

  // New time: tell the server (same endpoint, so it updates the record).
  let timer;
  time.addEventListener("change", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const sub = st.push && await current();
      if (sub) register(sub).then(() => say(`Przypomnienie przestawione na ${st.time}.`)).catch(() => say("Nie udało się zapisać nowej godziny. Spróbuj jeszcze raz."));
    }, 600);
  });

  // Show the real state; if the browser dropped the subscription, renew it quietly.
  (async () => {
    let sub = await current();
    if (!sub && st.push && Notification.permission === "granted") {
      try { const { publicKey } = await call("/vapid"); sub = await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }); await register(sub); } catch (e) { sub = null; }
    }
    paint(!!sub && Notification.permission === "granted");
  })();
})();
