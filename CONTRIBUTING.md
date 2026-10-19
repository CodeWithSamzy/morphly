# Contributing

Thanks for taking a look at Morphly. Issues and pull requests are welcome.

## Run it locally

1. Install Node.js 22.9 or newer.
2. Copy `.env.example` to `.env`.
3. Add `CLOUDFLARE_ACCOUNT_ID` and a Workers AI `CLOUDFLARE_API_TOKEN`.
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000`.

`ACCESS_PASSWORD`, `EDITS_PER_DAY`, and `CF_IMAGE_MODEL` are optional. See the
README for what each one does.

## Before you open a pull request

- Keep the change focused. One fix or feature per pull request.
- Run `npm start` and confirm an edit still works end to end.
- Never commit `.env`, `.env.local`, API keys, account IDs, or any file under
  `node_modules/` or `.vercel/`. The repository ships `.env.example`, which must
  stay empty.
- Match the existing style: plain ES modules, no build step, no framework.

## Reporting a problem

Open an issue with the photo size, the prompt you used, and the exact error
message. Do not paste API keys or personal photos.