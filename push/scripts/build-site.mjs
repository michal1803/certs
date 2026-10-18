// Copies the app (repo root) into dist/certs/, which wrangler serves as the Worker's
// static assets behind the site gate (src/gate.js). Only shipping files: the
// local planning files and the Worker itself stay out.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const push = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(push, "..");
const out = join(push, "dist", "certs");
const FILES = ["index.html", "privacy.html", "az104.html", "terraform.html", "manifest.webmanifest", "sw.js", "assets"];

rmSync(join(push, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(root, f), join(out, f), { recursive: true });
// The private question bank (gitignored push/bank/) goes to /bank/, served by
// the Worker only to the owner's session (GET /bank/<exam>).
for (const ex of ["az104", "terraform"]) {
  const src = join(push, "bank", `${ex}.html`);
  if (!existsSync(src)) throw new Error(`missing ${src}: the question bank is not in git, restore it first`);
  cpSync(src, join(push, "dist", "bank", `${ex}.html`));
}
console.log(`site copied to ${out}, bank to dist/bank`);
