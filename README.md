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

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for how to run the project locally and what to check before opening a pull
request.

## License

Released under the MIT License. See [LICENSE](LICENSE).