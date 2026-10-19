# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Security** tab using
"Report a vulnerability". Do not open a public issue for anything that could
expose API keys, session tokens, or user photos.

## Handling secrets

Morphly reads all credentials from environment variables on the server. The
repository never contains a real key. If you fork this project, keep
`CLOUDFLARE_API_TOKEN`, `ACCESS_PASSWORD`, `UPSTASH_REDIS_REST_TOKEN`, and the
session signing secret out of git and out of browser code.

If a key is ever committed by accident, revoke it in the Cloudflare dashboard
first, then remove it from history.