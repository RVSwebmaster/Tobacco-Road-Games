# Stripe Undelivered Payment Event Recovery

Operator procedure for payment events that Stripe created but could not deliver to TRG. This is a documented procedure, not a live replay; confirm the current endpoint and Owner financial controls before use.

## Recovery steps

1. In Stripe Workbench, select the correct Stripe account and mode (test or live), inspect the TRG webhook endpoint's delivery history, and record the outage interval and the last successfully delivered event before the gap. Correct endpoint configuration or availability before replaying.
2. List events for the outage window using the endpoint's configured event types, `delivery_success=false`, and `ending_before` set to the last successful event ID before the gap. Stripe's Events API returns only the last 30 days. Follow pagination to exhaustion and process events in chronological order. Do not treat one page as the complete backlog.
3. Replay each relevant event through Stripe's Dashboard or Stripe CLI to the exact TRG endpoint after it is healthy. Keep the original Stripe event and signature verification path intact. Do not directly mark an order paid or create an entitlement in D1 to compensate for a missing webhook.
4. Confirm the endpoint returns success and inspect TRG's Owner order recovery view for fulfillment status. A replay of an already processed event should be acknowledged as a duplicate without creating another order, entitlement, or accounting entry. Escalate any mismatch among Stripe payment, TRG order, and entitlement records for Owner reconciliation.
5. For events older than the Events API's 30-day window, use Stripe Workbench and the relevant payment objects to identify the affected transactions, then follow the approved Owner reconciliation process. Do not replay hand-built or unsigned payloads.

Stripe retries failed webhook deliveries automatically for up to three days. Manual processing does not stop those retries; event-ID idempotency must make subsequent deliveries safe. Stripe documents filtering undelivered events, pagination, chronological processing, and replay in [Process undelivered webhook events](https://docs.stripe.com/webhooks/process-undelivered-events). Verify current Stripe UI/API details when operating because provider interfaces can change.

The repository's `scripts/test-staging-stripe-resend.js` is a source-level staging safety check; it is not an operator replay utility and this launch gate does not contact Stripe.
