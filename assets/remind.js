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

  window.HubRemind = { box, st, store: () => store(st), say };
})();
