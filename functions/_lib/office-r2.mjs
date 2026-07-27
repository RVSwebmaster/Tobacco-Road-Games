import { officeError } from "./office-validation.mjs";

export async function verifyAndPromoteOfficeObject(bucket, item) {
  if (!bucket?.head || !bucket?.get || !bucket?.put) {
    throw officeError(503, "office_storage_unavailable", "Office archive storage is unavailable.");
  }
  const head = await bucket.head(item.pending_r2_key);
  if (!head) return { failureCode: "object_missing", verified: false };
  if (Number(head.size) !== Number(item.expected_size)) {
    return { failureCode: "size_mismatch", verified: false };
  }
  const actualHash = bufferToHex(head.checksums?.sha256);
  if (!actualHash || actualHash !== item.expected_sha256_hex) {
    return { failureCode: "checksum_mismatch", verified: false };
  }
  const source = await bucket.get(item.pending_r2_key);
  if (!source?.body) return { failureCode: "object_missing", verified: false };
  const stored = await bucket.put(item.final_r2_key, source.body, {
    customMetadata: {
      "trg-office-sha256": item.expected_sha256_hex,
      "trg-office-version-id": item.version_id
    },
    httpMetadata: { contentType: item.expected_content_type },
    onlyIf: { etagDoesNotMatch: "*" },
    sha256: hexToBuffer(item.expected_sha256_hex)
  });
  if (!stored) throw officeError(409, "immutable_key_exists", "The immutable version key already exists.");
  return { etag: stored.httpEtag || stored.etag || null, verified: true };
}

export async function downloadOfficeVersion(bucket, version, request) {
  const object = await bucket?.get?.(version.r2_object_key, { range: request.headers });
  if (!object) throw officeError(404, "version_object_missing", "The stored version is unavailable.");
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(version.name)}`);
  headers.set("content-type", version.content_type || "application/octet-stream");
  headers.set("etag", object.httpEtag || object.etag || version.r2_etag || "");
  headers.set("x-content-type-options", "nosniff");
  if (object.range) {
    const offset = Number(object.range.offset || 0);
    const length = Number(object.range.length || 0);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${version.byte_size}`);
    headers.set("content-length", String(length));
  } else {
    headers.set("content-length", String(version.byte_size));
  }
  return new Response(object.body, { headers, status: object.range ? 206 : 200 });
}

function bufferToHex(value) {
  if (!value) return "";
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(value) {
  return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16)).buffer;
}
