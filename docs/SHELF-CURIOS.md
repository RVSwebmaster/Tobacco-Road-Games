# Shared Shelf Curios

Movable curios use the existing Pages Functions and `TRG_ORDERS` D1 binding. Apply `migrations/048_shelf_curios.sql` to the verified staging database before deploying. Do not apply it to production without RV's approval. Migration reapplication does not overwrite saved arrangements.

`GET /api/curios` publicly reads current positions and issues same-origin CSRF and anonymous visitor cookies. `POST /api/curios` places a known movable curio using its current revision and normalized coordinates. No login is required. A valid account session attributes the move to that account; otherwise it is recorded as anonymous browser activity. Anonymous browser identifiers are not proof of a person's identity.

Only completed placements are saved. `x` is normalized across usable shelf width; `y` is normalized across the existing 24px shelf deck. Original Harimafuji placement is `(0.5, 0.5)`. Size, shelf geometry, lighting and surrounding fixtures are unchanged. Out-of-bounds or unknown-curio requests are rejected. Concurrent edits return 409 with current state. Public state is never cached. Visible pages refresh every 20 seconds, and on returning to the page.

The existing forum rate-limit secret (or existing owner CSRF/session secret) hashes anonymous network addresses for a 30-moves-per-minute limit. Raw network addresses are not stored. Account and anonymous activity remain private to RV. No new environment secret is required where those existing controls are configured.

RV's `/owner/curios.html` page shows current arrangement, move counts, and the latest 100 events. `/owner/api/curios` independently verifies owner authorization for reads and owner CSRF for resets. Reset restores code-defined defaults, records an event, and advances revisions to invalidate unfinished moves. There is no automatic reset or expiration of saved arrangements.

## Fixed Clickable Curios

Fixed curios have no database record, saved timer, or API mutation. Use `data-curio-behavior="fixed"` and an explicit effect. The implemented `data-curio-effect="tardis"` hook requires a `data-curio-light` element positioned over the real asset's top lamp, and an accessible button or button role. A TARDIS asset has not yet been supplied or placed on the storefront.

The local TARDIS effect flashes the blue lamp for five seconds, fades out over one second, stays absent for two minutes measured from completed disappearance, then fades in and reverses the lamp effect. Repeated clicks during the sequence are ignored. Reduced-motion visitors get steady light and immediate fades. Returning from a suspended/background tab checks elapsed wall-clock time. Reloading starts with the fixed curio visible again. No third-party animation library is needed.

## Verification

Run `node scripts/test-shelf-curios.js` and the existing storefront design, theme, and visual tests. Browser verification must cover independent visitors, reload, shelf bounds, keyboard and touch, cancellation, stale revisions, failures, owner-only reset, unchanged desktop/mobile geometry, and the fixed effect's timing with no network writes. Verify the actual staging binding and public deployment before describing the feature as live.
