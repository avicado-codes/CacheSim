// Types for the engine's JSON documents (src/report/json.cpp, src/compare/compare.cpp).
// Only the fields the UI reads are typed; consumers ignore unknown fields. A rate is
// `number | null`: null means a zero denominator and renders as "n/a", never 0.

export type Rate = number | null;

export interface LevelConfigDoc {
  name: string;
  size_bytes: number;
  line_bytes: number;
  ways: number;
  hit_latency_cycles: number;
  policy: string;
  write_policy: string;
  write_miss_policy: string;
}

export interface ThreeC {
  compulsory: number;
  capacity: number;
  conflict: number;
  shadow_only_misses: number;
}

export interface SetHeatmap {
  sets: number;
  bin_size: number;
  untouched_sets: number;
  access_cv: Rate;
  max_to_mean_access: Rate;
  accesses: number[];
  misses: number[];
}

export interface LevelReport {
  name: string;
  sets: number;
  ways: number;
  line_bytes: number;
  offset_bits: number;
  index_bits: number;
  accesses: number;
  reads: number;
  writes: number;
  hits: number;
  misses: number;
  read_misses: number;
  write_misses: number;
  evictions: number;
  writebacks: number;
  writebacks_received: number;
  writeback_hits: number;
  writeback_misses: number;
  no_allocate_misses: number;
  write_throughs_sent: number;
  write_throughs_received: number;
  back_invalidations: number;
  victims_received: number;
  hit_rate: Rate;
  miss_rate: Rate;
  read_miss_rate: Rate;
  write_miss_rate: Rate;
  local_miss_rate: Rate;
  global_miss_rate: Rate;
  misses_per_kilo_access: Rate;
  eviction_rate: Rate;
  dirty_eviction_ratio: Rate;
  three_c?: ThreeC;
  set_heatmap?: SetHeatmap;
}

export interface SimulationReport {
  schema: 'ccsim.simulation/1';
  ccsim_version: string;
  label: string;
  complete: boolean;
  config: {
    l1: LevelConfigDoc;
    l2: LevelConfigDoc | null;
    memory_latency_cycles: number;
    inclusion: string;
    seed: number;
    seed_hex: string;
    description: string;
  };
  trace: { source: string; accesses: number; reads: number; writes: number; fingerprint: string };
  levels: LevelReport[];
  memory: {
    reads: number;
    writes: number;
    read_bytes: number;
    write_bytes: number;
    bytes_per_access: Rate;
    accesses_per_kilo_access: Rate;
  };
  total_latency_cycles: number;
  amat_cycles: Rate;
  amat_textbook_cycles: Rate;
  speedup_vs_memory: Rate;
  latency_breakdown: { l1_cycles: number; l2_cycles: number; memory_cycles: number };
  timeline?: { columns: string[]; rows: number[][] };
  reuse?: {
    line_bytes: number;
    cold: number;
    footprint_bytes: number;
    histogram: number[];
    fa_lru_miss_ratio: Rate[];
  };
}

export interface ComparisonMetric {
  key: string;
  label: string;
  unit: string;
  better: 'lower' | 'higher' | 'neither';
  values: Rate[];
  delta_abs: Rate[];
  delta_rel: Rate[];
  best: number | null;
}

export interface ComparisonDoc {
  schema: 'ccsim.comparison/1';
  same_trace: boolean;
  runs: { label: string; description: string }[];
  differences: string[];
  metrics: ComparisonMetric[];
}

export function parseReport(json: string): SimulationReport {
  const doc = JSON.parse(json) as SimulationReport;
  if (doc.schema !== 'ccsim.simulation/1') throw new Error(`unexpected report schema ${String(doc.schema)}`);
  return doc;
}

export function parseComparison(json: string): ComparisonDoc {
  const doc = JSON.parse(json) as ComparisonDoc;
  if (doc.schema !== 'ccsim.comparison/1') throw new Error(`unexpected comparison schema ${String(doc.schema)}`);
  return doc;
}
