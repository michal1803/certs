// Sync merge and validation of untrusted data, and the backup file import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, memoryStorage } from "./load.mjs";

const files = ["assets/exam-data.js", "assets/sync.js"];
const { win } = load(files);
const { mergeStudy, mergeHistory, cleanStudy } = win.HubSync._merge;

const study = (ans, extra = {}) => ({ v: 1, order: "smart", savedAt: 1, ans, starLog: {}, summary: { identity: { total: 61 } }, ...extra });
const a = (at, ok, d = "identity") => ({ sel: ["A"], ok, at, n: 1, streak: ok ? 1 : 0, box: ok ? 1 : 0, due: at, d });

test("the newer answer to each question wins, from either side", () => {
  const m = mergeStudy(study({ q1: a(10, false), q2: a(30, true) }), study({ q1: a(20, true), q2: a(5, false) }));
  assert.equal(m.ans.q1.ok, true);
  assert.equal(m.ans.q2.ok, true);
  assert.equal(m.ans.q2.at, 30);
});

test("stars merge by their change log: the later star or unstar wins", () => {
  const m = mergeStudy(study({}, { starLog: { q1: 100, q2: -50 } }), study({}, { starLog: { q1: -200, q2: 40, q3: 10 } }));
  assert.deepEqual([...m.stars].sort(), ["q3"]);
});

test("exam history unites both sides, newest first, without duplicates, at most 30", () => {
  const left = [{ at: 3, count: 50, pct: 70 }, { at: 1, count: 40, pct: 60 }];
  const right = [{ at: 2, count: 50, pct: 65 }, { at: 3, count: 50, pct: 70 }];
  assert.deepEqual([...mergeHistory(left, right).map(h => h.at)], [3, 2, 1]);
  const many = Array.from({ length: 40 }, (_, i) => ({ at: i + 1, count: 10, pct: 50 }));
  assert.equal(mergeHistory(many, []).length, 30);
});

test("untrusted study data keeps only known fields with the right types", () => {
  const dirty = study({
    q1: { ...a(10, true), sel: ["A", "<img src=x onerror=alert(1)>", 5], d: "<script>", extra: "x" },
    "not-a-question": a(10, true),
    q2: "nope",
  });
  const c = cleanStudy(dirty);
  assert.deepEqual(Object.keys(c.ans), ["q1"]);
  assert.deepEqual([...c.ans.q1.sel], ["A"]);
  assert.equal(c.ans.q1.d, undefined);
  assert.equal(c.ans.q1.extra, undefined);
});

test("history entries are clamped to numbers", () => {
  const m = mergeHistory([{ at: 5, count: "50<b>", pct: 1e9, untimed: "yes" }], []);
  assert.deepEqual({ ...m[0] }, { at: 5, count: 0, pct: 100, untimed: false });
});

test("backup: export then import into an empty browser restores progress", () => {
  const src = memoryStorage({
    "study:az104:v1": JSON.stringify(study({ q1: a(10, true) })),
    "exam-history:az104:v1": JSON.stringify([{ at: 9, count: 50, pct: 80 }]),
    "exam-hub:theme": "dark",
  });
  const data = load(files, { storage: src }).win.HubSync.exportData();
  assert.deepEqual(Object.keys(data.items).sort(), ["exam-history:az104:v1", "study:az104:v1"]);

  const dst = memoryStorage();
  const target = load(files, { storage: dst }).win.HubSync;
  assert.equal(target.importData(data), 2);
  assert.equal(JSON.parse(dst.getItem("study:az104:v1")).ans.q1.ok, true);
  assert.equal(target.importData(data), 0, "importing the same file twice changes nothing");
});

test("backup: an import never replaces newer progress in this browser", () => {
  const dst = memoryStorage({ "study:az104:v1": JSON.stringify(study({ q1: a(50, false) })) });
  const target = load(files, { storage: dst }).win.HubSync;
  target.importData({ app: "exam-hub", v: 1, items: { "study:az104:v1": JSON.stringify(study({ q1: a(10, true) })) } });
  assert.equal(JSON.parse(dst.getItem("study:az104:v1")).ans.q1.at, 50);
});

test("backup: other files are refused", () => {
  assert.throws(() => win.HubSync.importData({ foo: 1 }), /format/);
  assert.throws(() => win.HubSync.importData(null), /format/);
});
