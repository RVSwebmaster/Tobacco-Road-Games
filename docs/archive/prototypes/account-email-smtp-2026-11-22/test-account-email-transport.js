const assert = require("node:assert/strict");

const SMTP_PASSWORD = "fake-app-password-not-a-real-secret";
const BASE_ENV = Object.freeze({
  MAIL_SMTP_HOST: "smtp.gmail.com",
  MAIL_SMTP_PORT: "587",
  MAIL_SMTP_TLS_MODE: "starttls",
  MAIL_SMTP_USERNAME: "tobaccoroadgames@gmail.com",
  MAIL_SMTP_PASSWORD: SMTP_PASSWORD,
  MAIL_FROM_ADDRESS: "tobaccoroadgames@gmail.com",
  MAIL_REPLY_TO: "tobaccoroadgames@gmail.com"
});

const MESSAGE = Object.freeze({
  html: "<p>Verify your TRG account.</p>",
  subject: "Verify your Tobacco Road Games account",
  text: "Verify your TRG account.",
  to: "member@example.net"
});

async function testRequiredConfiguration() {
  const { isAccountEmailConfigured } = await loadTransport();
  assert.equal(isAccountEmailConfigured(BASE_ENV), true);
  assert.equal(isAccountEmailConfigured({ ...BASE_ENV, MAIL_SMTP_PASSWORD: "" }), false);
  assert.equal(isAccountEmailConfigured({ ...BASE_ENV, MAIL_SMTP_PORT: "25" }), false);
  assert.equal(isAccountEmailConfigured({ ...BASE_ENV, MAIL_SMTP_TLS_MODE: "plain" }), false);
  assert.equal(isAccountEmailConfigured({ ...BASE_ENV, MAIL_REPLY_TO: "bad" }), false);
}

async function testStartTlsAuthenticatedDelivery() {
  const { createAccountEmailTransport } = await loadTransport();
  const env = { ...BASE_ENV, MAIL_SMTP_PASSWORD: "fake app password" };
  const plainSocket = fakeSocket([
    "220 smtp.gmail.com ESMTP ready",
    "250-smtp.gmail.com",
    "250-STARTTLS",
    "250 AUTH LOGIN PLAIN",
    "220 2.0.0 Ready to start TLS"
  ]);
  const secureSocket = fakeSocket([
    "250-smtp.gmail.com",
    "250-AUTH LOGIN PLAIN",
    "250 SIZE 35882577",
    "334 VXNlcm5hbWU6",
    "334 UGFzc3dvcmQ6",
    "235 2.7.0 Accepted",
    "250 2.1.0 Sender OK",
    "250 2.1.5 Recipient OK",
    "354 End data with <CR><LF>.<CR><LF>",
    "250 2.0.0 Message accepted",
    "221 2.0.0 Closing connection"
  ]);
  plainSocket.tlsSocket = secureSocket;

  let connectCalls = 0;
  const provider = createAccountEmailTransport(env, {
    connect(address, options) {
      connectCalls += 1;
      assert.deepEqual(address, { hostname: "smtp.gmail.com", port: 587 });
      assert.deepEqual(options, { secureTransport: "starttls" });
      return plainSocket;
    }
  });

  const result = await provider.send(MESSAGE, { idempotencyKey: "ignored-by-smtp" });
  assert.equal(result.status, "accepted");
  assert.match(result.id, /^<[^>]+@gmail\.com>$/);
  assert.equal(connectCalls, 1);
  assert.equal(plainSocket.startTlsCalled, true);

  assert.match(plainSocket.written, /EHLO tobaccoroadgames\.com\r\n/);
  assert.match(plainSocket.written, /STARTTLS\r\n/);
  assert.match(secureSocket.written, /AUTH LOGIN\r\n/);
  assert.ok(secureSocket.written.includes(`${base64(BASE_ENV.MAIL_SMTP_USERNAME)}\r\n`));
  assert.ok(secureSocket.written.includes(`${base64("fakeapppassword")}\r\n`));
  assert.doesNotMatch(secureSocket.written, /fake app password/);
  assert.match(secureSocket.written, /MAIL FROM:<tobaccoroadgames@gmail\.com>\r\n/);
  assert.match(secureSocket.written, /RCPT TO:<member@example\.net>\r\n/);
  assert.match(secureSocket.written, /Reply-To: <tobaccoroadgames@gmail\.com>/);
  assert.match(secureSocket.written, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(secureSocket.written, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(secureSocket.written, /QUIT\r\n/);
}

async function testStartTlsAndAuthFailuresAreSanitized() {
  const { createAccountEmailTransport } = await loadTransport();
  const { EmailProviderError } = await import("../functions/_lib/email-transport.mjs");
  const noStartTls = fakeSocket([
    "220 smtp.gmail.com ESMTP ready",
    "250-smtp.gmail.com",
    "250 AUTH LOGIN PLAIN"
  ]);
  const provider = createAccountEmailTransport(BASE_ENV, { connect: () => noStartTls });
  await assert.rejects(
    () => provider.send(MESSAGE),
    (error) => error instanceof EmailProviderError && error.code === "smtp_starttls_unavailable"
  );

  const plainSocket = fakeSocket([
    "220 smtp.gmail.com ESMTP ready",
    "250-smtp.gmail.com",
    "250-STARTTLS",
    "250 AUTH LOGIN PLAIN",
    "220 Ready"
  ]);
  const secureSocket = fakeSocket([
    "250-smtp.gmail.com",
    "250 AUTH LOGIN PLAIN",
    "334 VXNlcm5hbWU6",
    "535 5.7.8 Username and Password not accepted"
  ]);
  plainSocket.tlsSocket = secureSocket;
  const authProvider = createAccountEmailTransport(BASE_ENV, { connect: () => plainSocket });
  await assert.rejects(
    () => authProvider.send(MESSAGE),
    (error) => {
      assert.equal(error instanceof EmailProviderError, true);
      assert.equal(error.code, "smtp_auth_failed");
      assert.equal(error.httpStatus, 535);
      assert.equal(error.message.includes(SMTP_PASSWORD), false);
      assert.equal(String(error).includes(BASE_ENV.MAIL_SMTP_USERNAME), false);
      return true;
    }
  );
}

function fakeSocket(responseLines) {
  const bytes = new TextEncoder().encode(`${responseLines.join("\r\n")}\r\n`);
  let written = "";
  const socket = {
    opened: Promise.resolve(),
    readable: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }),
    writable: new WritableStream({
      write(chunk) {
        written += new TextDecoder().decode(chunk);
      }
    }),
    closed: Promise.resolve(),
    startTlsCalled: false,
    tlsSocket: null,
    startTls() {
      this.startTlsCalled = true;
      return this.tlsSocket;
    },
    async close() {}
  };
  Object.defineProperty(socket, "written", { get: () => written });
  return socket;
}

function base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function loadTransport() {
  return import("../functions/_lib/account-email-transport.mjs");
}

(async () => {
  await testRequiredConfiguration();
  await testStartTlsAuthenticatedDelivery();
  await testStartTlsAndAuthFailuresAreSanitized();
  console.log("Account SMTP transport tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
