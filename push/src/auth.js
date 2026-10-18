/* GitHub OAuth login. The browser never sees the GitHub token: the Worker swaps the
   OAuth code for the user's public profile, then hands the page a short-lived one-time
   code in the URL fragment, which the page exchanges for our own session token. */
import { b64u } from "./webpush.js";
import { ALLOWED_ORIGIN, isLocalOrigin, HttpError, rateLimit, readJson, sha256Hex } from "./http.js";

const STATE_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
// A session ends after 90 days without use, and 180 days after sign-in no matter what.
export const SESSION_IDLE_MS = 90 * DAY_MS;
export const SESSION_MAX_MS = 180 * DAY_MS;
// Accounts with no sign-in or API use for 24 months are deleted with all their data.
export const ACCOUNT_RETENTION_MS = 730 * DAY_MS;
// Refresh last_used at most daily so every API call is not a D1 write.
const TOUCH_GAP_MS = DAY_MS;

const enc = new TextEncoder();
const randomToken = () => b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
const oauthBase = env => env.GITHUB_OAUTH_BASE || "https://github.com";
const apiBase = env => env.GITHUB_API_BASE || "https://api.github.com";

function checkConfig(env) {
  if (!env.DB || !env.SESSION_SECRET || !env.GITHUB_CLIENT_SECRET ||
      !env.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID.startsWith("REPLACE_"))
    throw new HttpError(503, "login not configured");
}

// Only our own pages may receive the login code.
function validReturn(value, env) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch (e) { return null; }
  if (url.origin === ALLOWED_ORIGIN && url.pathname.startsWith("/certs/")) return url;
  if (isLocalOrigin(url.origin, env)) return url;
  return null;
}

const hmacKey = env =>
  crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function signState(env, data) {
  const payload = b64u.encode(enc.encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload));
  return `${payload}.${b64u.encode(sig)}`;
}

// Returns { ret, challenge } from a valid, unexpired state, else null.
async function verifyState(env, state) {
  if (typeof state !== "string" || state.length > 4096) return null;
  const [payload, sig, extra] = state.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    // subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), b64u.decode(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(b64u.decode(payload)));
    if (typeof data.e !== "number" || data.e < Date.now()) return null;
    const ret = validReturn(data.r, env);
    return ret && CHALLENGE.test(data.c) ? { ret, challenge: data.c } : null;
  } catch (e) {
    return null;
  }
}

// SHA-256 hex of the verifier the page keeps; binds the code to that browser,
// so a code from someone else's sign-in link cannot be exchanged here (login CSRF).
const CHALLENGE = /^[0-9a-f]{64}$/;

const redirect = location => new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
const callbackUrl = req => `${new URL(req.url).origin}/auth/callback`;

async function login(req, env) {
  checkConfig(env);
  const q = new URL(req.url).searchParams;
  const ret = validReturn(q.get("return"), env);
  if (!ret) throw new HttpError(400, "invalid return URL");
  const challenge = q.get("challenge");
  if (!CHALLENGE.test(challenge || "")) throw new HttpError(400, "challenge missing");
  const state = await signState(env, { r: ret.href, c: challenge, e: Date.now() + STATE_TTL_MS, n: randomToken() });
  const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(req), state, allow_signup: "true" });
  return redirect(`${oauthBase(env)}/login/oauth/authorize?${params}`);
}

