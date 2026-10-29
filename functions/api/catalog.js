import { handlePublicCatalogRequest } from "../_lib/public-product-catalog.mjs";

export function onRequest(context) {
  return handlePublicCatalogRequest(context.request, context.env);
}
