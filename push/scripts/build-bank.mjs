// Copies the private question bank (gitignored push/bank/) into dist/bank/, which
// wrangler deploys as the Worker's static assets. The Worker hands it out only to
// the owner's signed-in session (GET /bank/<exam>); the files are not public.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const push = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(push, "dist", "bank");

rmSync(join(push, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const ex of ["az104", "terraform"]) {
  const src = join(push, "bank", `${ex}.html`);
  if (!existsSync(src)) throw new Error(`missing ${src}: the question bank is not in git, restore it first`);
  cpSync(src, join(out, `${ex}.html`));
}
console.log(`bank copied to ${out}`);
