import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "morphly_session";
export const sessionTtlSeconds = 30 * 24 * 60 * 60;

function signature(expiresAt, password) {
  return createHmac("sha256", password).update(`morphly:${expiresAt}`).digest("base64url");
}

export function createSessionToken(password, ttlSeconds = sessionTtlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return `${expiresAt}.${signature(expiresAt, password)}`;
}

export function sessionIsValid(token, password) {
  if (!password) return true;
  if (typeof token !== "string" || token.length === 0) return false;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = Buffer.from(signature(expiresAt, password));
  const provided = Buffer.from(token.slice(separator + 1));
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function matchesPassword(provided, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  const given = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function sessionCookie(token, { secure = true, maxAge = sessionTtlSeconds } = {}) {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie({ secure = true } = {}) {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header, name) {
  if (typeof header !== "string" || header.length === 0) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}
