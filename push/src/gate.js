/* Site gate. The app itself (static assets under /certs/) is served only to the
   owner (OWNER_GITHUB_ID), signed in with GitHub. The proof is a cookie holding
   the GitHub id and an expiry, signed with SESSION_SECRET; without it a page
   load goes to GitHub login and anything else gets 401. The API routes
   (/auth, /sync, push) are separate and keep their own bearer-token checks. */
import { b64u } from "./webpush.js";
import { githubUser } from "./auth.js";
import { clientIp, rateLimit, HttpError } from "./http.js";

const COOKIE = "eh_gate";
const DAY_MS = 86_400_000;
const GATE_MS = 180 * DAY_MS;       // stay signed in to the site for 180 days
const STATE_TTL_MS = 10 * 60_000;
const APP = "/certs/";
const enc = new TextEncoder();

const key = env => crypto.subtle.importKey("raw", enc.encode(`gate|${env.SESSION_SECRET}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function seal(env, data) {
  const payload = b64u.encode(enc.encode(JSON.stringify(data)));
  return `${payload}.${b64u.encode(await crypto.subtle.sign("HMAC", await key(env), enc.encode(payload)))}`;
}
async function open(env, token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await key(env), b64u.decode(sig), enc.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(b64u.decode(payload)));
    return typeof data.e === "number" && data.e > Date.now() ? data : null;
  } catch (e) { return null; }
}

const cookieOf = req => (req.headers.get("Cookie") || "").split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const isOwner = async (req, env) => { const d = await open(env, cookieOf(req)); return !!d && String(d.id) === String(env.OWNER_GITHUB_ID); };
const appPath = p => typeof p === "string" && p.startsWith(APP) && !p.startsWith("//") && p.length < 512 ? p : `${APP}index.html`;
const callbackUrl = req => `${new URL(req.url).origin}/auth/callback/gate`;
const noStore = { "Cache-Control": "no-store" };
const page = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exam Hub</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px">${text}</body>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", ...noStore } });

// Asset responses: the app's own CSP meta stays; headers add what a meta tag cannot.
function secure(res) {
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "same-origin");
  out.headers.set("Cache-Control", "private, no-cache");
  return out;
}

/* Returns a Response for site and gate paths, or null for API routes. */
export async function gate(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/" || path === "/certs" || path === "/certs/") return Response.redirect(`${url.origin}${APP}index.html`, 302);

  if (path === "/gate/login" || path === "/auth/callback/gate") {
    try { await rateLimit(env.RL_AUTH, `ip:${clientIp(req)}`); }
    catch (e) { if (e instanceof HttpError) return page(429, "Za dużo prób logowania. Spróbuj za minutę."); throw e; }
  }

  if (path === "/gate/login") {
    if (!env.OWNER_GITHUB_ID || !env.SESSION_SECRET || !env.GITHUB_CLIENT_SECRET) return page(503, "Logowanie nie jest skonfigurowane.");
    const state = await seal(env, { r: appPath(url.searchParams.get("r")), e: Date.now() + STATE_TTL_MS, n: crypto.randomUUID() });
    const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(req), state, allow_signup: "false" });
    return new Response(null, { status: 302, headers: { Location: `${env.GITHUB_OAUTH_BASE || "https://github.com"}/login/oauth/authorize?${params}`, ...noStore } });
  }

  if (path === "/auth/callback/gate") {
    const st = await open(env, url.searchParams.get("state"));
    const code = url.searchParams.get("code");
    if (!st || !code || code.length > 200) return page(400, `Logowanie nie powiodło się. <a href="${APP}index.html">Spróbuj ponownie</a>.`);
    let user;
    try { user = await githubUser(env, code, callbackUrl(req)); } catch (e) { return page(502, `GitHub nie potwierdził logowania. <a href="${APP}index.html">Spróbuj ponownie</a>.`); }
    if (String(user.id) !== String(env.OWNER_GITHUB_ID)) return page(403, "Ta aplikacja jest prywatna. To konto GitHub nie ma dostępu.");
    const token = await seal(env, { id: user.id, e: Date.now() + GATE_MS });
    return new Response(null, { status: 302, headers: {
      Location: appPath(st.r), ...noStore,
      "Set-Cookie": `${COOKIE}=${token}; Max-Age=${GATE_MS / 1000}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    } });
  }

  if (path === "/gate/logout") {
    return new Response(null, { status: 302, headers: { Location: "/gate/signed-out", ...noStore, "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax` } });
  }
  if (path === "/gate/signed-out") return page(200, `Wylogowano z Exam Hub. <a href="${APP}index.html">Zaloguj się ponownie</a>.`);

  if (path.startsWith(APP)) {
    if (await isOwner(req, env)) return secure(await env.ASSETS.fetch(req));
    const navigate = req.headers.get("Sec-Fetch-Mode") === "navigate" || (req.headers.get("Accept") || "").includes("text/html");
    if (navigate) return new Response(null, { status: 302, headers: { Location: `/gate/login?r=${encodeURIComponent(path + url.search)}`, ...noStore } });
    return new Response("Unauthorized", { status: 401, headers: noStore });
  }
  return null;
}
