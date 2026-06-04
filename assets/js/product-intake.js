(() => {
  const statusLabels = {
    "available-direct": "Available Direct",
    "coming-soon": "Coming Soon",
    "preview-available": "Preview Available",
    "revised-edition-pending": "Revised Edition Pending",
    "legacy-edition": "Legacy Edition",
    retired: "Retired",
    "free-download": "Free Download",
    "pay-what-you-want": "Pay What You Want"
  };

  const fields = {
    title: document.getElementById("product-title"),
    slug: document.getElementById("product-slug"),
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
    previewFiles: document.getElementById("product-preview-files"),
    sampleFile: document.getElementById("product-sample-file"),
    videoFile: document.getElementById("product-video-file")
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
    previewCoverImage: document.getElementById("preview-cover-image"),
    previewVideoWrap: document.getElementById("preview-video-wrap"),
    previewVideo: document.getElementById("preview-video")
  };

  const buttons = {
    copy: document.getElementById("copy-json-button"),
    download: document.getElementById("download-json-button"),
    reset: document.getElementById("reset-intake-button")
  };

  let coverObjectUrl = "";
  let videoObjectUrl = "";
  let slugTouched = false;

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const parseList = (value, separator = ",") =>
    String(value || "")
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);

  const parseLines = (value) =>
    String(value || "")
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);

  const buildPayload = () => {
    const title = fields.title.value.trim();
    const slug = (fields.slug.value.trim() || slugify(title) || "untitled-product");
    const gameSystem = fields.system.value.trim();
    const productLine = fields.line.value.trim();
    const pageCountRaw = fields.pageCount.value.trim();
    const priceRaw = fields.price.value.trim();
    const previewImagePaths = fields.previewFiles.files.length
      ? Array.from(fields.previewFiles.files).map((_file, index) => `/assets/products/${slug}/preview-${String(index + 1).padStart(2, "0")}.webp`)
      : [
          `/assets/products/${slug}/preview-01.webp`,
          `/assets/products/${slug}/preview-02.webp`,
          `/assets/products/${slug}/preview-03.webp`
        ];

    return {
      slug,
      title,
      subtitle: fields.subtitle.value.trim(),
      authors: parseList(fields.authors.value),
      publisher: fields.publisher.value.trim(),
      gameSystem,
      gameSystemSlug: slugify(gameSystem),
      productLine,
      productLineSlug: slugify(productLine),
      format: parseList(fields.format.value),
      pageCount: pageCountRaw ? Number(pageCountRaw) : null,
      price: priceRaw,
      currency: fields.currency.value.trim() || "USD",
      status: fields.status.value,
      statusLabel: statusLabels[fields.status.value] || "Unavailable",
      thumbnailImage: `/assets/products/${slug}/thumb.webp`,
      frontCoverImage: `/assets/products/${slug}/cover.webp`,
      previewImages: previewImagePaths,
      previewPdf: fields.sampleFile.files.length ? `/assets/products/${slug}/sample.pdf` : "",
      teaserVideo: fields.videoFile.files.length ? `/assets/products/${slug}/teaser.mp4` : "",
      buyMode: fields.buyMode.value,
      buyUrl: fields.buyUrl.value.trim(),
      fulfillmentNote: fields.fulfillmentNote.value.trim(),
      shortDescription: fields.shortDescription.value.trim(),
      longDescription: fields.longDescription.value.trim(),
      features: parseLines(fields.features.value),
      tags: parseList(fields.tags.value),
      creationMethod: fields.creationMethod.value.trim(),
      legalNote: fields.legalNote.value.trim(),
      version: fields.version.value.trim(),
      releaseDate: fields.releaseDate.value,
      lastUpdated: fields.lastUpdated.value,
      relatedProducts: parseList(fields.related.value)
    };
  };

  const formatJson = (payload) => `${JSON.stringify(payload, null, 2)}`;

  const renderChecklist = (payload) => {
    const lines = [
      `Suggested folder: /assets/products/${payload.slug}/`,
      "",
      "Expected files:",
      `- thumb.webp`,
      `- cover.webp`,
      `- preview-01.webp`,
      `- preview-02.webp`,
      `- preview-03.webp`,
      `- sample.pdf`,
      `- teaser.mp4`,
      "",
      "Generated paths:",
      `thumbnailImage: ${payload.thumbnailImage}`,
      `frontCoverImage: ${payload.frontCoverImage}`,
      `previewImages: ${payload.previewImages.join(", ")}`,
      `previewPdf: ${payload.previewPdf || "(none)"}`,
      `teaserVideo: ${payload.teaserVideo || "(none)"}`,
      "",
      "Next step:",
      "1. Place the final files in the folder above.",
      "2. Paste the JSON entry into data/products.json.",
      "3. Run: node scripts/build-store.js"
    ];
    outputs.checklist.textContent = lines.join("\n");
  };

  const renderAssetFileList = (payload) => {
    const items = [
      payload.thumbnailImage,
      payload.frontCoverImage,
      ...payload.previewImages,
      payload.previewPdf || "/assets/products/[slug]/sample.pdf",
      payload.teaserVideo || "/assets/products/[slug]/teaser.mp4"
    ];
    outputs.assetFileList.replaceChildren(
      ...items.map((item) => {
        const chip = document.createElement("span");
        chip.textContent = item;
        return chip;
      })
    );
  };

  const renderPreview = (payload) => {
    outputs.previewStatus.textContent = payload.statusLabel;
    outputs.previewStatus.className = `status-badge status-badge--${payload.status}`;
    outputs.previewTitle.textContent = payload.title || "Untitled Product";
    outputs.previewSubtitle.textContent = payload.subtitle || "Subtitle will appear here.";
    outputs.previewCopy.textContent = payload.shortDescription || "Short description preview will appear here.";
    outputs.assetFolder.textContent = `/assets/products/${payload.slug || "untitled-product"}/`;
  };

  const updateCoverPreview = () => {
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
  };

  const updateVideoPreview = () => {
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      videoObjectUrl = "";
    }

    if (fields.videoFile.files.length) {
      videoObjectUrl = URL.createObjectURL(fields.videoFile.files[0]);
      outputs.previewVideo.src = videoObjectUrl;
      outputs.previewVideoWrap.hidden = false;
      return;
    }

    outputs.previewVideo.removeAttribute("src");
    outputs.previewVideo.load();
    outputs.previewVideoWrap.hidden = true;
  };

  const updateAll = () => {
    if (!slugTouched && fields.title.value.trim()) {
      fields.slug.value = slugify(fields.title.value);
    }

    const payload = buildPayload();
    outputs.json.value = formatJson(payload);
    renderChecklist(payload);
    renderAssetFileList(payload);
    renderPreview(payload);
    updateCoverPreview();
    updateVideoPreview();
  };

  fields.slug.addEventListener("input", () => {
    slugTouched = fields.slug.value.trim().length > 0;
    updateAll();
  });

  fields.title.addEventListener("input", updateAll);

  Object.values(fields).forEach((field) => {
    if (!field || field === fields.slug || field === fields.title) {
      return;
    }
    field.addEventListener("input", updateAll);
    field.addEventListener("change", updateAll);
  });

  buttons.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputs.json.value);
      outputs.status.textContent = "JSON entry copied to clipboard.";
    } catch {
      outputs.status.textContent = "Clipboard copy failed. You can still copy from the textarea below.";
    }
  });

  buttons.download.addEventListener("click", () => {
    const payload = buildPayload();
    const blob = new Blob([`${formatJson(payload)}\n`], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${payload.slug || "product-entry"}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    outputs.status.textContent = `Downloaded ${payload.slug || "product-entry"}.json.`;
  });

  buttons.reset.addEventListener("click", () => {
    document.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.type === "file") {
        field.value = "";
      }
    });
    fields.title.value = "";
    fields.slug.value = "";
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
    fields.buyMode.value = "none";
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
    outputs.status.textContent = "Form reset.";
    updateAll();
  });

  updateAll();
})();
