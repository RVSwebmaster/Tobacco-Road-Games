# Provider Financial Events and Payout Readiness — Pass 8

## Stripe ingestion boundary

The existing `/api/stripe/webhook` signature, timestamp-tolerance, livemode, pinned API-version, processing-lease, and provider-event idempotency checks remain the only Stripe webhook boundary. Pass 8 adds `refund.created`, `charge.dispute.created`, and `charge.dispute.closed` to that handler. Stripe documents `refund.created` as carrying a Refund object, whose immutable amount, currency, Charge, and PaymentIntent identify the provider-side refund. Stripe notes that `charge.refunded` contains the cumulative Charge while recommending refund events for individual refund information, so TRG consumes `refund.created` and avoids cumulative double application. See [Stripe event types](https://docs.stripe.com/api/events/types) and [the Refund object](https://docs.stripe.com/api/refunds/object).

Provider events resolve orders exclusively through the server-recorded Stripe PaymentIntent. Amounts and currency come from the signed event. No browser/client refund input is accepted. Accounting uses immutable `creator_sale_snapshots`, never current catalog prices, current ownership, or current fee policy.

## Refund and dispute allocation

When Stripe provides only an order-level amount, TRG allocates it proportionally across original paid order-line totals. Whole cents use largest-remainder allocation with order-item ID as the stable tie-breaker. Creator lines produce reversals; TRG-owned lines retain their proportional share as TRG liability and never become creator liability. Per-line reversal caps prevent cumulative provider refunds from exceeding the original line.

A dispute opening creates creator-specific holds using the same allocation rule. It does not create an irreversible ledger reversal. A won dispute releases those holds. A lost dispute releases the hold into final `chargeback_reversal` entries. Provider event, dispute, creator allocation, action, order, amount, currency, and timestamp are audited without storing the signed payload, webhook secret, PaymentMethod, card, or customer payment details.

## Provider reconciliation

`reconcileProviderFinance` uses stored Stripe webhook and provider-financial-event records as its import boundary, making it fixture-testable without live API credentials. It reports and never repairs:

- Stripe payment records without a linked internal order;
- internal paid orders without a processed Stripe payment event;
- refunds without creator reversals;
- creator reversal totals above the provider amount;
- disputes without creator holds;
- provider/order currency mismatches;
- order-line totals that do not equal the order total.

Database uniqueness on webhook/provider event IDs and reversal event/line pairs prevents duplicate application. Repeated deliveries are visible through webhook attempt history but do not create a second financial action.

## Payout profile and eligibility

`creator_payout_profiles` stores only provider choice, opaque provider account reference, onboarding/verification status, payout-enabled flag, country, currency, last status update, and an operator hold reason. It has no fields for account/routing numbers, SSN, EIN, tax ID, identity documents, or provider credentials.

Payout readiness is independent of any provider. A creator must be active, have complete and verified onboarding with payouts enabled, have no operator or dispute hold, have no affecting provider-reconciliation exceptions, satisfy the configured reserve period, and meet `CREATOR_MINIMUM_PAYOUT_CENTS` (temporary development default: 5,000 cents). The operator API rechecks readiness before recording even a manual payout. No external transfer API is called.

## Payout-provider assessment (August 2026)

### Stripe Connect — recommended technical direction, pending commercial/legal validation

Best architectural fit. TRG already collects customer payments with Stripe, while Connect is explicitly designed for marketplaces, connected-account onboarding, seller management, and payouts. Stripe-hosted onboarding collects business, identity, verification documents, and payout account details outside TRG; Stripe specifically recommends hosted/embedded collection to avoid storing bank and routing data. Connect also offers tax-reporting capabilities and country-dependent connected-account/cross-border coverage. API maturity and dispute/reporting alignment are the strongest of the evaluated choices. Payout fees, loss liability, merchant-of-record configuration, supported creator countries, and tax obligations depend on the selected Connect configuration and require Stripe Sales/legal confirmation before adoption. Sources: [Connect overview](https://docs.stripe.com/connect/how-connect-works), [hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding), [payout-account collection](https://docs.stripe.com/connect/payouts-bank-accounts), [identity verification](https://docs.stripe.com/connect/identity-verification), and [platform tax reporting](https://docs.stripe.com/connect/platform-tax-reporting).

### PayPal Payouts

Mature API and broad recipient reach; PayPal documents payout support across many countries/currencies, sender-paid percentage fees with caps, and recipient flows based on email, phone, or PayPal ID. It requires a PayPal Business account, approval for Payouts, sufficient funded balance, and recipients may need to claim/create accounts. This reduces TRG banking-data storage but introduces a second provider, separate funding/reconciliation, currency restrictions/conversion costs, and weaker direct alignment with the existing Stripe charge/dispute lifecycle. Sources: [Standard Payouts](https://developer.paypal.com/payouts/standard/overview), [Payouts FAQ](https://developer.paypal.com/payouts/faqs/), and [country support](https://developer.paypal.com/payouts/supported-features/).

### ACH/bank payout provider

Potentially attractive for domestic, higher-value transfers, but provider selection cannot be made generically: KYC ownership, hosted onboarding quality, returns/negative-balance handling, countries, settlement timing, and fees vary materially. A direct bank integration would increase sensitive-data and compliance exposure unless a provider hosts identity and bank collection. Evaluate named vendors only after creator-country, volume, payout-frequency, and legal requirements are known.

### Manual payouts

Lowest implementation risk and already supported by the internal ledger, but highest operator workload and weakest scalability/reconciliation. It remains the safe interim method: the operator transfers funds externally, then records the completed payout with a non-sensitive reference. It is unsuitable as the long-term marketplace default.

## Recommendation and deferred work

Proceed to a Stripe Connect hosted-onboarding proof of concept, but do not enable transfers until account configuration, pricing, platform loss liability, merchant-of-record position, tax reporting, supported creator countries, and operational support are approved. Preserve manual payouts during evaluation.

Pass 9 should add Connect account creation/account-link status synchronization in sandbox only, direct Stripe API reconciliation with bounded read-only credentials, refund/dispute fixtures captured at the pinned Stripe API version, operator profile-edit controls, and payout-batch preparation that still requires explicit owner execution. External payouts, collaborative bundle splits, tax filing, and storage of sensitive identity/banking data remain out of scope.
