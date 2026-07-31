# Forum Avatars

Forum avatars are public profile media, not private account identity. They never import or display a Google profile photograph, account image, authentication method, email address, or legal name.

## Storage and metadata

- Private R2 binding: `TRG_FORUM_AVATARS`
- Runtime binding: `env.TRG_FORUM_AVATARS`
- Object prefix: `forum-avatars/`
- Metadata migration: `migrations/011_forum_profile_avatars.sql`

Image bytes remain in private R2. D1 stores only the random R2 object key, detected media type, selected preset ID, monotonically increasing avatar version, and avatar update timestamp. Submitted filenames are never used as object keys. Product and Office R2 bindings are not used.

## Built-in presets and avatar states

Sixteen original TRG preset illustrations are stored as shared static assets under `assets/forum-avatars/`. Each has a stable internal ID and descriptive gallery label. They are not uploaded to R2 and are never copied per user.

A profile has exactly one effective state: default (no preset or object key), built-in (`avatar_preset_id`), or custom (`avatar_object_key` and media type). Selecting a preset clears and removes the previous custom object. Uploading a custom avatar clears the preset. Removing either choice restores the default.

## Accepted images

PNG, JPEG, and WebP are accepted up to 1 MiB. The server validates both the declared media type and image signature. SVG, GIF, mismatched MIME data, executable/scriptable formats, and oversized bodies are rejected.

The account page center-crops the selected image, resizes it to 256 × 256 pixels, and re-encodes it in the browser to strip incidental metadata. WebP is preferred with PNG fallback. Server validation remains authoritative.

## Replacement and deletion

Replacement uploads a new random object, updates D1 to point at it, and only then deletes the previous object. If the D1 update fails, the newly uploaded object is deleted. Removing an avatar clears its metadata, increments its version, deletes the previous object, and leaves the forum profile active with the default TRG avatar.

Public delivery uses `GET /forum/avatar/<handle>` for active profiles only. Responses use the stored media type, `X-Content-Type-Options: nosniff`, and version-aware caching. Missing custom avatars redirect to the default TRG avatar without exposing private account state.

## Retroactive resolution rule

Forum topics, posts, replies, member lists, and notifications must reference only the author's user/profile ID. They must never store an avatar URL, preset ID, R2 object key, or avatar snapshot. Renderers resolve the current avatar through `forum_profiles` and `/forum/avatar/<handle>` at display time, so every existing and future appearance changes immediately when the member selects, replaces, or removes an avatar. Any future forum-content migration must preserve this rule.

## Content policy

**No mature-themed avatars are permitted anywhere on the Tobacco Road Games Forum or website.**

Avatars must be suitable for a general tabletop gaming audience. Tobacco Road Games may remove avatars that are sexually explicit, pornographic, graphically violent, hateful, or otherwise inappropriate for the community. Automated content moderation is not part of this phase.

## Staging procedure

1. Apply migration 011 to `trg-orders-staging` only after review.
2. Confirm the private `TRG_FORUM_AVATARS` binding targets `trg-forum-avatars-staging`.
3. Run `node scripts/test-forum-avatars.js`, `npm test`, and `node scripts/build-store.js`.
4. Deploy to `tobacco-road-games-staging` and exercise upload, replacement, delivery, deletion, default restoration, and inactive-profile behavior.
5. Confirm temporary avatar objects and test profiles are removed.
