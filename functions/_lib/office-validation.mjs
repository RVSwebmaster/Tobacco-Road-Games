export const OFFICE_DEFAULT_LIMITS = Object.freeze({
  batchBytes: 1024 * 1024 * 1024,
  batchFiles: 50,
  fileBytes: 90 * 1024 * 1024,
  uploadTtlSeconds: 600
});

export function officeLimits(env = {}) {
  return {
    batchBytes: positiveInteger(env.OFFICE_MAX_BATCH_BYTES, OFFICE_DEFAULT_LIMITS.batchBytes),
    batchFiles: positiveInteger(env.OFFICE_MAX_BATCH_FILES, OFFICE_DEFAULT_LIMITS.batchFiles),
    fileBytes: positiveInteger(env.OFFICE_MAX_FILE_BYTES, OFFICE_DEFAULT_LIMITS.fileBytes),
    uploadTtlSeconds: Math.min(3600, positiveInteger(
      env.OFFICE_UPLOAD_URL_TTL_SECONDS,
      OFFICE_DEFAULT_LIMITS.uploadTtlSeconds
    ))
  };
}

export function requireUuid(value, field = "id") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw officeError(400, "invalid_identifier", `${field} is invalid.`);
  }
  return normalized;
}

export function optionalUuid(value, field) {
  return value === null || value === undefined || value === "" ? null : requireUuid(value, field);
}

export function requireName(value, field = "name", maxLength = 255) {
  const name = String(value || "").normalize("NFC").trim();
  if (!name || name.length > maxLength || /[\u0000-\u001f\u007f]/.test(name) || name === "." || name === "..") {
    throw officeError(400, "invalid_name", `${field} must be between 1 and ${maxLength} safe characters.`);
  }
  return name;
}

export function requireSha256(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw officeError(400, "invalid_sha256", "sha256 must be a 64-character hexadecimal digest.");
  }
  return hash;
}

export function requireByteSize(value, maxBytes) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw officeError(400, "invalid_size", "size must be a non-negative integer.");
  }
  if (size > maxBytes) {
    throw officeError(413, "file_too_large", `File exceeds the ${maxBytes}-byte staging limit.`);
  }
  return size;
}

export function normalizeContentType(value) {
  const type = String(value || "application/octet-stream").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type)
    ? type
    : "application/octet-stream";
}

export function officeError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

export function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers
    }
  });
}

export async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw officeError(415, "json_required", "This endpoint requires an application/json body.");
  }
  try {
    return await request.json();
  } catch {
    throw officeError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
