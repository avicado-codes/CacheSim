// View models for the comparison view. Values, deltas and winners are the engine's
// (ccsim.comparison/1); this file formats them and builds configuration sweeps.

import { POLICY_NAMES, INCLUSION_POLICIES, WRITE_POLICIES } from '../engine/abi';
import { validateConfig, type HierarchyConfigJS } from '../engine/config';
import type { ComparisonDoc, ComparisonMetric } from '../engine/report';
import { fmtDeltaRel, fmtMetric } from './format';

const short = (c: HierarchyConfigJS['l1']) =>
  `${c.sizeBytes}B/${c.lineBytes}B/${c.ways}w ${c.policy} ${c.writePolicy === 'write_back' ? 'wb' : 'wt'}+${
    c.writeMissPolicy === 'write_allocate' ? 'wa' : 'nwa'} ${c.hitLatency}c`;

/** Short description before a run, in the engine's describe() layout; the engine's own string replaces it after. */
export function summarize(c: HierarchyConfigJS): string {
  return [`L1 ${short(c.l1)}`, ...(c.l2 ? [`L2 ${short(c.l2)}`] : []), `mem ${c.memoryLatency}c`,
          ...(c.l2 ? [c.inclusion] : []), `seed ${c.seed}`].join(' | ');
}

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  better: string;
  values: string[];
  deltas: string[];   // vs run 0; first entry is "baseline"
  best: string;       // engine's best run, "tie", or "—"
  bestIndex: number | null;
}

/**
 * The engine's winner, or "tie" / "all equal" when the best value is shared. The engine marks
 * ties itself (`tie`, with `best` null); equal values at `best` are also treated as a tie, for
 * documents written before it did.
 */
export function bestOf(m: ComparisonMetric, labels: string[]): { text: string; index: number | null } {
  if (m.better === 'neither') return { text: '—', index: null };
  if (m.tie) {
    const present = m.values.filter((x): x is number => x !== null);
    const top = m.better === 'lower' ? Math.min(...present) : Math.max(...present);
    const sharing = present.filter((x) => x === top).length;
    return { text: sharing === m.values.length ? 'all equal' : 'tie', index: null };
  }
  if (m.best === null) return { text: '—', index: null };
  const v = m.values[m.best];
  const ties = m.values.filter((x) => x !== null && x === v).length;
  if (ties > 1) return { text: ties === m.values.length ? 'all equal' : 'tie', index: null };
  return { text: labels[m.best] ?? `run ${m.best}`, index: m.best };
}

export function metricRows(doc: ComparisonDoc): MetricRow[] {
  const labels = doc.runs.map((r) => r.label);
  return doc.metrics.map((m) => {
    const best = bestOf(m, labels);
    return {
      key: m.key, label: m.label, unit: m.unit, better: m.better,
      values: m.values.map((v) => fmtMetric(v, m.unit)),
      deltas: m.delta_rel.map((d, i) => (i === 0 ? 'baseline' : fmtDeltaRel(d))),
      best: best.text, bestIndex: best.index,
    };
  });
}

export function exportLog(doc: ComparisonDoc, trace: { name: string; accesses: number; fingerprint: string }): string {
  const lines = [
    'ccsim benchmark comparison',
    `trace: ${trace.name} (${trace.accesses} accesses, fingerprint ${trace.fingerprint})`,
    doc.same_trace ? 'trace: identical for all runs' : 'WARNING: runs used different traces; deltas are not a fair comparison',
    ...doc.runs.map((r, i) => `  [${i}] ${r.label}${i === 0 ? ' (baseline)' : ''}: ${r.description}`),
    'differences from baseline:',
    ...(doc.differences.length ? doc.differences.map((d) => `  ${d}`) : ['  (none)']),
  ];
  return `${lines.join('\n')}\n`;
}

export type SweepAxis = 'l1.ways' | 'l1.size' | 'l2.size' | 'policy' | 'writePolicy' | 'inclusion';

