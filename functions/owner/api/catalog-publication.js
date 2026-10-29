import { handleOwnerCatalogPublicationRequest } from "../../_lib/product-publication.mjs";

export function onRequest(context) {
  return handleOwnerCatalogPublicationRequest(context.request, context.env);
}
