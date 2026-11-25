const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scheduleUrl = pathToFileURL(path.join(root, "assets/js/creator-plateboard-schedule.mjs"));
const helperUrl = pathToFileURL(path.join(root, "functions/_lib/creator-plateboard.mjs"));

(async () => {
  const { buildCreatorPlateboardSchedule } = await import(scheduleUrl.href);
  const { getCreatorPlateboardAds, getCreatorPlateboardIntervalSeconds } = await import(helperUrl.href);
  const date = "2026-11-25";
  const creators = Array.from({ length: 720 }, (_, index) => ({ creatorId: `creator-${index}` }));
  const scheduled = buildCreatorPlateboardSchedule(creators, { date, intervalSeconds: 60 });
  assert.equal(scheduled.capacity, 1440);
  assert.equal(scheduled.capacityExceeded, false);
  assert.equal(scheduled.schedule.length, 1440);
  for (const creator of creators) {
    const appearances = scheduled.schedule.filter(item => item.creatorId === creator.creatorId);
    assert.equal(appearances.length, 2, `${creator.creatorId} must have exactly two daily appearances.`);
    assert.equal(appearances[1].startsAtMs - appearances[0].startsAtMs, 12 * 60 * 60 * 1000);
  }

  const overCapacity = buildCreatorPlateboardSchedule([...creators, { creatorId: "creator-720" }], { date, intervalSeconds: 60 });
  assert.equal(overCapacity.capacityExceeded, true);
  assert.equal(overCapacity.schedule.length, 0);
  const increasedCapacity = buildCreatorPlateboardSchedule([...creators, { creatorId: "creator-720" }], { date, intervalSeconds: 59 });
  assert.equal(increasedCapacity.capacityExceeded, false);
  assert.equal(increasedCapacity.schedule.length, 1442);
  assert.throws(() => buildCreatorPlateboardSchedule([{ creatorId: "same" }, { creatorId: "same" }]), /more than one advertisement/);
  assert.throws(() => buildCreatorPlateboardSchedule([], { intervalSeconds: 0 }), /whole number/);
  assert.equal(getCreatorPlateboardIntervalSeconds("30"), 30);
  assert.equal(getCreatorPlateboardIntervalSeconds("0"), 60);

  let capturedSql = "";
  const database = {
    prepare(sql) {
      capturedSql = sql;
      return { all: async () => ({ results: [{ creatorId: "creator-a", adKey: 1, destinationUrl: null, title: "Creator advertisement" }] }) };
    }
  };
  const ads = await getCreatorPlateboardAds(database);
  assert.equal(ads.length, 1);
  assert.equal(ads[0].destinationUrl, null, "An accepted creative remains eligible without a product destination.");
  assert.equal(ads[0].title, "Creator advertisement");
  assert.match(capturedSql, /marketplace_status = 'approved'/);
  assert.match(capturedSql, /validation_state = 'accepted'/);
  assert.match(capturedSql, /LEFT JOIN creator_listings/);
  const eligibilityWhere = capturedSql.split("WHERE")[1].split("\n    )")[0];
  assert.doesNotMatch(eligibilityWhere, /l\.(?:lifecycle_state|publication_state|inactivity_state|owner_review_hold|public_product_slug|source_product_slug)/);
  assert.match(capturedSql, /ELSE NULL\s+END destinationUrl/);
  assert.match(capturedSql, /PARTITION BY c\.creator_id/);
  assert.doesNotMatch(capturedSql, /creator_ad_slots/, "Plateboard eligibility must not depend on paid advertising slots.");

  const policy = fs.readFileSync(path.join(root, "docs/CREATOR-PLATEBOARD-ADVERTISING-POLICY.md"), "utf8");
  assert.match(policy, /two free advertising appearances per UTC day/i);
  assert.match(policy, /does not promise impressions, clicks, sales, conversions, or particular viewing times/i);
  assert.match(policy, /does not add paid tiers/i);
  assert.match(policy, /An active or published product listing is not required/i);
  assert.match(policy, /does not need to promote a Tobacco Road Games product, an RPG, or the Creator's own business/i);

  console.log("Creator plateboard schedule and feed tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
