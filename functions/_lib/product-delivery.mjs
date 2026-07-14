const DELIVERY_PRODUCTS = Object.freeze({
  agency: Object.freeze({
    contentType: "application/pdf",
    customerFilename: "Agency.pdf",
    productSlug: "agency",
    r2ObjectKey: "agency/product.pdf"
  })
});

export function getDeliveryProduct(productSlug) {
  return DELIVERY_PRODUCTS[String(productSlug || "").trim().toLowerCase()] || null;
}

export function isExactDeliveryMapping(entitlement, product) {
  return Boolean(
    entitlement
      && product
      && entitlement.product_slug === product.productSlug
      && entitlement.r2_object_key === product.r2ObjectKey
      && entitlement.customer_filename === product.customerFilename
      && entitlement.content_type === product.contentType
  );
}
