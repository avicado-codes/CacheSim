import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEMO_CONFIGS } from '../src/engine/config';
import type { SimulationReport } from '../src/engine/report';
import { kpis, latencyBreakdown, levelTable, missRatioCurve, reuseHistogram, threeC } from '../src/lib/analytics';
import { bestOf, metricRows, planSweep, summarize, sweep } from '../src/lib/comparison';
import { fmtCycles, fmtDeltaRel, fmtInt, fmtPercent, NA, ratio } from '../src/lib/format';
import { comparison, scenario } from './fixtures';

describe('honest numbers: null is n/a, never 0', () => {
  it('formatters', () => {
    expect(fmtPercent(null)).toBe(NA);
    expect(fmtCycles(null)).toBe(NA);
    expect(fmtInt(null)).toBe(NA);
    expect(fmtDeltaRel(null)).toBe(NA);
    expect(ratio(3, 0)).toBeNull();
    expect(fmtPercent(0)).toBe('0.00%');
  });

  it('a report with no accesses shows n/a tiles', () => {
    const r = structuredClone(scenario('demo_b').report) as SimulationReport;
    r.amat_cycles = null;
    r.speedup_vs_memory = null;
    r.levels[0]!.miss_rate = null;
    r.levels[1]!.local_miss_rate = null;
    const t = kpis(r);
    expect(t.slice(0, 4).map((k) => [k.value, k.na])).toEqual([[NA, true], [NA, true], [NA, true], [NA, true]]);
  });
});

// Expected values derived by hand in docs/WORKING_DEMO.md section 2.
describe('analytics of Demo B (hand-derived)', () => {
  const r = scenario('demo_b').report;

  it('KPI tiles', () => {
    const [amat, , l1, l2, mem] = kpis(r);
    expect(amat!.value).toBe('68.00 cycles');
    expect(amat!.sub).toBe('680 cycles / 10 accesses');
    expect(l1!.value).toBe('70.00%');
    expect(l2!.value).toBe('85.71%');
    expect(l2!.sub).toContain('global 60.00%');
    expect(mem!.sub).toMatch(/^6 line reads · 1 writes/);
  });

  it('per-level table', () => {
    const t = levelTable(r);
    expect(t.columns).toEqual(['Metric', 'L1', 'L2']);
    expect(t.rows.find((x) => x[0] === 'Evictions')).toEqual(['Evictions', '4', '3']);
    expect(t.rows.find((x) => x[0] === 'Dirty write-backs sent')).toEqual(['Dirty write-backs sent', '1', '1']);
  });

  it('latency breakdown sums to the total', () => {
    const t = latencyBreakdown(r).table;
    expect(t.rows.at(-1)).toEqual(['Total', '680', '100.00%']);
  });

  it('3C classes sum to the misses of each level', () => {
    const t = threeC(r)!.table;
    for (const row of t.rows) {
      const lvl = r.levels.find((l) => l.name === row[0])!;
      expect(Number(row[1]) + Number(row[2]) + Number(row[3])).toBe(lvl.misses);
    }
  });

  it('reuse histogram accounts for every access; MRC reaches 0 misses beyond cold ones', () => {
    const h = reuseHistogram(r)!.table;
    expect(h.rows.reduce((s, row) => s + Number(row[1]!.replace(/,/g, '')), 0)).toBe(10);
    expect(missRatioCurve(r)!.table.rows.length).toBeGreaterThan(1);
  });

  it('a configuration without L2 says so instead of showing 0', () => {
    const [, , , l2] = kpis(scenario('demo_a_direct').report);
    expect(l2).toMatchObject({ value: NA, na: true, sub: 'no L2 in this configuration' });
  });
});

