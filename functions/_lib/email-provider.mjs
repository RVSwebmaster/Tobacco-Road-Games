export const ORDER_EMAIL_FROM = "Tobacco Road Games <orders@tobaccoroadgames.com>";
const RESEND_EMAIL_API = "https://api.resend.com/emails";

export class EmailProviderError extends Error {
  constructor(code, options = {}) {
    super("The email provider could not accept the message.");
    this.name = "EmailProviderError";
    this.code = String(code || "provider_error");
    this.httpStatus = Number.isInteger(options.httpStatus) ? options.httpStatus : null;
    this.retryable = Boolean(options.retryable);
    this.indeterminate = Boolean(options.indeterminate);
  }
}

export function createEmailProvider(env = {}, options = {}) {
  return new ResendEmailProvider({
    apiKey: env.RESEND_API_KEY,
    fetchImpl: options.fetchImpl || ((...args) => fetch(...args)),
    replyTo: env.RESEND_REPLY_TO
  });
}

export function isEmailDeliveryConfigured(env = {}) {
  return String(env.RESEND_API_KEY || "").startsWith("re_")
    && isEmailAddress(env.RESEND_REPLY_TO);
}

export class ResendEmailProvider {
  constructor(options = {}) {
    this.apiKey = String(options.apiKey || "").trim();
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.replyTo = String(options.replyTo || "").trim().toLowerCase();
  }

  async send(message, options = {}) {
    if (!this.apiKey.startsWith("re_")) {
      throw new EmailProviderError("provider_not_configured");
    }
    if (!isEmailAddress(this.replyTo)) {
      throw new EmailProviderError("reply_to_not_configured");
    }
    const idempotencyKey = String(options.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 256) {
      throw new EmailProviderError("invalid_idempotency_key");
    }

    const payload = {
      from: ORDER_EMAIL_FROM,
      html: requiredString(message?.html, "html_missing"),
      reply_to: this.replyTo,
      subject: requiredString(message?.subject, "subject_missing"),
      tags: Array.isArray(message?.tags) ? message.tags : [],
      text: requiredString(message?.text, "text_missing"),
      to: [requiredEmail(message?.to)]
    };

    let response;
    try {
      response = await this.fetchImpl(RESEND_EMAIL_API, {
        body: JSON.stringify(payload),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey
        },
        method: "POST"
      });
    } catch {
      throw new EmailProviderError("provider_connection_indeterminate", {
        indeterminate: true,
        retryable: true
      });
    }

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (response.ok && typeof body?.id === "string" && body.id.trim()) {
      return { id: body.id.trim(), status: "accepted" };
    }

    const providerCode = safeProviderCode(body?.name || body?.code);
    const retryable = response.status === 408
      || response.status === 409 && providerCode === "concurrent_idempotent_requests"
      || response.status === 429
      || response.status >= 500;
    throw new EmailProviderError(providerCode || `provider_http_${response.status}`, {
      httpStatus: response.status,
      retryable
    });
  }
}

function safeProviderCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,80}$/.test(normalized) ? normalized : "";
}

function requiredString(value, code) {
  const normalized = String(value || "");
  if (!normalized.trim()) {
    throw new EmailProviderError(code);
  }
  return normalized;
}

function requiredEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!isEmailAddress(normalized)) {
    throw new EmailProviderError("recipient_invalid");
  }
  return normalized;
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
