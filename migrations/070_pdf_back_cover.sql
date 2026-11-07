ALTER TABLE marketplace_products ADD COLUMN back_cover_r2_key TEXT;
ALTER TABLE creator_listing_files ADD COLUMN generated_cover_key TEXT;
ALTER TABLE creator_listing_files ADD COLUMN generated_back_cover_key TEXT;
ALTER TABLE creator_listing_files ADD COLUMN pdf_page_count INTEGER;
