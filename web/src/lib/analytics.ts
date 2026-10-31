// View models for the analytics view, built only from a ccsim.simulation/1 report. Nothing is
// recomputed from the trace; null rates stay null and render as "n/a".

import { axisStyle, baseOption, type ChartOption, type TableData } from './chartStyle';
import type { LevelReport, Rate, SimulationReport } from '../engine/report';
import { fmtBytes, fmtCycles, fmtFixed, fmtInt, fmtPercent, NA, ratio } from './format';
import { ink, seriesColor } from './palette';

export interface Kpi {
  label: string;
  value: string;
  sub: string;
  na: boolean;
}

const l2Of = (r: SimulationReport): LevelReport | null => r.levels.find((l) => l.name === 'L2') ?? null;
const l1Of = (r: SimulationReport): LevelReport => r.levels[0]!;

export function kpis(r: SimulationReport): Kpi[] {
  const l1 = l1Of(r);
  const l2 = l2Of(r);
  const traffic = r.memory.read_bytes + r.memory.write_bytes;
  return [
    {
      label: 'AMAT', value: fmtCycles(r.amat_cycles), na: r.amat_cycles === null,
      sub: r.amat_cycles === null ? 'no accesses yet' : `${fmtInt(r.total_latency_cycles)} cycles / ${fmtInt(l1.accesses)} accesses`,
    },
    {
      label: 'Speed-up vs memory', value: r.speedup_vs_memory === null ? NA : `${fmtFixed(r.speedup_vs_memory)}×`,
      na: r.speedup_vs_memory === null, sub: `memory latency ${r.config.memory_latency_cycles} cycles ÷ AMAT`,
    },
    {
      label: 'L1 miss rate', value: fmtPercent(l1.miss_rate), na: l1.miss_rate === null,
      sub: `${fmtInt(l1.misses)} misses / ${fmtInt(l1.accesses)} accesses`,
    },
    l2
      ? {
          label: 'L2 local miss rate', value: fmtPercent(l2.local_miss_rate), na: l2.local_miss_rate === null,
          sub: l2.accesses === 0 ? 'no L1 miss has reached L2' : `global ${fmtPercent(l2.global_miss_rate)} · ${fmtInt(l2.misses)} / ${fmtInt(l2.accesses)}`,
        }
      : { label: 'L2 miss rate', value: NA, na: true, sub: 'no L2 in this configuration' },
    {
      label: 'Memory traffic', value: fmtBytes(traffic), na: false,
      sub: `${fmtInt(r.memory.reads)} line reads · ${fmtInt(r.memory.writes)} writes · ${fmtFixed(r.memory.bytes_per_access)} B/access`,
    },
  ];
}

/** Every per-level counter and rate, one column per level. */
export function levelTable(r: SimulationReport): TableData {
  const rows: [string, (l: LevelReport) => string][] = [
    ['Accesses', (l) => fmtInt(l.accesses)],
    ['Reads / writes', (l) => `${fmtInt(l.reads)} / ${fmtInt(l.writes)}`],
    ['Hits', (l) => fmtInt(l.hits)],
    ['Misses (read / write)', (l) => `${fmtInt(l.misses)} (${fmtInt(l.read_misses)} / ${fmtInt(l.write_misses)})`],
    ['Hit rate', (l) => fmtPercent(l.hit_rate)],
    ['Miss rate', (l) => fmtPercent(l.miss_rate)],
    ['Read / write miss rate', (l) => `${fmtPercent(l.read_miss_rate)} / ${fmtPercent(l.write_miss_rate)}`],
    ['Local / global miss rate', (l) => `${fmtPercent(l.local_miss_rate)} / ${fmtPercent(l.global_miss_rate)}`],
    ['Misses per 1,000 L1 accesses', (l) => fmtFixed(l.misses_per_kilo_access)],
    ['Evictions', (l) => fmtInt(l.evictions)],
    ['Eviction rate', (l) => fmtPercent(l.eviction_rate)],
    ['Dirty write-backs sent', (l) => fmtInt(l.writebacks)],
    ['Dirty eviction ratio', (l) => fmtPercent(l.dirty_eviction_ratio)],
    ['Write-backs received (hit / miss)', (l) => `${fmtInt(l.writebacks_received)} (${fmtInt(l.writeback_hits)} / ${fmtInt(l.writeback_misses)})`],
    ['No-allocate misses', (l) => fmtInt(l.no_allocate_misses)],
    ['Write-throughs sent / received', (l) => `${fmtInt(l.write_throughs_sent)} / ${fmtInt(l.write_throughs_received)}`],
    ['Back-invalidations', (l) => fmtInt(l.back_invalidations)],
    ['Victims received', (l) => fmtInt(l.victims_received)],
  ];
  return { columns: ['Metric', ...r.levels.map((l) => l.name)], rows: rows.map(([name, f]) => [name, ...r.levels.map(f)]) };
}

