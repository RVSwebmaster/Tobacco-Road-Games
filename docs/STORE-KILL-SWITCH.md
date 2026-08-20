# Store kill switch

The live store state is stored in the existing Cloudflare D1 database bound to the Pages project as `TRG_ORDERS`. Migration `015_store_state.sql` creates the `runtime_settings` table and seeds `store_state` to `CLOSED`, so applying the migration cannot accidentally open purchasing.

Valid values are `OPEN`, `CLOSED`, and `MAINTENANCE`.

## Normal owner control

Open `/owner/store-status.html`, sign in through the existing protected owner route, and choose **Open Store**, **Close Store**, or **Maintenance Mode**. The change is written directly to D1 and takes effect without a site rebuild or deployment.

`CLOSED` leaves catalog pages visible but removes purchase controls and blocks Stripe Checkout server-side. `MAINTENANCE` replaces public `/store/` pages with the maintenance display and also blocks checkout. Existing checkout return pages, order access, downloads, webhooks, orders, and customer records continue to work.

## Emergency command-line fallback

From the canonical production workspace, first apply migrations if migration 015 has not been applied:

```powershell
npx wrangler d1 migrations apply trg-orders --remote
```

Then set the desired state directly (replace `CLOSED` with `OPEN` or `MAINTENANCE` as needed):

```powershell
npx wrangler d1 execute trg-orders --remote --command "INSERT INTO runtime_settings (setting_key, setting_value, updated_at, updated_by) VALUES ('store_state', 'CLOSED', datetime('now'), 'wrangler-emergency') ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;"
```

Verify it:

```powershell
npx wrangler d1 execute trg-orders --remote --command "SELECT setting_value, updated_at, updated_by FROM runtime_settings WHERE setting_key = 'store_state';"
```

If D1 is unavailable, the binding is missing, the row is missing, or the value is invalid, checkout refuses purchases. The public state endpoint also reports `CLOSED`; it never assumes the store is open.
