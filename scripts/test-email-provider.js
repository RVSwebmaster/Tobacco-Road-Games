const assert = require("node:assert/strict");

async function loadProvider() {
  return import("../functions/_lib/email-provider.mjs");
}

const message = {
  html: "<p>Hello</p>",
  subject: "Provider test",
  text: "Hello",
  to: "recipient@example.com"
};

function assertResendRequest(url, init, apiKey = "re_test_key") {
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, `Bearer ${apiKey}`);
  assert.equal(init.headers.accept, "application/json");
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers["idempotency-key"], "provider-test-key");
  assert.deepEqual(JSON.parse(init.body), {
    from: "Tobacco Road Games <orders@tobaccoroadgames.com>",
    html: message.html,
    reply_to: "support@example.com",
    subject: message.subject,
    tags: [],
    text: message.text,
    to: [message.to]
  });
}

async function testDefaultFetchKeepsRuntimeBinding() {
  const { createEmailProvider } = await loadProvider();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = function boundFetch(url, init) {
    called = true;
    assert.equal(this, globalThis, "Default fetch should be invoked with the runtime global binding.");
    assertResendRequest(url, init);
    return Promise.resolve(Response.json({ id: "email_123" }));
  };
  try {
    const provider = createEmailProvider({
      RESEND_API_KEY: "re_test_key",
      RESEND_REPLY_TO: "support@example.com"
    });
    assert.deepEqual(await provider.send(message, { idempotencyKey: "provider-test-key" }), {
      id: "email_123",
      status: "accepted"
    });
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testInjectedFetchStillWorks() {
  const { ResendEmailProvider } = await loadProvider();
  let called = false;
  const provider = new ResendEmailProvider({
    apiKey: "re_injected_key",
    replyTo: "support@example.com",
    fetchImpl: async (url, init) => {
      called = true;
      assertResendRequest(url, init, "re_injected_key");
      return Response.json({ id: "email_injected" });
    }
  });
  assert.deepEqual(await provider.send(message, { idempotencyKey: "provider-test-key" }), {
    id: "email_injected",
    status: "accepted"
  });
  assert.equal(called, true);
}

async function testProviderFailuresStaySanitized() {
  const { EmailProviderError, ResendEmailProvider } = await loadProvider();
  const provider = new ResendEmailProvider({
    apiKey: "re_failure_key",
    replyTo: "support@example.com",
    fetchImpl: async () => Response.json({
      name: "validation_error",
      message: "The sending domain is not verified."
    }, { status: 403, statusText: "Forbidden" })
  });

  await assert.rejects(
    () => provider.send(message, { idempotencyKey: "provider-test-key" }),
    (error) => {
      assert.equal(error instanceof EmailProviderError, true);
      assert.equal(error.message, "The email provider could not accept the message.");
      assert.equal(error.code, "validation_error");
      assert.equal(error.httpStatus, 403);
      assert.equal(error.retryable, false);
      assert.equal(error.indeterminate, false);
      assert.equal(String(error).includes("recipient@example.com"), false);
      assert.equal(String(error).includes("The sending domain is not verified."), false);
      return true;
    }
  );
}

(async () => {
  await testDefaultFetchKeepsRuntimeBinding();
  await testInjectedFetchStillWorks();
  await testProviderFailuresStaySanitized();
  console.log("Email provider tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
