// beyondGREEN Broker Portal — auth token helpers (HMAC-signed cookie)
// Works in both Node (route handlers) and Edge (middleware) via Web Crypto.

const COOKIE_NAME = "bg_broker_session";
const TTL_MS = 1000 * 60 * 60 * 12; // 12-hour session

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}

export const SESSION_COOKIE = COOKIE_NAME;

/** Create a signed session token valid for TTL. */
export async function createToken(secret: string, user = "broker"): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: user, exp: Date.now() + TTL_MS })));
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

/** Verify a session token's signature and expiry. */
export async function verifyToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await hmac(payload, secret);
  if (sig !== expected) return false;
  try {
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    return typeof json.exp === "number" && json.exp > Date.now();
  } catch {
    return false;
  }
}
