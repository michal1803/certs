// The bank build moves each card's comments out without changing anything else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitComments } from "../push/scripts/build-bank.mjs";

const card = (id, comments) => `<div class="q-card" id="${id}" data-domain="identity" data-correct="C"
             data-link="https://example.test/${id}"
             data-comments='${comments}'>
  <div class="q-text">Question ${id} &amp; more</div>
</div>`;

test("comments split off, decoded exactly as a browser reads the attribute", () => {
  const raw = `[{&#34;user&#34;:&#34;a&#34;,&#34;answer&#34;:&#34;C&#34;,&#34;text&#34;:&#34;it&#39;s C &amp; not D&#34;}]`;
  const bank = card("q1", raw) + "\n" + card("q2", "[]");
  const { cards, comments } = splitComments(bank);
  assert.deepEqual(comments.q1, [{ user: "a", answer: "C", text: "it's C &amp; not D" }]);
  assert.deepEqual(comments.q2, []);
  assert.ok(!cards.includes("data-comments"));
  // everything else in the cards is byte-identical
  assert.equal(cards, bank.replace(/\s+data-comments='[^']*'/g, ""));
});

test("a card whose comments cannot be split stops the build", () => {
  assert.throws(() => splitComments(`<div class="q-card" id="q1" data-comments="[]"></div>`), /not every card/);
});
