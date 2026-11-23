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
