/* Exam Hub push: stores Web Push subscriptions in KV and sends one daily
   study reminder at each subscriber's local time (cron every 15 minutes).
   Also GitHub login and progress sync in D1 (see auth.js, sync.js). */
import { sendPush } from "./webpush.js";
import { corsHeaders, json, HttpError, readJson, sha256Hex } from "./http.js";
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
  // Keep lastSent so moving the time later today does not send a second reminder.
  await save(env, id, {
    subscription: { endpoint: sub.endpoint, keys: { p256dh, auth } },
    time, tz: body.tz, days,
    lastSent: prev?.lastSent || null,
    lastTest: prev?.lastTest || 0,
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
  if (res.status === 404 || res.status === 410) {
    await env.SUBS.delete(id);
    throw new HttpError(410, "subscription expired");
  }
  if (!res.ok) throw new HttpError(502, `push service answered ${res.status}`);
  return { ok: true };
}

async function runCron(env) {
  const now = new Date();
  const due = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ cursor });
    for (const k of page.keys) {
      const meta = k.metadata;
      if (!meta?.time || !validTz(meta.tz)) continue;
      const date = dueSlot(meta, now);
      if (date) due.push({ id: k.name, date });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  if (due.length > MAX_PUSHES_PER_RUN) console.warn(`${due.length} due, sending ${MAX_PUSHES_PER_RUN} this run`);
  let sent = 0, removed = 0, failed = 0;
  for (const { id, date } of due.slice(0, MAX_PUSHES_PER_RUN)) {
    try {
      const rec = await env.SUBS.get(id, "json");
      if (!rec) continue;
      const res = await sendPush(rec.subscription, PAYLOAD, vapidOf(env), PUSH_OPTS);
      if (res.status === 404 || res.status === 410) { await env.SUBS.delete(id); removed++; continue; }
      if (!res.ok) { failed++; console.warn(`push ${id.slice(0, 8)} -> ${res.status}`); continue; }
      rec.lastSent = date;
      await save(env, id, rec);
      sent++;
    } catch (e) {
      failed++;
      console.error(`push ${id.slice(0, 8)} failed: ${e.message}`);
    }
  }
  console.log(`cron: ${due.length} due, ${sent} sent, ${removed} removed, ${failed} failed`);
}

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
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    const route = routes[`${req.method} ${new URL(req.url).pathname}`];
    if (!route) return json(req, 404, { ok: false, error: "not found" });
    try {
      const out = await route(req, env);
      // Redirects and plain-text pages come back as ready Responses.
      return out instanceof Response ? out : json(req, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(req, e.status, { ok: false, error: e.message });
      console.error(e);
      return json(req, 500, { ok: false, error: "internal error" });
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(env));
    ctx.waitUntil(cleanupAuth(env));
  },
};
