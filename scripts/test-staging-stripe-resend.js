const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.resolve(__dirname, "..", "ops", "staging", "resend-stripe-event.ps1");
const source = fs.readFileSync(scriptPath, "utf8");

assert.match(source, /ValidatePattern\('\^evt_\[A-Za-z0-9\]\+\$'\)/, "The operation must accept only Stripe Event IDs.");
assert.match(source, /https:\/\/tobacco-road-games-staging\.pages\.dev\/api\/stripe\/webhook/, "The exact staging webhook URL must be fixed in the operation.");
assert.match(source, /livemode\s+-ne\s+\$false/, "The operation must reject live Events.");
assert.match(source, /Where-Object\s+\{\s+\$_\.url\s+-ceq\s+\$ExpectedWebhookUrl\s+\}/, "Endpoint discovery must require an exact URL match.");
assert.match(source, /events resend \$EventId/, "The operation must use Stripe's supported Event resend command.");
assert.match(source, /--webhook-endpoint=\$endpointId/, "The resend must target only the discovered staging endpoint.");
assert.match(source, /--confirm/, "The repeatable operation must not require an interactive resend prompt.");
assert.doesNotMatch(source, /--live(?:\s|`|$)/m, "The staging operation must never pass Stripe's live-mode flag.");
assert.match(source, /\$null\s*=\s*&\s*\$StripeCli events resend/, "The resend response must be suppressed from console output.");
assert.doesNotMatch(source, /sk_(?:test|live)_/, "No Stripe API credential may be committed in the operation.");

console.log("Staging Stripe Event resend operation tests passed.");
