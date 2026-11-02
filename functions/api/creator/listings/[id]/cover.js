import { handleCreatorCatalogCover } from "../../../../_lib/creator-catalog-cover.mjs";

export function onRequestGet(context) {
  return handleCreatorCatalogCover(context.request, context.env, context.params.id);
}
