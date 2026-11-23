import { EmailProviderError } from "./email-transport.mjs";

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const SMTP_TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();

export function createAccountEmailTransport(env = {}, options = {}) {
  const config = readConfig(env);
  const connect = options.connect || null;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : SMTP_TIMEOUT_MS;

  return {
    async send(message) {
      if (!config) throw new EmailProviderError("account_email_not_configured");
      const mail = normalizeMessage(message, config);
      const connectImpl = connect || await loadCloudflareConnect();
      return sendSmtpMessage(config, mail, connectImpl, timeoutMs);
    }
  };
}

export function isAccountEmailConfigured(env = {}) {
  return Boolean(readConfig(env));
}

async function sendSmtpMessage(config, mail, connect, timeoutMs) {
  let channel;
  let stage = "connect";
  let dataStarted = false;
  let accepted = false;

  try {
    const socket = connect(
      { hostname: config.host, port: config.port },
      { secureTransport: config.tlsMode === "tls" ? "on" : "starttls" }
    );
    await withTimeout(socket.opened, timeoutMs);
    channel = new SmtpChannel(socket, timeoutMs);

    expectCode(await channel.readResponse(), [220], "smtp_greeting_failed");
    let capabilities = await ehlo(channel);

    if (config.tlsMode === "starttls") {
      if (!hasCapability(capabilities, "STARTTLS")) {
        throw new EmailProviderError("smtp_starttls_unavailable");
      }
      stage = "starttls";
      expectCode(await channel.command("STARTTLS"), [220], "smtp_starttls_failed");
      await channel.upgradeToTls();
      capabilities = await ehlo(channel);
    }

    if (!hasCapability(capabilities, "AUTH")) {
      throw new EmailProviderError("smtp_auth_unavailable");
    }

    stage = "auth";
    expectCode(await channel.command("AUTH LOGIN"), [334], "smtp_auth_failed");
    expectCode(await channel.command(encodeBase64(config.username)), [334], "smtp_auth_failed");
    expectCode(await channel.command(encodeBase64(config.password)), [235], "smtp_auth_failed");

    stage = "mail_from";
    expectCode(await channel.command(`MAIL FROM:<${config.from}>`), [250], "smtp_sender_rejected");
    stage = "recipient";
    expectCode(await channel.command(`RCPT TO:<${mail.to}>`), [250, 251], "smtp_recipient_rejected");
    stage = "data";
    expectCode(await channel.command("DATA"), [354], "smtp_data_rejected");

    dataStarted = true;
    const mime = buildMimeMessage(config, mail);
    if (encoder.encode(mime).byteLength > MAX_MESSAGE_BYTES) {
      throw new EmailProviderError("smtp_message_too_large");
    }
    await channel.writeData(mime);
    const finalReply = await channel.readResponse();
    expectCode(finalReply, [250], "smtp_delivery_rejected");
    accepted = true;

    stage = "quit";
    await channel.command("QUIT").catch(() => null);
    return { id: mail.messageId, status: "accepted" };
  } catch (error) {
    if (error instanceof EmailProviderError) {
      if (dataStarted && !accepted && error.code === "smtp_timeout") {
        throw new EmailProviderError("smtp_delivery_indeterminate", { indeterminate: true });
      }
      throw error;
    }

    if (dataStarted && !accepted) {
      throw new EmailProviderError("smtp_delivery_indeterminate", { indeterminate: true });
    }
    throw new EmailProviderError(stage === "connect" ? "smtp_connection_failed" : "smtp_protocol_failed", {
      retryable: stage !== "auth"
    });
  } finally {
    await channel?.close();
  }
}

async function ehlo(channel) {
  const reply = await channel.command("EHLO tobaccoroadgames.com");
  expectCode(reply, [250], "smtp_ehlo_failed");
  return reply;
}

function readConfig(env) {
  const host = String(env.MAIL_SMTP_HOST || "").trim();
  const port = Number(env.MAIL_SMTP_PORT);
  const username = String(env.MAIL_SMTP_USERNAME || "").trim();
  const password = String(env.MAIL_SMTP_PASSWORD || "").replace(/\s+/g, "");
  const tlsMode = String(env.MAIL_SMTP_TLS_MODE || "starttls").trim().toLowerCase();
  const from = String(env.MAIL_FROM_ADDRESS || username).trim().toLowerCase();
  const replyTo = String(env.MAIL_REPLY_TO || from).trim().toLowerCase();

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || port === 25) return null;
  if (!username || !password || !isEmailAddress(username) || !isEmailAddress(from) || !isEmailAddress(replyTo)) return null;
  if (tlsMode !== "starttls" && tlsMode !== "tls") return null;

  return { from, host, password, port, replyTo, tlsMode, username };
}