export const SWEEP_AXES: { id: SweepAxis; label: string; short: string }[] = [
  { id: 'l1.ways', label: 'L1 associativity (1–16 ways)', short: 'L1 associativity' },
  { id: 'l1.size', label: 'L1 capacity (÷4 … ×4)', short: 'L1 capacity' },
  { id: 'l2.size', label: 'L2 capacity (÷4 … ×4)', short: 'L2 capacity' },
  { id: 'policy', label: 'Replacement policy (both levels)', short: 'replacement policy' },
  { id: 'writePolicy', label: 'Write policy (both levels)', short: 'write policy' },
  { id: 'inclusion', label: 'Inclusion', short: 'inclusion' },
];

export interface SweepResult {
  entries: { label: string; config: HierarchyConfigJS }[];
  rejected: { label: string; reason: string }[];
}

const scaled = (bytes: number) => [bytes / 4, bytes / 2, bytes, bytes * 2, bytes * 4].filter((b) => Number.isInteger(b) && b > 0);

/** Like the engine's expand_sweep: invalid combinations are listed with the reason, never dropped silently. */
export function sweep(base: HierarchyConfigJS, axis: SweepAxis): SweepResult {
  const variants: { label: string; config: HierarchyConfigJS }[] = [];
  const both = <K extends 'policy' | 'writePolicy'>(k: K, v: HierarchyConfigJS['l1'][K]) =>
    ({ ...base, l1: { ...base.l1, [k]: v }, l2: base.l2 ? { ...base.l2, [k]: v } : null });
  switch (axis) {
    case 'l1.ways':
      for (const w of [1, 2, 4, 8, 16]) variants.push({ label: `L1 ${w}-way`, config: { ...base, l1: { ...base.l1, ways: w } } });
      break;
    case 'l1.size':
      for (const b of scaled(base.l1.sizeBytes)) variants.push({ label: `L1 ${b} B`, config: { ...base, l1: { ...base.l1, sizeBytes: b } } });
      break;
    case 'l2.size':
      if (base.l2) for (const b of scaled(base.l2.sizeBytes)) variants.push({ label: `L2 ${b} B`, config: { ...base, l2: { ...base.l2!, sizeBytes: b } } });
      break;
    case 'policy':
      for (const p of POLICY_NAMES) variants.push({ label: p.toUpperCase(), config: both('policy', p) });
      break;
    case 'writePolicy':
      for (const p of WRITE_POLICIES) variants.push({ label: p.replace('_', '-'), config: both('writePolicy', p) });
      break;
    case 'inclusion':
      if (base.l2) for (const p of INCLUSION_POLICIES) variants.push({ label: p.replace('_', '-'), config: { ...base, inclusion: p } });
      break;
  }
  const out: SweepResult = { entries: [], rejected: [] };
  if (variants.length === 0) out.rejected.push({ label: axis, reason: 'needs an L2 in the base configuration' });
  for (const v of variants) {
    const errors = validateConfig(v.config).errors;
    if (errors.length) out.rejected.push({ label: v.label, reason: errors[0]! });
    else out.entries.push(v);
  }
  return out;
}

export interface SweepPlan {
  /** New steps that fit, in sweep order, at most `room` of them. */
  added: { label: string; config: HierarchyConfigJS }[];
  /** New steps beyond the run limit. */
  left: { label: string; config: HierarchyConfigJS }[];
  /** One line for the user, or null when everything asked for was added. */
  note: { kind: 'error' | 'note'; text: string } | null;
}

/**
 * What Add sweep does to a list of `listed` configurations holding at most `max`: steps that are
 * already listed are skipped quietly, steps the baseline cache cannot take are never offered, and
 * at most one line explains a sweep that added nothing or less than it could.
 */
