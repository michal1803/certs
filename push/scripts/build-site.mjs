// Copies the app (repo root) into dist/certs/, which wrangler serves as the Worker's
// static assets behind the site gate (src/gate.js). Only shipping files: the
// local planning files and the Worker itself stay out.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const push = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(push, "..");
const out = join(push, "dist", "certs");
const FILES = ["index.html", "privacy.html", "az104.html", "terraform.html", "manifest.webmanifest", "sw.js", "assets"];

rmSync(join(push, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(root, f), join(out, f), { recursive: true });
console.log(`site copied to ${out}`);
