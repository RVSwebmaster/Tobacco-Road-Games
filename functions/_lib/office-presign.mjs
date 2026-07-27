import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cachedClient;
let cachedKey;

export async function createOfficeUploadUrl(item, env, options = {}) {
  const config = presignConfig(env);
  const client = options.client || getClient(config);
  const expiresIn = Number(options.expiresIn || env.OFFICE_UPLOAD_URL_TTL_SECONDS || 600);
  return (options.sign || getSignedUrl)(client, new PutObjectCommand({
    Bucket: config.bucket,
    ChecksumSHA256: hexToBase64(item.sha256),
    ContentLength: item.size,
    ContentType: item.contentType,
    Key: item.pendingKey,
    Metadata: {
      "trg-office-upload-id": item.id
    }
  }), { expiresIn });
}

export function presignConfig(env) {
  const accountId = String(env.OFFICE_R2_ACCOUNT_ID || "").trim();
  const bucket = String(env.OFFICE_R2_BUCKET_NAME || "").trim();
  const accessKeyId = String(env.OFFICE_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.OFFICE_R2_SECRET_ACCESS_KEY || "").trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw Object.assign(new Error("Office R2 presigning is not configured."), {
      code: "presign_not_configured", status: 503
    });
  }
  return { accessKeyId, accountId, bucket, secretAccessKey };
}

function getClient(config) {
  const key = `${config.accountId}:${config.accessKeyId}`;
  if (!cachedClient || cachedKey !== key) {
    cachedKey = key;
    cachedClient = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      region: "auto"
    });
  }
  return cachedClient;
}

function hexToBase64(hex) {
  const bytes = new Uint8Array(hex.match(/../g).map((pair) => Number.parseInt(pair, 16)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

