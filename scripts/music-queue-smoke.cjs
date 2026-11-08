const assert = require("node:assert/strict");
const Queue = require("../ui/music-queue.js");
const queue = new Queue(() => 0.31);
queue.shuffled = true;
queue.start(
  Array.from({ length: 170 }, (_, i) => i + 1),
  80,
);
const played = [queue.current()];
for (let i = 0; i < 169; i++) played.push(queue.next(true));
assert.equal(new Set(played).size, 170);
assert.equal(queue.next(true), null);
assert.equal(queue.previous(), played.at(-2));
queue.repeat = "one";
assert.equal(queue.next(true), played.at(-2));
queue.repeat = "all";
queue.next();
queue.next();
assert.notEqual(queue.current(), null);
queue.shuffled = false;
queue.start([1, 2, 3, 4, 5], 1);
queue.move(4, 1);
assert.deepEqual(queue.upcoming(), [5, 2, 3, 4]);
queue.removeAt(2);
assert.deepEqual(queue.upcoming(), [5, 3, 4]);
queue.selectAt(1);
assert.equal(queue.current(), 5);
queue.prune(new Set([1, 3, 4]));
assert.deepEqual(queue.upcoming(), [3, 4]);
const restored = new Queue();
restored.restore(queue.snapshot(), new Set([1, 3, 4]));
assert.deepEqual(restored.snapshot(), queue.snapshot());
restored.restore(
  {
    order: [1, 2, 3, 4],
    original: [1, 2, 3, 4],
    position: 1,
    shuffled: true,
    repeat: "all",
  },
  new Set([1, 3, 4]),
);
assert.equal(restored.current(), 1);
assert.deepEqual(restored.upcoming(), [3, 4]);
assert.equal(restored.shuffled, true);
assert.equal(restored.repeat, "all");
const priority = new Queue();
priority.start([1, 2, 3, 4], 1);
priority.playNext(4);
assert.equal(priority.current(), 1);
assert.deepEqual(priority.upcoming(), [4, 2, 3]);
priority.playNext(4);
assert.deepEqual(priority.upcoming(), [4, 2, 3]);
priority.playNext(5);
assert.deepEqual(priority.upcoming(), [5, 4, 2, 3]);
const resumed = new Queue();
resumed.restore(priority.snapshot(), new Set([1, 2, 3, 4, 5]));
assert.equal(resumed.next(), 5);
const empty = new Queue();
empty.playNext(8);
assert.equal(empty.next(), 8);
console.log(
  "PASS all 170 shuffled tracks appear once; history, repeat, reorder, removal and pruning",
);