function normalizeMessage(message, config) {
  const to = String(message?.to || "").trim().toLowerCase();
  const subject = String(message?.subject || "").trim();
  const text = String(message?.text || "");
  const html = String(message?.html || "");
  if (!isEmailAddress(to) || !subject || !text.trim() || !html.trim()) {
    throw new EmailProviderError("smtp_message_invalid");
  }
  if (/\r|\n/.test(subject)) throw new EmailProviderError("smtp_header_invalid");

  return {
    html,
    messageId: `<${crypto.randomUUID()}@${config.from.split("@")[1]}>`,
    subject,
    text,
    to
  };
}

function buildMimeMessage(config, mail) {
  const boundary = `trg-${crypto.randomUUID()}`;
  const from = `Tobacco Road Games <${config.from}>`;
  const subject = encodeHeader(mail.subject);
  const textBody = wrapBase64(encodeBase64(mail.text));
  const htmlBody = wrapBase64(encodeBase64(mail.html));
  const rows = [
    `From: ${from}`,
    `To: <${mail.to}>`,
    `Reply-To: <${config.replyTo}>`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${mail.messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    textBody,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    htmlBody,
    `--${boundary}--`,
    ""
  ];
  return dotStuff(rows.join("\r\n"));
}

function expectCode(reply, expected, code) {
  if (expected.includes(reply.code)) return reply;
  const temporary = reply.code >= 400 && reply.code < 500;
  throw new EmailProviderError(code, {
    httpStatus: reply.code,
    retryable: temporary
  });
}

function hasCapability(reply, name) {
  return reply.lines.some((line) => {
    const match = line.match(/^\d{3}[- ](.*)$/);
    return Boolean(match && match[1].split(/\s+/)[0].toUpperCase() === name);
  });
}

function encodeHeader(value) {
  if (/[^\x20-\x7e]/.test(value)) return `=?UTF-8?B?${encodeBase64(value)}?=`;
  return value;
}

function encodeBase64(value) {
  const bytes = encoder.encode(String(value));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function wrapBase64(value) {
  return String(value).replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function dotStuff(value) {
  return value.replace(/(^|\r\n)\./g, "$1..");
}

function isEmailAddress(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value || "").trim());
}

async function loadCloudflareConnect() {
  try {
    const sockets = await import("cloudflare:sockets");
    return sockets.connect;
  } catch {
    throw new EmailProviderError("smtp_transport_unavailable");
  }
}

class SmtpChannel {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.attachStreams();
  }

  attachStreams() {
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.decoder = new TextDecoder();
    this.buffer = "";
  }

  async command(line) {
    if (/\r|\n/.test(line)) throw new EmailProviderError("smtp_command_invalid");
    await this.writer.write(encoder.encode(`${line}\r\n`));
    return this.readResponse();
  }

  async writeData(value) {
    await this.writer.write(encoder.encode(`${value}\r\n.\r\n`));
  }

  async readResponse() {
    const first = await this.readLine();
    const match = first.match(/^(\d{3})([- ])(.*)$/);
    if (!match) throw new EmailProviderError("smtp_response_invalid");
    const code = Number(match[1]);
    const lines = [first];
    let separator = match[2];
    while (separator === "-") {
      const line = await this.readLine();
      const next = line.match(/^(\d{3})([- ])(.*)$/);
      if (!next || Number(next[1]) !== code) throw new EmailProviderError("smtp_response_invalid");
      lines.push(line);
      separator = next[2];
    }
    return { code, lines };
  }

  async readLine() {
    while (true) {
      const end = this.buffer.indexOf("\r\n");
      if (end >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        return line;
      }
      const chunk = await withTimeout(this.reader.read(), this.timeoutMs);
      if (chunk.done) throw new EmailProviderError("smtp_connection_closed", { retryable: true });
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async upgradeToTls() {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = this.socket.startTls();
    await withTimeout(this.socket.opened, this.timeoutMs);
    this.attachStreams();
  }

  async close() {
    try { this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.socket?.close(); } catch {}
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new EmailProviderError("smtp_timeout", { retryable: true })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
