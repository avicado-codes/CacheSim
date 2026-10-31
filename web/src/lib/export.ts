// Exports: the engine's JSON as is, CSV built from the engine's report (null stays an empty
// cell, never 0), and PDF through the browser's print dialog with the print stylesheet.

import type { LevelReport, Rate, SimulationReport } from '../engine/report';

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the print dialog ("Save as PDF"); the title becomes the suggested file name. */
export function printPdf(fileTitle: string): void {
  const before = document.title;
  document.title = fileTitle;
  const restore = () => {
    document.title = before;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

const cell = (v: string | number | Rate | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = (r: (string | number | Rate | undefined)[][]) => r.map((x) => x.map(cell).join(',')).join('\n');

export const safeName = (s: string): string => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'ccsim';

const LEVEL_FIELDS: (keyof LevelReport)[] = [
  'sets', 'ways', 'line_bytes', 'accesses', 'reads', 'writes', 'hits', 'misses', 'read_misses', 'write_misses',
  'hit_rate', 'miss_rate', 'read_miss_rate', 'write_miss_rate', 'local_miss_rate', 'global_miss_rate',
  'misses_per_kilo_access', 'evictions', 'eviction_rate', 'writebacks', 'dirty_eviction_ratio', 'writebacks_received',
  'writeback_hits', 'writeback_misses', 'no_allocate_misses', 'write_throughs_sent', 'write_throughs_received',
  'back_invalidations', 'victims_received',
];

/** Every table of the analytics page as one sectioned CSV. */
export function analyticsCsv(r: SimulationReport): string {
  const out: string[] = [];
  const section = (name: string, body: string) => out.push(`section,${cell(name)}\n${body}`);

  section('run', rows([
    ['field', 'value'],
    ['label', r.label],
    ['ccsim_version', r.ccsim_version],
    ['complete', r.complete ? 'yes' : 'no'],
    ['configuration', r.config.description],
    ['trace', r.trace.source],
    ['accesses', r.trace.accesses],
    ['reads', r.trace.reads],
    ['writes', r.trace.writes],
    ['fingerprint', r.trace.fingerprint],
  ]));
  section('summary', rows([
    ['metric', 'value', 'unit'],
    ['amat', r.amat_cycles, 'cycles'],
    ['amat_textbook', r.amat_textbook_cycles, 'cycles'],
    ['total_latency', r.total_latency_cycles, 'cycles'],
    ['speedup_vs_memory', r.speedup_vs_memory, 'x'],
    ['memory_reads', r.memory.reads, 'lines'],
    ['memory_writes', r.memory.writes, 'lines'],
    ['memory_read_bytes', r.memory.read_bytes, 'bytes'],
    ['memory_write_bytes', r.memory.write_bytes, 'bytes'],
    ['memory_bytes_per_access', r.memory.bytes_per_access, 'bytes'],
  ]));
  section('levels', rows([
    ['metric', ...r.levels.map((l) => l.name)],
    ...LEVEL_FIELDS.map((f) => [f, ...r.levels.map((l) => l[f] as Rate)]),
  ]));
  section('latency_breakdown', rows([
    ['component', 'cycles'],
    ['l1', r.latency_breakdown.l1_cycles],
    ['l2', r.latency_breakdown.l2_cycles],
    ['memory', r.latency_breakdown.memory_cycles],
    ['total', r.total_latency_cycles],
  ]));
  const c3 = r.levels.filter((l) => l.three_c);
  if (c3.length) {
    section('three_c', rows([
      ['level', 'compulsory', 'capacity', 'conflict', 'shadow_only_misses'],
      ...c3.map((l) => [l.name, l.three_c!.compulsory, l.three_c!.capacity, l.three_c!.conflict, l.three_c!.shadow_only_misses]),
    ]));
  }
  if (r.timeline) section('timeline', rows([r.timeline.columns, ...r.timeline.rows]));
  if (r.reuse) {
    section('reuse_histogram', rows([
      ['bucket', 'min_distance', 'max_distance', 'count'],
      ...r.reuse.histogram.map((c, b) => [b, b === 0 ? 0 : 2 ** (b - 1), b === 0 ? 0 : 2 ** b - 1, c]),
      ['cold', '', '', r.reuse.cold],
    ]));
    section('miss_ratio_curve', rows([
      ['lines', 'bytes', 'fa_lru_miss_ratio'],
      ...r.reuse.fa_lru_miss_ratio.map((m, k) => [2 ** k, 2 ** k * r.reuse!.line_bytes, m]),
    ]));
  }
  for (const l of r.levels) {
    const h = l.set_heatmap;
    if (!h) continue;
    section(`${l.name.toLowerCase()}_set_heatmap`, rows([
      ['first_set', 'last_set', 'accesses', 'misses'],
      ...h.accesses.map((a, i) => [i * h.bin_size, Math.min(h.sets, (i + 1) * h.bin_size) - 1, a, h.misses[i]]),
    ]));
  }
  return `${out.join('\n\n')}\n`;
}
