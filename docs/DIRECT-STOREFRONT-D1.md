# Direct Storefront D1 Setup

This repository does not assume the Tobacco Road Games orders database already exists.

Phase 3A adds the internal order ledger schema and a temporary development endpoint:

- D1 binding name: `TRG_ORDERS`
- Migration path: `migrations/001_direct_storefront.sql`
- Temporary development route: `POST /api/orders/pending`

`/api/orders/pending` is for development and integration testing only. Before live checkout goes live, this route must be removed, disabled, or folded into the real checkout flow.

## Manual Cloudflare setup required

As of July 9, 2026, this repo does not contain a committed Wrangler config for Pages bindings. The Pages project needs a D1 binding added in the Cloudflare dashboard or in a separate uncommitted Wrangler config managed by the site owner.

Required binding:

- Pages project: the Tobacco Road Games Pages project
- Binding variable name: `TRG_ORDERS`
- D1 database: create a dedicated orders ledger database

Required secret:

- `ORDER_EMAIL_HASH_SECRET`

Do not commit account identifiers, database IDs, secrets, or dashboard export files into this repo.

## Create the D1 database

Cloudflare D1 supports both dashboard setup and Wrangler CLI setup.

CLI example:

```bash
npx wrangler d1 create trg-orders
```

If you manage Pages bindings in the dashboard:

1. Open `Workers & Pages`
2. Open the Tobacco Road Games Pages project
3. Open `Settings > Bindings`
4. Add a `D1 database` binding
5. Set the variable name to `TRG_ORDERS`
6. Select the orders database
7. Add the `ORDER_EMAIL_HASH_SECRET` secret
8. Redeploy the project

## Apply the migration

This repo keeps the schema in:

- `migrations/001_direct_storefront.sql`

Remote apply example:

```bash
npx wrangler d1 migrations apply trg-orders
```

Local-only apply example:

```bash
npx wrangler d1 migrations apply trg-orders --local
```

If you run the Pages app locally with a direct CLI binding instead of a committed Wrangler config, Cloudflare documents this pattern:

```bash
npx wrangler pages dev . --d1 TRG_ORDERS=<DATABASE_ID>
```

## Local testing expectations

Repository tests already exercise the migration and repository logic locally with Node's SQLite runtime. That keeps schema and transaction checks inside `npm test` without creating remote Cloudflare resources.

For manual local Pages testing, use either:

- a local D1 database populated with `wrangler d1 migrations apply ... --local`
- or a bound remote D1 database if you intentionally choose remote-resource development

Do not point routine local development at production customer data unless there is a deliberate operational reason to do so.

## Backup expectations

The orders ledger contains customer personal information and payment-adjacent transaction records. Maintain a documented backup routine outside this repo before live launch.

Recommended minimum practice:

- create a backup before destructive schema work
- create scheduled operational backups after the storefront goes live
- test restoration before relying on backups in production

## Personal-information fields

These `orders` columns contain customer personal information or private derived data:

- `customer_email`
- `customer_email_normalized`
- `customer_email_hash`

These fields must stay server-side only. They must not be returned to browsers, embedded into public pages, or logged in routine application logs.

The public order reference:

- `public_id`

is safe for receipts and support, but it is not authentication and must not grant downloads or reveal customer identity.

## Retention and deletion considerations

This phase does not implement customer self-service deletion or retention automation.

Before launch, the site owner should decide:

- how long order ledger records must be retained for tax and refund handling
- how support requests for personal-data deletion will be handled
- whether email hashes are retained after accountless fulfillment windows close
- what backup-retention timeline applies to customer order data

Deletion decisions must account for accounting, chargeback, fraud, and legal recordkeeping needs.

## Scope notes for Phase 3A

Phase 3A intentionally does not add:

- Stripe API calls
- Stripe Checkout Sessions
- Stripe webhooks
- transactional email
- private PDF delivery
- download links or tokens
- customer accounts
- customer profiles
- mailing-list subscriptions

Reference:

- Cloudflare Pages bindings docs: <https://developers.cloudflare.com/pages/functions/bindings/>
- Cloudflare D1 getting started: <https://developers.cloudflare.com/d1/get-started/>
- Cloudflare D1 migrations: <https://developers.cloudflare.com/d1/reference/migrations/>
- Cloudflare D1 local development: <https://developers.cloudflare.com/d1/best-practices/local-development/>
