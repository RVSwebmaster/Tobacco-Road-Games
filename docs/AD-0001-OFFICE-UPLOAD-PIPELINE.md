# AD-0001: Office upload pipeline

Status: Accepted

## Decision

TRG Office uploads pass through the authenticated Office Worker. Browsers,
desktop clients, AI agents, and future Office components never communicate
directly with R2.

```text
Browser -> authenticated Office Worker -> OfficeStorage -> private R2 binding
```

The Worker validates the Access assertion, exact owner identity, same origin,
CSRF token, reservation, content type, byte size, and SHA-256 before publishing
an immutable version.

Only `OfficeStorage` may call the R2 binding. Application and route code use:

- `OfficeStorage.reserveUpload()`
- `OfficeStorage.storeVersion()`
- `OfficeStorage.fetchVersion()`
- `OfficeStorage.restoreVersion()`

The current adapter uses R2. Callers do not depend on R2 object APIs.

## Retention

The `versions/` prefix has an indefinite bucket lock. Pending objects are not
locked and remain temporary workspace. There is no application hard-delete
route and the current Office code does not call R2 deletion.

## Consequences

- No R2 S3 API credential is required by Office.
- Every upload follows the same authorization and policy path.
- Upload traffic and execution pass through the Worker.
- R2 rejects a stream whose supplied SHA-256 does not match.
- Conditional writes and the bucket lock prevent immutable-version overwrite.

