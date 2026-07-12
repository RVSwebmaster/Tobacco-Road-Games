# Author Discussions

Author profile pages include public, shallow discussion threads backed by the existing `TRG_ORDERS` D1 database.

## Production setup

1. Apply `migrations/002_author_discussions.sql` to the D1 database bound as `TRG_ORDERS`.
2. Add these encrypted/runtime environment values in Cloudflare:
   - `RESEND_API_KEY`: transactional email API key.
   - `DISCUSSION_FROM_EMAIL`: verified sender, such as `Tobacco Road Games <discussion@tobaccoroadgames.com>`.
   - `DISCUSSION_AUTHOR_EMAIL_RV_SAWYER`: private address that receives new-message notices. `OWNER_ACCESS_EMAIL` is used as a fallback.
   - `DISCUSSION_AUTHOR_DISPLAY_NAME`: optional author name for official responses; defaults to `RV Sawyer`.
3. Protect `/owner/*` with the existing owner authentication configuration.

## Behavior

- Guest posts require a display name, valid email, message, and mandatory notification agreement.
- Guest posts remain private until the email verification link is used; links expire after 24 hours.
- Published participants receive new-reply notifications and can stop future notifications from the email link.
- Official responses are posted at `/owner/discussions.html` and carry an Author badge publicly.
- Five submissions per IP/email pair are allowed per hour.
- Pending messages expire after 24 hours.
- Threads are deleted after 30 days without a published comment. Cleanup runs whenever discussion traffic reaches the API.
- Email addresses are stored privately and never returned by the public API.
