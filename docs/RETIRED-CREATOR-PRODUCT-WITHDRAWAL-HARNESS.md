# Retired Creator Product Withdrawal Harness

`scripts/test-creator-product-withdrawal.js` was written for the retired repository-generated publication workflow. Its executable scenario copied and mutated generated catalog files and supplied mock GitHub publishing configuration. Those behaviors are no longer valid marketplace acceptance criteria after Operation Severance.

The file remains temporarily as a test-fixture helper because the independent product-inactivity regression imports its SQLite, R2, and fixture utilities. It is not an operational publication test and is no longer the target of `npm run test:creator-product-withdrawal`.

The command now runs `scripts/test-creator-native-review-publication.js`, which provides native D1/R2 coverage for:

- withdrawal of a pending Creator submission without creating a public product;
- Creator-owned publication pause and immediate public-catalog removal;
- immutable stable product identity through private edits and Owner reapproval;
- stale revision rejection, duplicate approval safety, rejection, slug conflict safety, and missing-R2 failure handling;
- Creator/Owner authentication and CSRF enforcement.

This preserves the useful lifecycle assertions while formally retiring repository mutation and GitHub-dispatch expectations.
