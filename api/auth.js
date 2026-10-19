import { clearedCookie, createSessionToken, matchesPassword, sessionCookie } from "../lib/auth.mjs";

const attemptWindowMs = 15 * 60 * 1000;
const maximumAttempts = 8;
const attempts = new Map();

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0 && forwarded.length < 512) return forwarded.split(",")[0].trim();
  return request.socket?.remoteAddress || "unknown";
}

function hasExhaustedAttempts(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.startedAt > attemptWindowMs) {
    attempts.set(ip, { startedAt: now, count: 0 });
    return false;
  }
  return record.count >= maximumAttempts;
}

function recordFailedAttempt(ip) {
  const record = attempts.get(ip);
  if (record) record.count += 1;
}

export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const password = process.env.ACCESS_PASSWORD;

  if (request.method === "GET") {
    response.status(200).json({ authEnabled: Boolean(password) });
    return;
  }

  if (request.method === "DELETE") {
    response.setHeader("Set-Cookie", clearedCookie());
    response.status(200).json({ ok: true });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!password) {
    response.status(200).json({ ok: true });
    return;
  }

  const ip = clientIp(request);
  if (hasExhaustedAttempts(ip)) {
    response.status(429).json({ error: "Too many attempts. Wait a few minutes and try again." });
    return;
  }

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const provided = body && typeof body === "object" ? body.password : "";

  if (!matchesPassword(provided, password)) {
    recordFailedAttempt(ip);
    response.status(401).json({ error: "That password is not correct." });
    return;
  }

  attempts.delete(ip);
  response.setHeader("Set-Cookie", sessionCookie(createSessionToken(password)));
  response.status(200).json({ ok: true });
}
