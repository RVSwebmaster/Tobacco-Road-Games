import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateEnvironmentConfig } from "./release-pipeline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    args.set(key, argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
  }
  return args;
}

function required(args, name) {
  const value = args.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing --${name}.`);
  return value;
}

function getCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
}

function mergeCookies(existing, updates) {
  const values = new Map((existing || "").split(";").map((value) => value.trim()).filter(Boolean).map((value) => {
    const separator = value.indexOf("=");
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
  for (const raw of updates.filter(Boolean)) {
    const cookie = raw.split(";", 1)[0];
    const separator = cookie.indexOf("=");
    if (separator > 0) values.set(cookie.slice(0, separator), cookie.slice(separator + 1));
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler did not return D1 JSON output.");
  return JSON.parse(output.slice(start));
}

function resolveWranglerCli() {
  if (process.platform !== "win32") return null;
  const cacheRoot = path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx");
  if (!fs.existsSync(cacheRoot)) return null;
  return fs.readdirSync(cacheRoot).map((entry) => {
    const cli = path.join(cacheRoot, entry, "node_modules", "wrangler", "bin", "wrangler.js");
    const packageFile = path.join(cacheRoot, entry, "node_modules", "wrangler", "package.json");
    if (!fs.existsSync(cli) || !fs.existsSync(packageFile)) return null;
    const version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version || "0.0.0";
    return { cli, version: version.split(".").map(Number) };
  }).filter(Boolean).sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      const difference = (right.version[index] || 0) - (left.version[index] || 0);
      if (difference) return difference;
    }
    return 0;
  })[0]?.cli || null;
}

function wranglerD1(sqlFile, configCwd, envName) {
  const cliArgs = [
    "d1", "execute", "TRG_ORDERS", "--remote", "--command", fs.readFileSync(sqlFile, "utf8"),
    "--config", path.join(configCwd, "wrangler.toml"), "--env", envName, "--yes", "--json"
  ];
  const wranglerCli = resolveWranglerCli();
  const command = wranglerCli
    ? [process.execPath, [wranglerCli, ...cliArgs]]
    : process.platform === "win32"
      ? [process.execPath, [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"), "--yes", "wrangler", ...cliArgs]]
      : ["npx", ["wrangler", ...cliArgs]];
  const output = execFileSync(command[0], command[1], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 });
  return parseWranglerJson(output).flatMap((entry) => entry.results || []);
}

function writeSql(file, sql) {
  fs.writeFileSync(file, `${sql.trim()}\n`, { encoding: "utf8", flag: "w" });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const target = required(args, "target");
  if (!["staging", "production"].includes(target)) throw new Error("Deployed account smoke supports staging and production only.");
  if (target === "production" && args.get("allow-production") !== true) throw new Error("Production smoke requires the explicit --allow-production flag.");
  const baseUrl = required(args, "base-url").replace(/\/$/, "");
  const configPath = path.resolve(ROOT, required(args, "config"));
  const configCwd = path.resolve(ROOT, required(args, "config-cwd"));
  const envName = required(args, "wrangler-env");
  const outputPath = path.resolve(ROOT, required(args, "output"));
  const envMap = JSON.parse(fs.readFileSync(path.join(ROOT, "ops", "release", "environments.json"), "utf8"));
  const environment = envMap[target];
  const config = fs.readFileSync(configPath, "utf8");
  const bindingCheck = validateEnvironmentConfig(config, target, envMap);
  if (!bindingCheck.ok) throw new Error(`Refusing auth smoke with unsafe environment config: ${bindingCheck.errors.join("; ")}`);
  const parsedBase = new URL(baseUrl);
  const expectedHost = new URL(environment.publicOrigin).hostname;
  if (target === "production" ? parsedBase.hostname !== expectedHost : !parsedBase.hostname.endsWith(`.${expectedHost}`) && parsedBase.hostname !== expectedHost) {
    throw new Error("Base URL does not belong to the configured target environment.");
  }
  const releaseWorkDir = path.resolve(ROOT, args.get("temp-dir") || path.join(".wrangler", "release-pipeline", "deployed-auth-smoke"));
  if (!releaseWorkDir.startsWith(path.join(ROOT, ".wrangler", "release-pipeline"))) throw new Error("Smoke workspace must stay under .wrangler/release-pipeline.");
  fs.mkdirSync(releaseWorkDir, { recursive: true });
  const precheckFile = path.join(releaseWorkDir, "unique-account-precheck.sql");
  const cleanupFile = path.join(releaseWorkDir, "controlled-account-cleanup.sql");
  const cleanupCheckFile = path.join(releaseWorkDir, "controlled-account-cleanup-check.sql");
  const id = crypto.randomUUID();
  const email = `trg-release-smoke-${id}@example.com`;
  const password = `Trg!9_${crypto.randomBytes(24).toString("base64url")}`;
  const results = {
    registration: false,
    immediateLogin: false,
    customerAccess: false,
    logout: false,
    signedOutCustomerBlocked: false,
    loginAfterLogout: false,
    duplicateRegistrationRejected: false,
    accountCleanup: false
  };
  let userId = "";
  let failure = "";

  try {
    writeSql(precheckFile, `SELECT COUNT(*) AS count FROM users WHERE email_normalized='${email}';`);
    const precheck = wranglerD1(precheckFile, configCwd, envName);
    if (Number(precheck[0]?.count) !== 0) throw new Error("Generated account identity unexpectedly already exists.");

    const origin = new URL(baseUrl).origin;
    async function request(route, options = {}) {
      return fetch(`${baseUrl}${route}`, { redirect: "manual", ...options });
    }
    const anon = await request("/api/account/me");
    const anonPayload = await anon.json();
    if (anon.status !== 200 || !anonPayload.csrfToken) throw new Error("CSRF bootstrap failed.");
    let cookie = getCookies(anon).map((item) => item.split(";", 1)[0]).join("; ");
    const headers = { "content-type": "application/json", origin };
    const anonymousCustomer = await request("/customer");
    results.signedOutCustomerBlocked = anonymousCustomer.status === 302
      && new URL(anonymousCustomer.headers.get("location")).pathname === "/guest/";

    const registration = await request("/api/auth/register", {
      method: "POST", headers, body: JSON.stringify({ email, password, passwordConfirmation: password })
    });
    const registered = await registration.json();
    if (registration.status !== 201 || registered.user?.email !== email || registered.user?.emailVerified !== false) {
      throw new Error("Immediate Customer registration failed or returned an unexpected account state.");
    }
    userId = String(registered.user.id || "");
    if (!/^[a-f0-9-]{36}$/i.test(userId)) throw new Error("Registration did not return a valid new account ID.");
    cookie = mergeCookies(cookie, getCookies(registration));
    const activeRowsFile = path.join(releaseWorkDir, "controlled-account-state.sql");
    writeSql(activeRowsFile, `SELECT u.status,u.role,u.email_verified,s.state,(SELECT COUNT(*) FROM email_verification_tokens t WHERE t.user_id=u.id) AS verification_tokens FROM users u LEFT JOIN customer_registration_states s ON s.user_id=u.id WHERE u.id='${userId}' AND u.email_normalized='${email}';`);
    const activeRows = wranglerD1(activeRowsFile, configCwd, envName);
    if (activeRows.length !== 1 || activeRows[0].status !== "active" || activeRows[0].role !== "user" || Number(activeRows[0].email_verified) !== 0 || activeRows[0].state !== "active" || Number(activeRows[0].verification_tokens) !== 0) {
      throw new Error("Registration state or verification-token assertions failed.");
    }
    results.registration = true;
    const me = await request("/api/account/me", { headers: { cookie } });
    if ((await me.json()).authenticated !== true) throw new Error("Registration session was not authenticated.");
    const customer = await request("/customer", { headers: { cookie } });
    if (customer.status !== 200) throw new Error("Authenticated Customer Storefront did not load.");
    results.customerAccess = true;

    const logout = await request("/api/auth/logout", { method: "POST", headers: { ...headers, cookie }, body: "{}" });
    if (logout.status !== 200 || !getCookies(logout).some((item) => /__Host-trg_session=;/.test(item))) throw new Error("Logout did not clear the session cookie.");
    const signedOut = await request("/api/account/me", { headers: { cookie } });
    if ((await signedOut.json()).authenticated !== false) throw new Error("Logout did not revoke the current session.");
    const blocked = await request("/customer", { headers: { cookie } });
    if (blocked.status !== 302 || new URL(blocked.headers.get("location")).pathname !== "/guest/") throw new Error("Signed-out Customer access was not redirected.");
    results.logout = true;
    results.signedOutCustomerBlocked = true;

    const login = await request("/api/auth/login", { method: "POST", headers, body: JSON.stringify({ email, password }) });
    if (login.status !== 200) throw new Error("Login after logout did not succeed.");
    const loginCookie = mergeCookies("", getCookies(login));
    if ((await request("/customer", { headers: { cookie: loginCookie } })).status !== 200) throw new Error("Reauthenticated Customer could not open /customer.");
    results.immediateLogin = true;
    results.loginAfterLogout = true;

    const duplicate = await request("/api/auth/register", { method: "POST", headers, body: JSON.stringify({ email, password, passwordConfirmation: password }) });
    if (duplicate.status !== 409) throw new Error("Duplicate registration was not safely rejected.");
    results.duplicateRegistrationRejected = true;
  } catch (error) {
    failure = error.message || "Staging account flow failed.";
  } finally {
    if (userId) {
      try {
        writeSql(cleanupFile, `DELETE FROM sessions WHERE user_id='${userId}';\nDELETE FROM email_verification_tokens WHERE user_id='${userId}';\nDELETE FROM password_reset_tokens WHERE user_id='${userId}';\nDELETE FROM customer_registration_states WHERE user_id='${userId}';\nDELETE FROM user_account_profiles WHERE user_id='${userId}';\nDELETE FROM user_identities WHERE user_id='${userId}';\nDELETE FROM password_credentials WHERE user_id='${userId}';\nDELETE FROM users WHERE id='${userId}' AND email_normalized='${email}' AND status='active' AND role='user';`);
        wranglerD1(cleanupFile, configCwd, envName);
        writeSql(cleanupCheckFile, `SELECT (SELECT COUNT(*) FROM users WHERE id='${userId}' AND email_normalized='${email}') AS accounts,(SELECT COUNT(*) FROM sessions WHERE user_id='${userId}') AS sessions,(SELECT COUNT(*) FROM email_verification_tokens WHERE user_id='${userId}') AS verification_tokens,(SELECT COUNT(*) FROM password_reset_tokens WHERE user_id='${userId}') AS reset_tokens,(SELECT COUNT(*) FROM customer_registration_states WHERE user_id='${userId}') AS registration_states,(SELECT COUNT(*) FROM password_credentials WHERE user_id='${userId}') AS credentials;`);
        const cleanupCounts = wranglerD1(cleanupCheckFile, configCwd, envName)[0];
        results.accountCleanup = Boolean(cleanupCounts) && Object.values(cleanupCounts).every((value) => Number(value) === 0);
        if (!results.accountCleanup) failure ||= "Controlled account cleanup left a record behind.";
      } catch {
        results.accountCleanup = false;
        failure ||= "Controlled account cleanup could not be verified.";
      }
    } else {
      results.accountCleanup = true;
    }
  }

  const report = {
    target,
    passed: !failure && Object.values(results).every(Boolean),
    commitSha: required(args, "commit-sha"),
    manifestSha256: required(args, "manifest-sha256"),
    verifiedAt: new Date().toISOString(),
    checks: results,
    ...(failure ? { failure } : {})
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
