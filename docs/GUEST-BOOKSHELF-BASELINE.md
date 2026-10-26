# Guest Bookshelf Baseline

The Guest storefront bookshelf presentation is an approved shared visual foundation for future Customer and Creator profile shells.

## Locked behavior

- Preserve the approved cabinet geometry, furniture, decorations, shelf surfaces, and bookstops.
- Populate shelves from their assigned collections; decorative staging books are presentation fixtures, not live catalog products.
- Fill shelves sequentially from top to bottom, with two books every 500 milliseconds.
- Preserve each shelf's established stacking direction and stable shelf contact.
- Give each appearing pair its existing restrained sparks and one to three simultaneous randomized flashes.
- SPACE completes the sequence and clears effects. A second SPACE does not restart it. The visible Replay control is intentionally absent; reduced-motion behavior remains available.
- On desktop pointer hover/focus, every visible book rises exactly 10px and uses the existing forward-pull perspective transform (`translateZ(28px) scale(1.06)`), brightness, and drop-shadow treatment. The selected book remains above its neighbors (`z-index: 3`) and returns smoothly to its unchanged resting position with the existing 200ms transform transition.
- The approved hover behavior applies consistently to the Open Game Library, Featured Creator, New This Week, and Best Sellers shelf groups. Reduced-motion users receive no transform animation and no forced motion.
- Keep the original homepage unchanged.

The reusable implementation is the Guest shelf renderer, `assets/js/magical-bookshelf.js`, and `assets/js/guest-product-preview.js`; future profile shells should consume the same shelf and preview contracts rather than recreating the cabinet, animation, or dialog.

## Product-preview interaction

- Every visible shelf book receives a native anchor when its presentation collection or catalog data resolves to a product-summary record.
- The shared dialog displays that record's cover, title, Creator or publisher, price/status, description, and full-product destination.
- X and Escape close the dialog and restore focus to the selected book.
- Decorative books without a product association remain non-navigable; preview fixtures remain non-purchasable presentation data rather than live catalog products.
- `scripts/build-store.js` must regenerate all three versioned Guest feature assets: `guest-landing.css`, `magical-bookshelf.js`, and `guest-product-preview.js`. Change their shared cache key whenever any of those public files changes.
