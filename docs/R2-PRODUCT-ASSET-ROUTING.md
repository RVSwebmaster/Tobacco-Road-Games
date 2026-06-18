# R2 Product Asset Routing

This site can serve public store display images from Cloudflare R2 through a Pages Function without copying every product image into the repo.

## Manual Cloudflare binding required

As of June 17, 2026, this repo does not contain a Wrangler config or any committed R2 binding declaration. The Pages project needs a dashboard binding:

- Pages project: the Tobacco Road Games site project
- Binding variable name: `TRG_PRODUCTS`
- Bucket name: `trg-products`

Cloudflare Pages requires a redeploy after adding the binding in the dashboard.

Dashboard path:

1. Go to `Workers & Pages`
2. Open the Tobacco Road Games Pages project
3. Open `Settings > Bindings`
4. Add an `R2 bucket` binding
5. Set variable name to `TRG_PRODUCTS`
6. Select bucket `trg-products`
7. Redeploy the project

Reference:

- Cloudflare Pages bindings docs: <https://developers.cloudflare.com/pages/functions/bindings/>
- Cloudflare Pages routing docs: <https://developers.cloudflare.com/pages/functions/routing/>

## Public route shape

The Pages Function lives at:

- `functions/assets/products/[slug]/[asset].js`

It serves only these public display assets:

- `/assets/products/<slug>/cover.webp`
- `/assets/products/<slug>/preview.webp`

The function first calls `context.next()` so any repo-hosted asset already present at that path still wins. If the static asset is missing, it falls back to the bound R2 bucket.

## Slug to R2 folder mapping

Public store slugs map to exact R2 object key prefixes:

- `tablecraft-primer` -> `trg-products/Tablecraft Primer`
- `circle-of-cinder` -> `trg-products/circleofcinder`
- `final-flame` -> `trg-products/finalflame`
- `mouthy-monsters` -> `trg-products/mouthy-monsters`
- `path-of-the-janky` -> `trg-products/path of the janky`
- `ringbound` -> `trg-products/ringbound`
- `sirrocans` -> `trg-products/sirrocans`
- `spriggans` -> `trg-products/spriggans`
- `yojimbo` -> `trg-products/yojimbo`

That preserves existing object keys, including the `trg-products/` prefix, spaces, and mixed casing, without renaming R2 folders.

## Scope guardrails

This route intentionally does not expose paid or unpublished product PDFs. Only `cover.webp` and `preview.webp` are eligible for public serving in this pass.
