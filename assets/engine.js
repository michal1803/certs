/* Shared exam/study engine. Each exam page sets <html data-exam="<id>">
   and loads assets/exam-data.js before this file. */
const EXAM_PROFILE = window.EXAM_PROFILES[document.documentElement.dataset.exam];

const state = {};
  let totalAnswered = 0, totalCorrect = 0;

  const originals = {};
  document.querySelectorAll(".q-card").forEach((card) => {
    const id = card.id;
    originals[id] = {
      preview: document.getElementById(`${id}-preview`).innerHTML,
      text: document.getElementById(`${id}-text`).innerHTML,
      opts: [],
    };
    card.querySelectorAll(".opt-text").forEach((o) => {
      originals[id].opts.push(o.getAttribute("data-original"));
    });
  });

  /* ===== SEARCH ===== */
  let searchTimeout;
  function handleSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(doSearch, 150);
    document
      .getElementById("searchClear")
      .classList.toggle(
        "show",
        document.getElementById("searchInput").value.length > 0
      );
  }

  function doSearch() {
    const raw = document.getElementById("searchInput").value.trim();
    const cards = document.querySelectorAll(".q-card");
    const stats = document.getElementById("searchStats");
    const noRes = document.getElementById("noResults");

    cards.forEach((card) => {
      const id = card.id;
      document.getElementById(`${id}-preview`).innerHTML = originals[id].preview;
      document.getElementById(`${id}-text`).innerHTML = originals[id].text;
      card.querySelectorAll(".opt-text").forEach((o, i) => {
        o.innerHTML = originals[id].opts[i];
      });
      card.classList.remove("highlight-match");
    });

    if (!raw) {
      cards.forEach((c) => c.classList.remove("hidden-by-search"));
      stats.classList.remove("show");
      noRes.classList.remove("show");
      return;
    }

    const query = raw.toLowerCase();
    const qNumMatch = raw.match(/^q(\d+)$/i);
    let visible = 0;

    cards.forEach((card) => {
      const id = card.id;
      const bodyText = document.getElementById(`${id}-text`).textContent;
      const optsText = originals[id].opts.join(" ");
      const qNum = id.replace("q", "");
      const fullText = `Q${qNum} ${originals[id].preview} ${bodyText} ${optsText}`.toLowerCase();

      const match = qNumMatch ? qNum === qNumMatch[1] : fullText.includes(query);

      if (match) {
        card.classList.remove("hidden-by-search");
        card.classList.add("highlight-match");
        visible++;

        if (!qNumMatch) {
          document.getElementById(`${id}-preview`).innerHTML = hl(originals[id].preview, raw);
          document.getElementById(`${id}-text`).innerHTML = hlHTML(originals[id].text, raw);
          card.querySelectorAll(".opt-text").forEach((o, i) => {
            o.innerHTML = hl(originals[id].opts[i], raw);
          });
        }
      } else {
        card.classList.add("hidden-by-search");
      }
    });

    stats.textContent = `${visible} of ${cards.length} questions`;
    stats.classList.add("show");
    noRes.classList.toggle("show", visible === 0);
  }

  function hl(text, q) {
    if (!q) return text;
    const e = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`(${e})`, "gi"), "<mark>$1</mark>");
  }

  function hlHTML(html, q) {
    if (!q) return html;
    const e = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return html.replace(/>([^<]+)</g, (m, t) => ">" + t.replace(new RegExp(`(${e})`, "gi"), "<mark>$1</mark>") + "<");
  }

  function clearSearch() {
    const input = document.getElementById("searchInput");
    input.value = "";
    input.focus();
    handleSearch();
    doSearch();
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      document.getElementById("searchInput").focus();
    }
    if (e.key === "Escape") {
      closeComments();
      closeImageModal();
      closeConfirm();
      document.getElementById("searchInput").blur();
    }
  });

  /* ===== QUIZ ===== */
  function toggleCard(id) {
    document.getElementById(id).classList.toggle("open");
  }

  function getCorrectAnswers(card) {
    const raw = (card.dataset.correct || "").toUpperCase().trim();
    if (!raw) return [];

    let parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1 && parts[0].length > 1) {
      parts = parts[0].split("");
    }

    const seen = new Set();
    return parts.filter(
      (letter) => /^[A-F]$/.test(letter) && !seen.has(letter) && seen.add(letter)
    );
  }

  function sameAnswers(a, b) {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((item) => setB.has(item));
  }

  function setQuestionStatus(qid, nextState) {
    const status = document.getElementById(`${qid}-status`);
    if (!status) return;

    const states = {
      correct: { icon: "✅", label: "Correct" },
      wrong: { icon: "❌", label: "Incorrect" },
      peek: { icon: "👀", label: "Peeked answer" }
    };

    const meta = states[nextState];
    if (!meta) {
      status.textContent = "";
      status.classList.remove("has-state");
      status.removeAttribute("data-state");
      status.removeAttribute("title");
      status.removeAttribute("aria-label");
      return;
    }

    status.textContent = meta.icon;
    status.classList.add("has-state");
    status.dataset.state = nextState;
    status.title = meta.label;
    status.setAttribute("aria-label", meta.label);
  }

  function pick(el, qid) {
    if (state[qid]?.answered) return;

    const card = document.getElementById(qid);
    const correctAnswers = getCorrectAnswers(card);
    const isMulti = correctAnswers.length > 1;
    const picked = el.getAttribute("data-val");

    if (!state[qid]) state[qid] = { selected: [], answered: false, wasCorrect: false, counted: false };
    if (!Array.isArray(state[qid].selected)) state[qid].selected = [];

    if (isMulti) {
      if (el.classList.contains("selected")) {
        el.classList.remove("selected");
        state[qid].selected = state[qid].selected.filter((v) => v !== picked);
      } else {
        el.classList.add("selected");
        if (!state[qid].selected.includes(picked)) state[qid].selected.push(picked);
      }
    } else {
      document.querySelectorAll(`#${qid}-opts .opt`).forEach((o) => o.classList.remove("selected"));
      el.classList.add("selected");
      state[qid].selected = [picked];
    }

    document.getElementById(`${qid}-submit`).disabled = state[qid].selected.length === 0;
  }

  function submit(qid) {
    const card = document.getElementById(qid);
    const correctAnswers = getCorrectAnswers(card);
    const selectedAnswers = Array.isArray(state[qid]?.selected) ? state[qid].selected : [];
    if (!selectedAnswers.length || state[qid]?.answered) return;

    state[qid].answered = true;
    state[qid].counted = true;

    document.querySelectorAll(`#${qid}-opts .opt`).forEach((o) => o.classList.add("disabled"));
    const res = document.getElementById(`${qid}-result`);
    const correctSet = new Set(correctAnswers);
    const selectedSet = new Set(selectedAnswers);
    const answersText = correctAnswers.join(", ");
    const isCorrect = sameAnswers(selectedAnswers, correctAnswers);

    document.querySelectorAll(`#${qid}-opts .opt`).forEach((opt) => {
      const val = opt.getAttribute("data-val");
      if (correctSet.has(val)) {
        opt.classList.add("correct");
      } else if (selectedSet.has(val)) {
        opt.classList.add("wrong");
      }
    });

    if (isCorrect) {
      res.className = "result-bar show is-correct";
      res.innerHTML =
        correctAnswers.length > 1
          ? `Correct! Answers: <strong>${answersText}</strong>`
          : "Correct!";
      setQuestionStatus(qid, "correct");
      totalCorrect++;
      state[qid].wasCorrect = true;
    } else {
      res.className = "result-bar show is-wrong";
      res.innerHTML = `Wrong - answer${correctAnswers.length > 1 ? "s are" : " is"} <strong>${answersText}</strong>`;
      setQuestionStatus(qid, "wrong");
      state[qid].wasCorrect = false;
    }

    totalAnswered++;
    showPost(qid, card.dataset.link);
    updateScore();
  }

  function cheat(qid) {
    if (state[qid]?.answered) return;
    if (!state[qid]) state[qid] = { selected: [], answered: false, wasCorrect: false, counted: false };

    state[qid].answered = true;
    state[qid].counted = false;

    const card = document.getElementById(qid);
    const correctAnswers = getCorrectAnswers(card);
    const answersText = correctAnswers.join(", ");

    document.querySelectorAll(`#${qid}-opts .opt`).forEach((o) => o.classList.add("disabled"));

    correctAnswers.forEach((letter) => {
      const el = document.querySelector(`#${qid}-opts .opt[data-val="${letter}"]`);
      if (el) el.classList.add("correct");
    });

    const res = document.getElementById(`${qid}-result`);
    res.className = "result-bar show is-cheat";
    res.innerHTML = `Answer${correctAnswers.length > 1 ? "s" : ""}: <strong>${answersText}</strong>`;

    setQuestionStatus(qid, "peek");
    state[qid].wasCorrect = false;
    showPost(qid, card.dataset.link);
  }

  function showPost(qid, link) {
    document.getElementById(`${qid}-submit`).classList.add("hidden");
    document.getElementById(`${qid}-cheat`).classList.add("hidden");

    const d = document.getElementById(`${qid}-discuss`);
    d.classList.remove("hidden");
    d.href = link;

    document.getElementById(`${qid}-reset`).classList.remove("hidden");
  }

  function reset(qid) {
    if (state[qid]?.answered && state[qid]?.counted) {
      totalAnswered--;
      if (state[qid].wasCorrect) totalCorrect--;
      updateScore();
    }

    state[qid] = { answered: false, selected: [], wasCorrect: false, counted: false };

    document.querySelectorAll(`#${qid}-opts .opt`).forEach((o) =>
      o.classList.remove("selected", "correct", "wrong", "disabled")
    );

    document.getElementById(`${qid}-result`).className = "result-bar";
    document.getElementById(`${qid}-result`).innerHTML = "";
    setQuestionStatus(qid, "");

    document.getElementById(`${qid}-submit`).classList.remove("hidden");
    document.getElementById(`${qid}-submit`).disabled = true;

    document.getElementById(`${qid}-cheat`).classList.remove("hidden");
    document.getElementById(`${qid}-discuss`).classList.add("hidden");
    document.getElementById(`${qid}-reset`).classList.add("hidden");
  }

  function updateScore() {
    document.getElementById("scoreDisplay").textContent = `${totalCorrect} ✓ · ${totalAnswered} answered`;
  }

  /* ===== RESTART ===== */
  function confirmRestart() {
    if (totalAnswered === 0) {
      restartExam();
      return;
    }
    document.getElementById("confirmOverlay").classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeConfirm() {
    document.getElementById("confirmOverlay").classList.remove("show");
    document.body.style.overflow = "";
  }

  function closeConfirmOutside(e) {
    if (e.target === document.getElementById("confirmOverlay")) closeConfirm();
  }

  function restartExam() {
    closeConfirm();
    document.querySelectorAll(".q-card").forEach((card) => {
      reset(card.id);
      card.classList.remove("open");
    });

    const first = document.querySelector(".q-card");
    if (first) first.classList.add("open");

    totalAnswered = 0;
    totalCorrect = 0;
    updateScore();
    clearSearch();

    document.querySelector(".app-content")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ===== COMMENTS MODAL ===== */
  function openComments(qid) {
    const card = document.getElementById(qid);
    let comments = [];
    try { comments = JSON.parse(card.dataset.comments); } catch (e) {}

    const body = document.getElementById("commentsBody");

    if (!comments.length) {
      body.innerHTML = '<div class="no-comments">💤 No comments yet</div>';
    } else {
      body.innerHTML = comments
        .map((c) => {
          const initials = (c.user || "?").substring(0, 2).toUpperCase();
          const answerBadge = c.answer ? `<span class="comment-answer">Answer: ${c.answer}</span>` : "";
          const textFormatted = (c.text || "").replace(/\n/g, "<br>");
          return `
            <div class="comment-card">
              <div class="comment-header">
                <div class="comment-avatar">${initials}</div>
                <span class="comment-user">${c.user || "Anonymous"}</span>
                ${answerBadge}
              </div>
              <div class="comment-body">${textFormatted}</div>
            </div>`;
        })
        .join("");
    }

    document.getElementById("commentsModal").classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeComments() {
    document.getElementById("commentsModal").classList.remove("show");
    document.body.style.overflow = "";
  }

  function closeCommentsOutside(e) {
    if (e.target === document.getElementById("commentsModal")) closeComments();
  }

  /* ===== IMAGE ZOOM ===== */
  function zoomImage(src) {
    document.getElementById("imgModalSrc").src = src;
    document.getElementById("imgModal").classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeImageModal() {
    document.getElementById("imgModal").classList.remove("show");
    document.body.style.overflow = "";
  }

/* ===== LOCAL PROGRESS (added for GitHub Pages version) ===== */
(() => {
  const STORAGE_KEY = EXAM_PROFILE.storage.progress;

  function saveProgress() {
    try {
      const cards = Array.from(document.querySelectorAll(".q-card"));
      const payload = {
        state: {},
        open: cards.filter(c => c.classList.contains("open")).map(c => c.id),
        savedAt: Date.now()
      };
      cards.forEach(card => {
        const qid = card.id;
        if (state[qid]) payload.state[qid] = state[qid];
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const el = document.getElementById("saveIndicator");
      if (el) el.textContent = "✓ Postęp zapisany na tym urządzeniu";
    } catch (e) {
      console.warn("Could not save progress", e);
    }
  }

  function restoreProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw);
      const savedState = payload.state || {};

      totalAnswered = 0;
      totalCorrect = 0;

      document.querySelectorAll(".q-card").forEach(card => {
        const qid = card.id;
        const saved = savedState[qid];
        if (!saved) return;

        state[qid] = {
          answered: !!saved.answered,
          selected: Array.isArray(saved.selected) ? saved.selected : [],
          wasCorrect: !!saved.wasCorrect,
          counted: !!saved.counted
        };

        const selectedSet = new Set(state[qid].selected);
        card.querySelectorAll(".opt").forEach(opt => {
          const val = opt.getAttribute("data-val");
          if (selectedSet.has(val)) opt.classList.add("selected");
        });

        const submitBtn = document.getElementById(`${qid}-submit`);
        if (submitBtn) submitBtn.disabled = state[qid].selected.length === 0;

        if (!state[qid].answered) return;

        const correctAnswers = getCorrectAnswers(card);
        const correctSet = new Set(correctAnswers);
        card.querySelectorAll(".opt").forEach(opt => {
          opt.classList.add("disabled");
          const val = opt.getAttribute("data-val");
          if (correctSet.has(val)) opt.classList.add("correct");
          else if (state[qid].counted && selectedSet.has(val)) opt.classList.add("wrong");
        });

        const res = document.getElementById(`${qid}-result`);
        const answersText = correctAnswers.join(", ");

        if (state[qid].counted) {
          totalAnswered++;
          if (state[qid].wasCorrect) {
            totalCorrect++;
            if (res) {
              res.className = "result-bar show is-correct";
              res.innerHTML = correctAnswers.length > 1
                ? `Correct! Answers: <strong>${answersText}</strong>`
                : "Correct!";
            }
            setQuestionStatus(qid, "correct");
          } else {
            if (res) {
              res.className = "result-bar show is-wrong";
              res.innerHTML = `Wrong - answer${correctAnswers.length > 1 ? "s are" : " is"} <strong>${answersText}</strong>`;
            }
            setQuestionStatus(qid, "wrong");
          }
        } else {
          if (res) {
            res.className = "result-bar show is-cheat";
            res.innerHTML = correctAnswers.length
              ? `Answer${correctAnswers.length > 1 ? "s" : ""}: <strong>${answersText}</strong>`
              : "Answer area — use the exhibit/discussion for this question.";
          }
          setQuestionStatus(qid, "peek");
        }

        showPost(qid, card.dataset.link);
      });

      const openIds = new Set(Array.isArray(payload.open) ? payload.open : []);
      if (openIds.size) {
        document.querySelectorAll(".q-card").forEach(card =>
          card.classList.toggle("open", openIds.has(card.id))
        );
      }

      updateScore();
      const el = document.getElementById("saveIndicator");
      if (el) el.textContent = "✓ Przywrócono zapisany postęp";
    } catch (e) {
      console.warn("Could not restore progress", e);
    }
  }

  const originalPick = pick;
  pick = function(...args) {
    const result = originalPick.apply(this, args);
    saveProgress();
    return result;
  };

  const originalSubmit = submit;
  submit = function(...args) {
    const result = originalSubmit.apply(this, args);
    saveProgress();
    return result;
  };

  const originalCheat = cheat;
  cheat = function(...args) {
    const result = originalCheat.apply(this, args);
    saveProgress();
    return result;
  };

  const originalReset = reset;
  reset = function(...args) {
    const result = originalReset.apply(this, args);
    saveProgress();
    return result;
  };

  const originalToggleCard = toggleCard;
  toggleCard = function(...args) {
    const result = originalToggleCard.apply(this, args);
    saveProgress();
    return result;
  };

  const originalRestartExam = restartExam;
  restartExam = function(...args) {
    const result = originalRestartExam.apply(this, args);
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    const el = document.getElementById("saveIndicator");
    if (el) el.textContent = "Postęp wyzerowany";
    return result;
  };

  restoreProgress();
})();

/* ===== STUDY / EXAM MODE V2 ===== */
(() => {
  const V2_KEY = EXAM_PROFILE.storage.ui;
  const allCards = () => Array.from(document.querySelectorAll(".q-card"));
  const allIds = () => allCards().map(c => c.id);
  let mode = "study";
  let filter = "all";
  let pool = null; // null = all questions
  let stars = new Set();
  let examFinished = false;
  let pendingExam = 0; // exam size requested by the launcher, drawn on load

  function loadV2() {
    try {
      const saved = JSON.parse(localStorage.getItem(V2_KEY) || "{}");
      mode = saved.mode === "exam" ? "exam" : "study";
      filter = ["all","wrong","star"].includes(saved.filter) ? saved.filter : "all";
      stars = new Set(Array.isArray(saved.stars) ? saved.stars : []);
      pool = Array.isArray(saved.pool) && saved.pool.length ? saved.pool.filter(id => document.getElementById(id)) : null;
      examFinished = !!saved.examFinished && mode === "exam";
      pendingExam = mode === "exam" ? parseInt(saved.pendingExam, 10) || 0 : 0;
    } catch (e) {}
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Draw an exam set that follows the official domain weights
     (assets/exam-data.js), using only questions with an answer key. */
  function buildExamPool(count) {
    const byDomain = {};
    allCards().forEach(card => {
      if (!getCorrectAnswers(card).length) return;
      (byDomain[card.dataset.domain] ||= []).push(card.id);
    });
    const available = {};
    Object.entries(byDomain).forEach(([d, ids]) => { available[d] = ids.length; });
    const quotas = window.examQuotas(EXAM_PROFILE, count, available);
    return shuffle(Object.entries(quotas).flatMap(([d, n]) => shuffle(byDomain[d] || []).slice(0, n)));
  }

  function saveV2() {
    try {
      localStorage.setItem(V2_KEY, JSON.stringify({
        mode, filter, stars: Array.from(stars), pool, examFinished
      }));
    } catch (e) {}
  }

  function injectStars() {
    allCards().forEach(card => {
      const top = card.querySelector(".q-top");
      if (!top || top.querySelector(".q-star")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "q-star";
      btn.textContent = "★";
      btn.title = "Oznacz pytanie gwiazdką";
      btn.setAttribute("aria-label", "Oznacz pytanie gwiazdką");
      btn.onclick = (event) => {
        event.stopPropagation();
        toggleStar(card.id);
      };
      const status = top.querySelector(".q-status");
      top.insertBefore(btn, status || top.lastElementChild);
    });
  }

  function renderStars() {
    allCards().forEach(card => {
      const btn = card.querySelector(".q-star");
      if (!btn) return;
      btn.classList.toggle("active", stars.has(card.id));
      btn.title = stars.has(card.id) ? "Usuń gwiazdkę" : "Oznacz pytanie gwiazdką";
    });
  }

  window.toggleStar = function(qid) {
    if (stars.has(qid)) stars.delete(qid); else stars.add(qid);
    renderStars();
    applyStudyVisibility();
    saveV2();
  };

  function populateCountOptions() {
    const sel = document.getElementById("questionCount");
    if (!sel) return;
    const previous = sel.value;
    const n = eligibleIds().length;
    const candidates = mode === "exam" ? EXAM_PROFILE.exam.counts : n <= 30 ? [10,20] : [10,20,50,100];
    const allLabel = mode === "exam" ? `Wszystkie oceniane (${n})` : `Wszystkie (${n})`;
    sel.innerHTML = `<option value="all">${allLabel}</option>` + candidates
      .filter(x => x < n)
      .map(x => `<option value="${x}">${x} pytań</option>`).join("");
    const desired = pool && activePoolIds().length < n ? String(activePoolIds().length) : previous;
    if (Array.from(sel.options).some(o => o.value === desired)) sel.value = desired;
    else sel.value = "all";
  }

  function eligibleIds() {
    const ids = allIds();
    if (mode !== "exam") return ids;
    return ids.filter(id => {
      const card = document.getElementById(id);
      return card && getCorrectAnswers(card).length > 0;
    });
  }

  function activePoolIds() {
    const eligible = new Set(eligibleIds());
    if (pool && pool.length) return pool.filter(id => eligible.has(id));
    return Array.from(eligible);
  }

  function cardMatchesFilter(card) {
    if (filter === "star") return stars.has(card.id);
    if (filter === "wrong") return !!(state[card.id]?.answered && state[card.id]?.counted && !state[card.id]?.wasCorrect);
    return true;
  }

  window.applyStudyVisibility = function() {
    const allowed = new Set(activePoolIds());
    allCards().forEach(card => {
      const show = allowed.has(card.id) && cardMatchesFilter(card);
      card.classList.toggle("hidden-by-study", !show);
    });
    updateStudyProgress();
  };

  window.setStudyFilter = function(next) {
    filter = ["all","wrong","star"].includes(next) ? next : "all";
    ["all","wrong","star"].forEach(k => {
      const id = k === "all" ? "filterAll" : k === "wrong" ? "filterWrong" : "filterStar";
      document.getElementById(id)?.classList.toggle("active", filter === k);
    });
    applyStudyVisibility();
    saveV2();
  };

  function resetPoolForExam() {
    activePoolIds().forEach(id => {
      if (state[id]?.answered || (state[id]?.selected || []).length) reset(id);
    });
    examFinished = false;
    document.body.classList.remove("exam-finished");
    const summary = document.getElementById("examSummary");
    if (summary) summary.textContent = "";
  }

  window.setStudyMode = function(next) {
    const target = next === "exam" ? "exam" : "study";
    const changingIntoExam = target === "exam" && mode !== "exam";
    mode = target;
    if (changingIntoExam) {
      resetPoolForExam();
      totalAnswered = 0;
      totalCorrect = 0;
      updateScore();
    }
    if (mode === "study") {
      examFinished = false;
      totalAnswered = 0;
      totalCorrect = 0;
      allIds().forEach(id => {
        if (state[id]?.answered && state[id]?.counted) {
          totalAnswered++;
          if (state[id]?.wasCorrect) totalCorrect++;
        }
      });
      updateScore();
    } else if (examFinished) {
      totalAnswered = 0;
      totalCorrect = 0;
      activePoolIds().forEach(id => {
        if (state[id]?.answered && state[id]?.counted) {
          totalAnswered++;
          if (state[id]?.wasCorrect) totalCorrect++;
        }
      });
      updateScore();
    }
    populateCountOptions();
    document.body.classList.toggle("exam-mode", mode === "exam");
    document.body.classList.toggle("exam-finished", mode === "exam" && examFinished);
    document.getElementById("modeStudy")?.classList.toggle("active", mode === "study");
    document.getElementById("modeExam")?.classList.toggle("active", mode === "exam");
    applyStudyVisibility();
    updateStudyProgress();
    saveV2();
  };

  window.randomizeQuestions = function() {
    const sel = document.getElementById("questionCount");
    const value = sel?.value || "all";
    if (value === "all") {
      pool = null;
    } else {
      const count = Math.max(1, Math.min(parseInt(value,10) || 10, eligibleIds().length));
      pool = mode === "exam" ? buildExamPool(count) : shuffle(eligibleIds()).slice(0, count);
    }
    if (mode === "exam") {
      resetPoolForExam();
      totalAnswered = 0;
      totalCorrect = 0;
      updateScore();
    }
    filter = "all";
    window.setStudyFilter("all");
    clearSearch();
    applyStudyVisibility();
    const firstVisible = allCards().find(c => !c.classList.contains("hidden-by-study"));
    if (firstVisible) {
      allCards().forEach(c => c.classList.remove("open"));
      firstVisible.classList.add("open");
      firstVisible.scrollIntoView({behavior:"smooth", block:"start"});
    }
    saveV2();
  };

  function attemptedCount() {
    const ids = activePoolIds();
    if (mode === "exam" && !examFinished) {
      return ids.filter(id => Array.isArray(state[id]?.selected) && state[id].selected.length > 0).length;
    }
    return ids.filter(id => state[id]?.answered && state[id]?.counted).length;
  }

  window.updateStudyProgress = function() {
    const ids = activePoolIds();
    const total = ids.length;
    const done = attemptedCount();
    const pct = total ? Math.round(done / total * 100) : 0;
    const text = document.getElementById("progressText");
    const fill = document.getElementById("progressFill");
    const label = document.getElementById("progressLabel");
    if (text) text.textContent = `${done} / ${total} (${pct}%)`;
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = mode === "exam" && !examFinished ? "Odpowiedziano" : "Postęp";
  };

  function revealExamCard(card, selectedAnswers, correctAnswers, isCorrect) {
    const qid = card.id;
    const selectedSet = new Set(selectedAnswers);
    const correctSet = new Set(correctAnswers);
    card.querySelectorAll(".opt").forEach(opt => {
      opt.classList.add("disabled");
      const val = opt.getAttribute("data-val");
      if (correctSet.has(val)) opt.classList.add("correct");
      else if (selectedSet.has(val)) opt.classList.add("wrong");
    });
    const res = document.getElementById(`${qid}-result`);
    const answersText = correctAnswers.join(", ");
    if (res) {
      if (isCorrect) {
        res.className = "result-bar show is-correct";
        res.innerHTML = correctAnswers.length > 1 ? `Correct! Answers: <strong>${answersText}</strong>` : "Correct!";
      } else {
        res.className = "result-bar show is-wrong";
        res.innerHTML = `Wrong - answer${correctAnswers.length > 1 ? "s are" : " is"} <strong>${answersText || "—"}</strong>`;
      }
    }
    setQuestionStatus(qid, isCorrect ? "correct" : "wrong");
    showPost(qid, card.dataset.link);
  }

  window.finishExamSession = function() {
    if (mode !== "exam" || examFinished) return;
    const ids = activePoolIds();
    let correct = 0;
    ids.forEach(id => {
      const card = document.getElementById(id);
      if (!card) return;
      if (!state[id]) state[id] = { selected: [], answered: false, wasCorrect: false, counted: false };
      const selected = Array.isArray(state[id].selected) ? state[id].selected : [];
      const answers = getCorrectAnswers(card);
      const ok = sameAnswers(selected, answers);
      state[id].answered = true;
      state[id].counted = true;
      state[id].wasCorrect = ok;
      if (ok) correct++;
      revealExamCard(card, selected, answers, ok);
    });
    totalAnswered = ids.length;
    totalCorrect = correct;
    updateScore();
    examFinished = true;
    document.body.classList.add("exam-finished");
    const pct = ids.length ? Math.round(correct / ids.length * 100) : 0;
    const summary = document.getElementById("examSummary");
    if (summary) summary.textContent = `Wynik egzaminu: ${correct}/${ids.length} (${pct}%). Błędne pytania możesz od razu wyświetlić filtrem „Błędne”.`;
    // Trigger the existing progress persistence wrapper without changing selection.
    const first = ids.map(id => document.querySelector(`#${id} .opt`)).find(Boolean);
    if (first) {
      try { previousPick(first, first.closest('.q-card').id); } catch (e) {}
    } else if (ids[0]) {
      try { window.toggleCard(ids[0]); window.toggleCard(ids[0]); } catch (e) {}
    }
    updateStudyProgress();
    saveV2();
  };

  // Extend existing functions without replacing their core behavior.
  const previousPick = window.pick;
  window.pick = function(...args) {
    if (mode === "exam" && examFinished) return;
    const result = previousPick.apply(this, args);
    updateStudyProgress();
    return result;
  };

  const previousSubmit = window.submit;
  window.submit = function(...args) {
    if (mode === "exam") return;
    const result = previousSubmit.apply(this, args);
    updateStudyProgress();
    applyStudyVisibility();
    return result;
  };

  const previousCheat = window.cheat;
  window.cheat = function(...args) {
    if (mode === "exam") return;
    const result = previousCheat.apply(this, args);
    updateStudyProgress();
    return result;
  };

  const previousReset = window.reset;
  window.reset = function(...args) {
    const result = previousReset.apply(this, args);
    updateStudyProgress();
    applyStudyVisibility();
    return result;
  };

  const previousRestartExam = window.restartExam;
  window.restartExam = function(...args) {
    const result = previousRestartExam.apply(this, args);
    pool = null;
    filter = "all";
    examFinished = false;
    document.body.classList.remove("exam-finished");
    const sel = document.getElementById("questionCount");
    if (sel) sel.value = "all";
    setStudyFilter("all");
    updateStudyProgress();
    saveV2();
    return result;
  };

  // Existing search and filters use separate classes, so they compose cleanly.
  const previousDoSearch = window.doSearch;
  window.doSearch = function(...args) {
    const result = previousDoSearch.apply(this, args);
    applyStudyVisibility();
    return result;
  };

  loadV2();
  if (pendingExam) {
    pool = buildExamPool(pendingExam);
    pendingExam = 0;
    saveV2();
  }
  injectStars();
  populateCountOptions();
  renderStars();
  setStudyFilter(filter);
  setStudyMode(mode);
  document.body.classList.toggle("exam-finished", mode === "exam" && examFinished);
  updateStudyProgress();
})();
