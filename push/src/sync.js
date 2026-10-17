/* Progress sync: a small per-user key/value store in D1. Values are opaque strings
   (the page's localStorage entries); last write wins per key. */
import { HttpError, readJson } from "./http.js";
import { authenticate } from "./auth.js";

const KEY_RE = /^(study:[a-z0-9-]{1,40}:v1|exam-history:[a-z0-9-]{1,40}:v1|exam-hub:theme)$/;
const MAX_KEYS = 20;
const MAX_VALUE = 200_000;
const MAX_SYNC_BODY = 1_000_000;

async function getSync(req, env) {
  const { user } = await authenticate(req, env);
  const { results } = await env.DB.prepare("SELECT key, value, updated FROM data WHERE user_id = ?").bind(user.id).all();
  const items = {};
  for (const r of results) items[r.key] = { value: r.value, updated: r.updated };
  return { ok: true, items };
}

async function putSync(req, env) {
  const { user } = await authenticate(req, env);
  const body = await readJson(req, MAX_SYNC_BODY);
  const items = body?.items;
  if (!items || typeof items !== "object" || Array.isArray(items)) throw new HttpError(400, "items missing");
  const entries = Object.entries(items);
  if (!entries.length || entries.length > MAX_KEYS) throw new HttpError(400, `items must have 1-${MAX_KEYS} keys`);
  for (const [key, value] of entries) {
    if (!KEY_RE.test(key)) throw new HttpError(400, `invalid key: ${key.slice(0, 60)}`);
    if (typeof value !== "string") throw new HttpError(400, `value of ${key} must be a string`);
    if (value.length > MAX_VALUE) throw new HttpError(413, `value of ${key} too large`);
  }
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO data (user_id, key, value, updated) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated = excluded.updated`
  );
  await env.DB.batch(entries.map(([key, value]) => stmt.bind(user.id, key, value, now)));
  return { ok: true, updated: now };
}

export const syncRoutes = {
  "GET /sync": getSync,
  "PUT /sync": putSync,
};
