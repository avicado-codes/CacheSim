/**
 * test_parser.js - Test suite for CacheSim schema parser & fixtures
 *
 * Verifies:
 * 1. Demo B simulation fixture validates successfully against ccsim.simulation/1.
 * 2. Demo B event stream excerpt validates successfully against ccsim.events/1.
 * 3. Parser correctly rejects malformed payloads and invariant violations.
 * 4. Parser correctly ignores unknown fields (per TECHNICAL_DESIGN.md section 11).
 * 5. Fixtures module exports valid structures.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Parser = require('./js/parser.js');
const Fixtures = require('./fixtures/fixtures.js');

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

console.log('=== CacheSim Parser & Fixture Test Suite ===\n');

// 1. Test Demo B simulation JSON file
console.log('1. Testing Demo B simulation JSON fixture:');
const simJsonPath = path.join(__dirname, 'fixtures', 'demo_b_sample.simulation.json');
const simJsonRaw = fs.readFileSync(simJsonPath, 'utf8');
const simRes = Parser.validateSimulation(simJsonRaw);

assert(simRes.valid === true, 'demo_b_sample.simulation.json validates against ccsim.simulation/1', simRes.errors.join('; '));
assert(simRes.data !== null, 'Validated simulation data is returned');
assert(simRes.data.schema === 'ccsim.simulation/1', 'Schema is ccsim.simulation/1');
assert(simRes.data.amat_cycles === 68.0, 'AMAT cycles matches Demo B (68.0)');
assert(simRes.data.levels.length === 2, 'Contains 2 levels (L1 and L2)');
assert(simRes.data.memory.reads === 6 && simRes.data.memory.writes === 1, 'Memory reads=6, writes=1');

// Check that _comment and _is_sample_data are preserved/ignored
assert(simRes.data._is_sample_data === true, 'Unknown field _is_sample_data safely ignored/preserved');

// 2. Test Demo B events NDJSON file
console.log('\n2. Testing Demo B events NDJSON fixture:');
const eventsPath = path.join(__dirname, 'fixtures', 'demo_b_sample.events.ndjson');
const eventsRaw = fs.readFileSync(eventsPath, 'utf8');
const eventsRes = Parser.parseEventStream(eventsRaw);

assert(eventsRes.valid === true, 'demo_b_sample.events.ndjson parses and validates against ccsim.events/1', eventsRes.errors.join('; '));
assert(eventsRes.events.length === 10, `Parsed all 10 documented Demo B events (got ${eventsRes.events.length})`);
assert(eventsRes.events[3].seq === 3, 'Documented step 4 has seq 3 (0-based)');
assert(eventsRes.events[3].latency_cycles === 111, 'Step 4 event latency is 111 cycles');

// 3. Test fixtures.js module
console.log('\n3. Testing fixtures.js module:');
assert(Fixtures.demoB !== undefined, 'Fixtures.demoB is defined');
const modSimRes = Parser.validateSimulation(Fixtures.demoB.simulation);
assert(modSimRes.valid === true, 'Fixtures.demoB.simulation object is valid');
assert(Array.isArray(Fixtures.demoB.events) && Fixtures.demoB.events.length === 10, 'Fixtures.demoB.events contains 10 events');
assert(Fixtures.demoB.eventsExcerpt.length === 1, 'Fixtures.demoB.eventsExcerpt contains Step 4 excerpt');

// 4. Test Invariant and Error Handling
console.log('\n4. Testing Invariant and Error Handling:');

// Test 4.1: Wrong schema
const badSchema = { ...Fixtures.demoB.simulation, schema: 'ccsim.other/1' };
const badSchemaRes = Parser.validateSimulation(badSchema);
assert(badSchemaRes.valid === false, 'Rejects unrecognized schema');

// Test 4.2: Hits + misses != accesses
const badHits = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badHits.levels[0].hits = 999;
const badHitsRes = Parser.validateSimulation(badHits);
assert(badHitsRes.valid === false, 'Rejects hits + misses != accesses invariant violation');

// Test 4.3: Writebacks > evictions
const badWb = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badWb.levels[0].writebacks = 999;
const badWbRes = Parser.validateSimulation(badWb);
assert(badWbRes.valid === false, 'Rejects writebacks > evictions invariant violation');

// Test 4.4: L2.accesses != L1.misses
const badL2Acc = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badL2Acc.levels[1].accesses = 999;
const badL2AccRes = Parser.validateSimulation(badL2Acc);
assert(badL2AccRes.valid === false, 'Rejects L2.accesses != L1.misses invariant violation');

// Test 4.5: Memory reads != bottom level misses
const badMem = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badMem.memory.reads = 999;
const badMemRes = Parser.validateSimulation(badMem);
assert(badMemRes.valid === false, 'Rejects memory.reads != L2.misses invariant violation');

// Test 4.6: Negative counter
const badNeg = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badNeg.levels[0].accesses = -5;
const badNegRes = Parser.validateSimulation(badNeg);
assert(badNegRes.valid === false, 'Rejects negative counter');

// Test 4.8: L1 reads + writes != accesses
const badReads = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badReads.levels[0].reads = 999;
const badReadsRes = Parser.validateSimulation(badReads);
assert(badReadsRes.valid === false, 'Rejects L1 reads + writes != accesses invariant violation');

// Test 4.9: L1 read_misses + write_misses != misses
const badReadMisses = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badReadMisses.levels[0].read_misses = 999;
const badReadMissesRes = Parser.validateSimulation(badReadMisses);
assert(badReadMissesRes.valid === false, 'Rejects L1 read_misses + write_misses != misses invariant violation');

// Test 4.10: L1 evictions > misses
const badEvictions = JSON.parse(JSON.stringify(Fixtures.demoB.simulation));
badEvictions.levels[0].evictions = 999;
const badEvictionsRes = Parser.validateSimulation(badEvictions);
assert(badEvictionsRes.valid === false, 'Rejects L1 evictions > misses invariant violation');

// Test 4.11: Events validation error cases
const badEventOp = JSON.parse(JSON.stringify(Fixtures.demoB.eventsExcerpt[0]));
badEventOp.op = 'INVALID';
const badEventOpRes = Parser.validateEvent(badEventOp);
assert(badEventOpRes.valid === false, 'Rejects invalid event op');

const badEventAddr = JSON.parse(JSON.stringify(Fixtures.demoB.eventsExcerpt[0]));
badEventAddr.address = 'not-hex';
const badEventAddrRes = Parser.validateEvent(badEventAddr);
assert(badEventAddrRes.valid === false, 'Rejects non-hex address in event');

const badEventSchema = JSON.parse(JSON.stringify(Fixtures.demoB.eventsExcerpt[0]));
badEventSchema.schema = 'wrong.events/1';
const badEventSchemaRes = Parser.validateEvent(badEventSchema);
assert(badEventSchemaRes.valid === false, 'Rejects wrong schema in event');

console.log(`\n=== Test Results: ${passedTests} passed, ${failedTests} failed ===`);
if (failedTests > 0) {
  process.exit(1);
}
