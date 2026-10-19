import { sessionIsValid, readCookie, SESSION_COOKIE } from "../lib/auth.mjs";
import { handleEdit } from "../lib/edit-core.mjs";

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0 && forwarded.length < 512) return forwarded.split(",")[0].trim();
  return request.socket?.remoteAddress || "unknown";
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Use POST to create an edit." });
    return;
  }

  const password = process.env.ACCESS_PASSWORD;
  if (password && !sessionIsValid(readCookie(request.headers.cookie, SESSION_COOKIE), password)) {
    response.status(401).json({ error: "Sign in to continue." });
    return;
  }

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  const { status, body: payload } = await handleEdit({ body, clientIp: clientIp(request) });
  response.status(status).json(payload);
}
