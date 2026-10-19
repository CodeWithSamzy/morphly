import { createHash } from "node:crypto";

export const maximumRequestBytes = 7 * 1024 * 1024;

const maximumImageBytes = 5 * 1024 * 1024;
const usageWindowSeconds = 24 * 60 * 60;
const defaultModel = "@cf/black-forest-labs/flux-2-klein-9b";
const editTimeoutMs = 180000;
const minimumDimension = 256;
const maximumDimension = 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const localUsage = new Map();
let warnedAboutMemoryQuota = false;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function editsPerDay() {
  const configured = Number(process.env.EDITS_PER_DAY);
  return Number.isInteger(configured) && configured > 0 ? configured : 3;
}

export async function readJsonBody(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximumRequestBytes) throw new HttpError(413, "Image is too large. Try a smaller photo.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request could not be read.");
  }
}

function usageKey(clientIp) {
  const day = new Date().toISOString().slice(0, 10);
  return `morphly:${createHash("sha256").update(`${day}:${clientIp}`).digest("hex")}`;
}

async function consumeEditQuota(clientIp) {
  const limit = editsPerDay();
  const key = usageKey(clientIp);
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    const script = "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";
    const redisResponse = await fetch(redisUrl.replace(/\/$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", script, 1, key, usageWindowSeconds]),
      signal: AbortSignal.timeout(5000),
    });
    if (!redisResponse.ok) throw new HttpError(503, "The free-use limit service is unavailable. Try again later.");
    const result = await redisResponse.json();
    if (typeof result.result !== "number") throw new HttpError(503, "The free-use limit service is unavailable. Try again later.");
    return { allowed: result.result <= limit, limit };
  }

  if (!warnedAboutMemoryQuota) {
    warnedAboutMemoryQuota = true;
    console.warn("[morphly] UPSTASH_REDIS_REST_URL is not set, so the daily edit counter is kept in memory and can reset between requests.");
  }
  const now = Date.now();
  const existing = localUsage.get(key);
  const count = existing && now - existing.startedAt < usageWindowSeconds * 1000 ? existing.count + 1 : 1;
  localUsage.set(key, { startedAt: existing?.startedAt || now, count });
  return { allowed: count <= limit, limit };
}

async function releaseEditQuota(clientIp) {
  const key = usageKey(clientIp);
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    await fetch(redisUrl.replace(/\/$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(["DECR", key]),
      signal: AbortSignal.timeout(5000),
    });
    return;
  }
  const existing = localUsage.get(key);
  if (existing && existing.count > 0) localUsage.set(key, { startedAt: existing.startedAt, count: existing.count - 1 });
}

