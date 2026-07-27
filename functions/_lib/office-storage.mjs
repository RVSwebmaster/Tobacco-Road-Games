import { officeError } from "./office-validation.mjs";

export function createOfficeStorage(r2Binding) {
  requireBinding(r2Binding);

  return Object.freeze({
    async reserveUpload(item, request) {
      if (!request.body) throw officeError(400, "upload_body_required", "The upload body is required.");
      let stored;
      try {
        stored = await r2Binding.put(item.pending_r2_key, request.body, {
          customMetadata: {
            "trg-office-upload-id": item.id
          },
          httpMetadata: {
            contentType: item.expected_content_type
          },
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: hexToBuffer(item.expected_sha256_hex)
        });
      } catch {
        throw officeError(422, "upload_checksum_rejected", "R2 rejected the upload checksum.");
      }
      if (!stored) {
        throw officeError(409, "pending_upload_exists", "This upload reservation has already received content.");
      }
      if (Number(stored.size) !== Number(item.expected_size)) {
        throw officeError(422, "upload_size_rejected", "The uploaded size did not match the reservation.");
      }
      const hash = bufferToHex(stored.checksums?.sha256);
      if (!hash || hash !== item.expected_sha256_hex) {
        throw officeError(422, "upload_checksum_rejected", "The uploaded checksum did not match the reservation.");
      }
      return storageMetadata(stored);
    },

    async storeVersion(item) {
      const pending = await r2Binding.head(item.pending_r2_key);
      if (!pending) return { failureCode: "object_missing", verified: false };
      if (Number(pending.size) !== Number(item.expected_size)) {
        return { failureCode: "size_mismatch", verified: false };
      }
      const actualHash = bufferToHex(pending.checksums?.sha256);
      if (!actualHash || actualHash !== item.expected_sha256_hex) {
        return { failureCode: "checksum_mismatch", verified: false };
      }
      const source = await r2Binding.get(item.pending_r2_key);
      if (!source?.body) return { failureCode: "object_missing", verified: false };
      const stored = await r2Binding.put(item.final_r2_key, source.body, {
        customMetadata: {
          "trg-office-sha256": item.expected_sha256_hex,
          "trg-office-version-id": item.version_id
        },
        httpMetadata: { contentType: item.expected_content_type },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: hexToBuffer(item.expected_sha256_hex)
      });
      if (!stored) {
        throw officeError(409, "immutable_key_exists", "The immutable version key already exists.");
      }
      return { ...storageMetadata(stored), verified: true };
    },

    async restoreVersion(version) {
      const object = await r2Binding.head(version.r2_object_key);
      if (!object) throw officeError(404, "version_object_missing", "The stored version is unavailable.");
      const actualHash = bufferToHex(object.checksums?.sha256);
      if (actualHash && actualHash !== version.sha256_hex) {
        throw officeError(409, "version_integrity_failure", "The stored version failed its integrity check.");
      }
      return storageMetadata(object);
    },

    async fetchVersion(version, request) {
      const object = await r2Binding.get(version.r2_object_key, { range: request.headers });
      if (!object?.body) throw officeError(404, "version_object_missing", "The stored version is unavailable.");
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
  });
}

function requireBinding(binding) {
  if (!binding?.head || !binding?.get || !binding?.put) {
    throw officeError(503, "office_storage_unavailable", "Office archive storage is unavailable.");
  }
}

function storageMetadata(object) {
  return {
    etag: object.httpEtag || object.etag || null,
    sha256: bufferToHex(object.checksums?.sha256),
    size: Number(object.size || 0)
  };
}

function bufferToHex(value) {
  if (!value) return "";
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(value) {
  return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16)).buffer;
}

