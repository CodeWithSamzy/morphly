import { next } from "@vercel/functions";

const SESSION_COOKIE = "morphly_session";

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(expiresAt, password) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`morphly:${expiresAt}`));
  return base64Url(new Uint8Array(digest));
}

function readSessionCookie(header) {
  if (typeof header !== "string" || header.length === 0) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) return part.slice(separator + 1).trim();
  }
  return "";
}

async function sessionIsValid(token, password) {
  if (typeof token !== "string" || token.length === 0) return false;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const provided = token.slice(separator + 1);
  const expected = await signature(expiresAt, password);
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

export default async function middleware(request) {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return next();

  const url = new URL(request.url);
  if (await sessionIsValid(readSessionCookie(request.headers.get("cookie")), password)) return next();

  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const target = `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
  return new Response(null, { status: 307, headers: { Location: target } });
}

export const config = {
  matcher: ["/((?!login|api/auth|_vercel).*)"],
};