async function githubUser(env, code, redirectUri) {
  const tokenRes = await fetch(`${oauthBase(env)}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "exam-hub" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri,
    }),
  });
  const tok = tokenRes.ok ? await tokenRes.json().catch(() => null) : null;
  if (!tok?.access_token) throw new Error("token");
  const userRes = await fetch(`${apiBase(env)}/user`, {
    headers: { Authorization: `Bearer ${tok.access_token}`, "User-Agent": "exam-hub", Accept: "application/vnd.github+json" },
  });
  const u = userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!Number.isSafeInteger(u?.id) || u.id <= 0 || typeof u.login !== "string") throw new Error("user");
  const str = (v, n) => (typeof v === "string" && v ? v.slice(0, n) : null);
  return { id: u.id, login: u.login.slice(0, 100), name: str(u.name, 200), avatar: str(u.avatar_url, 500) };
}

async function callback(req, env) {
  checkConfig(env);
  const q = new URL(req.url).searchParams;
  const st = await verifyState(env, q.get("state"));
  if (!st) {
    return new Response("Nieprawidłowe lub wygasłe logowanie. Wróć do aplikacji i spróbuj ponownie.", {
      status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const ret = st.ret;
  ret.hash = "";
  const fail = reason => redirect(`${ret.href}#auth-error=${reason}`);
  const ghError = q.get("error");
  if (ghError) return fail(/^[a-z_]{1,40}$/.test(ghError) ? ghError : "github");
  const code = q.get("code");
  if (!code || code.length > 200) return fail("no_code");

  try {
    const user = await githubUser(env, code, callbackUrl(req));
    const now = Date.now();
    const oneTime = randomToken();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, login, name, avatar, created, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar = excluded.avatar, last_seen = excluded.last_seen`
      ).bind(user.id, user.login, user.name, user.avatar, now),
      env.DB.prepare("INSERT INTO codes (code_hash, user_id, expires, challenge) VALUES (?, ?, ?, ?)")
        .bind(await sha256Hex(oneTime), user.id, now + CODE_TTL_MS, st.challenge),
    ]);
    return redirect(`${ret.href}#auth=${oneTime}`);
  } catch (e) {
    console.error(`login failed: ${e.message}`);
    return fail(["token", "user"].includes(e.message) ? e.message : "server");
  }
}

const publicUser = row => ({ id: row.id, login: row.login, name: row.name, avatar: row.avatar });

async function exchange(req, env) {
  checkConfig(env);
  const { code, verifier } = await readJson(req);
  if (typeof code !== "string" || !code || code.length > 200) throw new HttpError(400, "code missing");
  if (typeof verifier !== "string" || verifier.length < 32 || verifier.length > 200) throw new HttpError(400, "verifier missing");
  // Deleting first makes the code single-use even if two exchanges race.
  const row = await env.DB.prepare("DELETE FROM codes WHERE code_hash = ? RETURNING user_id, expires, challenge")
    .bind(await sha256Hex(code)).first();
  if (!row || row.expires < Date.now()) throw new HttpError(400, "invalid or expired code");
  if (!row.challenge || row.challenge !== await sha256Hex(verifier)) throw new HttpError(400, "invalid or expired code");
  const user = await env.DB.prepare("SELECT id, login, name, avatar FROM users WHERE id = ?").bind(row.user_id).first();
  if (!user) throw new HttpError(400, "invalid or expired code");
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created, last_used) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), user.id, now, now).run();
  return { ok: true, token, user: publicUser(user) };
}

// Resolves the Bearer token to { user, tokenHash } or throws 401 (429 past the per-user limit).
export async function authenticate(req, env) {
  if (!env.DB) throw new HttpError(503, "login not configured");
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.headers.get("Authorization") || "");
  if (!m) throw new HttpError(401, "unauthorized");
  const tokenHash = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    `SELECT s.created, s.last_used, u.id, u.login, u.name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  const now = Date.now();
  if (!row || now - row.last_used > SESSION_IDLE_MS || now - row.created > SESSION_MAX_MS)
    throw new HttpError(401, "unauthorized");
  await rateLimit(env.RL_API, `user:${row.id}`);
  if (now - row.last_used > TOUCH_GAP_MS) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET last_used = ? WHERE token_hash = ?").bind(now, tokenHash),
      env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now, row.id),
    ]);
  }
  return { user: publicUser(row), tokenHash };
}

async function me(req, env) {
  const { user } = await authenticate(req, env);
  return { ok: true, user };
}

// `?all=1` signs the user out on every device.
async function logout(req, env, all = new URL(req.url).searchParams.get("all") === "1") {
  const { user, tokenHash } = await authenticate(req, env);
  const stmt = all
    ? env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id)
    : env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash);
  const { meta } = await stmt.run();
  return { ok: true, sessions: meta?.changes ?? 0 };
}

const deleteUsersWhere = (env, where, ...args) =>
  ["data", "sessions", "codes"].map(t =>
    env.DB.prepare(`DELETE FROM ${t} WHERE user_id IN (SELECT id FROM users WHERE ${where})`).bind(...args)
  ).concat(env.DB.prepare(`DELETE FROM users WHERE ${where}`).bind(...args));

async function deleteAccount(req, env) {
  const { user } = await authenticate(req, env);
  await env.DB.batch(deleteUsersWhere(env, "id = ?", user.id));
  return { ok: true };
}

/* Called from the cron, skipped when D1 is not bound. Indexed DELETEs (migration 0003):
   expired codes and sessions, then accounts idle for 24 months with everything they own. */
export async function cleanupAuth(env, now = Date.now()) {
  if (!env.DB) return;
  try {
    const { meta } = (await env.DB.batch([
      env.DB.prepare("DELETE FROM codes WHERE expires < ?").bind(now),
      env.DB.prepare("DELETE FROM sessions WHERE last_used < ?").bind(now - SESSION_IDLE_MS),
      env.DB.prepare("DELETE FROM sessions WHERE created < ?").bind(now - SESSION_MAX_MS),
      ...deleteUsersWhere(env, "last_seen < ?", now - ACCOUNT_RETENTION_MS),
    ])).at(-1);
    if (meta?.changes) console.log(`deleted ${meta.changes} inactive account(s)`);
  } catch (e) {
    console.error(`auth cleanup failed: ${e.message}`);
  }
}

export const authRoutes = {
  "GET /auth/login": login,
  "GET /auth/callback": callback,
  "POST /auth/exchange": exchange,
  "POST /auth/logout": logout,
  "POST /auth/logout-all": (req, env) => logout(req, env, true),
  "GET /me": me,
  "DELETE /account": deleteAccount,
};
