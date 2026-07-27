# TRG Office Archive — staging runbook

This runbook applies only to the `tobacco-road-games-staging` Pages project.
It must not be used against the production Pages project, `TRG_ORDERS`,
`TRG_PRODUCTS`, or the `trg-products` bucket.

## Local verification

From the canonical repository:

```powershell
npm run test:office
npm test
npx wrangler pages functions build --outdir .wrangler\office-build-check
```

No global package installation is required.

## Provisioning blocker: deletion authority

Cloudflare R2's long-lived S3 permission for uploads is `Object Read & Write`.
Cloudflare documents that its write operation set includes `PutObject`,
`DeleteObject`, `DeleteObjects`, and `CopyObject`. R2 does not currently offer a
long-lived PutObject-only S3 credential.

The application has no delete route and never calls the R2 `delete()` binding.
An indefinite bucket lock is supplied for `versions/`, which makes published
versions non-overwritable and non-deletable even by a read/write credential.
However, the presigning credential still has nominal DeleteObject permission
on the staging bucket, including the unlocked `pending/` prefix.

Do not create the R2 S3 credential until the owner explicitly accepts one of:

1. A bucket-scoped Object Read & Write credential, with the `versions/`
   indefinite lock as the enforcement boundary and no credential exposed to
   agents.
2. A change to the direct-presigned-upload requirement or storage design.

## Resource creation (requires owner approval)

These commands create staging resources only:

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

Configure browser PUT CORS and immutable version retention:

```powershell
npx wrangler r2 bucket cors set trg-office-archive-staging --file ops/staging/office-r2-cors.json
npx wrangler r2 bucket lock set trg-office-archive-staging --file ops/staging/office-r2-lock.json
```

Confirm the lock before the first upload:

```powershell
npx wrangler r2 bucket lock list trg-office-archive-staging
```

Do not configure a public development URL or custom domain for this bucket.

## Cloudflare Access

Create a self-hosted Access application for:

`tobacco-road-games-staging.pages.dev/office/*`

Use an Allow policy containing only the owner's exact identity. Record its
Application Audience tag. The Office Worker validates the assertion again and
fails closed when any Access setting is missing.

## Staging variables and secrets

Plain staging variables:

- `OFFICE_ACCESS_TEAM_DOMAIN`
- `OFFICE_ACCESS_AUD`
- `OFFICE_ACCESS_EMAIL`
- `OFFICE_R2_ACCOUNT_ID`
- `OFFICE_R2_BUCKET_NAME=trg-office-archive-staging`
- `OFFICE_UPLOAD_URL_TTL_SECONDS=600`
- `OFFICE_MAX_FILE_BYTES=536870912`
- `OFFICE_MAX_BATCH_FILES=50`
- `OFFICE_MAX_BATCH_BYTES=1073741824`

Encrypted staging secrets:

- `OFFICE_CSRF_SECRET`
- `OFFICE_R2_ACCESS_KEY_ID`
- `OFFICE_R2_SECRET_ACCESS_KEY`

The R2 credential must be scoped to `trg-office-archive-staging` only. It must
not have bucket-administration permissions or access to any other bucket.

## Staging deployment gate

Before running `ops/staging/deploy.ps1`, verify:

1. The Office D1 ID is present in both staging configs.
2. The D1 migration succeeded remotely.
3. R2 CORS contains only the staging Pages origin.
4. The indefinite `versions/` lock is enabled.
5. The Access application and owner-only policy are active.
6. All Office variables and secrets exist in staging.
7. `npm test` and the Pages Functions build pass.

Production deployment is explicitly outside this phase.

## Smoke test

After an approved staging deployment:

1. Verify `/office/` redirects through Access when signed out.
2. Verify a non-owner Access identity is denied.
3. Create a project and nested folder.
4. Batch-upload two files and verify their SHA-256 values in version details.
5. Upload a second version and download both versions.
6. Restore version 1 and confirm version 2 remains downloadable.
7. Move a file, folder, and project to trash and recover each.
8. Confirm no object is reachable through public store or product routes.
9. Confirm mutation, download, rejection, restore, and recovery audit records.