const barSeries = (name: string, data: number[], i: number, stack?: string) => ({
  type: 'bar' as const, name, data, stack, barMaxWidth: 36,
  itemStyle: { color: seriesColor(i), borderRadius: stack ? 0 : [4, 4, 0, 0], borderColor: ink().surface, borderWidth: stack ? 2 : 0 },
});

export function hitsMisses(r: SimulationReport): { option: ChartOption; table: TableData } {
  const names = r.levels.map((l) => l.name);
  return {
    option: {
      ...baseOption(),
      xAxis: { type: 'category', data: names, ...axisStyle() },
      yAxis: { type: 'value', name: 'accesses', ...axisStyle() },
      series: [barSeries('Hits', r.levels.map((l) => l.hits), 0), barSeries('Misses', r.levels.map((l) => l.misses), 1)],
    },
    table: {
      columns: ['Level', 'Hits', 'Misses', 'Hit rate'],
      rows: r.levels.map((l) => [l.name, fmtInt(l.hits), fmtInt(l.misses), fmtPercent(l.hit_rate)]),
    },
  };
}

export function latencyBreakdown(r: SimulationReport): { option: ChartOption; table: TableData } {
  const parts: [string, number][] = [
    ['L1', r.latency_breakdown.l1_cycles],
    ...(r.config.l2 ? [['L2', r.latency_breakdown.l2_cycles] as [string, number]] : []),
    ['Memory', r.latency_breakdown.memory_cycles],
  ];
  return {
    option: {
      ...baseOption(),
      tooltip: { ...(baseOption().tooltip as object), trigger: 'item' },
      grid: { left: 24, right: 24, top: 36, bottom: 40, containLabel: true },
      xAxis: { type: 'value', name: 'cycles', nameLocation: 'middle', nameGap: 28, ...axisStyle() },
      yAxis: { type: 'category', data: ['Total latency'], ...axisStyle() },
      series: parts.map(([name, v], i) => barSeries(name, [v], i, 'latency')),
    },
    table: {
      columns: ['Component', 'Cycles', 'Share'],
      rows: [...parts.map(([n, v]) => [n, fmtInt(v), fmtPercent(ratio(v, r.total_latency_cycles))]),
             ['Total', fmtInt(r.total_latency_cycles), fmtPercent(ratio(r.total_latency_cycles, r.total_latency_cycles))]],
    },
  };
}

export function threeC(r: SimulationReport): { option: ChartOption; table: TableData; subtitle: string } | null {
  const levels = r.levels.filter((l) => l.three_c);
  if (levels.length === 0) return null;
  const kinds = ['compulsory', 'capacity', 'conflict'] as const;
  // The engine reports no split for an exclusive L2 (it holds only L1 victims, which the
  // fully associative model does not follow); say so rather than drop the level silently.
  const exclusiveL2 = r.config.inclusion === 'exclusive' && r.levels.length > 1 && !r.levels[1]!.three_c;
  return {
    subtitle: `Compulsory, capacity and conflict misses (Hill and Smith)${
      exclusiveL2 ? '. Not given for the exclusive L2, which holds only L1 victims.' : ''}`,
    option: {
      ...baseOption(),
      xAxis: { type: 'category', data: levels.map((l) => l.name), ...axisStyle() },
      yAxis: { type: 'value', name: 'misses', ...axisStyle() },
      series: kinds.map((k, i) => barSeries(k[0]!.toUpperCase() + k.slice(1), levels.map((l) => l.three_c![k]), i, '3c')),
    },
    table: {
      columns: ['Level', 'Compulsory', 'Capacity', 'Conflict', 'Beaten by FA-LRU (shadow-only misses)'],
      rows: levels.map((l) => [l.name, fmtInt(l.three_c!.compulsory), fmtInt(l.three_c!.capacity),
                               fmtInt(l.three_c!.conflict), fmtInt(l.three_c!.shadow_only_misses)]),
    },
  };
}

