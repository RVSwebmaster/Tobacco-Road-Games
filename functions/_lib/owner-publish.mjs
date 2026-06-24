import { dispatchPublishWorkflow } from "./github-dispatch.mjs";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getOwnerSecrets,
  isSafeFolderName,
  jsonResponse,
  normalizeFolderName,
  normalizeSlug,
  parseCookieHeader,
  readCookie,
  validateSameOriginRequest,
  verifyCsrfToken,
  verifySessionToken
} from "./owner-auth.mjs";
import {
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";

const STATUS_LABELS = {
  "available-direct": "Available Direct",
  "coming-soon": "Coming Soon",
  "free-download": "Free Download",
  "legacy-edition": "Legacy Edition",
  "legacy-not-for-sale": "Legacy Not For Sale",
  "pay-what-you-want": "Pay What You Want",
  "preview-available": "Preview Available",
  "preview-only": "Preview Only",
  "revised-edition-pending": "Revised Edition Pending",
  retired: "Retired"
};

const ALLOWED_BUY_MODES = new Set([
  "available-direct",
  "coming-soon",
  "fixed-price",
  "free-download",
  "manual-invoice",
  "pay-what-you-want",
  "preview-only",
  "retired"
]);

const REQUIRED_TEXT_FIELDS = [
  ["title", "Product title"],
  ["slug", "Product slug"],
  ["folder", "R2 folder name"],
  ["subtitle", "Product subtitle"],
  ["gameSystem", "Game system"],
  ["productLine", "Product line"],
  ["shortDescription", "Short description"],
  ["longDescription", "Long description"],
  ["status", "Status"],
  ["buyMode", "Buy mode"]
];

const REQUIRED_FILE_FIELDS = [
  ["coverFile", "Cover image", "image/webp", ".webp"],
  ["previewFile", "Preview image", "image/webp", ".webp"],
  ["productFile", "Product PDF", "application/pdf", ".pdf"]
];

export async function handleOwnerPublishRequest(request, env, options = {}) {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse({
      error: "Publish only accepts POST requests."
    }, 405);
  }

  const authState = await verifyAuthenticatedPublishRequest(request, env);
  if (!authState.valid) {
    return jsonResponse({
      error: authState.userMessage
    }, authState.status);
  }

  if (!validateSameOriginRequest(request)) {
    return jsonResponse({
      error: "Publish requests must come from the Tobacco Road Games owner site."
    }, 403);
  }

  const formData = await request.formData();
  const parsed = parsePublishForm(formData);
  if (!parsed.valid) {
    return jsonResponse({
      error: parsed.userMessage
    }, 400);
  }

  const bucket = env.TRG_PRODUCTS;
  if (!bucket || typeof bucket.put !== "function") {
    return jsonResponse({
      error: "The product bucket binding is missing. Add TRG_PRODUCTS in Cloudflare before publishing."
    }, 503);
  }

  const uploadResult = await uploadRequiredProductFiles(bucket, parsed.payload);
  if (!uploadResult.ok) {
    return jsonResponse({
      error: uploadResult.userMessage
    }, 502);
  }

  const publishId = `pub-${Date.now()}-${crypto.randomUUID()}`;
  const dispatchPayload = {
    folder: parsed.payload.folder,
    metadata: parsed.payload.metadata,
    publish_id: publishId,
    ref: String(env.GITHUB_PUBLISH_REF || "main"),
    requested_by: authState.username
  };

  const dispatchResult = await dispatchPublishWorkflow(dispatchPayload, env, options.dispatchOptions);
  if (!dispatchResult.ok) {
    return jsonResponse({
      error: `Files uploaded to R2, but the store was not published. ${dispatchResult.userMessage}`,
      filesUploaded: uploadResult.uploadedKeys,
      runUrl: dispatchResult.runUrl || ""
    }, dispatchResult.reason === "workflow_timeout" ? 504 : 502);
  }

  return jsonResponse({
    filesUploaded: uploadResult.uploadedKeys,
    message: "Files uploaded and the store publish workflow completed successfully.",
    ok: true,
    runUrl: dispatchResult.runUrl || ""
  });
}

