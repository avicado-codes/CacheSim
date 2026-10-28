/**
 * test_visualizer.js - Unit tests for Visualizer replay, grid computation, and narration
 * Run with: node web/test_visualizer.js
 */

const assert = require('assert');
const Fixtures = require('./fixtures/fixtures.js');
const Visualizer = require('./js/visualizer.js');

let passedTests = 0;
let failedTests = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

console.log('=== CacheSim Visualizer Test Suite ===\n');

console.log('1. Testing computeGridState with Demo B:');

const events = Fixtures.demoB.events;
const dims = { l1Sets: 2, l1Ways: 2, l2Sets: 4, l2Ways: 2 };

runTest('Initial state (cursor -1) has all lines invalid/empty', () => {
  const state = Visualizer.computeGridState(events, -1, dims);
  assert.strictEqual(state.l1.length, 2);
  assert.strictEqual(state.l1[0].length, 2);
  assert.strictEqual(state.l1[0][0].valid, false);
  assert.strictEqual(state.l1[0][1].valid, false);
  assert.strictEqual(state.l1[1][0].valid, false);
  assert.strictEqual(state.l1[1][1].valid, false);
  assert.strictEqual(state.l2.length, 4);
});

runTest('Step 1 (cursor 0) fills L1 set 0 way 0 clean (R 0x000)', () => {
  const state = Visualizer.computeGridState(events, 0, dims);
  const cell = state.l1[0][0];
  assert.strictEqual(cell.valid, true);
  assert.strictEqual(cell.tag, 0);
  assert.strictEqual(cell.dirty, false);
  assert.strictEqual(cell.justFilled, true);
  assert.strictEqual(cell.justHit, false);
  assert.strictEqual(state.l1[0][1].valid, false);
});

runTest('Step 2 (cursor 1) is a store hit on line 0 (W 0x008): marks line 0 dirty and hit', () => {
  const state = Visualizer.computeGridState(events, 1, dims);
  const cell0 = state.l1[0][0];
  assert.strictEqual(cell0.valid, true);
  assert.strictEqual(cell0.tag, 0);
  assert.strictEqual(cell0.dirty, true); // write store marks dirty
  assert.strictEqual(cell0.justHit, true);
  assert.strictEqual(state.l1[0][1].valid, false); // way 1 still empty
});

runTest('Step 3 (cursor 2) fills L1 set 0 way 1 clean (R 0x040)', () => {
  const state = Visualizer.computeGridState(events, 2, dims);
  const cell0 = state.l1[0][0];
  const cell1 = state.l1[0][1];
  assert.strictEqual(cell0.valid, true);
  assert.strictEqual(cell0.tag, 0);
  assert.strictEqual(cell0.dirty, true);
  assert.strictEqual(cell0.justHit, false); // hit occurred in step 2

  assert.strictEqual(cell1.valid, true);
  assert.strictEqual(cell1.tag, 2);
  assert.strictEqual(cell1.dirty, false);
  assert.strictEqual(cell1.justFilled, true);
});

runTest('Step 4 (cursor 3) eviction & write-back to L2 replaces way 0 (R 0x080)', () => {
  const state = Visualizer.computeGridState(events, 3, dims);
  // Way 0 now contains tag 4 (new line 0x080)
  const cell0 = state.l1[0][0];
  assert.strictEqual(cell0.valid, true);
  assert.strictEqual(cell0.tag, 4);
  assert.strictEqual(cell0.justFilled, true);
  // L2 state check: victim line 0 was written back into L2
  assert.strictEqual(state.l2[0][0].valid, true);
  assert.strictEqual(state.l2[0][0].dirty, true);
});

runTest('Deterministic replay: computing step 4 directly equals replaying from 0', () => {
  const stateDirect = Visualizer.computeGridState(events, 3, dims);
  const stateReplayed = Visualizer.computeGridState(events.slice(0, 4), 3, dims);
  assert.deepStrictEqual(stateDirect, stateReplayed);
});

console.log('\n2. Testing narrateEvent:');

runTest('Cursor -1 produces initial state description', () => {
  const nar = Visualizer.narrateEvent(null, -1, 10);
  assert.ok(nar.headline.includes('Initial State'));
  assert.ok(nar.l1Text.includes('invalid'));
  assert.strictEqual(nar.noteText !== null, true);
});

runTest('Step 1 produces read miss description', () => {
  const nar = Visualizer.narrateEvent(events[0], 0, 10);
  assert.ok(nar.headline.includes('Step 1'));
  assert.ok(nar.headline.includes('Read Load 0x000'));
  assert.ok(nar.l1Text.includes('L1 Miss'));
  assert.ok(nar.l2Text.includes('L2 Demand Fetch Miss'));
});

runTest('Step 2 produces write store hit description', () => {
  const nar = Visualizer.narrateEvent(events[1], 1, 10);
  assert.ok(nar.headline.includes('Step 2'));
  assert.ok(nar.headline.includes('Write Store 0x008'));
  assert.ok(nar.l1Text.includes('L1 Hit'));
  assert.ok(nar.l1Text.includes('dirty'));
});

runTest('Step 4 produces "What to notice" documented educational callout', () => {
  const nar = Visualizer.narrateEvent(events[3], 3, 10);
  assert.ok(nar.noteText !== null);
  assert.ok(nar.noteText.includes('dirty L1 victim (line 0)'));
  assert.ok(nar.noteText.includes('evicted line 4 instead of line 0'));
});

console.log(`\n=== Test Results: ${passedTests} passed, ${failedTests} failed ===`);
if (failedTests > 0) process.exit(1);