export function planSweep(listed: { config: HierarchyConfigJS }[], base: HierarchyConfigJS, axis: SweepAxis, max: number): SweepPlan {
  const name = SWEEP_AXES.find((a) => a.id === axis)!.short;
  const r = sweep(base, axis);
  const fresh = r.entries.filter((v) => !listed.some((e) => configDifferences(e.config, v.config).length === 0));
  const room = Math.max(0, max - listed.length);
  const added = fresh.slice(0, room);
  const left = fresh.slice(room);
  let note: SweepPlan['note'] = null;
  if (r.entries.length === 0) {
    note = { kind: 'note', text: r.rejected[0]?.reason === 'needs an L2 in the base configuration'
      ? `The baseline has no L2, so there is no ${name} to sweep.` : `No ${name} step is possible for the baseline cache.` };
  } else if (left.length) {
    note = { kind: 'error', text: `Can't run more than ${max} configurations at once, so ${left.map((e) => e.label).join(', ')} ${left.length === 1 ? 'was' : 'were'} not added.` };
  } else if (added.length === 0) {
    note = { kind: 'note', text: `Every ${name} step that fits the baseline cache is already in the list.` };
  }
  return { added, left, note };
}

/** Fields of b that differ from a, in words; the engine's own differences replace these after a run. */
export function configDifferences(a: HierarchyConfigJS, b: HierarchyConfigJS): string[] {
  const out: string[] = [];
  const level = (name: string, x: HierarchyConfigJS['l1'] | null, y: HierarchyConfigJS['l1'] | null) => {
    if (!x || !y) {
      if (!!x !== !!y) out.push(`${name} ${y ? 'added' : 'removed'}`);
      return;
    }
    const keys: [keyof HierarchyConfigJS['l1'], string][] = [
      ['sizeBytes', 'capacity'], ['lineBytes', 'line size'], ['ways', 'ways'], ['hitLatency', 'hit latency'],
      ['policy', 'replacement'], ['writePolicy', 'write policy'], ['writeMissPolicy', 'write-miss policy'],
    ];
    for (const [k, label] of keys) if (x[k] !== y[k]) out.push(`${name} ${label}`);
  };
  level('L1', a.l1, b.l1);
  level('L2', a.l2, b.l2);
  if (a.memoryLatency !== b.memoryLatency) out.push('memory latency');
  if (a.l2 && b.l2 && a.inclusion !== b.inclusion) out.push('inclusion');
  if (a.seed !== b.seed) out.push('seed');
  return out;
}

export interface Check {
  ok: boolean;
  /** Blocking checks stop the comparison; advisory ones only warn. */
  blocking: boolean;
  text: string;
  detail?: string[];
}

/** Validity of a comparison before it runs (ARCHITECTURE section 10: one trace, valid, distinct configurations). */
export function checkComparison(entries: { label: string; config: HierarchyConfigJS }[], maxRuns: number,
                                trace: { ok: boolean; text: string }): Check[] {
  const invalid = entries.flatMap((e) => validateConfig(e.config).errors.map((x) => `${e.label || 'unnamed'}: ${x}`));
  const dupes: string[] = [];
  entries.forEach((a, i) => entries.slice(i + 1).forEach((b) => {
    if (configDifferences(a.config, b.config).length === 0) dupes.push(`${a.label} and ${b.label} are the same configuration`);
  }));
  const names = entries.map((e) => e.label.trim());
  const badNames = names.some((n) => !n) || new Set(names).size !== names.length;
  const base = entries[0];
  const multi = base ? entries.slice(1).filter((e) => configDifferences(base.config, e.config).length > 1) : [];
  return [
    { ok: entries.length >= 2, blocking: true, text: `At least two configurations (${entries.length} now)` },
    { ok: entries.length <= maxRuns, blocking: true, text: `At most ${maxRuns} configurations, one colour each` },
    { ok: invalid.length === 0, blocking: true, text: 'Every configuration is a valid cache', detail: invalid },
    { ok: dupes.length === 0, blocking: true, text: 'No two configurations are identical', detail: dupes },
    { ok: !badNames, blocking: true, text: 'Every run has its own name' },
    { ...trace, blocking: true },
    {
      ok: multi.length === 0, blocking: false,
      text: 'Each run changes one thing from the baseline',
      detail: multi.map((e) => `${e.label} changes ${configDifferences(base!.config, e.config).join(', ')}: its deltas mix several causes`),
    },
  ];
}
