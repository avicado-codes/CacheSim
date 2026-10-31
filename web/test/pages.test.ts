// Logic behind the redesigned pages: the CSV export, the comparison fairness checks and the engine
// recordings the Home and Learn pages replay. Expected values come from docs/WORKING_DEMO.md.

import { describe, expect, it } from 'vitest';
import { DEMO_CONFIGS } from '../src/engine/config';
import type { SimulationReport } from '../src/engine/report';
import { checkComparison, configDifferences } from '../src/lib/comparison';
import { analyticsCsv, safeName } from '../src/lib/export';
import { configOfReport, toRecording, type RecordingJson } from '../src/recordings';
import { scenario } from './fixtures';

const section = (csv: string, name: string): string[] => {
  const blocks = csv.trim().split('\n\n');
  const b = blocks.find((x) => x.startsWith(`section,${name}\n`));
  if (!b) throw new Error(`no section ${name}`);
  return b.split('\n').slice(1);
};

describe('analytics CSV export', () => {
  const r = scenario('demo_b').report;
  const csv = analyticsCsv(r);

  it('carries the hand-derived Demo B numbers (WORKING_DEMO section 2)', () => {
    expect(section(csv, 'summary')).toContain('amat,68,cycles');
    expect(section(csv, 'latency_breakdown')).toContain('total,680');
    const levels = section(csv, 'levels');
    expect(levels[0]).toBe('metric,L1,L2');
    expect(levels).toContain('accesses,10,7');
  });

  it('writes an unavailable rate as an empty cell, never 0', () => {
    const z = structuredClone(r) as SimulationReport;
    z.amat_cycles = null;
    z.levels[1]!.local_miss_rate = null;
    const out = analyticsCsv(z);
    expect(section(out, 'summary')).toContain('amat,,cycles');
    expect(section(out, 'levels').find((l) => l.startsWith('local_miss_rate,'))).toMatch(/^local_miss_rate,[^,]*,$/);
  });

  it('quotes cells holding commas or quotes', () => {
    const z = structuredClone(r) as SimulationReport;
    z.label = 'a, "b"';
    expect(section(analyticsCsv(z), 'run')).toContain('label,"a, ""b"""');
  });

  it('makes safe file names', () => {
    expect(safeName('Demo B / 32 KiB')).toBe('Demo_B_32_KiB');
    expect(safeName('///')).toBe('ccsim');
  });
});

describe('comparison fairness checks', () => {
  const base = DEMO_CONFIGS.demo_b;
  const moreWays = { ...base, l1: { ...base.l1, ways: base.l1.ways * 2 } };
  const traceOk = { ok: true, text: 'One trace for every run' };
  const blockingFailures = (c: ReturnType<typeof checkComparison>) => c.filter((x) => x.blocking && !x.ok);

  it('lists what differs between two configurations', () => {
    expect(configDifferences(base, base)).toEqual([]);
    expect(configDifferences(base, moreWays)).toEqual(['L1 ways']);
    expect(configDifferences(base, { ...base, l2: null })).toEqual(['L2 removed']);
  });

  it('passes a baseline against a one-change variant', () => {
    const c = checkComparison([{ label: 'base', config: base }, { label: 'ways', config: moreWays }], 8, traceOk);
    expect(blockingFailures(c)).toEqual([]);
    expect(c.every((x) => x.ok)).toBe(true);
  });

  it('blocks one run, duplicates, clashing names and a bad trace', () => {
    expect(blockingFailures(checkComparison([{ label: 'a', config: base }], 8, traceOk))).toHaveLength(1);
    const dup = checkComparison([{ label: 'a', config: base }, { label: 'b', config: base }], 8, traceOk);
    expect(blockingFailures(dup).map((x) => x.text)).toEqual(['No two configurations are identical']);
    const names = checkComparison([{ label: 'a', config: base }, { label: 'a', config: moreWays }], 8, traceOk);
    expect(blockingFailures(names).map((x) => x.text)).toEqual(['Every run has its own name']);
    const trace = checkComparison([{ label: 'a', config: base }, { label: 'b', config: moreWays }], 8,
                                  { ok: false, text: 'Pick a trace' });
    expect(blockingFailures(trace).map((x) => x.text)).toEqual(['Pick a trace']);
  });

  it('only warns when a run changes several things at once', () => {
    const two = { ...moreWays, memoryLatency: base.memoryLatency + 50 };
    const c = checkComparison([{ label: 'a', config: base }, { label: 'b', config: two }], 8, traceOk);
    expect(blockingFailures(c)).toEqual([]);
    const advisory = c.find((x) => !x.blocking)!;
    expect(advisory.ok).toBe(false);
    expect(advisory.detail![0]).toContain('L1 ways, memory latency');
  });
});

describe('engine recordings for Home and Learn', () => {
  it('rebuild the configuration and one snapshot per access', () => {
    const s = scenario('demo_b');
    const rec = toRecording(s as unknown as RecordingJson);
    expect(configOfReport(s.report)).toEqual(DEMO_CONFIGS.demo_b);
    expect(rec.events).toHaveLength(s.accesses);
    expect(rec.grids).toHaveLength(s.accesses + 1);
    expect(Array.from(rec.grids[0]!.l1.states).every((x) => x === 0)).toBe(true);
  });
});
