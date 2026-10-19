import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";

import { HttpError, handleEdit, readJsonBody } from "./lib/edit-core.mjs";
import { clearedCookie, createSessionToken, matchesPassword, readCookie, SESSION_COOKIE, sessionCookie, sessionIsValid } from "./lib/auth.mjs";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const accessPassword = process.env.ACCESS_PASSWORD || "";
const secureCookies = process.env.NODE_ENV === "production";
const attemptWindowMs = 15 * 60 * 1000;
const maximumAttempts = 8;
const loginAttempts = new Map();
const loginAssets = new Set(["/login", "/login.html", "/login.js"]);
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/login", "login.html"],
  ["/login.html", "login.html"],
  ["/login.js", "login.js"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}

function sendJson(response, status, body) {
  setSecurityHeaders(response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function requestIp(request) {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length < 512) return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "unknown";
}

function isAuthenticated(request) {
  if (!accessPassword) return true;
  return sessionIsValid(readCookie(request.headers.cookie, SESSION_COOKIE), accessPassword);
}

function hasExhaustedAttempts(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.startedAt > attemptWindowMs) {
    loginAttempts.set(ip, { startedAt: now, count: 0 });
    return false;
  }
  return record.count >= maximumAttempts;
}

function recordFailedAttempt(ip) {
  const record = loginAttempts.get(ip);
  if (record) record.count += 1;
}

async function handleAuth(request, response) {
  if (request.method === "GET") return sendJson(response, 200, { authEnabled: Boolean(accessPassword) });
  if (request.method === "DELETE") {
    setSecurityHeaders(response);
    response.setHeader("Set-Cookie", clearedCookie({ secure: secureCookies }));
    return sendJson(response, 200, { ok: true });
  }
  if (request.method !== "POST") {
    setSecurityHeaders(response);
    response.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  if (!accessPassword) return sendJson(response, 200, { ok: true });

  const ip = requestIp(request);
  if (hasExhaustedAttempts(ip)) return sendJson(response, 429, { error: "Too many attempts. Wait a few minutes and try again." });

  let body = null;
  try {
    body = await readJsonBody(request);
  } catch {
    body = null;
  }
  if (!matchesPassword(body?.password, accessPassword)) {
    recordFailedAttempt(ip);
    return sendJson(response, 401, { error: "That password is not correct." });
  }

  loginAttempts.delete(ip);
  setSecurityHeaders(response);
  response.setHeader("Set-Cookie", sessionCookie(createSessionToken(accessPassword), { secure: secureCookies }));
  return sendJson(response, 200, { ok: true });
}

async function editImage(request, response) {
  try {
    const body = await readJsonBody(request);
    const { status, body: payload } = await handleEdit({ body, clientIp: requestIp(request) });
    return sendJson(response, status, payload);
  } catch (error) {
    return sendJson(response, error.status || 500, { error: error.status ? error.message : "Something went wrong. Please try again." });
  }
}

async function serveFile(request, response, filename) {
  const filePath = resolve(rootDirectory, filename);
  if (!filePath.startsWith(`${rootDirectory}${sep}`)) return sendJson(response, 404, { error: "Not found." });
  try {
    const file = await readFile(filePath);
    setSecurityHeaders(response);
    response.writeHead(200, { "Content-Type": contentTypes[filePath.slice(filePath.lastIndexOf("."))] || "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : file);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");

  if (requestUrl.pathname === "/api/auth") return handleAuth(request, response);

  if (requestUrl.pathname === "/api/edit") {
    if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST to create an edit." });
    if (!isAuthenticated(request)) return sendJson(response, 401, { error: "Sign in to continue." });
    return editImage(request, response);
  }

  if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });

  const filename = publicFiles.get(requestUrl.pathname);
  if (!filename) return sendJson(response, 404, { error: "Not found." });

  if (accessPassword && !loginAssets.has(requestUrl.pathname) && !isAuthenticated(request)) {
    setSecurityHeaders(response);
    response.writeHead(302, { Location: "/login" });
    return response.end();
  }

  return serveFile(request, response, filename);
});

server.listen(port, host, () => {
  console.log(`Morphly is running at http://${host}:${port}`);
});