export function missRateOverTime(r: SimulationReport): { option: ChartOption; table: TableData } | null {
  const t = r.timeline;
  if (!t || t.rows.length === 0) return null;
  const col = (name: string) => t.columns.indexOf(name);
  const [ia, i1, i2] = [col('accesses'), col('l1_misses'), col('l2_misses')];
  const hasL2 = !!r.config.l2;
  const pts = t.rows.map((row) => ({
    x: row[ia]!,
    l1: ratio(row[i1]!, row[ia]!),
    l2: hasL2 ? ratio(row[i2]!, row[ia]!) : null,
  }));
  const line = (name: string, data: [number, Rate][], i: number) => ({
    type: 'line' as const, name, data, showSymbol: pts.length < 40, symbolSize: 8,
    lineStyle: { width: 2, color: seriesColor(i) }, itemStyle: { color: seriesColor(i) },
  });
  return {
    option: {
      ...baseOption(),
      tooltip: { ...(baseOption().tooltip as object), valueFormatter: (v: unknown) => fmtPercent(v as Rate) },
      xAxis: { type: 'value', name: 'accesses', ...axisStyle() },
      yAxis: { type: 'value', name: 'cumulative miss rate', axisLabel: { color: '#898781', formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
               splitLine: axisStyle().splitLine, axisLine: axisStyle().axisLine, nameTextStyle: axisStyle().nameTextStyle },
      series: [line('L1 miss rate', pts.map((p) => [p.x, p.l1]), 0),
               ...(hasL2 ? [line('L2 global miss rate', pts.map((p) => [p.x, p.l2] as [number, Rate]), 1)] : [])],
    },
    table: {
      columns: ['Accesses', 'L1 miss rate', ...(hasL2 ? ['L2 global miss rate'] : [])],
      rows: pts.map((p) => [fmtInt(p.x), fmtPercent(p.l1), ...(hasL2 ? [fmtPercent(p.l2)] : [])]),
    },
  };
}

export function setHeatmap(l: LevelReport): { option: ChartOption; table: TableData; subtitle: string } | null {
  const h = l.set_heatmap;
  if (!h) return null;
  const label = (i: number) => (h.bin_size === 1 ? `${i}` : `${i * h.bin_size}–${(i + 1) * h.bin_size - 1}`);
  const cats = h.accesses.map((_, i) => label(i));
  return {
    subtitle: `${h.sets} sets${h.bin_size > 1 ? `, ${h.bin_size} per bar` : ''} · access CV ${fmtFixed(h.access_cv)} · max/mean ${fmtFixed(h.max_to_mean_access)} · ${fmtInt(h.untouched_sets)} untouched`,
    option: {
      ...baseOption(),
      xAxis: { type: 'category', data: cats, name: 'set', ...axisStyle() },
      yAxis: { type: 'value', name: 'count', ...axisStyle() },
      series: [barSeries('Accesses', h.accesses, 0), barSeries('Misses', h.misses, 1)],
    },
    table: { columns: ['Sets', 'Accesses', 'Misses'], rows: cats.map((c, i) => [c, fmtInt(h.accesses[i]), fmtInt(h.misses[i])]) },
  };
}

export function missRatioCurve(r: SimulationReport): { option: ChartOption; table: TableData; subtitle: string } | null {
  const reuse = r.reuse;
  if (!reuse) return null;
  // Up to the first capacity that holds the whole footprint, plus one point.
  const lines = Math.max(1, reuse.cold);
  const kMax = Math.min(reuse.fa_lru_miss_ratio.length - 1, Math.ceil(Math.log2(lines)) + 1);
  const pts = reuse.fa_lru_miss_ratio.slice(0, kMax + 1).map((v, k) => ({ bytes: 2 ** k * reuse.line_bytes, v }));
  return {
    subtitle: `Exact fully associative LRU miss ratio for every power-of-two capacity (${reuse.line_bytes}-byte lines). Footprint ${fmtBytes(reuse.footprint_bytes)}; L1 is ${fmtBytes(r.config.l1.size_bytes)}.`,
    option: {
      ...baseOption(),
      tooltip: { ...(baseOption().tooltip as object), valueFormatter: (v: unknown) => fmtPercent(v as Rate) },
      xAxis: { type: 'category', data: pts.map((p) => fmtBytes(p.bytes)), name: 'capacity', ...axisStyle() },
      yAxis: { type: 'value', name: 'miss ratio', max: 1, axisLabel: { color: '#898781', formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
               splitLine: axisStyle().splitLine, axisLine: axisStyle().axisLine, nameTextStyle: axisStyle().nameTextStyle },
      series: [{ type: 'line', name: 'FA-LRU miss ratio', data: pts.map((p) => p.v), symbolSize: 8,
                 lineStyle: { width: 2, color: seriesColor(0) }, itemStyle: { color: seriesColor(0) } }],
    },
    table: { columns: ['Capacity', 'Miss ratio'], rows: pts.map((p) => [fmtBytes(p.bytes), fmtPercent(p.v)]) },
  };
}

export function reuseHistogram(r: SimulationReport): { option: ChartOption; table: TableData } | null {
  const reuse = r.reuse;
  if (!reuse) return null;
  // histogram[0] = distance 0; histogram[b] = distances [2^(b-1), 2^b - 1] (reuse.hpp).
  const label = (b: number) => (b === 0 ? '0' : b === 1 ? '1' : `${2 ** (b - 1)}–${2 ** b - 1}`);
  const cats = ['cold', ...reuse.histogram.map((_, b) => label(b))];
  const data = [reuse.cold, ...reuse.histogram];
  return {
    option: {
      ...baseOption(),
      xAxis: { type: 'category', data: cats, name: 'distinct lines in between', ...axisStyle() },
      yAxis: { type: 'value', name: 'accesses', ...axisStyle() },
      series: [barSeries('Accesses', data, 0)],
    },
    table: { columns: ['Reuse distance', 'Accesses'], rows: cats.map((c, i) => [c, fmtInt(data[i])]) },
  };
}
