import { handlePublicProductAssetRequest } from "../../_lib/public-product-assets.mjs";

export const onRequestGet = context => handlePublicProductAssetRequest(context);
export const onRequestHead = context => handlePublicProductAssetRequest(context, { headOnly: true });