function parsePublishForm(formData) {
  const errors = [];
  const metadata = {};

  for (const [fieldName, label] of REQUIRED_TEXT_FIELDS) {
    const value = String(formData.get(fieldName) || "").trim();
    if (!value) {
      errors.push(`${label} is required.`);
      continue;
    }
    metadata[fieldName] = value;
  }

  const slug = normalizeSlug(metadata.slug);
  if (!slug) {
    errors.push("Product slug must be lowercase and hyphenated.");
  }
  metadata.slug = slug;

  const folder = normalizeFolderName(metadata.folder);
  if (!isSafeFolderName(folder)) {
    errors.push("R2 folder name may only use letters, numbers, spaces, underscores, and hyphens.");
  }
  metadata.folder = folder;

  const status = metadata.status;
  if (status && !STATUS_LABELS[status]) {
    errors.push("Status is not one of the supported storefront values.");
  }

  const buyMode = metadata.buyMode;
  if (buyMode && !ALLOWED_BUY_MODES.has(buyMode)) {
    errors.push("Buy mode is not one of the supported storefront values.");
  }

  const formatList = String(formData.get("format") || "PDF")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!formatList.length) {
    errors.push("At least one format is required.");
  }

  const payload = {
    folder,
    metadata: {
      authorSlugs: ["rv-sawyer"],
      authors: ["RV Sawyer"],
      bundleEligible: false,
      bundleGroup: "standard-digital",
      bundleMinPriceCents: 100,
      buyMode,
      buyUrl: String(formData.get("buyUrl") || "").trim(),
      creationMethod: String(formData.get("creationMethod") || "").trim(),
      currency: String(formData.get("currency") || "USD").trim() || "USD",
      excludeFromBundles: true,
      features: parseLines(formData.get("features")),
      featured: String(formData.get("featured") || "") === "true",
      fileList: [],
      format: formatList,
      fulfillmentNote: String(formData.get("fulfillmentNote") || "").trim(),
      gameSystem: metadata.gameSystem,
      gameSystemSlug: normalizeSlug(String(formData.get("gameSystemSlug") || metadata.gameSystem)),
      lastUpdated: String(formData.get("lastUpdated") || "").trim(),
      legalNote: String(formData.get("legalNote") || "").trim(),
      longDescription: metadata.longDescription,
      pageCount: normalizeOptionalNumber(formData.get("pageCount")),
      price: String(formData.get("price") || "").trim(),
      priceCents: normalizePriceCents(formData.get("price")),
      productLine: metadata.productLine,
      productLineSlug: normalizeSlug(String(formData.get("productLineSlug") || metadata.productLine)),
      series: String(formData.get("series") || "").trim(),
      seriesSlug: normalizeSlug(String(formData.get("seriesSlug") || formData.get("series") || "")),
      publisher: "Tobacco Road Games",
      relatedProducts: parseList(formData.get("relatedProducts")),
      releaseDate: String(formData.get("releaseDate") || "").trim(),
      shortDescription: metadata.shortDescription,
      slug,
      status,
      statusLabel: STATUS_LABELS[status] || "Unavailable",
      subtitle: metadata.subtitle,
      tags: parseList(formData.get("tags")),
      title: metadata.title,
      updateEligible: true,
      version: String(formData.get("version") || "").trim()
    },
    productFile: null,
    previewFile: null,
    coverFile: null
  };

  for (const [fieldName, label, expectedType, expectedExtension] of REQUIRED_FILE_FIELDS) {
    const file = formData.get(fieldName);
    const fileValidation = validateRequiredFile(file, label, expectedType, expectedExtension);
    if (!fileValidation.valid) {
      errors.push(fileValidation.userMessage);
      continue;
    }
    payload[fieldName] = file;
  }

  if (errors.length) {
    return {
      valid: false,
      userMessage: errors.join(" ")
    };
  }

  if (!payload.metadata.creationMethod) {
    payload.metadata.creationMethod = "Human-authored by RV Sawyer.";
  }

  if (!payload.metadata.version) {
    payload.metadata.version = "1.0";
  }

  payload.metadata.fileList = [payload.productFile?.name || `${metadata.title || "Untitled Product"}.pdf`];

  return {
    valid: true,
    payload
  };
}

async function uploadRequiredProductFiles(bucket, payload) {
  const uploads = [
    [payload.coverFile, `${payload.folder}/cover.webp`, "image/webp"],
    [payload.previewFile, `${payload.folder}/preview.webp`, "image/webp"],
    [payload.productFile, `${payload.folder}/product.pdf`, "application/pdf"]
  ];
  const uploadedKeys = [];

  try {
    for (const [file, objectKey, contentType] of uploads) {
      const bytes = await file.arrayBuffer();
      await bucket.put(objectKey, bytes, {
        httpMetadata: {
          contentType
        }
      });
      uploadedKeys.push(objectKey);
    }
  } catch {
    await rollbackUploads(bucket, uploadedKeys);
    return {
      ok: false,
      userMessage: "The R2 upload failed before all required files were written. Nothing was published to GitHub."
    };
  }

  return {
    ok: true,
    uploadedKeys
  };
}

