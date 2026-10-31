// Decoder for the binary event buffer (ccsim_api.h: 20 header words + 5 words per action).
// The UI animates exactly these records; it decides nothing about the cache itself.

import {
  ACTION_KINDS,
  ACTION_WORDS,
  EVENT_HEADER_WORDS,
  FLAG_DIRTY,
  FLAG_FROM_POLICY,
  FLAG_HIT,
  LEVELS,
  OUTCOMES,
  type ActionKindName,
  type LevelName,
  type OutcomeName,
} from './abi';

export interface LevelView {
  outcome: OutcomeName;
  set: number;
  way: number;
  tag: bigint;
}

/**
 * One micro-step. `set` is always the line's set at `level`. `way` names a slot only when
 * the action refers to a resident slot: a lookup hit, evict, fill, write-back or write-through
 * hit, back_invalidate and move_out. For a lookup miss, write-back miss, write-through miss
 * and victim_insert the engine records way 0 as a placeholder; the slot the line lands in is
 * the `fill` that follows (src/sim/hierarchy.cpp). Memory actions carry set 0, way 0.
 */
export interface Action {
  kind: ActionKindName;
  level: LevelName;
  hit: boolean;
  dirty: boolean;
  fromPolicy: boolean;
  set: number;
  way: number;
  line: bigint;
}

export interface AccessEvent {
  seq: number;
  op: 'R' | 'W';
  address: bigint;
  line: bigint;
  offset: number;
  l1: LevelView;
  l2: LevelView;
  latency: number;
  actions: Action[];
}

const u64 = (w: Uint32Array, i: number): bigint => (BigInt(w[i + 1]!) << 32n) | BigInt(w[i]!);

function name<T>(names: readonly T[], value: number, what: string): T {
  const n = names[value];
  if (n === undefined) throw new Error(`event decode: unknown ${what} ${value}`);
  return n;
}

function levelView(w: Uint32Array, i: number): LevelView {
  return { outcome: name(OUTCOMES, w[i]!, 'outcome'), set: w[i + 1]!, way: w[i + 2]!, tag: u64(w, i + 3) };
}

/** Decodes every event in a buffer; throws if the buffer is not an exact sequence of events. */
export function decodeEvents(words: Uint32Array): AccessEvent[] {
  const events: AccessEvent[] = [];
  let i = 0;
  while (i < words.length) {
    if (i + EVENT_HEADER_WORDS > words.length) throw new Error('event decode: truncated header');
    const count = words[i + 19]!;
    const end = i + EVENT_HEADER_WORDS + count * ACTION_WORDS;
    if (end > words.length) throw new Error('event decode: truncated actions');
    const seq = u64(words, i);
    if (seq > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('event decode: sequence number above 2^53');
    const actions: Action[] = [];
    for (let a = i + EVENT_HEADER_WORDS; a < end; a += ACTION_WORDS) {
      const packed = words[a]!;
      const flags = (packed >>> 16) & 0xff;
      actions.push({
        kind: name(ACTION_KINDS, packed & 0xff, 'action kind'),
        level: name(LEVELS, (packed >>> 8) & 0xff, 'level'),
        hit: (flags & FLAG_HIT) !== 0,
        dirty: (flags & FLAG_DIRTY) !== 0,
        fromPolicy: (flags & FLAG_FROM_POLICY) !== 0,
        set: words[a + 1]!,
        way: words[a + 2]!,
        line: u64(words, a + 3),
      });
    }
    events.push({
      seq: Number(seq),
      op: words[i + 2] === 1 ? 'W' : 'R',
      address: u64(words, i + 3),
      line: u64(words, i + 5),
      offset: words[i + 7]!,
      l1: levelView(words, i + 8),
      l2: levelView(words, i + 13),
      latency: words[i + 18]!,
      actions,
    });
    i = end;
  }
  return events;
}
