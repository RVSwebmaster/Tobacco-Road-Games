import { jsonResponse } from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["video/mp4"]);

export function normalizeAdFilename(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\.mp4$/i, "");
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return slug ? `${slug}.mp4` : "";
}

export async function handleOwnerAdUpload(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Upload only accepts POST requests." }, 405);

  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env, {
    sameOriginMessage: "Uploads must come from the Tobacco Road Games owner site."
  });
  if (!auth.valid) return jsonResponse({ error: auth.userMessage }, auth.status);

  const bucket = env.TRG_PRODUCTS;
  if (!bucket?.put) return jsonResponse({ error: "The upload bucket is not configured." }, 503);

  let form;
  try { form = await request.formData(); } catch { return jsonResponse({ error: "The upload form could not be read." }, 400); }
  const file = form.get("video");
  if (!(file instanceof File)) return jsonResponse({ error: "Choose an MP4 video to upload." }, 400);
  const filename = normalizeAdFilename(form.get("filename") || file.name);
  if (!filename) return jsonResponse({ error: "Enter a valid filename." }, 400);
  if (!ALLOWED_TYPES.has(String(file.type).toLowerCase()) || !file.name.toLowerCase().endsWith(".mp4")) {
    return jsonResponse({ error: "Only MP4 video files are allowed." }, 400);
  }
  if (!file.size || file.size > MAX_VIDEO_BYTES) return jsonResponse({ error: "Video files must be between 1 byte and 100 MB." }, 413);

  const key = `ads/${filename}`;
  const existing = await bucket.head(key);
  if (existing && String(form.get("overwrite") || "") !== "true") {
    return jsonResponse({ error: "A video with that filename already exists. Enable Replace existing file to overwrite it." }, 409);
  }

  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: "video/mp4", cacheControl: "public, max-age=3600" },
    customMetadata: { uploadedBy: String(auth.username || "owner"), originalName: file.name }
  });
  return jsonResponse({ filename, ok: true, url: `/ad-media/${filename}` }, 201);
}
