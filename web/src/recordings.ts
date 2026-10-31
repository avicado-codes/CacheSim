// Engine recordings for the Home and Learn pages: the event buffers, slot snapshots after every
// access, and reports that tests/tools/web_fixtures.cpp captured from the real engine through
// the C ABI (ctest unit.web_fixtures_current keeps them current). Replaying them needs no
// WebAssembly, and the page still shows only what the engine did.

import type { InclusionName, PolicyName, WriteMissPolicyName, WritePolicyName } from './engine/abi';
import type { CacheConfigJS, HierarchyConfigJS } from './engine/config';
import { decodeEvents, type AccessEvent } from './engine/events';
import type { ComparisonDoc, LevelConfigDoc, SimulationReport } from './engine/report';
import type { Grid } from './store/useApp';
// Home shows these on first paint, so they ship in the main bundle; the rest load on demand.
import demoADirect from '../test/fixtures/demo_a_direct.json';
import demoB from '../test/fixtures/demo_b.json';
import demoCCompare from '../test/fixtures/demo_c.compare.json';

export type RecordingName =
  | 'demo_a_direct' | 'demo_a_2way' | 'demo_b' | 'demo_b_write_through' | 'demo_b_no_write_allocate'
  | 'demo_b_inclusive' | 'demo_b_exclusive' | 'demo_c_fifo3' | 'demo_c_fifo4';

interface GridJson {
  states: number[];
  tags: string[];
}

export interface RecordingJson {
  scenario: string;
  trace: string;
  accesses: number;
  event_words: number[];
  grids: { l1: GridJson; l2: GridJson | null }[];
  report: SimulationReport;
}

export interface Recording {
  name: string;
  trace: string;
  config: HierarchyConfigJS;
  events: AccessEvent[];
  /** grids[k] is the snapshot after k accesses (grids[0] = empty caches). */
  grids: { l1: Grid; l2: Grid | null }[];
  report: SimulationReport;
}

const grid = (g: GridJson): Grid => ({
  states: Uint8Array.from(g.states),
  tags: BigUint64Array.from(g.tags.map((t) => BigInt(t))),
});

const level = (c: LevelConfigDoc): CacheConfigJS => ({
  sizeBytes: c.size_bytes,
  lineBytes: c.line_bytes,
  ways: c.ways,
  hitLatency: c.hit_latency_cycles,
  policy: c.policy as PolicyName,
  writePolicy: c.write_policy as WritePolicyName,
  writeMissPolicy: c.write_miss_policy as WriteMissPolicyName,
});

/** The configuration a report was produced with, in the form's shape. */
export function configOfReport(r: SimulationReport): HierarchyConfigJS {
  return {
    l1: level(r.config.l1),
    l2: r.config.l2 ? level(r.config.l2) : null,
    memoryLatency: r.config.memory_latency_cycles,
    inclusion: r.config.inclusion as InclusionName,
    seed: BigInt(r.config.seed_hex),
  };
}

export function toRecording(j: RecordingJson): Recording {
  return {
    name: j.scenario,
    trace: j.trace,
    config: configOfReport(j.report),
    events: decodeEvents(Uint32Array.from(j.event_words)),
    grids: j.grids.map((g) => ({ l1: grid(g.l1), l2: g.l2 ? grid(g.l2) : null })),
    report: j.report,
  };
}

const files: Record<string, () => Promise<RecordingJson>> = {
  ...import.meta.glob<RecordingJson>(
    ['../test/fixtures/demo_*.json', '!../test/fixtures/*.compare.json',
     '!../test/fixtures/demo_a_direct.json', '!../test/fixtures/demo_b.json'],
    { import: 'default' }),
  '../test/fixtures/demo_a_direct.json': async () => demoADirect as unknown as RecordingJson,
  '../test/fixtures/demo_b.json': async () => demoB as unknown as RecordingJson,
};

export async function loadRecording(name: RecordingName): Promise<Recording> {
  const load = files[`../test/fixtures/${name}.json`];
  if (!load) throw new Error(`no engine recording ${name}`);
  return toRecording(await load());
}

const comparisons: Record<string, () => Promise<ComparisonDoc>> = {
  ...import.meta.glob<ComparisonDoc>(['../test/fixtures/*.compare.json', '!../test/fixtures/demo_c.compare.json'],
                                     { import: 'default' }),
  '../test/fixtures/demo_c.compare.json': async () => demoCCompare as unknown as ComparisonDoc,
};

export async function loadComparison(name: 'demo_a' | 'demo_c'): Promise<ComparisonDoc> {
  const load = comparisons[`../test/fixtures/${name}.compare.json`];
  if (!load) throw new Error(`no engine comparison ${name}`);
  return load();
}
