# TRG Office Archive — staging runbook

This runbook applies only to the `tobacco-road-games-staging` Pages project.
It must not be used against production, `TRG_ORDERS`, `TRG_PRODUCTS`, or the
`trg-products` bucket.

The upload architecture is defined by
`docs/AD-0001-OFFICE-UPLOAD-PIPELINE.md`. Uploads pass through the authenticated
Office Worker and its private R2 binding. Office does not use S3 credentials,
presigned URLs, a public bucket URL, or browser-to-R2 CORS.

## Local verification

```powershell
npm run test:office
npm test
npx wrangler pages functions build --outdir .wrangler\office-build-check
```

No global package installation is required.

## Resource creation (requires owner approval)

```powershell
npx wrangler d1 create trg-office-staging
npx wrangler r2 bucket create trg-office-archive-staging
```

Copy the returned D1 database ID into both staging Wrangler files, replacing:

`REPLACE_WITH_TRG_OFFICE_STAGING_DATABASE_ID`

Apply the isolated Office migration:

```powershell
npx wrangler d1 migrations apply trg-office-staging --remote --config ops/staging/wrangler.toml
```

Configure the immutable final-version lock:

```powershell
npx wrangler r2 bucket lock set trg-office-archive-staging --file ops/staging/office-r2-lock.json
npx wrangler r2 bucket lock list trg-office-archive-staging
```

The lock applies only to `versions/`. Do not lock `pending/`. Do not configure a
public development URL, custom domain, lifecycle deletion, or browser CORS for
the bucket.

## Cloudflare Access

Create a self-hosted Access application for:

`office-staging.tobaccoroadgames.com/office/*`

Use an Allow policy containing only the owner's exact identity. Record the
Application Audience tag. The Worker validates the Access assertion again and
fails closed when any Access setting is missing.

## Staging variables and secrets

Plain staging variables:

- `OFFICE_ACCESS_TEAM_DOMAIN`
- `OFFICE_ACCESS_AUD`
- `OFFICE_ACCESS_EMAIL`
- `OFFICE_UPLOAD_RESERVATION_TTL_SECONDS=600`
- `OFFICE_MAX_FILE_BYTES=94371840`
- `OFFICE_MAX_BATCH_FILES=50`
- `OFFICE_MAX_BATCH_BYTES=1073741824`

Encrypted staging secret:

- `OFFICE_CSRF_SECRET`

There are no Office R2 S3 access keys. `TRG_OFFICE_ARCHIVE` is a Cloudflare
binding available only to the deployed Office Worker.

## Staging deployment gate

Before running `ops/staging/deploy.ps1`, verify:

1. The Office D1 ID is present in both staging configs.
2. The D1 migration succeeded remotely.
3. The R2 bucket has no public URL or custom domain.
4. The indefinite `versions/` lock is enabled and `pending/` remains unlocked.
5. The Access application and owner-only policy are active.
6. All Office variables and the CSRF secret exist in staging.
7. `npm test` and the Pages Functions build pass.

The isolated `tobacco-road-games-staging` Pages project is deployed as its
Production environment because the project itself is staging. This does not
deploy or modify the production Tobacco Road Games Pages project.

## Smoke test

After an approved staging deployment:

1. Verify `/office/` redirects through Access when signed out.
2. Verify a non-owner Access identity is denied.
3. Create a project and nested folder.
4. Batch-upload two files through the Worker.
5. Verify their SHA-256 values in version details.
6. Upload a second version and download both versions.
7. Attempt an overwrite of the final version key and confirm failure.
8. Restore version 1 and confirm version 2 remains downloadable.
9. Move a file, folder, and project to trash and recover each.
10. Confirm no object is reachable through public store or product routes.
11. Confirm upload, download, rejection, restore, and recovery audit records.
