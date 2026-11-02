const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const mapping = await import(`${pathToFileURL(path.resolve(__dirname, "../functions/_lib/creator-publication-map.mjs")).href}?pass5=${Math.random()}`);
  const listing = {
    id: "pass-five-native", creator_id: "creator-pass-five", lifecycle_state: "submitted",
    publication_state: "not_approved", slug: "pass-five-native", title: "Pass Five Native",
    short_description: "Native Creator mapping regression.", long_description: "A complete native Creator mapping regression fixture.",
    game_system: "System Neutral", format_json: '["PDF"]', listed_price_cents: 700,
    pricing_model: "pwyw", suggested_price_cents: 700, minimum_price_cents: 0,
    media_type: "digital", genre: "fantasy", discovery_json: '{"language":"English"}'
  };
  const creator = { id: "creator-pass-five", slug: "pass-five", display_name: "Pass Five Creator" };
  const files = [
    { id: "cover", listing_id: listing.id, purpose: "cover", validation_state: "accepted", quarantine_key: "private/cover.webp", normalized_filename: "cover.webp", content_type: "image/webp" },
    { id: "product", listing_id: listing.id, purpose: "product", validation_state: "accepted", quarantine_key: "private/product.pdf", normalized_filename: "product.pdf", content_type: "application/pdf" }
  ];
  const result = mapping.mapApprovedListingToPublishPayload(listing, creator, files, { nowMs: Date.parse("2026-11-02T16:00:00Z") });
  assert.equal(result.valid, true);
  assert.equal(result.metadata.id, listing.id);
  assert.equal(result.metadata.creatorListingId, listing.id);
  assert.equal(result.metadata.pricingModel, "pwyw");
  assert.equal(result.metadata.minimumPriceCents, 0);
  assert.equal(result.metadata.suggestedPriceCents, 700);
  assert.equal(result.metadata.status, "pay-what-you-want");
  assert.equal(mapping.mapApprovedListingToPublishPayload({ ...listing, lifecycle_state: "active" }, creator, files).valid, false);
  assert.equal(mapping.mapApprovedListingToPublishPayload(listing, creator, files.slice(0, 1)).valid, false);
  console.log("Marketplace Pass 5 native Creator publication mapping tests passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
