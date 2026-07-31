# Forum Profiles

Forum profiles provide a public identity for an existing private Tobacco Road Games account. Apply `migrations/009_forum_profiles.sql` to the D1 database bound as `TRG_ORDERS` before deploying these routes.

## Privacy boundary

The private account owns email, Google identity, password credentials, sessions, verification state, role, and authentication method. The public profile contains only its handle, optional display name, optional biography, public status, and join date. Public APIs and `/forum/member/<handle>` never return account email, Google subject/name/image, authentication method, session data, account role, or moderation notes.

`forum_profiles.user_id` has a one-to-one foreign key to `users.id` with `ON DELETE CASCADE`. A database trigger makes an active profile inactive when its account is disabled. Public queries also require both the account and profile to be active.

## Handle rules

Handles preserve their submitted capitalization but compare through the unique lowercase `handle_normalized` value. They must be 3–24 characters, use only letters, numbers, underscores, and hyphens, begin and end with a letter or number, and contain no consecutive punctuation. Reserved authority/system handles include `admin`, `administrator`, `moderator`, `mod`, `owner`, `staff`, `support`, `tobacco-road-games`, `tobaccoroadgames`, `trg`, `system`, `deleted`, and `anonymous`.

Availability checks are advisory. The unique database constraint is authoritative during creation, and expected concurrent conflicts return a controlled `handle_unavailable` response.

Display names are optional plain text up to 60 characters. Biographies are optional plain text up to 500 characters with ordinary line breaks preserved. Neither field renders HTML or Markdown.

## Routes

- `GET /api/forum/profile/me`: authenticated account’s profile and verification eligibility.
- `POST /api/forum/profile`: create a profile for a verified account; requires the TRG session CSRF token and same-origin request.
- `PATCH /api/forum/profile`: edit display name and biography; handles are immutable in this phase.
- `GET /api/forum/profile/:handle`: public-data-only profile lookup.
- `GET /api/forum/handle-availability?handle=...`: advisory validation and availability.
- `GET /forum/member/<handle>`: escaped public member page.

## Staging procedure

1. Apply migration 009 to the staging `trg-orders-staging` database.
2. Run `node scripts/test-forum-profiles.js`, the account/Google/email tests, `npm test`, and `node scripts/build-store.js`.
3. Sign in with a verified native or Google-created account and create a profile from `/account.html`.
4. Confirm the public member page shows only the handle, optional public fields, and join date.
5. Confirm an unverified native account is prompted to verify and cannot create a profile.
6. Try the same handle with different capitalization from another account and confirm creation is rejected.
