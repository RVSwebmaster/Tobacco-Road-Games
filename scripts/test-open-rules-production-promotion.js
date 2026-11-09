const assert = require("node:assert/strict");
const {
  PRODUCT_COLUMNS,
  PRODUCT_IDS,
  productInsert,
  validateSourceRows
} = require("./promote-open-rules-library-production.js");

function fixture(id, index) {
  return {
    ...Object.fromEntries(PRODUCT_COLUMNS.map((column) => [column, null])),
    id,
    slug: id,
    creator_id: "creator-rv-sawyer",
    publication_state: "published",
    title: `Book ${index + 1}`,
    publisher: "Tobacco Road Games",
    status: "preview-only",
    buy_mode: "preview-only",
    sale_enabled: 0,
    price_cents: 0,
    cover_r2_key: `catalog-publications/${id}/cover.webp`,
    back_cover_r2_key: `catalog-publications/${id}/back-cover.webp`,
    delivery_r2_key: `catalog-publications/${id}/delivery.pdf`,
    metadata_json: JSON.stringify({ openRulesEligible: true, pageCount: 20 + index })
  };
}

const rows = PRODUCT_IDS.map(fixture);
assert.deepEqual(validateSourceRows(rows).map((row) => row.id), PRODUCT_IDS);
assert.throws(() => validateSourceRows(rows.slice(1)), /exactly the twelve/);
assert.throws(() => validateSourceRows(rows.map((row, index) => index ? row : { ...row, buy_mode: "cart" })), /buy mode/);
const statement = productInsert(rows, "production-owner");
assert.match(statement, /^INSERT INTO marketplace_products/);
assert.equal((statement.match(/production-owner/g) || []).length, 12);
assert.doesNotMatch(statement, /staging-admin-open-rules/);

console.log("Open Rules production promotion safeguards passed.");
