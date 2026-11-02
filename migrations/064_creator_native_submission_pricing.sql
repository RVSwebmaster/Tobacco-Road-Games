ALTER TABLE creator_listings
ADD COLUMN minimum_price_cents INTEGER
CHECK(minimum_price_cents IS NULL OR minimum_price_cents >= 0);
