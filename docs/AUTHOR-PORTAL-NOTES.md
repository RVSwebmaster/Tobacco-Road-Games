# Author Portal Notes

This site is still a static public storefront and author presence layer. The future author portal should be a separate workflow, not a fake front end for systems that do not exist yet.

## Future needs

- Author login
- Product intake form
- Upload to an intake or staging bucket path
- Admin review workflow
- Promotion of approved files to live product storage
- Author sale requests
- Author blog posting
- Royalty and payout ledger later

## Recommended storage shape

```text
intake/authors/{authorSlug}/products/{productSlug}/submission-{submissionId}/
live/products/{productSlug}/v{version}/
archive/products/{productSlug}/v{version}/
```

## Important rule

Authors should never touch the bucket directly. The intake processor handles bucket writes.
