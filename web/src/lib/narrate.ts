// Turns one engine event into words for the decision panel. Every sentence restates an
// action the engine recorded, in the engine's order; nothing here decides cache behaviour.

import type { HierarchyConfigJS } from '../engine/config';
import type { AccessEvent, Action } from '../engine/events';
import { fmtHex } from './format';

export interface Narration {
  headline: string;
  steps: string[];
}

function policyOf(level: Action['level'], config: HierarchyConfigJS): string {
  const c = level === 'L1' ? config.l1 : level === 'L2' ? config.l2 : null;
  return c ? c.policy.toUpperCase() : '';
}

function describe(a: Action, config: HierarchyConfigJS): string {
  const at = `set ${a.set}, way ${a.way}`;
  const line = `line ${fmtHex(a.line)}`;
  switch (a.kind) {
    case 'lookup':
      return `${a.level} lookup for ${line}: ${a.hit ? `hit in ${at}` : `miss in set ${a.set}`}.`;
    case 'evict':
      return `${a.level} evicts ${line} from ${at} (${a.dirty ? 'dirty' : 'clean'}${
        a.fromPolicy ? `, victim chosen by ${policyOf(a.level, config)}` : ''}).`;
    case 'fill':
      return `${a.level} installs ${line} in ${at} (${a.dirty ? 'dirty' : 'clean'}).`;
    case 'writeback':
      return `Dirty ${line} is written back into ${a.level}${
        a.hit ? ` (already resident in ${at}, now dirty)` : ' (not resident there, so it is allocated)'}.`;
    case 'write_through':
      return `The store is forwarded to ${a.level}${a.hit ? ` and updates ${line} in ${at}` : ` (${line} not resident there)`}.`;
    case 'back_invalidate':
      return `Inclusive L2 evicted ${line}, so its L1 copy in ${at} is invalidated (${a.dirty ? 'dirty' : 'clean'}).`;
    case 'move_out':
      return `Exclusive hierarchy: ${line} moves out of L2 ${at} up into L1 (${a.dirty ? 'dirty' : 'clean'}).`;
    case 'victim_insert':
      return `Exclusive hierarchy: the L1 victim ${line} moves into L2 set ${a.set} (${a.dirty ? 'dirty' : 'clean'}).`;
    case 'memory_read':
      return `Memory read of ${line}.`;
    case 'memory_write':
      return `Memory write of ${line}.`;
  }
}

export function narrate(e: AccessEvent, config: HierarchyConfigJS): Narration {
  const op = e.op === 'W' ? 'Store' : 'Load';
  const l1 = e.l1.outcome === 'miss_no_allocate' ? 'L1 write miss, not allocated (write-around)'
           : `L1 ${e.l1.outcome}`;
  const l2 = e.l2.outcome === 'none' ? '' : `, L2 ${e.l2.outcome}`;
  return {
    headline: `Access ${e.seq + 1}: ${op} ${fmtHex(e.address)} — ${l1}${l2}, ${e.latency} cycle${e.latency === 1 ? '' : 's'}`,
    steps: e.actions.map((a) => describe(a, config)),
  };
}

export type Highlight = 'hit' | 'fill' | 'evict' | 'update';

/**
 * Cells the current event touched, keyed "level:set:way", for transient highlights. Taken
 * from the engine's action log; the grid's contents always come from the engine snapshot.
 * Only actions that name a resident slot are used (see Action in engine/events.ts). Actions
 * are in engine order, so the last one on a slot wins (an evicted slot refilled shows "fill").
 */
export function highlights(e: AccessEvent | null): Map<string, Highlight> {
  const out = new Map<string, Highlight>();
  if (!e) return out;
  for (const a of e.actions) {
    if (a.level === 'memory') continue;
    const key = `${a.level}:${a.set}:${a.way}`;
    if (a.kind === 'lookup' && a.hit) out.set(key, 'hit');
    else if (a.kind === 'fill') out.set(key, 'fill');
    else if (a.kind === 'evict' || a.kind === 'back_invalidate' || a.kind === 'move_out') out.set(key, 'evict');
    else if ((a.kind === 'writeback' || a.kind === 'write_through') && a.hit) out.set(key, 'update');
  }
  return out;
}
