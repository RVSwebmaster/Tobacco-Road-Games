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

- `functions/product-assets/[slug]/[asset].js`

It serves only these public display assets:

- `/product-assets/<slug>/cover.webp`
- `/product-assets/<slug>/preview.webp`

The function first calls `context.next()` so any repo-hosted asset already present at that path still wins. If the static asset is missing, it falls back to the bound R2 bucket.

## Slug to R2 folder mapping

Public store slugs map to exact object keys inside the `trg-products` bucket:

- `tablecraft-primer` -> `Tablecraft Primer`
- `circle-of-cinder` -> `circleofcinder`
- `final-flame` -> `finalflame`
- `mouthy-monsters` -> `mouthy-monsters`
- `path-of-the-janky` -> `path of the janky`
- `ringbound` -> `ringbound`
- `sirrocans` -> `sirrocans`
- `spriggans` -> `spriggans`
- `yojimbo` -> `yojimbo`

That preserves the current object keys inside the bucket root, including spaces and mixed casing, without renaming R2 folders.

## Scope guardrails

This route intentionally does not expose paid or unpublished product PDFs. Only `cover.webp` and `preview.webp` are eligible for public serving in this pass.
