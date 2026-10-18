/* Shared HTTP helpers: CORS, JSON responses, errors, body parsing, hashing, rate limits. */

export const ALLOWED_ORIGIN = "https://michal1803.github.io";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_BODY = 4096;

// http://localhost and 127.0.0.1 only when .dev.vars sets DEV_ORIGINS=1; never in production.
export const isLocalOrigin = (origin, env) => env?.DEV_ORIGINS === "1" && LOCAL_ORIGIN.test(origin);

export function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  if (origin !== ALLOWED_ORIGIN && !isLocalOrigin(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Responses can carry user data (profile, progress, tokens): never cache them.
export const json = (req, env, status, data, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req, env), ...headers },
  });

export class HttpError extends Error {
  constructor(status, message, headers) { super(message); this.status = status; this.headers = headers; }
}

export async function readJson(req, max = MAX_BODY) {
  // Cheap early reject before buffering; the byte count below is the real check.
  if (Number(req.headers.get("Content-Length")) > max) throw new HttpError(413, "body too large");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) throw new HttpError(413, "body too large");
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new HttpError(400, "invalid JSON"); }
}

export async function sha256Hex(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Only Cloudflare's header is trusted. IPv6 is keyed by its /64: one connection
// usually owns a whole /64, so per-address keys would be trivial to rotate.
export const clientIp = req => {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  if (!ip.includes(":")) return ip;
  const v4 = ip.match(/(\d{1,3}(\.\d{1,3}){3})$/); // IPv4-mapped (::ffff:a.b.c.d)
  if (v4) return v4[1];
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map(g => (g || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
};

// Must match `period` of the [[ratelimits]] bindings in wrangler.toml.
const RATE_PERIOD_S = 60;

/* Workers Rate Limiting binding (per Cloudflare location, approximate). Without the
   binding (old local setup) or if the limiter itself fails, the request goes through. */
export async function rateLimit(binding, key) {
  if (!binding?.limit) return;
  let ok = true;
  try { ({ success: ok } = await binding.limit({ key })); } catch (e) { console.warn(`rate limiter failed: ${e.message}`); }
  if (!ok) throw new HttpError(429, "rate limited", { "Retry-After": String(RATE_PERIOD_S) });
}
