import { describe, expect, it } from 'vitest';
import { decodeEvents, type AccessEvent } from '../src/engine/events';
import { scenario, SCENARIOS, type EventJson } from './fixtures';

const hex = (v: bigint) => `0x${v.toString(16)}`;

// Projects a decoded event onto the engine's own JSON form (event_to_json in src/report/json.cpp).
const asJson = (e: AccessEvent): EventJson => ({
  schema: 'ccsim.events/1',
  seq: e.seq,
  op: e.op,
  address: hex(e.address),
  line: hex(e.line),
  offset: e.offset,
  l1: { result: e.l1.outcome, set: e.l1.set, tag: hex(e.l1.tag), way: e.l1.way },
  l2: { result: e.l2.outcome, set: e.l2.set, tag: hex(e.l2.tag), way: e.l2.way },
  actions: e.actions.map((a) => ({
    kind: a.kind, level: a.level, hit: a.hit, dirty: a.dirty, from_policy: a.fromPolicy, set: a.set, way: a.way, line: hex(a.line),
  })),
  latency_cycles: e.latency,
});

describe('binary event decoder', () => {
  it.each(SCENARIOS)('%s: equals the engine JSON serialisation of every event', (name) => {
    const s = scenario(name);
    const events = decodeEvents(Uint32Array.from(s.event_words));
    expect(events).toHaveLength(s.accesses);
    expect(events.map(asJson)).toEqual(s.events_json);
  });

  it('rejects a truncated buffer', () => {
    const words = Uint32Array.from(scenario('demo_b').event_words);
    expect(() => decodeEvents(words.subarray(0, 25))).toThrow(/truncated/);
    expect(() => decodeEvents(words.subarray(0, 10))).toThrow(/truncated/);
  });

  it('rejects unknown enum values', () => {
    const words = Uint32Array.from(scenario('demo_b').event_words);
    words[8] = 9;  // L1 outcome
    expect(() => decodeEvents(words)).toThrow(/unknown outcome/);
  });
});

// Independent expectations, derived by hand in docs/WORKING_DEMO.md section 2 and
// ARCHITECTURE section 7.2 (not copied from the engine).
describe('Demo B, hand-derived', () => {
  const events = decodeEvents(Uint32Array.from(scenario('demo_b').event_words));

  it('has the per-access latencies of the walkthrough table', () => {
    expect(events.map((e) => e.latency)).toEqual([111, 1, 111, 111, 11, 111, 111, 111, 1, 1]);
  });

  it('access 4 writes the dirty victim back before the demand fetch', () => {
    expect(events[3]!.actions.map((a) => `${a.kind} ${a.level}`)).toEqual([
      'lookup L1', 'evict L1', 'writeback L2', 'lookup L2', 'evict L2', 'memory_read memory', 'fill L2', 'fill L1',
    ]);
    const [, evictL1, wb, , evictL2] = events[3]!.actions;
    expect(evictL1).toMatchObject({ dirty: true, line: 0n });
    expect(wb).toMatchObject({ hit: true });
    expect(evictL2).toMatchObject({ line: 4n });
  });

  it('access 7 is the only memory write', () => {
    const writes = events.map((e) => e.actions.filter((a) => a.kind === 'memory_write').length);
    expect(writes).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
  });

  it('accesses 2, 9 and 10 hit in L1 and never reach L2', () => {
    for (const i of [1, 8, 9]) expect(events[i]).toMatchObject({ l1: { outcome: 'hit' }, l2: { outcome: 'none' } });
  });
});
