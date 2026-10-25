# Guest Bookshelf Baseline

The Guest storefront bookshelf presentation is an approved shared visual foundation for future Customer and Creator profile shells.

## Locked behavior

- Preserve the approved cabinet geometry, furniture, decorations, shelf surfaces, and bookstops.
- Populate shelves from their assigned collections; decorative staging books are presentation fixtures, not live catalog products.
- Fill shelves sequentially from top to bottom, with two books every 500 milliseconds.
- Preserve each shelf's established stacking direction and stable shelf contact.
- Give each appearing pair its existing restrained sparks and one to three simultaneous randomized flashes.
- SPACE completes the sequence and clears effects; replay and reduced-motion behavior remain available.
- Keep the original homepage unchanged.

The reusable implementation is the Guest shelf renderer and `assets/js/magical-bookshelf.js`; future profile shells should consume the same shelf contract rather than recreating the cabinet or animation.

## Pending interaction specifications

Mouse-over behavior, preview overlays, and full-product navigation for future profile shelves are recorded requirements only. They are not claimed as part of this baseline and must be specified and approved before implementation.
