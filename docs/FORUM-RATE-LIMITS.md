# Forum rate-limit configuration

Forum topic creation, replies, and reports require the encrypted runtime secret `FORUM_RATE_LIMIT_SECRET`.

The value must be an independently generated random secret of at least 32 characters. Install it as a Cloudflare Pages secret; never place the value in Wrangler configuration, source control, logs, screenshots, or ordinary documentation.

Staging installation:

```powershell
$secret | npx wrangler pages secret put FORUM_RATE_LIMIT_SECRET --project-name tobacco-road-games-staging
```

Production must use a separately generated value installed on the production Pages project. Different environment secrets intentionally produce different IP fingerprints.

IP addresses are never stored. The application creates a stable environment-local fingerprint using HMAC-SHA-256 over a versioned IP input. Missing or undersized configuration rejects protected forum writes with a safe service-unavailable response; it never falls back to unkeyed hashing.

Duplicate-content fingerprints remain one-way SHA-256 hashes of normalized content and never store submitted bodies. Rate-limit events expire through application cleanup after 25 hours.