async function rollbackUploads(bucket, uploadedKeys) {
  for (const key of uploadedKeys) {
    try {
      await bucket.delete(key);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function verifyAuthenticatedPublishRequest(request, env) {
  const accessConfig = getOwnerAccessConfig(env);
  if (accessConfig.enabled) {
    return verifyAccessProtectedPublishRequest(request, env, accessConfig);
  }

  const secrets = getOwnerSecrets(env);
  const sessionToken = readCookie(request, SESSION_COOKIE_NAME);
  if (!secrets.sessionSecret || !sessionToken) {
    return {
      valid: false,
      status: 401,
      userMessage: "Your owner session is missing. Please sign in again."
    };
  }

  const sessionState = await verifySessionToken(sessionToken, secrets.sessionSecret);
  if (!sessionState.valid) {
    return {
      valid: false,
      status: 401,
      userMessage: "Your owner session is no longer valid. Please sign in again."
    };
  }

  const csrfToken = request.headers.get("x-csrf-token") || "";
  const csrfCookie = parseCookieHeader(request.headers.get("cookie")).get(CSRF_COOKIE_NAME) || "";
  if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie || !secrets.csrfSecret) {
    return {
      valid: false,
      status: 403,
      userMessage: "The publish form security token did not match. Reload the page and try again."
    };
  }

  const csrfState = await verifyCsrfToken(csrfToken, sessionState.username, secrets.csrfSecret);
  if (!csrfState.valid) {
    return {
      valid: false,
      status: 403,
      userMessage: "The publish form security token has expired. Reload the page and try again."
    };
  }

  return {
    valid: true,
    username: sessionState.username
  };
}

async function verifyAccessProtectedPublishRequest(request, env, accessConfig) {
  if (!accessConfig.ready) {
    return {
      valid: false,
      status: 503,
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    };
  }

  const accessState = await verifyOwnerAccessRequest(request, env);
  if (!accessState.valid) {
    return {
      valid: false,
      status: accessState.reason === "config_incomplete" ? 503 : 403,
      userMessage: accessState.userMessage
    };
  }

  const secrets = getOwnerSecrets(env);
  if (!secrets.csrfSecret) {
    return {
      valid: false,
      status: 503,
      userMessage: "Owner publish is missing OWNER_CSRF_SECRET in Cloudflare."
    };
  }

  const csrfToken = request.headers.get("x-csrf-token") || "";
  const csrfCookie = parseCookieHeader(request.headers.get("cookie")).get(CSRF_COOKIE_NAME) || "";
  if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie) {
    return {
      valid: false,
      status: 403,
      userMessage: "The publish form security token did not match. Reload the page and try again."
    };
  }

  const csrfState = await verifyCsrfToken(csrfToken, accessState.csrfSubject, secrets.csrfSecret);
  if (!csrfState.valid) {
    return {
      valid: false,
      status: 403,
      userMessage: "The publish form security token has expired. Reload the page and try again."
    };
  }

  return {
    valid: true,
    username: accessState.email || accessState.csrfSubject
  };
}

function validateRequiredFile(file, label, expectedType, expectedExtension) {
  if (!(file instanceof File)) {
    return {
      valid: false,
      userMessage: `${label} is required.`
    };
  }

  const actualName = String(file.name || "").trim().toLowerCase();
  if (!file.size) {
    return {
      valid: false,
      userMessage: `${label} is empty.`
    };
  }

  const contentType = String(file.type || "").toLowerCase();
  if (expectedType === "image/webp") {
    const nameLooksRight = actualName.endsWith(expectedExtension);
    const typeLooksRight = !contentType || contentType === "image/webp";
    if (!nameLooksRight || !typeLooksRight) {
      return {
        valid: false,
        userMessage: `${label} must be a WebP image.`
      };
    }
  }

  if (expectedType === "application/pdf") {
    const nameLooksRight = actualName.endsWith(expectedExtension);
    const typeLooksRight = !contentType || contentType === "application/pdf";
    if (!nameLooksRight || !typeLooksRight) {
      return {
        valid: false,
        userMessage: `${label} must be a PDF file.`
      };
    }
  }

  return { valid: true };
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOptionalNumber(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePriceCents(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}
