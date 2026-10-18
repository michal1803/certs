/* Exam Hub push: stores Web Push subscriptions in KV and sends one daily
   study reminder at each subscriber's local time (cron every 15 minutes).
   Also GitHub login and progress sync in D1 (see auth.js, sync.js). */
import { sendPush } from "./webpush.js";
import { clientIp, corsHeaders, json, HttpError, rateLimit, readJson, sha256Hex } from "./http.js";
import { authRoutes, cleanupAuth } from "./auth.js";
import { syncRoutes } from "./sync.js";

const PAYLOAD = JSON.stringify({
  title: "Exam Hub",
  body: "Masz chwilę? Zrób szybką piątkę: 5 pytań, ok. 3 minuty.",
  url: "./index.html#szybkie",
  tag: "daily",
});
const PUSH_OPTS = { ttl: 4 * 3600, urgency: "normal", topic: "daily" };
const WINDOW_MIN = 15;     // matches the cron interval
const TEST_GAP_MS = 60_000;
// Free plan allows 50 subrequests per invocation; keep headroom.
const MAX_PUSHES_PER_RUN = 45;
// Caps on stored subscriptions; counted in D1 (migration 0003), skipped without D1.
const MAX_SUBS = 1000;
const MAX_NEW_SUBS_PER_IP_PER_DAY = 5;
// 400/403 from the push service this many times in a row removes the subscription (404/410 at once).
const MAX_PUSH_FAILURES = 3;

const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

const idFor = sha256Hex;

function checkEndpoint(endpoint, env) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) throw new HttpError(400, "endpoint missing");
  let url;
  try { url = new URL(endpoint); } catch (e) { throw new HttpError(400, "endpoint is not a URL"); }
  // Only real browser push services, so the Worker cannot be used to POST to arbitrary hosts.
  if (url.protocol === "https:" && PUSH_HOSTS.test(url.hostname)) return;
  if (url.protocol === "https:") throw new HttpError(400, "unknown push service");
  // Only for local testing against a fake push service.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (env.ALLOW_INSECURE_ENDPOINTS === "1" && url.protocol === "http:" && local) return;
  throw new HttpError(400, "endpoint must be https");
}

function validTz(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();

// Local calendar date, minute of day and weekday of `date` in `tz`.
function localParts(date, tz) {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    });
    fmtCache.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: WEEKDAYS[p.weekday] };
}

/* The reminder is due when local time is within [time, time + 15 min).
   Returns the local date the slot belongs to (so 23:50 caught at 00:00 still counts
   for the day before), or null when nothing should be sent. */
export function dueSlot(meta, now) {
  const [h, m] = meta.time.split(":").map(Number);
  const local = localParts(now, meta.tz);
  const diff = (local.minutes - (h * 60 + m) + 1440) % 1440;
  if (diff >= WINDOW_MIN) return null;
  const slot = diff ? localParts(new Date(now.getTime() - diff * 60_000), meta.tz) : local;
  if (slot.date === meta.lastSent) return null;
  if (!meta.days.includes(slot.weekday)) return null;
  return slot.date;
}

// Schedule lives in KV metadata so the cron run needs one list, no gets, for idle subscribers.
const save = (env, id, rec) =>
  env.SUBS.put(id, JSON.stringify(rec), {
    metadata: { time: rec.time, tz: rec.tz, days: rec.days, lastSent: rec.lastSent || null },
  });

