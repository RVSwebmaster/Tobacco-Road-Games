# Forum Avatar Staging Storage

The Tobacco Road Games staging Pages project uses a dedicated private Cloudflare R2 bucket for future forum avatars.

- Pages project: `tobacco-road-games-staging`
- R2 bucket: `trg-forum-avatars-staging`
- Pages Functions binding: `TRG_FORUM_AVATARS`
- Runtime access: `env.TRG_FORUM_AVATARS`

The bucket must remain private. Do not enable an R2 public development URL or custom public domain. Future avatar delivery must pass through Tobacco Road Games application routes.

This bucket is separate from `TRG_PRODUCTS` and `TRG_OFFICE_ARCHIVE`. Forum avatar code must never read, write, move, or delete product-download or Office-archive objects. Future avatar objects should use the dedicated `forum-avatars/` prefix inside this bucket.

Both `ops/staging/wrangler.pages.toml` and `ops/staging/wrangler.toml` declare the staging binding. No production avatar bucket or binding exists yet.

## Verification

Infrastructure verification should confirm that the bucket exists, the staging Pages project receives `TRG_FORUM_AVATARS`, and a temporary object can be written, read byte-for-byte, and deleted. The verification object must be removed immediately afterward. Never print Cloudflare credentials or secret values.
