# Creator Balance internal purchases

Creator Balance is a restricted spending source for fully registered Creators. It is not a bank account, stored-value wallet, cash equivalent, general store credit, or transferable balance. Only cleared marketplace earnings are spendable. Pending reserve-period earnings, held funds, payout reservations, internal purchase reservations, and negative adjustments reduce or do not contribute to the available amount.

## Purchase rules

- The customer must be signed in, email verified, actively own a completed Creator identity, and explicitly select Creator Balance.
- The store kill switch must be `OPEN`. The option cannot bypass store closure.
- The complete positive cart total must be covered. Split tender, partial use, transfers, gifting, cash loading, withdrawal through checkout, and arbitrary operator transfers are unsupported.
- Preferred Creator charges may be paid explicitly from full Creator Balance at the unchanged $20 monthly charge under a 12-month commitment or $200 annual prepaid price. Automatic recurring Creator Balance consumption is not enabled.
- The unchanged Ad Credit package is five credits for $5 and may be paid explicitly from full Creator Balance.
- Cart products and prices are resolved from the server catalog. Secure delivery objects are checked before settlement.
- Stripe is not called. The order records `payment_source=creator_balance`, `settlement_method=internal_ledger`, and zero processor fees.

## Accounting and concurrency

One D1 batch reserves the buyer's cleared earnings, creates a normal paid order and items, applies the same per-product fee policy as an external sale, records seller earnings under the normal reserve policy, records the marketplace commission, creates delivery entitlements, debits the buyer, closes the reservation, and writes an audit event. A database trigger recalculates spendable funds when a reservation is inserted, including active payout and purchase reservations. This makes competing payout/purchase attempts fail closed instead of double-spending.

An internal refund never calls Stripe. It reverses seller earnings and marketplace commission, restores the buyer's Creator Balance, revokes entitlements, changes the order to refunded/canceled fulfillment, and records operator audit history. Operators can inspect settlements and invoke only this order-linked reversal through `/owner/api/creator-balance`.

## Marketplace services and Ad Credits

Preferred fees and Ad Credit packages settle through separate marketplace service-purchase and service-revenue ledgers. They are not product orders, product GMV, or new Creator earnings. An internal service settlement reserves cleared funds, records one Creator Balance debit, records one matching TRG service-revenue entry, activates the Preferred term or issues exactly five credits, consumes the reservation, and audits the result in one D1 batch. Processor fees are zero because Stripe is not invoked.

One unused Ad Credit becomes one additional active ad slot for 30 days only when the Creator explicitly redeems it. Uploading a draft does not consume a credit. Unused credits do not expire. Standard Creators retain one included slot and Preferred Creators retain five; redeemed credits add temporary slots beyond that capacity. A Creator may swap an eligible validated product or creative into an active purchased slot without another credit and without changing its original activation or expiration timestamp. Expiration removes the slot from rotation, does not consume another credit, and does not renew automatically. Every occupied slot remains one neutral rotation entry with no per-ad weighting boost.

Automatic recurring Creator Balance billing and automatic fallback from insufficient balance to a stored external method remain deferred. The Creator must explicitly choose the full-balance option for each currently due service charge. Split tender remains intentionally unsupported.

## Reputation and discovery

Cross-Creator internal purchases use normal paid orders and therefore qualify for customer acquisition, sales, reporting, and discovery when all existing fraud, reversal, and entitlement rules pass. A user who controls the selling Creator identity cannot rate that Creator, regardless of which controlled identity funded the order. Existing discovery queries continue to exclude seller-owner self-purchases.

## Operational verification

Run `node scripts/test-creator-balance-internal-purchases.js` for the complete purchase/idempotency/insufficient-balance/refund lifecycle and static safety assertions. Run `npm test` and `npm run test:store-kill-switch` before deployment. Apply migration `033_creator_balance_internal_purchases.sql` before deploying Functions.