const vapidOf = env => ({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* Before storing a new subscription: refuse when the total is at MAX_SUBS or this IP
   already added MAX_NEW_SUBS_PER_IP_PER_DAY today. The IP is kept only as an HMAC with
   the dedicated secret IP_HASH_SECRET and the day, and the row is dropped the next day.
   Without that secret the per-IP quota is skipped rather than hashed with a public value. */
async function admitNewSub(req, env) {
  if (!env.DB) return;
  const total = await env.DB.prepare("SELECT value FROM stats WHERE name = 'subs'").first("value");
  if (total >= MAX_SUBS) throw new HttpError(503, "subscription limit reached");
  const day = utcDay();
  const n = !env.IP_HASH_SECRET ? 0 : await env.DB.prepare(
    `INSERT INTO sub_quota (ip_hash, day, count) VALUES (?, ?, 1)
     ON CONFLICT(ip_hash) DO UPDATE SET count = count + 1 RETURNING count`
  ).bind(await hmacHex(env.IP_HASH_SECRET, `${day}|${clientIp(req)}`), day).first("count");
  if (n > MAX_NEW_SUBS_PER_IP_PER_DAY) throw new HttpError(429, "too many new subscriptions today", { "Retry-After": "86400" });
  // The exact count is rewritten by every cron run; this keeps the cap tight in between.
  await env.DB.prepare(
    "INSERT INTO stats (name, value) VALUES ('subs', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1"
  ).run();
}

/* 404/410: gone for good, delete now. 400/403: delete after MAX_PUSH_FAILURES in a row.
   Returns true when the subscription was deleted. The caller resets rec.fails on success. */
async function handlePushStatus(env, id, rec, status) {
  if (status === 404 || status === 410) { await env.SUBS.delete(id); return true; }
  if (status !== 400 && status !== 403) return false;
  rec.fails = (rec.fails || 0) + 1;
  if (rec.fails >= MAX_PUSH_FAILURES) { await env.SUBS.delete(id); return true; }
  await save(env, id, rec);
  return false;
}

async function subscribe(req, env) {
  const body = await readJson(req);
  const sub = body.subscription;
  if (!sub || typeof sub !== "object") throw new HttpError(400, "subscription missing");
  checkEndpoint(sub.endpoint, env);
  const { p256dh, auth } = sub.keys || {};
  if (typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth || p256dh.length > 200 || auth.length > 100)
    throw new HttpError(400, "subscription keys missing");
  const time = body.time;
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, "time must be HH:MM");
  if (!validTz(body.tz)) throw new HttpError(400, "invalid tz");
  let days = body.days ?? [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(days) || !days.length || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6))
    throw new HttpError(400, "days must be weekday numbers 0-6");
  days = [...new Set(days)].sort();

  const id = await idFor(sub.endpoint);
  const prev = await env.SUBS.get(id, "json");
  if (!prev) await admitNewSub(req, env);
  // Keep lastSent so moving the time later today does not send a second reminder.
  await save(env, id, {
    subscription: { endpoint: sub.endpoint, keys: { p256dh, auth } },
    time, tz: body.tz, days,
    lastSent: prev?.lastSent || null,
    lastTest: prev?.lastTest || 0,
    fails: prev?.fails || 0,
    created: prev?.created || Date.now(),
  });
  return { ok: true };
}

async function unsubscribe(req, env) {
  const { endpoint } = await readJson(req);
  if (typeof endpoint !== "string" || !endpoint) throw new HttpError(400, "endpoint missing");
  await env.SUBS.delete(await idFor(endpoint));
  return { ok: true };
}

async function test(req, env) {
  const { endpoint } = await readJson(req);
  if (typeof endpoint !== "string" || !endpoint) throw new HttpError(400, "endpoint missing");
  const id = await idFor(endpoint);
  const rec = await env.SUBS.get(id, "json");
  if (!rec) throw new HttpError(404, "not subscribed");
  if (Date.now() - (rec.lastTest || 0) < TEST_GAP_MS) throw new HttpError(429, "wait a minute between tests");
  rec.lastTest = Date.now();
  await save(env, id, rec);
  const res = await sendPush(rec.subscription, PAYLOAD, vapidOf(env), PUSH_OPTS);
  if (await handlePushStatus(env, id, rec, res.status)) throw new HttpError(410, "subscription expired");
  if (!res.ok) throw new HttpError(502, `push service answered ${res.status}`);
  if (rec.fails) { rec.fails = 0; await save(env, id, rec); }
  return { ok: true };
}