function hasExpectedImageHeader(bytes, mimeType) {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(pngSignature);
  if (mimeType === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function detectImageMimeType(bytes) {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(pngSignature)) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function imageDimensions(bytes, mimeType) {
  try {
    if (mimeType === "image/png" && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 <= bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {}
  return null;
}

function snappedDimensions(bytes, mimeType) {
  const size = imageDimensions(bytes, mimeType);
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return null;
  const longest = Math.max(size.width, size.height);
  const scale = longest > maximumDimension ? maximumDimension / longest : 1;
  const snap = (value) => Math.max(minimumDimension, Math.min(maximumDimension, Math.round((value * scale) / 32) * 32));
  return { width: snap(size.width), height: snap(size.height) };
}

function cloudflareFailure(status, payload) {
  const detail = Array.isArray(payload?.errors) ? String(payload.errors[0]?.message || "") : "";
  if (status === 429 && /neuron|free allocation/i.test(detail)) return [503, "Today's free image capacity has been used up. Please try again tomorrow."];
  if (status === 429) return [429, "The image service is busy right now. Please try again in a moment."];
  if (status === 401 || status === 403) return [503, "The Cloudflare API token is invalid or lacks Workers AI access."];
  if (status === 400 || status === 422) return [422, "The image model rejected this photo or prompt. Try a different photo or clearer instructions."];
  if (status >= 500) return [503, "The image service is unavailable right now. Please try again shortly."];
  return [502, "The image provider returned an unexpected response. Please try again."];
}

async function runCloudflareEdit({ model, accountId, token, prompt, imageBytes, mimeType, dimensions }) {
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("input_image_0", new Blob([imageBytes], { type: mimeType }), `photo.${extension}`);
  if (dimensions) {
    form.append("width", String(dimensions.width));
    form.append("height", String(dimensions.height));
  }
  let upstream = null;
  for (let attempt = 0; attempt < 3 && !upstream; attempt += 1) {
    try {
      upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(editTimeoutMs),
      });
    } catch (error) {
      if (error.name === "TimeoutError" || attempt === 2) throw new HttpError(503, "Could not reach the image service. Please try again.");
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  const raw = Buffer.from(await upstream.arrayBuffer());
  let payload = null;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { payload = null; }
  return { ok: upstream.ok, status: upstream.status, payload };
}

export async function handleEdit({ body, clientIp }) {
  let quotaConsumed = false;
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) throw new HttpError(503, "Cloudflare image editing is not configured yet.");
    if (!body || typeof body !== "object") throw new HttpError(400, "The request could not be read.");

    const instruction = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const mimeType = body.mimeType;
    const imageData = body.imageData;
    if (body.consent !== true) throw new HttpError(400, "Confirm that you have permission to edit and process this photo.");
    if (!instruction || instruction.length > 1000) throw new HttpError(400, "Describe the edit in 1 to 1,000 characters.");
    if (!allowedMimeTypes.has(mimeType) || typeof imageData !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
      throw new HttpError(400, "Choose a valid JPG, PNG, or WebP photo.");
    }
    const imageBytes = Buffer.from(imageData, "base64");
    if (imageBytes.length > maximumImageBytes || !hasExpectedImageHeader(imageBytes, mimeType)) {
      throw new HttpError(400, "The photo is too large or could not be verified.");
    }

    const model = process.env.CF_IMAGE_MODEL || defaultModel;
    if (!/^@?[A-Za-z0-9._/-]+$/.test(model) || model.includes("..")) throw new HttpError(500, "The Cloudflare image model configuration is invalid.");

    const quota = await consumeEditQuota(clientIp);
    if (!quota.allowed) throw new HttpError(429, `You have reached today's limit of ${quota.limit} edits. Please try again tomorrow.`);
    quotaConsumed = true;

    const prompt = `Edit this photo by applying the requested change exactly. Keep the person's identity, face, hairstyle, and body unchanged unless the change explicitly asks for it. Requested change: ${instruction}`;
    const dimensions = snappedDimensions(imageBytes, mimeType);

    let outcome = await runCloudflareEdit({ model, accountId, token, prompt, imageBytes, mimeType, dimensions });
    if (!outcome.ok && dimensions && (outcome.status === 400 || outcome.status === 422 || outcome.status >= 500)) {
      outcome = await runCloudflareEdit({ model, accountId, token, prompt, imageBytes, mimeType, dimensions: null });
    }
    if (!outcome.ok) {
      const [status, message] = cloudflareFailure(outcome.status, outcome.payload);
      throw new HttpError(status, message);
    }
    const encoded = outcome.payload?.result?.image;
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new HttpError(502, "The image provider returned an invalid response. Please try again.");
    }
    const resultBytes = Buffer.from(encoded, "base64");
    const resultMimeType = detectImageMimeType(resultBytes);
    if (!resultMimeType || resultBytes.length > maximumImageBytes || !hasExpectedImageHeader(resultBytes, resultMimeType)) {
      throw new HttpError(502, "The image provider returned an invalid image. Please try again.");
    }
    quotaConsumed = false;
    return { status: 200, body: { imageData: resultBytes.toString("base64"), mimeType: resultMimeType } };
  } catch (error) {
    if (quotaConsumed) await releaseEditQuota(clientIp).catch(() => {});
    const status = error.status || 500;
    return { status, body: { error: error.status ? error.message : "Something went wrong. Please try again." } };
  }
}
