const ENABLED = "staging-verification";

export function isNativeGuestCheckoutEnabled(env = {}, options = {}) {
  if (typeof options.nativeGuestCheckoutEnabled === "boolean") {
    return options.nativeGuestCheckoutEnabled;
  }
  if (options.skipIdentityChecks === true) {
    return true;
  }
  return isStaging(env, options)
    && String(env.NATIVE_GUEST_CHECKOUT_MODE || "").trim().toLowerCase() === ENABLED;
}

export function isNativeGuestClaimEnabled(env = {}, options = {}) {
  if (typeof options.nativeGuestClaimEnabled === "boolean") {
    return options.nativeGuestClaimEnabled;
  }
  return isStaging(env, options)
    && String(env.NATIVE_GUEST_CLAIM_MODE || "").trim().toLowerCase() === ENABLED;
}

function isStaging(env, options) {
  return String(options.pipelineStage || env.PAYMENT_PIPELINE_STAGE || "")
    .trim()
    .toLowerCase() === "staging";
}
