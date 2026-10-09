/* Shared helpers and a read-only question model for exam pages.
   The page's .q-card markup is the question bank; nothing here changes it. */
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const pad = n => String(n).padStart(2, "0");
  const clock = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  };
  const plural = (n, one, few, many) => {
    if (n === 1) return one;
    const d = n % 10, t = n % 100;
    return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
  };
  const shuffle = list => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  const ICONS = {
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    book: '<path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  };
  const icon = (name, label) => `<svg class="icon" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>${ICONS[name]}</svg>`;

  function getCorrectAnswers(card) {
    const raw = (card.dataset.correct || "").toUpperCase().trim();
    if (!raw) return [];
    let parts = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length === 1 && parts[0].length > 1) parts = parts[0].split("");
    const seen = new Set();
    return parts.filter(l => /^[A-F]$/.test(l) && !seen.has(l) && seen.add(l));
  }

  /* Display-only cleanup of scraped question text: the source markup stays
     as it is; only the rendered copy gets spaces, bullets and paragraphs. */
  const KEEP_DOT = /(Microsoft|Azure|System|Windows|Get|Set|New|Remove)$/;
  function tidyText(t) {
    return t
      .replace(/^\s*(HOTSPOT|DRAG DROP)\s*-\s*/, "$1\n")
      .replace(/\s*[✑•]\s*/g, "\n• ")
      .replace(/\s*(Solution:|NOTE:|Note:|Hot Area:|Does this meet the goal\?|Does the solution meet the goal\?|To answer,)/g, "\n\n$1")
      // "connections.Subnet1" / "rules.NSG2" -> new sentence; "ASP.NET",
      // "Microsoft.Compute/..." and "contoso.com" stay as they are.
      .replace(/([a-z0-9)\]%])([.?!])([A-Z][a-z]|[A-Z]{1,6}\d)/g, (m, a, p, b, i, all) =>
        KEEP_DOT.test(all.slice(Math.max(0, i - 12), i + 1)) ? m : `${a}${p} ${b}`)
      .replace(/(will not appear in the review screen\.|might not have a correct solution\.(?= After)|depicts the identical set-up\. However, every question has a distinctive result\. Establish if the solution satisfies the requirements\.)\s*/g, "$1\n\n")
      .replace(/([a-z]):([A-Z0-9])/g, "$1: $2")
      .replace(/\n{3,}/g, "\n\n");
  }
  function tidyHTML(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node, k) => {
      let t = tidyText(node.nodeValue);
      if (k === 0) t = t.replace(/^\n+/, "");
      if (!t.includes("\n")) { node.nodeValue = t; return; }
      const frag = document.createDocumentFragment();
      t.split("\n").forEach((line, j) => {
        if (j) frag.appendChild(document.createElement("br"));
        if (line) frag.appendChild(document.createTextNode(line));
      });
      node.replaceWith(frag);
    });
    return tpl.innerHTML;
  }

  const examId = document.documentElement.dataset.exam;
  const profile = examId ? window.EXAM_PROFILES[examId] : null;
  const SERIES_RE = /part of a series of questions|included in a number of questions that depicts? the identical set-up/i;

  /* Question model, built once from the page markup. */
  const questions = {};
  const order = [];
  if (profile) {
    document.querySelectorAll(".q-card").forEach(card => {
      const body = card.querySelector(".q-body");
      const parts = [];
      Array.from(body.children).forEach(el => {
        if (el.classList.contains("q-exhibit")) {
          parts.push({ kind: "exhibit", label: el.querySelector(".q-exhibit-label")?.textContent || "Exhibit", srcs: Array.from(el.querySelectorAll("img")).map(i => i.getAttribute("src")) });
        } else if (el.classList.contains("q-text")) {
          parts.push({ kind: "text", html: tidyHTML(el.innerHTML) });
        }
      });
      const text = card.querySelector(".q-text")?.textContent || "";
      let comments = [];
      try { comments = JSON.parse(card.dataset.comments || "[]"); } catch (e) {}
      questions[card.id] = {
        id: card.id,
        num: card.querySelector(".q-number")?.textContent || card.id.toUpperCase(),
        domain: card.dataset.domain,
        correct: getCorrectAnswers(card),
        parts,
        text,
        options: Array.from(card.querySelectorAll(".opts .opt")).map(o => ({ val: o.dataset.val, html: o.querySelector(".opt-text")?.innerHTML || "" })),
        answerArea: Array.from(card.querySelectorAll(".answer-exhibit img")).map(i => i.getAttribute("src")),
        link: card.dataset.link || "",
        comments,
        series: !!profile.exam.rules?.seriesNoReturn && SERIES_RE.test(text),
      };
      order.push(card.id);
    });
  }

  const domainOf = id => profile?.domains.find(d => d.id === id) || { id, label: id, name: id };

  window.EXAM_PROFILE = profile;
  window.Hub = { tidyText, esc, load, store, clock, plural, shuffle, icon, getCorrectAnswers, examId, profile, questions, order, domainOf };

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
