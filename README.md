# Morphly

Morphly is a prompt-driven photo editor. Users upload an image, describe the changes they want, and receive an AI-generated edit. Images are sent to Cloudflare Workers AI and are not stored by Morphly.

## Run locally

Requires Node.js 22.9 or newer.

1. Copy `.env.example` to `.env` and set:
   - `CLOUDFLARE_ACCOUNT_ID` from the Cloudflare dashboard URL or the Workers AI overview page.
   - `CLOUDFLARE_API_TOKEN` created from the **Workers AI** API token template.
2. Run `npm start`.
3. Open `http://localhost:3000`.

Each IP address is limited to three edits per 24-hour period. Local development uses an in-memory limit that resets when the server restarts.

Set `ACCESS_PASSWORD` in `.env` to exercise the password gate locally; without it the local server stays open and the sign-out button stays hidden.

## How an edit works

1. The browser downsizes the photo to a maximum of 1280 px and encodes it as JPEG. The 1280 px cap keeps the base64 request body under Vercel's 4.5 MB function limit; the client re-encodes at a lower size and quality if a photo still comes out too large. The server then scales it to at most 1024 px on the long edge, which is FLUX.2 [klein]'s largest accepted output size; requests above that are rejected upstream.
2. The server posts the image and your prompt as multipart form data to `@cf/black-forest-labs/flux-2-klein-9b`. The image travels in the `input_image_0` field, which is FLUX.2's reference-image slot; the numbered suffix supports additional references if multi-image editing is added later.
3. The model returns a base64 JPEG, which the server verifies and returns to the browser.

`CF_IMAGE_MODEL` overrides the model. `@cf/black-forest-labs/flux-2-klein-4b` is the cheaper, faster variant if you want to trade some quality for headroom.

## Public deployment

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as server-side environment variables. Never expose them in browser code. The server binds to `0.0.0.0` in production and uses the host-provided `PORT`. Set `TRUST_PROXY=true` only when the host supplies a trusted `X-Forwarded-For` header.

Set `ACCESS_PASSWORD` to password-protect the deployment. When it is set, every page and API route requires a signed session cookie issued by `/login`, and `/api/edit` re-checks the cookie itself. Leave it unset for an open deployment. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are optional and add a shared per-IP daily counter; without them the counter stays in memory and can reset between requests, which is fine for a single-user deployment where the Workers AI account quota is the real ceiling.

Workers AI bills FLUX.2 [klein] 9B at $0.015 for the first output megapixel and $0.002 per additional output megapixel plus $0.002 per input megapixel. The Workers AI free plan includes 10,000 neurons per day per account, which only covers a handful of edits, so the free tier will run out on a busy day; the app reports that plainly instead of failing silently. Keep the daily edit limit and usage monitoring enabled, and move to a Workers Paid plan before sharing widely.

### Publish with Vercel

Vercel serves `index.html`, `styles.css`, `app.js`, `login.html`, and `login.js` as static files, runs `api/edit.js` and `api/auth.js` as functions, and uses `middleware.js` to gate every route behind the password. `vercel.json` sets `cleanUrls` so `/login` maps to `login.html`, raises the edit function's maximum duration to 300 seconds, and adds the same security headers the local server sends.

1. Install the CLI and sign in: `npm i -g vercel`, then `vercel login`.
2. From this folder run `vercel`. Accept the detected settings: no build command, no output directory.
3. Add the environment variables for the Production and Preview environments, either in the dashboard under **Project Settings > Environment Variables** or one at a time with `vercel env add ACCESS_PASSWORD production`:
   - `ACCESS_PASSWORD` - the password that unlocks the site.
   - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
   - `CF_IMAGE_MODEL` - optional, defaults to `@cf/black-forest-labs/flux-2-klein-9b`.
   - `EDITS_PER_DAY` - optional, defaults to 3 per IP address.
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` - optional.
4. Run `vercel --prod` to deploy, or `vercel` for a preview URL.
5. Open the deployment URL. You are redirected to `/login`; after unlocking, the session lasts 30 days.

Vercel caps function request bodies at 4.5 MB and returns `413 FUNCTION_PAYLOAD_TOO_LARGE` above that, which is why the client caps photos at 1280 px. Hobby accounts may use their functions for personal, non-commercial projects, which covers this use. Treat the deployment URL as public: `ACCESS_PASSWORD` is the only thing standing between a stranger and your Cloudflare allowance.

Two Hobby-account defaults need correcting the first time, and both are one command:

- The CLI may detect this repo as a Vercel Service and write a `services` block into `vercel.json`. That routes every request to the Node server and skips `api/` and `middleware.js`. Delete the `services` and `rewrites` keys and run `vercel project update morphly --framework other`.
- Vercel Authentication protects every deployment except custom domains, so the production `*.vercel.app` URL asks for a Vercel login. Run `vercel project protection disable morphly --sso` to leave `ACCESS_PASSWORD` as the only gate. This also makes preview URLs public, which is why `ACCESS_PASSWORD` is set for both the Production and Preview environments.