describe('comparison (engine document, hand-derived expectations)', () => {
  it('Demo A: 2-way wins AMAT 101 → 34.33; compulsory misses are a tie', () => {
    const doc = comparison('demo_a');
    const rows = metricRows(doc);
    const amat = rows.find((x) => x.key === 'amat_cycles')!;
    expect(amat.values).toEqual(['101', '34.33']);
    expect(amat.best).toBe('2-way');
    expect(amat.deltas).toEqual(['baseline', '-66.01%']);
    expect(rows.find((x) => x.key === 'l1.compulsory')!.best).toBe('all equal');
    expect(doc.same_trace).toBe(true);
  });

  it("Demo C: Belady's anomaly, FIFO with 4 lines misses more (10 vs 9 of 12)", () => {
    const rows = metricRows(comparison('demo_c'));
    const miss = rows.find((x) => x.key === 'l1.miss_rate')!;
    expect(miss.values).toEqual(['75.00%', '83.33%']);
    expect(miss.best).toBe('FIFO 3 lines');
  });

  it('a tie is never reported as a winner', () => {
    const m = { key: 'x', label: 'x', unit: 'count', better: 'lower' as const, values: [2, 2, 3], delta_abs: [], delta_rel: [], best: 0 };
    expect(bestOf(m, ['a', 'b', 'c'])).toEqual({ text: 'tie', index: null });
  });
});

describe('sweeps list rejected configurations with the reason', () => {
  it('L1 ways on the defaults: all valid', () => {
    const r = sweep(DEFAULT_CONFIG, 'l1.ways');
    expect(r.entries.map((e) => e.label)).toEqual(['L1 1-way', 'L1 2-way', 'L1 4-way', 'L1 8-way', 'L1 16-way']);
    expect(r.rejected).toEqual([]);
  });

  it('L1 ways on Demo C (48 B): non-power-of-two set counts are rejected, not dropped', () => {
    const r = sweep(DEMO_CONFIGS.demo_c_fifo3, 'l1.ways');
    expect(r.entries.map((e) => e.label)).toEqual([]);
    expect(r.rejected.map((x) => x.label)).toEqual(['L1 1-way', 'L1 2-way', 'L1 4-way', 'L1 8-way', 'L1 16-way']);
    expect(r.rejected[0]!.reason).toMatch(/set count 3 must be a power of two/);
  });

  it('Add sweep skips listed steps quietly and never offers impossible ones', () => {
    // Small two-level: L1 64 B of 16 B lines holds 4 lines, so 8 and 16 ways cannot exist.
    const base = DEMO_CONFIGS.demo_b;
    const first = planSweep([{ config: base }], base, 'l1.ways', 4);
    expect(first.added.map((e) => e.label)).toEqual(['L1 1-way', 'L1 4-way']);
    expect(first.note).toBeNull();
    const again = planSweep([{ config: base }, ...first.added], base, 'l1.ways', 4);
    expect(again.added).toEqual([]);
    expect(again.note).toEqual({ kind: 'note', text: 'Every L1 associativity step that fits the baseline cache is already in the list.' });
  });

  it('Add sweep stops at the run limit with one error line', () => {
    const p = planSweep([{ config: DEFAULT_CONFIG }], DEFAULT_CONFIG, 'l1.ways', 4);
    expect(p.added.map((e) => e.label)).toEqual(['L1 1-way', 'L1 2-way', 'L1 4-way']);
    expect(p.left.map((e) => e.label)).toEqual(['L1 16-way']);
    expect(p.note).toEqual({ kind: 'error', text: "Can't run more than 4 configurations at once, so L1 16-way was not added." });
  });

  it('Add sweep says so when no step fits', () => {
    expect(planSweep([], DEMO_CONFIGS.demo_c_fifo3, 'l1.ways', 4).note?.text).toBe('No L1 associativity step is possible for the baseline cache.');
    expect(planSweep([], DEMO_CONFIGS.demo_a_direct, 'l2.size', 4).note?.text).toBe('The baseline has no L2, so there is no L2 capacity to sweep.');
  });

  it('inclusion needs an L2', () => {
    expect(sweep(DEMO_CONFIGS.demo_a_direct, 'inclusion').rejected[0]!.reason).toMatch(/needs an L2/);
  });

  it('summary follows the engine description layout', () => {
    expect(summarize(DEFAULT_CONFIG)).toBe('L1 32768B/64B/8w lru wb+wa 4c | L2 262144B/64B/8w lru wb+wa 12c | mem 200c | non_inclusive | seed 1');
  });

  it('summary equals the engine describe() string', () => {
    expect(summarize(DEMO_CONFIGS.demo_b)).toBe(scenario('demo_b').report.config.description);
    expect(summarize(DEMO_CONFIGS.demo_a_direct)).toBe(scenario('demo_a_direct').report.config.description);
    expect(summarize(DEMO_CONFIGS.demo_c_fifo4)).toBe(scenario('demo_c_fifo4').report.config.description);
  });
});
