# Product Advisor V1

## Intent

The owner intake includes a deterministic product advisor that recommends:

- MSRP
- sale price
- product type
- series fit
- audience
- tags
- cross-sells
- reasoning

It is advisory only.

- It does not auto-publish changes.
- It does not overwrite live listings by itself.
- It does not lock fields after suggestions are applied.

## Current behavior

Version 1 runs entirely in the intake UI through `shared/product-advisor.js`.

Inputs considered:

- title
- subtitle
- short description
- long description
- product line / category
- series
- tags
- game system
- page count
- cover / preview / PDF presence
- current price when present

Outputs are shown in the owner page and can be applied into editable form fields.

## Pricing model

Base price by product type:

```js
{
  one_page: 1.99,
  advice_booklet: 4.99,
  adventure: 6.99,
  rules_expansion: 7.99,
  setting: 9.99,
  full_game: 19.99,
  asset_pack: 4.99
}
```

Version 1 then adjusts for:

- stronger metadata completeness and presentational signals
- system-neutral evergreen advice
- table-usable tools or procedures
- very short page count
- thin or unfinished metadata

The result is clamped to a product-type price band and rounded to a charm price tier.

## Future persistence

When advisor history is promoted out of the browser-only phase, store runs separately from published product metadata.

Suggested D1 table:

```sql
CREATE TABLE product_advisor_runs (
  id TEXT PRIMARY KEY,
  product_slug TEXT NOT NULL,
  suggested_price REAL,
  suggested_sale_price REAL,
  confidence REAL NOT NULL,
  product_type TEXT NOT NULL,
  series_fit TEXT,
  audience_json TEXT NOT NULL,
  suggested_tags_json TEXT NOT NULL,
  suggested_cross_sells_json TEXT NOT NULL,
  reasoning_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model_version TEXT NOT NULL
);
```

That future table is meant for:

- comparing suggested price to final owner-entered price
- comparing recommendation quality to actual sales later
- tracking model-version changes over time