// Exact subscription count for the MAX_SUBS check; yesterday's per-IP counters dropped.
async function recordSubCount(env, total, now) {
  if (!env.DB) return;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO stats (name, value) VALUES ('subs', ?1) ON CONFLICT(name) DO UPDATE SET value = ?1").bind(total),
      env.DB.prepare("DELETE FROM sub_quota WHERE day < ?").bind(utcDay(now.getTime())),
    ]);
  } catch (e) {
    console.error(`subscription count failed: ${e.message}`);
  }
}

async function runCron(env) {
  const now = new Date();
  const due = [];
  let cursor, total = 0;
  do {
    const page = await env.SUBS.list({ cursor });
    total += page.keys.length;
    for (const k of page.keys) {
      const meta = k.metadata;
      if (!meta?.time || !validTz(meta.tz)) continue;
      const date = dueSlot(meta, now);
      if (date) due.push({ id: k.name, date });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  await recordSubCount(env, total, now);

  if (due.length > MAX_PUSHES_PER_RUN) console.warn(`${due.length} due, sending ${MAX_PUSHES_PER_RUN} this run`);
  let sent = 0, removed = 0, failed = 0;
  for (const { id, date } of due.slice(0, MAX_PUSHES_PER_RUN)) {
    try {
      const rec = await env.SUBS.get(id, "json");
      if (!rec) continue;
      const res = await sendPush(rec.subscription, PAYLOAD, vapidOf(env), PUSH_OPTS);
      if (await handlePushStatus(env, id, rec, res.status)) { removed++; continue; }
      if (!res.ok) { failed++; console.warn(`push ${id.slice(0, 8)} -> ${res.status}`); continue; }
      rec.lastSent = date;
      rec.fails = 0;
      await save(env, id, rec);
      sent++;
    } catch (e) {
      failed++;
      console.error(`push ${id.slice(0, 8)} failed: ${e.message}`);
    }
  }
  console.log(`cron: ${due.length} due, ${sent} sent, ${removed} removed, ${failed} failed`);
}

/* Per-IP limits (wrangler.toml [[ratelimits]]); authenticate() adds a per-user one on RL_API.
   GET /vapid is not limited. */
const LIMITS = {
  "POST /subscribe": "RL_PUSH",
  "POST /unsubscribe": "RL_PUSH",
  "POST /test": "RL_PUSH",
  "GET /auth/login": "RL_AUTH",
  "GET /auth/callback": "RL_AUTH",
  "POST /auth/exchange": "RL_AUTH",
  "POST /auth/logout": "RL_API",
  "POST /auth/logout-all": "RL_API",
  "GET /me": "RL_API",
  "GET /sync": "RL_API",
  "PUT /sync": "RL_API",
  "DELETE /account": "RL_API",
};

const routes = {
  ...authRoutes,
  ...syncRoutes,
  "POST /subscribe": subscribe,
  "POST /unsubscribe": unsubscribe,
  "POST /test": test,
  "GET /vapid": (req, env) => ({ publicKey: env.VAPID_PUBLIC_KEY }),
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const name = `${req.method} ${new URL(req.url).pathname}`;
    const route = routes[name];
    if (!route) return json(req, env, 404, { ok: false, error: "not found" });
    try {
      if (LIMITS[name]) await rateLimit(env[LIMITS[name]], `ip:${clientIp(req)}`);
      const out = await route(req, env);
      // Redirects and plain-text pages come back as ready Responses.
      return out instanceof Response ? out : json(req, env, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(req, env, e.status, { ok: false, error: e.message }, e.headers);
      console.error(e);
      return json(req, env, 500, { ok: false, error: "internal error" });
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(env));
    ctx.waitUntil(cleanupAuth(env, controller.scheduledTime));
  },
};
