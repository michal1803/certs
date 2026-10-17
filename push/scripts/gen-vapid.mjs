/* Generates a VAPID key pair (P-256). Prints to stdout only; nothing is written to disk.
   Public key: base64url uncompressed point (65 bytes) -> VAPID_PUBLIC_KEY in wrangler.toml.
   Private key: base64url raw 32-byte scalar "d" -> `npx wrangler secret put VAPID_PRIVATE_KEY`. */
const { subtle } = globalThis.crypto;

const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(await subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const { d } = await subtle.exportKey("jwk", pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
