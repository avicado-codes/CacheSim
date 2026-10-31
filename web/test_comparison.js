/**
 * test_comparison.js - Unit tests for Experiment Comparison (View 4)
 * Run with: node web/test_comparison.js
 */

const assert = require('assert');
const Fixtures = require('./fixtures/fixtures.js');
const Comparison = require('./js/comparison.js');

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

console.log('=== CacheSim Comparison Test Suite ===\n');

console.log('1. Testing Demo A Comparison (Associativity & Conflict Misses):');
const runA_direct = Fixtures.demoA_direct.simulation;
const runA_twoway = Fixtures.demoA_twoway.simulation;
const compA = Comparison.compareRuns(runA_direct, runA_twoway);

runTest('Comparison model is produced', () => {
  assert.ok(compA !== null);
  assert.strictEqual(compA.runA.name, 'Demo A: Direct-Mapped (1-Way)');
  assert.strictEqual(compA.runB.name, 'Demo A: 2-Way Set Associative');
});

runTest('L1 Miss Rate delta is -66.67% (improved in Run B)', () => {
  const m = compA.metrics.find(x => x.name === 'L1 Miss Rate');
  assert.ok(m !== undefined);
  assert.strictEqual(m.valA, 100);
  assert.strictEqual(Math.round(m.valB), 33);
  assert.strictEqual(m.winner, 'B');
  assert.ok(m.delta < 0);
});

runTest('AMAT delta shows reduction from 101.0 to ~34.33 cycles', () => {
  const m = compA.metrics.find(x => x.name === 'AMAT (Latency)');
  assert.ok(m !== undefined);
  assert.strictEqual(m.valA, 101.0);
  assert.ok(Math.abs(m.valB - 34.3333) < 0.01);
  assert.strictEqual(m.winner, 'B');
});

runTest('Automated narrative recognizes associativity and conflict misses', () => {
  assert.ok(compA.summaryHeadline.includes('Associativity eliminates conflict misses'));
  assert.ok(compA.summaryNarrative.includes('1-way (direct-mapped) to 2-way'));
});

console.log("\n2. Testing Demo C Comparison (Belady's Anomaly):");
const runC_fifo3 = Fixtures.demoC_fifo3.simulation;
const runC_fifo4 = Fixtures.demoC_fifo4.simulation;
const compC = Comparison.compareRuns(runC_fifo3, runC_fifo4);

runTest('L1 Misses increase from 9 to 10 in larger FIFO cache', () => {
  const m = compC.metrics.find(x => x.name === 'L1 Misses');
  assert.ok(m !== undefined);
  assert.strictEqual(m.valA, 9);
  assert.strictEqual(m.valB, 10);
  assert.strictEqual(m.delta, 1);
  assert.strictEqual(m.winner, 'A'); // Run A had fewer misses
});

runTest('AMAT regresses from 76.0 to ~84.33 cycles in Run B', () => {
  const m = compC.metrics.find(x => x.name === 'AMAT (Latency)');
  assert.ok(m !== undefined);
  assert.strictEqual(m.valA, 76.0);
  assert.ok(Math.abs(m.valB - 84.3333) < 0.01);
  assert.strictEqual(m.winner, 'A');
});

runTest('Automated narrative specifically identifies Belady\'s Anomaly', () => {
  assert.ok(compC.summaryHeadline.includes("Belady's Anomaly"));
  assert.ok(compC.summaryNarrative.includes('4 lines vs 3 lines'));
});

console.log('\n3. Testing Missing L2 Handling (Two-Level Demo B vs Single-Level Demo A):');
const runB_twolevel = Fixtures.demoB.simulation;
const compB_vs_A = Comparison.compareRuns(runB_twolevel, runA_twoway);

runTest('Run A has L2 while Run B does not', () => {
  assert.strictEqual(compB_vs_A.runA.hasL2, true);
  assert.strictEqual(compB_vs_A.runB.hasL2, false);
});

runTest('L2 Local Miss Rate handles missing level gracefully as n/a', () => {
  const m = compB_vs_A.metrics.find(x => x.name === 'L2 Local Miss Rate');
  assert.ok(m !== undefined);
  assert.ok(m.valA !== null);
  assert.strictEqual(m.valB, null);
  assert.strictEqual(m.delta, null);
  assert.ok(m.assessment.includes('Only present in Run A'));
});

console.log('\n4. Testing Comparison SVG Generation:');
const svg = Comparison.generateComparisonChartsSvg(compA);

runTest('generateComparisonChartsSvg produces accessible SVG markup', () => {
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('L1 Miss Rate (%)'));
  assert.ok(svg.includes('AMAT Latency (Cycles)'));
  assert.ok(svg.includes('Memory Traffic (RAM Ops)'));
});

runTest('SVG includes Run A and Run B entity labels', () => {
  assert.ok(svg.includes('Run A'));
  assert.ok(svg.includes('Run B'));
});

console.log('\n5. Testing CSV Export:');
const csv = Comparison.exportComparisonCsv(compA);

runTest('exportComparisonCsv returns formatted CSV with headers and deltas', () => {
  assert.ok(csv.includes('CacheSim Experiment Comparison Report'));
  assert.ok(csv.includes('Configuration Reproducibility'));
  assert.ok(csv.includes('"Metric","Run A","Run B","Absolute Delta (B - A)","Relative Change (%)","Assessment"'));
  assert.ok(csv.includes('L1 Miss Rate'));
  assert.ok(csv.includes('AMAT (Latency)'));
});

console.log(`\n=== Test Results: ${passedTests} passed, ${failedTests} failed ===`);
if (failedTests > 0) process.exit(1);
