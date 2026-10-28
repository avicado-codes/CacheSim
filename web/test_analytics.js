/**
 * test_analytics.js - Automated Test Suite for View 3 Performance Analytics
 *
 * Verifies:
 * 1. calculateKpis correctly extracts Demo B metrics with exact numbers.
 * 2. calculateKpis handles single-level hierarchy (no L2) and emits 'n/a' with reason, never 0.
 * 3. calculateKpis handles zero accesses and null AMAT cleanly with 'n/a', never 0.
 * 4. generateHierarchySvg generates accessible inline SVG with correct bar values and labels.
 * 5. generateMemorySvg generates accessible inline SVG with memory counts.
 * 6. HTML and SVG contains required ARIA labels, roles, and table captions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Fixtures = require('./fixtures/fixtures.js');
const Analytics = require('./js/analytics.js');
const Parser = require('./js/parser.js');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName}${details ? ': ' + details : ''}`);
    failedTests++;
  }
}

console.log('=== Performance Analytics Test Suite ===\n');

// 1. Test Demo B KPI calculations
console.log('1. Testing Demo B KPI calculation:');
const demoB = Fixtures.demoB.simulation;
const kpisB = Analytics.calculateKpis(demoB);

assert(kpisB !== null, 'KPI model returned for Demo B');
assert(kpisB.l1.value === '70.00%', `L1 miss rate is exact 70.00% (got ${kpisB.l1.value})`);
assert(kpisB.l1.isNa === false, 'L1 miss rate is not n/a');
assert(kpisB.l1.sub.includes('7 misses / 10 accesses'), 'L1 subtitle shows 7 misses / 10 accesses');

assert(kpisB.l2.value === '85.71% local', `L2 local miss rate is exact 85.71% local (got ${kpisB.l2.value})`);
assert(kpisB.l2.isNa === false, 'L2 miss rate is not n/a');
assert(kpisB.l2.sub.includes('Global: 60.00%'), `L2 global miss rate is exact 60.00% (got ${kpisB.l2.sub})`);

assert(kpisB.amat.value === '68.00 cycles', `AMAT value is exact 68.00 cycles (got ${kpisB.amat.value})`);
assert(kpisB.amat.isNa === false, 'AMAT is not n/a');

assert(kpisB.memory.value === '7 ops', `Memory traffic is exact 7 ops (got ${kpisB.memory.value})`);
assert(kpisB.memory.sub === '6 reads · 1 writes', `Memory details show 6 reads · 1 writes (got ${kpisB.memory.sub})`);

// 2. Test Single-Level Cache (No L2) — Honest 'n/a' reporting
console.log('\n2. Testing Single-Level Cache (No L2):');
const singleLevelSim = {
  schema: 'ccsim.simulation/1',
  ccsim_version: '0.1.0',
  levels: [
    { name: 'L1', accesses: 6, hits: 0, misses: 6, evictions: 5, writebacks: 0, miss_rate: 1.0 }
  ],
  memory: { reads: 6, writes: 0 },
  amat_cycles: 101.0
};

const kpisSingle = Analytics.calculateKpis(singleLevelSim);
assert(kpisSingle.l1.value === '100.00%', 'L1 miss rate is 100.00%');
assert(kpisSingle.l2.value === 'n/a', `L2 miss rate is reported as 'n/a' when L2 is disabled (never 0)`);
assert(kpisSingle.l2.isNa === true, 'L2 isNa flag is true');
assert(kpisSingle.l2.sub.includes('--no-l2'), `L2 subtitle explains reason: --no-l2 (got: ${kpisSingle.l2.sub})`);
assert(kpisSingle.amat.value === '101.00 cycles', 'AMAT reports 101.00 cycles');

// 3. Test Zero Access / Null AMAT Edge Cases
console.log('\n3. Testing Zero Access / Null AMAT Edge Cases:');
const zeroAccessSim = {
  schema: 'ccsim.simulation/1',
  ccsim_version: '0.1.0',
  levels: [
    { name: 'L1', accesses: 0, hits: 0, misses: 0, evictions: 0, writebacks: 0, miss_rate: null }
  ],
  memory: { reads: 0, writes: 0 },
  amat_cycles: null
};

const kpisZero = Analytics.calculateKpis(zeroAccessSim);
assert(kpisZero.l1.value === 'n/a', `L1 miss rate with 0 accesses is 'n/a' (never 0 or NaN)`);
assert(kpisZero.amat.value === 'n/a', `AMAT with null is reported as 'n/a' (never 0)`);
assert(kpisZero.l2.value === 'n/a', `L2 with no L2 is 'n/a'`);

// 4. Test Hierarchy SVG Generation
console.log('\n4. Testing SVG Generation:');
const hierarchySvg = Analytics.generateHierarchySvg(demoB.levels);
assert(typeof hierarchySvg === 'string' && hierarchySvg.includes('<svg'), 'generateHierarchySvg returns valid SVG markup');
assert(hierarchySvg.includes('role="img"'), 'SVG contains accessible role="img"');
assert(hierarchySvg.includes('L1 Cache'), 'SVG contains L1 Cache label');
assert(hierarchySvg.includes('L2 Cache'), 'SVG contains L2 Cache label');
assert(hierarchySvg.includes('fill="#38bdf8"'), 'SVG uses distinct sky blue color for hits');
assert(hierarchySvg.includes('fill="#f59e0b"'), 'SVG uses distinct amber color for misses');
assert(hierarchySvg.includes('<title>L1 Hits: 3 (30.0%)</title>'), 'SVG contains accessible hover tooltip for L1 hits');

// 5. Test Memory SVG Generation
console.log('\n5. Testing Memory SVG Generation:');
const memorySvg = Analytics.generateMemorySvg(demoB.memory, demoB.levels);
assert(typeof memorySvg === 'string' && memorySvg.includes('<svg'), 'generateMemorySvg returns valid SVG markup');
assert(memorySvg.includes('Mem Reads'), 'Memory SVG includes Mem Reads');
assert(memorySvg.includes('Mem Writes'), 'Memory SVG includes Mem Writes');
assert(memorySvg.includes('L1 Evictions'), 'Memory SVG includes L1 Evictions');
assert(memorySvg.includes('L2 Evictions'), 'Memory SVG includes L2 Evictions');

// 6. Test Single-Level Hierarchy SVG (No L2)
console.log('\n6. Testing Single-Level Hierarchy SVG (No L2):');
const singleSvg = Analytics.generateHierarchySvg(singleLevelSim.levels);
assert(!singleSvg.includes('L2 Cache'), 'Single-level SVG does not render absent L2');
assert(singleSvg.includes('L1 Cache'), 'Single-level SVG renders L1 Cache');

// 7. Regression Test: Empty-State vs Active Content Lifecycle
console.log('\n7. Regression Test: Empty-State vs Active Content Lifecycle:');

const mockElements = {
  'analytics-empty-state': { id: 'analytics-empty-state', hidden: false, style: {} },
  'analytics-content': { id: 'analytics-content', hidden: true, style: {} },
  'analytics-sample-banner': { id: 'analytics-sample-banner', hidden: true, style: {} },
  'kpi-l1-miss-rate': { innerHTML: '', textContent: '' },
  'kpi-l1-miss-sub': { textContent: '' },
  'kpi-l2-miss-rate': { innerHTML: '', textContent: '' },
  'kpi-l2-miss-sub': { textContent: '' },
  'kpi-amat': { innerHTML: '', textContent: '' },
  'kpi-amat-sub': { textContent: '' },
  'kpi-memory-traffic': { innerHTML: '', textContent: '' },
  'kpi-memory-traffic-sub': { textContent: '' },
  'chart-hierarchy-svg': { innerHTML: '' },
  'chart-memory-svg': { innerHTML: '' },
  'table-hierarchy-body': { innerHTML: '' },
  'table-memory-body': { innerHTML: '' },
  'amat-breakdown-container': { innerHTML: '' },
  'invariants-checklist': { innerHTML: '' }
};

global.document = {
  getElementById: (id) => mockElements[id] || null
};

// Case 7.1: Call with null runData (no active run)
Analytics.renderAnalytics(null);
assert(mockElements['analytics-empty-state'].hidden === false, 'Empty state is not hidden when runData is null');
assert(mockElements['analytics-empty-state'].style.display === 'flex', 'Empty state style.display is "flex" when runData is null');
assert(mockElements['analytics-content'].hidden === true, 'Content is hidden when runData is null');
assert(mockElements['analytics-content'].style.display === 'none', 'Content style.display is "none" when runData is null');
assert(mockElements['analytics-sample-banner'].hidden === true, 'Sample banner is hidden when runData is null');

// Case 7.2: Render with Demo B (active run loaded)
Analytics.renderAnalytics(demoB);
assert(mockElements['analytics-empty-state'].hidden === true, 'Empty state is hidden when Demo B is loaded');
assert(mockElements['analytics-empty-state'].style.display === 'none', 'Empty state style.display is explicitly "none" when Demo B is loaded');
assert(mockElements['analytics-content'].hidden === false, 'Content is unhidden when Demo B is loaded');
assert(mockElements['analytics-content'].style.display === 'block', 'Content style.display is "block" when Demo B is loaded');
assert(mockElements['analytics-sample-banner'].hidden === false, 'Sample banner is shown for Demo B sample data');
assert(mockElements['analytics-sample-banner'].style.display === 'flex', 'Sample banner style.display is "flex" for Demo B sample data');

// Case 7.3: Clear active run (reset to null)
Analytics.renderAnalytics(null);
assert(mockElements['analytics-empty-state'].hidden === false, 'Empty state returns when active run is cleared');
assert(mockElements['analytics-empty-state'].style.display === 'flex', 'Empty state style.display is restored to "flex"');
assert(mockElements['analytics-content'].hidden === true, 'Content is re-hidden when active run is cleared');
assert(mockElements['analytics-content'].style.display === 'none', 'Content style.display is set to "none"');

console.log(`\n=== Test Results: ${passedTests} passed, ${failedTests} failed ===`);
if (failedTests > 0) {
  process.exit(1);
}
