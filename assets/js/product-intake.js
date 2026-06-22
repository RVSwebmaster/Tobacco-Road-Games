(() => {
  const statusLabels = {
    "available-direct": "Available Direct",
    "coming-soon": "Coming Soon",
    "preview-available": "Preview Available",
    "preview-only": "Preview Only",
    "revised-edition-pending": "Revised Edition Pending",
    "legacy-edition": "Legacy Edition",
    "legacy-not-for-sale": "Legacy Not For Sale",
    retired: "Retired",
    "free-download": "Free Download",
    "pay-what-you-want": "Pay What You Want"
  };

  const fields = {
    title: document.getElementById("product-title"),
    slug: document.getElementById("product-slug"),
    folder: document.getElementById("product-folder"),
    subtitle: document.getElementById("product-subtitle"),
    authors: document.getElementById("product-authors"),
    publisher: document.getElementById("product-publisher"),
    system: document.getElementById("product-system"),
    line: document.getElementById("product-line"),
    format: document.getElementById("product-format"),
    pageCount: document.getElementById("product-page-count"),
    price: document.getElementById("product-price"),
    currency: document.getElementById("product-currency"),
    status: document.getElementById("product-status"),
    buyMode: document.getElementById("product-buy-mode"),
    buyUrl: document.getElementById("product-buy-url"),
    shortDescription: document.getElementById("product-short-description"),
    longDescription: document.getElementById("product-long-description"),
    features: document.getElementById("product-features"),
    tags: document.getElementById("product-tags"),
    fulfillmentNote: document.getElementById("product-fulfillment-note"),
    creationMethod: document.getElementById("product-creation-method"),
    legalNote: document.getElementById("product-legal-note"),
    version: document.getElementById("product-version"),
    releaseDate: document.getElementById("product-release-date"),
    lastUpdated: document.getElementById("product-last-updated"),
    related: document.getElementById("product-related"),
    coverFile: document.getElementById("product-cover-file"),
    previewFile: document.getElementById("product-preview-file"),
    pdfFile: document.getElementById("product-pdf-file")
  };

  const outputs = {
    json: document.getElementById("generated-json"),
    checklist: document.getElementById("asset-checklist"),
    status: document.getElementById("intake-status"),
    assetFolder: document.getElementById("asset-folder-output"),
    assetFileList: document.getElementById("asset-file-list"),
    previewStatus: document.getElementById("preview-status"),
    previewTitle: document.getElementById("preview-title"),
    previewSubtitle: document.getElementById("preview-subtitle"),
    previewCopy: document.getElementById("preview-copy"),
    previewCoverImage: document.getElementById("preview-cover-image")
  };

  const buttons = {
    publish: document.getElementById("publish-button"),
    reset: document.getElementById("reset-intake-button")
  };

  let coverObjectUrl = "";
  let slugTouched = false;
  let folderTouched = false;
  let publishBusy = false;

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const parseList = (value) =>
    String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const parseLines = (value) =>
    String(value || "")
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);

  const buildPayload = () => {
    const title = fields.title.value.trim();
    const slug = fields.slug.value.trim() || slugify(title) || "untitled-product";
    const folder = fields.folder.value.trim() || slug;
    const gameSystem = fields.system.value.trim();
    const productLine = fields.line.value.trim();
    const pageCountRaw = fields.pageCount.value.trim();
    const priceRaw = fields.price.value.trim();
    const priceCents = priceRaw ? Math.round(Number(priceRaw) * 100) : null;

    return {
      authorSlugs: ["rv-sawyer"],
      authors: ["RV Sawyer"],
      buyMode: fields.buyMode.value,
      buyUrl: fields.buyUrl.value.trim(),
      creationMethod: fields.creationMethod.value.trim() || "Human-authored by RV Sawyer.",
      currency: fields.currency.value.trim() || "USD",
      features: parseLines(fields.features.value),
      fileList: [`${title || "Untitled Product"} PDF`],
      folder,
      format: parseList(fields.format.value).length ? parseList(fields.format.value) : ["PDF"],
      fulfillmentNote: fields.fulfillmentNote.value.trim(),
      gameSystem,
      gameSystemSlug: slugify(gameSystem),
      lastUpdated: fields.lastUpdated.value,
      legalNote: fields.legalNote.value.trim(),
      longDescription: fields.longDescription.value.trim(),
      pageCount: pageCountRaw ? Number(pageCountRaw) : null,
      price: priceRaw,
      priceCents,
      productLine,
      productLineSlug: slugify(productLine),
      publisher: "Tobacco Road Games",
      relatedProducts: parseList(fields.related.value),
      releaseDate: fields.releaseDate.value,
      shortDescription: fields.shortDescription.value.trim(),
      slug,
      status: fields.status.value,
      statusLabel: statusLabels[fields.status.value] || "Unavailable",
      subtitle: fields.subtitle.value.trim(),
      tags: parseList(fields.tags.value),
      title,
      version: fields.version.value.trim() || "1.0"
    };
  };

  const updatePreview = () => {
    const payload = buildPayload();
    outputs.previewStatus.textContent = payload.statusLabel;
    outputs.previewStatus.className = `status-badge status-badge--${payload.status}`;
    outputs.previewTitle.textContent = payload.title || "Untitled Product";
    outputs.previewSubtitle.textContent = payload.subtitle || "Subtitle will appear here.";
    outputs.previewCopy.textContent = payload.shortDescription || "Short description preview will appear here.";
    outputs.assetFolder.textContent = `R2 folder: ${payload.folder || "untitled-product"}`;
    outputs.json.value = `${JSON.stringify(payload, null, 2)}`;
    outputs.checklist.textContent = buildChecklist(payload);
    renderAssetFileList(payload);
    updateCoverPreview();
  };

  function buildChecklist(payload) {
    return [
      `R2 folder: ${payload.folder}`,
      "",
      "Required uploaded files:",
      `- ${payload.folder}/cover.webp`,
      `- ${payload.folder}/preview.webp`,
      `- ${payload.folder}/product.pdf`,
      "",
      "Published public asset paths:",
      `/product-assets/${payload.slug}/cover.webp`,
      `/product-assets/${payload.slug}/preview.webp`,
      "",
      "Repo publish path after upload:",
      "- Update shared folder map",
      "- Update data/product-intake-map.json",
      "- Update data/products.json",
      "- Run node scripts/build-store.js",
      "- Commit and push to main"
    ].join("\n");
  }

  function renderAssetFileList(payload) {
    const items = [
      `${payload.folder}/cover.webp`,
      `${payload.folder}/preview.webp`,
      `${payload.folder}/product.pdf`,
      `/product-assets/${payload.slug}/cover.webp`,
      `/product-assets/${payload.slug}/preview.webp`
    ];

    outputs.assetFileList.replaceChildren(
      ...items.map((item) => {
        const chip = document.createElement("span");
        chip.textContent = item;
        return chip;
      })
    );
  }

  function updateCoverPreview() {
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = "";
    }

    if (fields.coverFile.files.length) {
      coverObjectUrl = URL.createObjectURL(fields.coverFile.files[0]);
      outputs.previewCoverImage.src = coverObjectUrl;
      outputs.previewCoverImage.alt = "Selected product cover preview";
      return;
    }

    outputs.previewCoverImage.src = "../assets/logo.png";
    outputs.previewCoverImage.alt = "Tobacco Road Games logo fallback";
  }

  function getCookie(name) {
    const cookies = document.cookie.split(";").map((entry) => entry.trim()).filter(Boolean);
    for (const cookie of cookies) {
      const separator = cookie.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const cookieName = cookie.slice(0, separator);
      if (cookieName === name) {
        return cookie.slice(separator + 1);
      }
    }
    return "";
  }

  async function publishProduct() {
    if (publishBusy) {
      return;
    }

    const missingTextErrors = validateRequiredFields();
    if (missingTextErrors.length) {
      outputs.status.textContent = missingTextErrors.join(" ");
      return;
    }

    const csrfToken = getCookie("trg_owner_csrf");
    if (!csrfToken) {
      outputs.status.textContent = "Your login security token is missing. Reload the page and sign in again if needed.";
      return;
    }

    publishBusy = true;
    buttons.publish.disabled = true;
    outputs.status.textContent = "Uploading to R2 and waiting for the GitHub publish workflow to finish...";

    try {
      const payload = buildPayload();
      const formData = new FormData();
      formData.set("title", payload.title);
      formData.set("slug", payload.slug);
      formData.set("folder", payload.folder);
      formData.set("subtitle", payload.subtitle);
      formData.set("gameSystem", payload.gameSystem);
      formData.set("gameSystemSlug", payload.gameSystemSlug);
      formData.set("productLine", payload.productLine);
      formData.set("productLineSlug", payload.productLineSlug);
      formData.set("format", payload.format.join(", "));
      formData.set("pageCount", payload.pageCount === null ? "" : String(payload.pageCount));
      formData.set("price", payload.price);
      formData.set("currency", payload.currency);
      formData.set("status", payload.status);
      formData.set("buyMode", payload.buyMode);
      formData.set("buyUrl", payload.buyUrl);
      formData.set("shortDescription", payload.shortDescription);
      formData.set("longDescription", payload.longDescription);
      formData.set("features", payload.features.join("\n"));
      formData.set("tags", payload.tags.join(", "));
      formData.set("fulfillmentNote", payload.fulfillmentNote);
      formData.set("creationMethod", payload.creationMethod);
      formData.set("legalNote", payload.legalNote);
      formData.set("version", payload.version);
      formData.set("releaseDate", payload.releaseDate);
      formData.set("lastUpdated", payload.lastUpdated);
      formData.set("relatedProducts", payload.relatedProducts.join(", "));
      formData.set("coverFile", fields.coverFile.files[0]);
      formData.set("previewFile", fields.previewFile.files[0]);
      formData.set("productFile", fields.pdfFile.files[0]);

      const response = await fetch("/owner/api/publish", {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrfToken
        },
        body: formData,
        redirect: "manual"
      });

      if (response.status === 401 || response.status === 403) {
        const payload = await safeJson(response);
        outputs.status.textContent = payload.error || "Your session is no longer valid. Redirecting to login...";
        window.setTimeout(() => {
          window.location.assign(`/owner/login?next=${encodeURIComponent(window.location.pathname)}`);
        }, 600);
        return;
      }

      const responsePayload = await safeJson(response);
      if (!response.ok) {
        outputs.status.textContent = responsePayload.error || "Publish failed.";
        return;
      }

      outputs.status.textContent = responsePayload.runUrl
        ? `${responsePayload.message} Workflow: ${responsePayload.runUrl}`
        : responsePayload.message;
    } catch {
      outputs.status.textContent = "The publish request failed before the server could answer. Please try again.";
    } finally {
      publishBusy = false;
      buttons.publish.disabled = false;
    }
  }

  function validateRequiredFields() {
    const errors = [];
    const requiredTextFields = [
      [fields.title, "Title"],
      [fields.slug, "Slug"],
      [fields.folder, "R2 folder name"],
      [fields.subtitle, "Subtitle"],
      [fields.system, "Game system"],
      [fields.line, "Product line"],
      [fields.shortDescription, "Short description"],
      [fields.longDescription, "Long description"]
    ];

    for (const [field, label] of requiredTextFields) {
      if (!field.value.trim()) {
        errors.push(`${label} is required.`);
      }
    }

    if (!fields.coverFile.files.length) {
      errors.push("cover.webp is required.");
    }
    if (!fields.previewFile.files.length) {
      errors.push("preview.webp is required.");
    }
    if (!fields.pdfFile.files.length) {
      errors.push("product.pdf is required.");
    }

    return errors;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function updateAutoFields() {
    if (!slugTouched && fields.title.value.trim()) {
      fields.slug.value = slugify(fields.title.value);
    }

    if (!folderTouched && fields.slug.value.trim()) {
      fields.folder.value = fields.slug.value.trim();
    }

    updatePreview();
  }

  fields.slug.addEventListener("input", () => {
    slugTouched = fields.slug.value.trim().length > 0;
    if (!folderTouched) {
      fields.folder.value = fields.slug.value.trim();
    }
    updatePreview();
  });

  fields.folder.addEventListener("input", () => {
    folderTouched = fields.folder.value.trim().length > 0;
    updatePreview();
  });

  fields.title.addEventListener("input", updateAutoFields);

  Object.values(fields).forEach((field) => {
    if (!field || field === fields.slug || field === fields.title || field === fields.folder) {
      return;
    }

    field.addEventListener("input", updatePreview);
    field.addEventListener("change", updatePreview);
  });

  buttons.publish.addEventListener("click", publishProduct);

  buttons.reset.addEventListener("click", () => {
    document.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.type === "file") {
        field.value = "";
      }
    });
    fields.title.value = "";
    fields.slug.value = "";
    fields.folder.value = "";
    fields.subtitle.value = "";
    fields.authors.value = "RV Sawyer";
    fields.publisher.value = "Tobacco Road Games";
    fields.system.value = "5E Compatible";
    fields.line.value = "Fifth Edition Fantasy Roleplaying";
    fields.format.value = "PDF";
    fields.pageCount.value = "";
    fields.price.value = "";
    fields.currency.value = "USD";
    fields.status.value = "coming-soon";
    fields.buyMode.value = "coming-soon";
    fields.buyUrl.value = "";
    fields.shortDescription.value = "";
    fields.longDescription.value = "";
    fields.features.value = "";
    fields.tags.value = "";
    fields.fulfillmentNote.value = "";
    fields.creationMethod.value = "Human-authored by RV Sawyer.";
    fields.legalNote.value = "";
    fields.version.value = "";
    fields.releaseDate.value = "";
    fields.lastUpdated.value = "";
    fields.related.value = "";
    slugTouched = false;
    folderTouched = false;
    outputs.status.textContent = "Form reset.";
    updatePreview();
  });

  updatePreview();
})();
