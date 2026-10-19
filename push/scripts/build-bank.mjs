// Builds the private question bank for the Worker's static assets (dist/bank/):
// - <exam>.html: the question cards from push/bank/ (not in git), without their
//   data-comments attribute, so the first question shows without waiting for them;
// - <exam>.comments.json: those community comments, { "<question id>": [...] },
//   which the page fetches in the background (GET /bank/<exam>/comments).
// The Worker hands both only to the owner's signed-in session; the cards and the
// comments themselves are not changed, only split.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const push = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(push, "dist", "bank");
// The attribute is single-quoted and the bank only uses these two entities in it.
const decode = v => v.replace(/&#34;/g, '"').replace(/&#39;/g, "'");
const CARD = /(<div class="q-card[^>]*?\sid="(q\d+)"[^>]*?)\s+data-comments='([^']*)'/g;

rmSync(join(push, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const ex of ["az104", "terraform"]) {
  const src = join(push, "bank", `${ex}.html`);
  if (!existsSync(src)) throw new Error(`missing ${src}: the question bank is not in git, restore it first`);
  const bank = readFileSync(src, "utf8");
  const comments = {};
  const cards = bank.split('<div class="q-card').length - 1;
  const stripped = bank.replace(CARD, (m, head, id, raw) => { comments[id] = JSON.parse(decode(raw)); return head; });
  if (Object.keys(comments).length !== cards || stripped.includes("data-comments=")) throw new Error(`${ex}: not every card's comments were split off`);
  writeFileSync(join(out, `${ex}.html`), stripped);
  writeFileSync(join(out, `${ex}.comments.json`), JSON.stringify(comments));
  const n = Object.values(comments).reduce((s, c) => s + c.length, 0);
  console.log(`${ex}: ${cards} cards (${(stripped.length / 1024).toFixed(0)} KB), ${n} comments (${(JSON.stringify(comments).length / 1024).toFixed(0)} KB)`);
}
