const assert = require("node:assert/strict");
const path = require("node:path");

const animation = require(path.resolve(__dirname, "../assets/js/magical-bookshelf.js"));

const eighteen = animation.buildRevealPlan([18]);
assert.equal(eighteen.length, 9);
assert.deepEqual(eighteen[0], { shelfIndex: 0, bookIndexes: [0, 1] });
assert.deepEqual(eighteen[8], { shelfIndex: 0, bookIndexes: [16, 17] });

const mixed = animation.buildRevealPlan([0, 5, 18]);
assert.equal(mixed.length, 12);
assert.deepEqual(mixed.slice(0, 3).map((step) => step.bookIndexes), [[0, 1], [2, 3], [4]]);
assert.ok(mixed.slice(0, 3).every((step) => step.shelfIndex === 1));
assert.ok(mixed.slice(3).every((step) => step.shelfIndex === 2));

const positionedBooks = [0, 1, 2, 3, 4].map((position) => ({ position }));
assert.deepEqual(animation.orderBooksByDirection(positionedBooks, "left-to-right", (book) => book.position).map((book) => book.position), [0, 1, 2, 3, 4]);
assert.deepEqual(animation.orderBooksByDirection(positionedBooks, "right-to-left", (book) => book.position).map((book) => book.position), [4, 3, 2, 1, 0]);
assert.deepEqual(animation.orderBooksByDirection(positionedBooks, "outer-inward", (book) => book.position).map((book) => book.position), [0, 4, 1, 3, 2]);

const palette = new Set(["#e8bd55", "#5ca9ff", "#a979ff", "#64c982", "#f18ab9", "#f1a447", "#ffffff"]);
const deterministicValues = [0, 0, 0, 0, 0, .34, .16, .99, .99, .99, .67, .33, .5, .5, .5, .2];
let deterministicIndex = 0;
const flashes = animation.createFlashDescriptors(() => deterministicValues[deterministicIndex++ % deterministicValues.length]);
assert.equal(flashes.length, 1);
assert.ok(flashes.every((flash) => palette.has(flash.color)));
assert.ok(flashes.every((flash) => flash.sizePx >= 18 && flash.sizePx <= 34));
assert.ok(flashes.every((flash) => flash.offsetX >= -22 && flash.offsetX <= 22));
assert.ok(flashes.every((flash) => flash.offsetY >= -14 && flash.offsetY <= 14));
assert.ok(flashes.every((flash) => flash.durationMs >= 420 && flash.durationMs <= 600));

for (const value of [0, .34, .67, .999]) {
  const group = animation.createFlashDescriptors(() => value);
  assert.ok(group.length >= 1 && group.length <= 3);
  assert.ok(group.every((flash) => !Object.hasOwn(flash, "delayMs")));
}

const firstReplay = animation.createFlashDescriptors(() => .1);
const secondReplay = animation.createFlashDescriptors(() => .8);
assert.notDeepEqual(firstReplay, secondReplay);

function createHarness(counts) {
  const steps = animation.buildRevealPlan(counts);
  const queues = [];
  const scheduledDelays = [];
  const revealed = new Set();
  let effectsCleared = 0;
  let completed = 0;
  const runner = animation.createSequenceRunner({
    steps,
    revealStep(step) {
      step.bookIndexes.forEach((bookIndex) => revealed.add(`${step.shelfIndex}:${bookIndex}`));
    },
    revealAll() {
      counts.forEach((count, shelfIndex) => {
        for (let bookIndex = 0; bookIndex < count; bookIndex += 1) revealed.add(`${shelfIndex}:${bookIndex}`);
      });
    },
    clearEffects() { effectsCleared += 1; },
    onComplete() { completed += 1; },
    schedule(callback, delay) { queues.push(callback); scheduledDelays.push(delay); return callback; },
    cancel(callback) {
      const index = queues.indexOf(callback);
      if (index >= 0) queues.splice(index, 1);
    },
  });
  return { completed: () => completed, effectsCleared: () => effectsCleared, queues, revealed, runner, scheduledDelays };
}

const normal = createHarness([18, 18]);
normal.runner.start();
while (normal.queues.length) normal.queues.shift()();
assert.equal(normal.revealed.size, 36);
assert.equal(normal.completed(), 1);
assert.equal(normal.runner.isRunning(), false);
assert.ok(normal.scheduledDelays.every((delay) => delay === 500));

const firstPairSkip = createHarness([18]);
firstPairSkip.runner.start();
assert.equal(firstPairSkip.revealed.size, 2);
firstPairSkip.runner.finish();
assert.equal(firstPairSkip.revealed.size, 18);
assert.equal(firstPairSkip.effectsCleared(), 1);
assert.equal(firstPairSkip.queues.length, 0);

const midwaySkip = createHarness([5, 18]);
midwaySkip.runner.start();
midwaySkip.queues.shift()();
midwaySkip.queues.shift()();
assert.equal(midwaySkip.revealed.size, 5);
assert.equal(midwaySkip.runner.isRunning(), true);
midwaySkip.runner.finish();
assert.equal(midwaySkip.revealed.size, 23);
assert.equal(midwaySkip.effectsCleared(), 1);

assert.equal(animation.isStagingPreviewHost("abc.tobacco-road-games-staging.pages.dev"), true);
assert.equal(animation.isStagingPreviewHost("tobaccoroadgames.com"), false);
assert.equal(animation.isTextEntryTarget({ matches: (selector) => selector.includes("input") }), true);
assert.equal(animation.isTextEntryTarget({ matches: () => false }), false);

console.log("Guest magical bookshelf animation tests passed.");
