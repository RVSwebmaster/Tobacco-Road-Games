import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const recipe = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(recipe, "../../..");
const output = path.join(repo, ".wrangler");
fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(output, "canonical-account-profile-072-"));
const site = path.join(root, "site");
const approved = "efb16dce8b3489193241809baeb6091b763e1071";
const baseline = "a0758e3c4a27800878ac7ed77becb86acfdf0414";
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 30 * 1024 * 1024 });
const fromGit = (revision, file) => git("show", `${revision}:${file}`);
const archive = path.join(root, "baseline.tar");
git("archive", "--format=tar", `--output=${archive}`, baseline, "--", ".", ":(exclude).wrangler");
fs.mkdirSync(site);
execFileSync("tar", ["-xf", archive, "-C", site]);
fs.unlinkSync(archive);
const changes = new Set();
function put(file, content) {
  const destination = path.join(site, file);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  fs.writeFileSync(destination, content);
  changes.add(file);
}
function read(file) {
  return fs.readFileSync(path.join(site, file), "utf8").replaceAll("\r\n","\n");
}
function replaceOnce(value, from, to) {
  if (!value.includes(from) || value.indexOf(from) !== value.lastIndexOf(from)) throw Error("Missing or duplicated release anchor: "+from);
  return value.replace(from, to);
}

const copy = [
  "assets/css/guest-landing.css", "assets/css/guest-login.css", "assets/css/member-profile.css",
  "assets/js/guest-login.js", "assets/js/member-identity-board.js", "assets/js/member-profile-library.js",
  "assets/js/creator-profile-catalog-rotation.js", "assets/js/open-rules-library.js", "assets/js/homepage-shelves.js",
  "assets/js/guest-product-preview.js", "assets/js/magical-bookshelf.js", "assets/js/progressive-navigation.js",
  "assets/images/storefront-shelf-dressing/upper-cabinet-creator-desktop.png",
  "assets/images/storefront-shelf-dressing/upper-cabinet-creator-tablet.png",
  "assets/images/storefront-shelf-dressing/upper-cabinet-creator-mobile.png",
  "functions/_middleware.js", "functions/_lib/member-profile-access.mjs", "scripts/build-store.js", "styles.css",
];
for (const badge of ["customer","creator","founding-25","premium-creator","admin","owner"]) {
  for (const ext of ["png","webp"]) copy.push(`assets/images/member-tier-badges/${badge}.${ext}`);
}
for (const file of copy) put(file, fromGit(approved, file));

// These blobs match the recovered production upload.
put("assets/js/creator-dashboard.js", fromGit("25f23d0ffba1d023da7ffed193fb9d3fcfda6fdc", "assets/js/creator-dashboard.js"));
for (const file of [
  "functions/_lib/homepage-config-d1.mjs",
  "functions/_lib/homepage-shelves.mjs",
  "functions/api/homepage-shelves.js",
]) put(file, fromGit("f7ab9891933be571daf02e5204a16303b8f64afd", file));

// Keep the live account page, signup, saved-card and payment implementation.
let auth = read("functions/_lib/account-auth.mjs");
auth = 'import { resolveMemberProfileAccess } from "./member-profile-access.mjs";\n' + auth;
auth = replaceOnce(auth, "  return json({\n    authenticated: true,", `  const profile = await env.TRG_ORDERS.prepare(
    "SELECT display_name, avatar_url FROM user_account_profiles WHERE user_id=?"
  ).bind(session.user.id).first();
  const memberAccess = await resolveMemberProfileAccess(env.TRG_ORDERS, session.user);
  return json({
    authenticated: true,`);
auth = replaceOnce(auth, "    user: publicUser(session.user)", `    user: {
      ...publicUser(session.user),
      customerPrivilegesActive: await customerPrivilegesActive(env.TRG_ORDERS, session.user.id),
      displayName: profile?.display_name || "",
      avatarUrl: profile?.avatar_url || "",
      ...memberAccess
    }`);
const response = "return json({ ok: true, user: publicUser(user) }, 200, {";
if (auth.split(response).length !== 3) throw Error("Expected the two live login responses");
auth = auth.replaceAll(response, "return json({ ok: true, user: { ...publicUser(user), customerPrivilegesActive: await customerPrivilegesActive(db, user.id) } }, 200, {");
auth += `
// A member without a new registration state keeps the production-072 access policy.
export async function customerPrivilegesActive(db, userId) {
  const state = await db.prepare("SELECT state FROM customer_registration_states WHERE user_id=?").bind(userId).first();
  return !state || state.state === "active";
}
`;
put("functions/_lib/account-auth.mjs", auth);

let identity = read("functions/_lib/member-profile-access.mjs");
identity = replaceOnce(identity, 'import { getCreatorCapacity } from "./marketplace-policy.mjs";', 'import { getCreatorTier } from "./marketplace-policy.mjs";');
identity = replaceOnce(identity, "capacityResolver = getCreatorCapacity", "capacityResolver = readProfileTier");
identity += `
// Resolve display identity independently from marketplace commission and capacity policy.
async function readProfileTier(database, creatorId) {
  const now = new Date().toISOString();
  const founding = await database.prepare(
    "SELECT 1 AS active FROM creator_commission_category_assignments WHERE creator_id=? AND category='founding25' AND effective_at<=? AND (revoked_at IS NULL OR revoked_at>?) LIMIT 1"
  ).bind(creatorId, now, now).first();
  if (founding) return { founding25: true };
  return getCreatorTier(database, creatorId);
}
`;
put("functions/_lib/member-profile-access.mjs", identity);

