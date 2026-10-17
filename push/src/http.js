/* Shared HTTP helpers: CORS, JSON responses, errors, body parsing, hashing. */

export const ALLOWED_ORIGIN = "https://michal1803.github.io";
export const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_BODY = 4096;

export function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  if (origin !== ALLOWED_ORIGIN && !LOCAL_ORIGIN.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export const json = (req, status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders(req) } });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
