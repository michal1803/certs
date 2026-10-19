// Exam profiles, domain quotas, time limits, scoring, pass rule, spaced repetition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, memoryStorage } from "./load.mjs";

const { win } = load(["assets/exam-data.js"]);
const { EXAM_PROFILES: P, examQuotas, examMinutes, scoreAnswer, passPct, SRS, drawExam } = win;
const shuffle = list => list.slice().reverse();   // deterministic stand-in
const DAY = 864e5;
const sum = o => Object.values(o).reduce((s, n) => s + n, 0);

test("quotas add up to the question count for every offered count", () => {
  for (const p of Object.values(P)) for (const n of p.exam.counts) assert.equal(sum(examQuotas(p, n)), n);
});

test("AZ-104 50 questions follow the midpoints of the official domain ranges", () => {
  // 22.5 / 17.5 / 22.5 / 17.5 / 12.5 of 92.5, largest remainder, ties to the earlier domain
  assert.deepEqual({ ...examQuotas(P.az104, 50) }, { identity: 12, storage: 10, compute: 12, networking: 9, monitoring: 7 });
});

test("quotas never exceed what the bank holds and move the shortfall elsewhere", () => {
  const q = examQuotas(P.az104, 60, { identity: 36, storage: 5, compute: 38, networking: 54, monitoring: 24 });
  assert.equal(q.storage, 5);
  assert.equal(sum(q), 60);
});

test("quotas are deterministic (the launcher preview matches the exam draw)", () => {
  assert.deepEqual({ ...examQuotas(P.terraform, 14) }, { ...examQuotas(P.terraform, 14) });
});

test("time limit: official for AZ-104, real pace for the Terraform drill", () => {
  assert.equal(examMinutes(P.az104, 40), 100);
  assert.equal(examMinutes(P.az104, 60), 100);
  assert.equal(examMinutes(P.terraform, 14), 15);
  assert.equal(examMinutes(P.terraform, 28), 30);
});

test("scoring without partial credit: exact set or nothing", () => {
  assert.deepEqual({ ...scoreAnswer(["B"], ["B"], false) }, { pts: 1, max: 1, exact: true });
  assert.deepEqual({ ...scoreAnswer(["B"], ["A"], false) }, { pts: 0, max: 1, exact: false });
  assert.equal(scoreAnswer(["A", "C"], ["A"], false).pts, 0);
  assert.equal(scoreAnswer(["A", "C"], [], false).pts, 0);
});

test("scoring with partial credit: a point per right choice, extra choices cost", () => {
  assert.deepEqual({ ...scoreAnswer(["A", "C"], ["A", "C"], true) }, { pts: 2, max: 2, exact: true });
  assert.equal(scoreAnswer(["A", "C"], ["A"], true).pts, 1);
  assert.equal(scoreAnswer(["A", "C"], ["A", "B"], true).pts, 1);
  assert.equal(scoreAnswer(["A", "C"], ["A", "B", "D"], true).pts, 0);
  assert.equal(scoreAnswer(["A"], [], true).pts, 0);
});

test("pass rule: conservative 75% for AZ-104, none for Terraform", () => {
  assert.equal(passPct(P.az104.exam.passing), 75);
  assert.equal(passPct(P.terraform.exam.passing), null);
  assert.equal(passPct({ score: 700, scale: 1000 }), 70);
});

test("Leitner steps: a miss drops to box 0, due at once", () => {
  assert.deepEqual({ ...SRS.step({ ok: true, box: 4, due: 0 }, false, 1000) }, { box: 0, due: 1000 });
});

test("Leitner steps: a first right answer goes to box 1, back tomorrow", () => {
  assert.deepEqual({ ...SRS.step(undefined, true, 0) }, { box: 1, due: DAY });
});

test("Leitner steps: right again once due moves up with a growing gap, capped at 30 days", () => {
  assert.deepEqual({ ...SRS.step({ ok: true, box: 1, due: DAY }, true, 2 * DAY) }, { box: 2, due: 2 * DAY + 3 * DAY });
  assert.deepEqual({ ...SRS.step({ ok: true, box: 5, due: 0 }, true, 10) }, { box: 5, due: 10 + 30 * DAY });
});

test("Leitner steps: right before the due date keeps box and date (no cramming)", () => {
  assert.deepEqual({ ...SRS.step({ ok: true, box: 3, due: 10 * DAY }, true, 5 * DAY) }, { box: 3, due: 10 * DAY });
});

test("Leitner steps: a lucky guess comes back tomorrow from box 1", () => {
  assert.deepEqual({ ...SRS.step({ ok: true, box: 4, due: 0 }, true, 0, true) }, { box: 1, due: DAY });
});

test("mastered means right and box 3 or higher", () => {
  assert.equal(SRS.mastered({ ok: true, box: 3 }), true);
  assert.equal(SRS.mastered({ ok: true, box: 2 }), false);
  assert.equal(SRS.mastered({ ok: false, box: 4 }), false);
});

test("due count leaves out self-assessed answers the quick five cannot serve", () => {
  const now = Date.now();
  const study = { v: 1, ans: {
    q1: { ok: false, box: 0, due: now - 1, at: now - 1 },
    q2: { ok: true, box: 1, due: now + DAY, at: now - 1 },
    q3: { ok: false, box: 0, due: now - 1, at: now - 1, self: true },
    q999: { ok: false, box: 0, due: now - 1, at: now - 1 },   // not in the bank
  } };
  const { win: w } = load(["assets/exam-data.js"], { storage: memoryStorage({ "study:az104:v1": JSON.stringify(study) }) });
  assert.equal(w.HubDue.count("az104", now), 1);
});

test("exam draw: quotas per domain, questions from recent attempts only when needed", () => {
  const byDomain = { a: ["a1", "a2", "a3", "a4"], b: ["b1", "b2"] };
  const pool = [...drawExam(byDomain, { a: 2, b: 1 }, new Set(["a4", "a3", "b2"]), shuffle)];
  assert.deepEqual(pool.filter(id => id.startsWith("a")).sort(), ["a1", "a2"]);
  assert.deepEqual(pool.filter(id => id.startsWith("b")), ["b1"]);
  const tight = [...drawExam(byDomain, { a: 3, b: 2 }, new Set(["a1", "a2", "a3", "b1"]), shuffle)];
  assert.equal(tight.length, 5);
  assert.ok(tight.includes("a4") && tight.includes("b2"), "fresh questions are always taken first");
});