let library = read("functions/_lib/account-library.mjs");
library = replaceOnce(library, "import { getSessionFromRequest }", "import { customerPrivilegesActive, getSessionFromRequest }");
library = replaceOnce(library, "  const database = options.database || env.TRG_ORDERS;", `  const database = options.database || env.TRG_ORDERS;
  if (!(await customerPrivilegesActive(database, session.user.id))) {
    return json({ error: { code: "customer_registration_incomplete", message: "Customer access is pending." } }, 403);
  }`);
put("functions/_lib/account-library.mjs", library);

let account = read("assets/js/account.js");
account = replaceOnce(account, '        await api("/api/auth/login", data);\n        form.reset();', `        const result = await api("/api/auth/login", data);
        form.reset();
        if (result.user?.customerPrivilegesActive === true) {
          window.location.assign("/customer");
          return;
        }`);
account = replaceOnce(account, '      await api("/api/auth/google", {\n        credential: credentialResponse.credential,\n      });', `      const result = await api("/api/auth/google", {
        credential: credentialResponse.credential,
      });
      if (result.user?.customerPrivilegesActive === true) {
        window.location.assign("/customer");
        return;
      }`);
put("assets/js/account.js", account);
let accountHtml = replaceOnce(read("account.html"), "/assets/js/account.js?v=20261102a", "/assets/js/account.js?v=20261120-focused-account1");
accountHtml = accountHtml.replaceAll('href="/creator/"', 'href="/creator-dashboard/"');
put("account.html", accountHtml);

// Preserve the existing dashboard UI and backend at its live path.
put("_redirects", read("_redirects").trimEnd() + "\n/creator-dashboard/ /temp-creator/ 302\n");
const routes = read("_routes.json");
put("_routes.json", replaceOnce(routes, '"/customer.html"', '"/customer", "/customer/", "/customer.html"'));
const builder = read("scripts/build-pages-output.mjs");
put("scripts/build-pages-output.mjs", replaceOnce(builder, '"assets", "authors", "creator",', '"assets", "authors", "admin-profile", "customer-profile", "founding-25-profile", "premium-creator-profile", "owner-profile", "creator",'));

// Keep the shared renderer usable without bringing in a new Creator Dashboard.
let generator = read("scripts/build-store.js");
generator = generator.replace(/  const creatorDashboardTemplate = .*\n  writeFile\("creator-dashboard\/index\.html",.*\n/, "");
generator = generator.replace(/function renderCreatorFurniture\(\) \{[\s\S]*?^\}\n\n/m, "");
generator = replaceOnce(generator, "customer-session-navigation4", "customer-session-navigation4-focused1");
const generate = generator.match(/^  buildHomepage\(publicCatalogProducts, indexes, bundleRules\);\n  const guestLandingPage = [\s\S]+?^  }$/m)?.[0];
if (!generate) throw new Error("Missing approved storefront and Profile generation block");
generator = replaceOnce(generator, generate, "  buildFocusedPages(publicCatalogProducts);");
generator = replaceOnce(generator, "module.exports = {", `function buildFocusedPages(publicCatalogProducts = loadProducts(buildAuthorLookup(loadAuthors())).filter(isCatalogBrowsable)) {
${generate.replace("publicCatalogProducts, indexes, bundleRules", "publicCatalogProducts")}
}

module.exports = { buildFocusedPages,`);
put("scripts/build-store.js", generator);
const { buildFocusedPages, memberProfileRoutes } = createRequire(import.meta.url)(path.join(site, "scripts/build-store.js"));
buildFocusedPages();
for (const file of ["index.html", "guest/index.html", "customer.html", ...memberProfileRoutes.map(({ route }) => `${route.slice(1)}index.html`)]) {
  changes.add(file);
}
// Resolve the pre-existing missing client reference when a paid library has books.
put("assets/js/progressive-navigation.js", replaceOnce(read("assets/js/progressive-navigation.js"), "const makeBook = openRules?.createOpenRulesShelfBook;", "const makeBook = window.TRGOpenRulesLibrary?.createOpenRulesShelfBook;"));

const obsolete = ["assets/css/creator-dashboard.css", "assets/js/creator-open-rules.js"];
for (const file of obsolete) fs.unlinkSync(path.join(site, file));
const files = [...changes, ...obsolete].sort().flatMap(file => {
  if (obsolete.includes(file)) return [`D\t${file}`];
  let base;
  try {
    base = execFileSync("git", ["show", `${baseline}:${file}`], { cwd: repo, maxBuffer: 30 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [`A\t${file}`];
  }
  return base.equals(fs.readFileSync(path.join(site, file))) || base.equals(Buffer.from(read(file)))
    ? [] : [`M\t${file}`];
});
const manifest = files.join("\n") + "\n";
if (manifest !== fs.readFileSync(path.join(recipe, "release-files.tsv"), "utf8").replaceAll("\r\n", "\n")) {
  throw new Error("Focused release differs from the reviewed manifest");
}
fs.writeFileSync(path.join(root, "release-files.txt"), manifest);
console.log(root);
