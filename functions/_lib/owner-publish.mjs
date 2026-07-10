import { dispatchPublishWorkflow } from "./github-dispatch.mjs";
import {
  isSafeFolderName,
  jsonResponse,
  normalizeFolderName,
  normalizeSlug
} from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";
import {
  getFolderForSlug,
  hasFolderForSlug
} from "../../shared/product-folder-map.mjs";

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
  "cart",
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

  try {
    const authState = await verifyAuthenticatedOwnerMutationRequest(request, env, {
      csrfExpiredMessage: "The publish form security token has expired. Reload the page and try again.",
      csrfMismatchMessage: "The publish form security token did not match. Reload the page and try again.",
      missingCsrfSecretMessage: "Owner publish is missing OWNER_CSRF_SECRET in Cloudflare.",
      sameOriginMessage: "Publish requests must come from the Tobacco Road Games owner site."
    });
    if (!authState.valid) {
      return jsonResponse({
        error: authState.userMessage
      }, authState.status);
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
      }, 502);
    }

    return jsonResponse({
      filesUploaded: uploadResult.uploadedKeys,
      message: dispatchResult.pending
        ? "Files uploaded and the GitHub rebuild workflow was accepted. The live store may take another minute to catch up."
        : "Files uploaded and the store publish workflow completed successfully.",
      ok: true,
      pending: Boolean(dispatchResult.pending),
      runUrl: dispatchResult.runUrl || ""
    }, dispatchResult.pending ? 202 : 200);
  } catch (error) {
    logOwnerPublishException(request, error);
    return jsonResponse({
      error: "Owner publish could not be completed. Please try again. If the problem persists, check Cloudflare bindings and the GitHub workflow configuration."
    }, 500);
  }
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

  const priceText = normalizeMoneyText(formData.get("price"));
  const priceCents = normalizePriceCents(formData.get("price"));
  const buyUrl = String(formData.get("buyUrl") || "").trim();

  if (buyMode === "cart") {
    if (status !== "available-direct") {
      errors.push("Cart products must use Available Direct status.");
    }
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      errors.push("Cart products require a positive price.");
    }
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
      buyUrl: buyMode === "cart" ? "" : buyUrl,
      creationMethod: String(formData.get("creationMethod") || "").trim(),
      currency: String(formData.get("currency") || "USD").trim() || "USD",
      excludeFromBundles: true,
      features: parseLines(formData.get("features")),
      featured: String(formData.get("featured") || "") === "true",
      fileList: [],
      format: formatList,
      fulfillmentNote: String(formData.get("fulfillmentNote") || "").trim(),
      gameSystem: metadata.gameSystem,
      gameSystemSlug: String(formData.get("gameSystemSlug") || "").trim(),
      lastUpdated: String(formData.get("lastUpdated") || "").trim(),
      legalNote: String(formData.get("legalNote") || "").trim(),
      longDescription: metadata.longDescription,
      pageCount: normalizeOptionalNumber(formData.get("pageCount")),
      price: priceText,
      priceCents,
      productLine: metadata.productLine,
      productLineSlug: String(formData.get("productLineSlug") || "").trim(),
      series: String(formData.get("series") || "").trim(),
      seriesSlug: String(formData.get("seriesSlug") || "").trim(),
      publisher: "Tobacco Road Games",
      relatedProducts: parseList(formData.get("relatedProducts")),
      releaseDate: String(formData.get("releaseDate") || "").trim(),
      saleEnabled: String(formData.get("saleEnabled") || "") === "true",
      salePrice: normalizeMoneyText(formData.get("salePrice")),
      salePriceCents: normalizePriceCents(formData.get("salePrice")),
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
    existingFolder: "",
    isExistingProduct: false,
    productFile: null,
    previewFile: null,
    coverFile: null
  };

  payload.isExistingProduct = hasFolderForSlug(slug);
  payload.existingFolder = getFolderForSlug(slug);
  const requireAllFiles = !payload.isExistingProduct || payload.existingFolder !== folder;

  for (const [fieldName, label, expectedType, expectedExtension] of REQUIRED_FILE_FIELDS) {
    const file = formData.get(fieldName);
    const fileValidation = validateRequiredFile(file, label, expectedType, expectedExtension, {
      required: requireAllFiles
    });
    if (!fileValidation.valid) {
      errors.push(fileValidation.userMessage);
      continue;
    }
    if (fileValidation.file) {
      payload[fieldName] = fileValidation.file;
    }
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

  payload.metadata.fileList = payload.productFile?.name ? [payload.productFile.name] : [];

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
  ].filter(([file]) => file instanceof File);
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

function validateRequiredFile(file, label, expectedType, expectedExtension, options = {}) {
  const required = options.required !== false;
  if (!(file instanceof File)) {
    if (!required) {
      return {
        valid: true,
        file: null
      };
    }
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

  return {
    valid: true,
    file
  };
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
  const trimmed = normalizeMoneyText(value);
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

function normalizeMoneyText(value) {
  return String(value || "")
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "");
}

function logOwnerPublishException(request, error) {
  const payload = {
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : "UnknownError",
    event: "owner_publish_exception",
    method: request.method,
    path: new URL(request.url).pathname,
    rayId: request.headers.get("cf-ray") || ""
  };

  console.error(JSON.stringify(payload));
}
