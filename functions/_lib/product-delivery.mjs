import { getRuntimeCatalogProduct } from "./runtime-catalog.mjs";

const DELIVERY_PRODUCTS = Object.freeze({
  agency: Object.freeze({
    contentType: "application/pdf",
    customerFilename: "Agency.pdf",
    productSlug: "agency",
    r2ObjectKey: "agency/product.pdf"
  }),
  janni: Object.freeze({
    contentType: "application/pdf",
    customerFilename: "Janni.pdf",
    productSlug: "janni",
    r2ObjectKey: "janni/product.pdf"
  })
});

export function getDeliveryProduct(productSlug) {
  const slug=String(productSlug||"").trim().toLowerCase();
  if(DELIVERY_PRODUCTS[slug])return DELIVERY_PRODUCTS[slug];
  const product=getRuntimeCatalogProduct(slug);
  if(!product?.creatorId||!product.fulfillmentEligible)return null;
  return {contentType:"application/pdf",customerFilename:`${safeFilename(product.title)}.pdf`,productSlug:slug,r2ObjectKey:`${slug}/product.pdf`};
}

function safeFilename(value){return String(value||"Product").replace(/[<>:"/\\|?*\u0000-\u001F]/g,"").trim().slice(0,120)||"Product";}

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
