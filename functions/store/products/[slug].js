import { handlePublicProductPage } from "../../_lib/public-storefront.mjs";

export function onRequest(context) {
  return handlePublicProductPage(context);
}
