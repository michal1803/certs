/* Exam profiles: one entry per certification, built from the vendor's
   official pages. Each question card carries data-domain="<domain id>".
   Used by the launcher (index.html) and by assets/engine.js on exam pages. */
(function () {
  const qRange = n => Array.from({ length: n }, (_, i) => "q" + (i + 1));

  window.EXAM_PROFILES = {
    terraform: {
      title: "Terraform Associate 004",
      vendor: "HashiCorp",
      href: "terraform.html",
      storage: { ui: "exam-ui-v2:terraform-associate-004", progress: "exam-progress:terraform-associate-004:v1" },
      all: qRange(28),
      exam: {
        minutes: 60,
        counts: [14, 28],
        defaultCount: 14,
        // HashiCorp publishes no question count, passing score or domain weights.
        passing: null,
        partialCredit: false,
        // The bank (28) is far smaller than the real exam (~57, unofficial), so
        // this is a timed drill at the real pace (~63 s per question), not a mock.
        drill: { secondsPerQuestion: 63, realMinutes: 60, realCount: "ok. 57 (nieoficjalnie)" },
        questionTypes: "prawda/fałsz, jednokrotny i wielokrotny wybór",
        source: "https://developer.hashicorp.com/certifications/terraform-associate",
        verified: "2026-10-09",
      },
      // Unofficial weights: number of sub-objectives per domain (1a–8d, 37 total).
      weightsAreProxy: true,
      domains: [
        { id: "iac",           label: "IaC",           name: "Infrastructure as Code (IaC) with Terraform", weight: 3 },
        { id: "fundamentals",  label: "Fundamentals",  name: "Terraform fundamentals",                      weight: 4 },
        { id: "workflow",      label: "Workflow",      name: "Core Terraform workflow",                     weight: 7 },
        { id: "configuration", label: "Configuration", name: "Terraform configuration",                     weight: 8 },
        { id: "modules",       label: "Modules",       name: "Terraform modules",                           weight: 4 },
        { id: "state",         label: "State",         name: "Terraform state management",                  weight: 4 },
        { id: "maintain",      label: "Maintenance",   name: "Maintain infrastructure with Terraform",      weight: 3 },
        { id: "hcp",           label: "HCP",           name: "HCP Terraform",                               weight: 4 },
      ],
    },
    az104: {
      title: "AZ-104 Azure Administrator",
      vendor: "Microsoft",
      href: "az104.html",
      storage: { ui: "exam-ui-v2:microsoft-az-104", progress: "exam-progress:microsoft-az-104:v1" },
      all: qRange(256),
      exam: {
        minutes: 100,
        counts: [40, 50, 60],
        defaultCount: 50,
        passing: { score: 700, scale: 1000, scaled: true },
        // One point per correct selection on multi-answer questions.
        partialCredit: true,
        questionTypes: "jednokrotny i wielokrotny wybór, serie Tak/Nie, case study",
        rules: {
          // Problem/solution series: once you move on, you cannot return.
          seriesNoReturn: true,
          // Microsoft Learn is available during role-based exams; the clock keeps running.
          learnUrl: "https://learn.microsoft.com/",
          // Unscheduled breaks: the exam clock keeps running and every question
          // seen before the break locks (Microsoft "Exam duration and exam experience").
          breaks: true,
        },
        source: "https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104",
        verified: "2026-10-09",
      },
      // Skills measured as of 2026-04-17; weight = midpoint of the official range.
      domains: [
        { id: "identity",   label: "Identity/Gov.", name: "Manage Azure identities and governance",    range: [20, 25] },
        { id: "storage",    label: "Storage",       name: "Implement and manage storage",              range: [15, 20] },
        { id: "compute",    label: "Compute",       name: "Deploy and manage Azure compute resources", range: [20, 25] },
        { id: "networking", label: "Networking",    name: "Implement and manage virtual networking",   range: [15, 20] },
        { id: "monitoring", label: "Monitoring",    name: "Monitor and maintain Azure resources",      range: [10, 15] },
      ],
    },
  };

  const weightOf = d => d.weight ?? (d.range[0] + d.range[1]) / 2;

  /* Time limit for an exam of n questions: the official limit, or for a
     drill the real exam pace scaled to the number of questions. */
  window.examMinutes = function (profile, n) {
    const drill = profile.exam.drill;
    return drill ? Math.ceil(n * drill.secondsPerQuestion / 60) : profile.exam.minutes;
  };
  window.examLabel = profile => profile.exam.drill ? "Trening na czas" : "Egzamin";

  /* Questions per domain for an exam of n questions (largest-remainder
     apportionment of the weights). `available` ({domainId: count}) caps a
     domain at what the bank holds; the shortfall goes to the other domains
     by the same rule. Deterministic, so the launcher preview matches the
     set the exam page draws. */
  window.examQuotas = function (profile, n, available) {
    const quotas = {};
    profile.domains.forEach(d => { quotas[d.id] = 0; });
    let open = profile.domains.filter(d => !available || (available[d.id] || 0) > 0);
    let left = n;
    while (left > 0 && open.length) {
      const total = open.reduce((s, d) => s + weightOf(d), 0);
      const shares = open.map((d, i) => {
        const exact = left * weightOf(d) / total;
        return { d, i, base: Math.floor(exact), rem: exact - Math.floor(exact) };
      });
      let extra = left - shares.reduce((s, x) => s + x.base, 0);
      shares.slice().sort((a, b) => b.rem - a.rem || weightOf(b.d) - weightOf(a.d) || a.i - b.i)
        .forEach(x => { if (extra > 0) { x.base++; extra--; } });
      let placed = 0;
      shares.forEach(({ d, base }) => {
        const cap = available ? available[d.id] - quotas[d.id] : Infinity;
        const take = Math.min(base, cap);
        quotas[d.id] += take;
        placed += take;
      });
      left -= placed;
      if (placed === 0) break;
      open = open.filter(d => !available || quotas[d.id] < available[d.id]);
    }
    return quotas;
  };

  /* Spaced repetition (Leitner boxes) for study progress. Box 0 = missed,
     back in the same session; a correct answer moves one box up and waits
     DAYS[box] before it is due again. A correct answer before the due date
     keeps the box (the gap is what makes it stick); a miss always drops to 0.
     "Mastered" = box 3 or higher: right three times with growing gaps. */
  const DAY = 864e5;
  const DAYS = [0, 1, 3, 7, 14, 30];
  const MASTERED = 3;
  window.SRS = {
    DAYS, MASTERED,
    // Progress saved before boxes existed: a streak of n right answers = box n.
    migrate(a) {
      if (!a || a.box !== undefined) return a;
      a.box = a.ok ? Math.min(a.streak || 1, DAYS.length - 1) : 0;
      a.due = a.at + DAYS[a.box] * DAY;
      return a;
    },
    // Next box and due date after an answer; prev may be undefined (new).
    step(prev, ok, now) {
      if (!ok) return { box: 0, due: now };
      if (prev && prev.ok && prev.box > 0 && now < prev.due) return { box: prev.box, due: prev.due };
      const box = prev ? Math.min(prev.box + 1, DAYS.length - 1) : 1;
      return { box, due: now + DAYS[box] * DAY };
    },
    isDue: (a, now) => !!a && a.due <= now,
    mastered: a => !!a && a.ok && a.box >= MASTERED,
    // "dziś", "jutro", "za 3 dni"
    when(due, now) {
      const days = Math.ceil((due - now) / DAY);
      return days <= 0 ? "dziś" : days === 1 ? "jutro" : `za ${days} dni`;
    },
  };
})();
