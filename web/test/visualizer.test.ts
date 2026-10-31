// The visualiser draws the engine's grid snapshot and highlights the slots the engine's actions
// name. These tests check, for every access of every scenario, that the two agree: the
// highlights never claim a state the engine's snapshot does not have (FRONTEND_DESIGN FE-2).

import { describe, expect, it } from 'vitest';
import { SLOT_DIRTY, SLOT_VALID } from '../src/engine/abi';
import { DEMO_CONFIGS, geometry } from '../src/engine/config';
import { decodeEvents } from '../src/engine/events';
import { highlights, narrate } from '../src/lib/narrate';
import { scenario, SCENARIOS } from './fixtures';

describe('highlights agree with the engine snapshot after each access', () => {
  it.each(SCENARIOS)('%s', (name) => {
    const s = scenario(name);
    const events = decodeEvents(Uint32Array.from(s.event_words));
    events.forEach((e, k) => {
      const after = s.grids[k + 1]!;
      for (const [key, kind] of highlights(e)) {
        const [level, set, way] = key.split(':');
        const lvl = level === 'L1' ? 0 : 1;
        const grid = lvl === 0 ? after.l1 : after.l2!;
        const ways = s.report.levels[lvl]!.ways;
        const slot = Number(set) * ways + Number(way);
        const state = grid.states[slot]!;
        if (kind === 'fill' || kind === 'hit' || kind === 'update') {
          expect(state & SLOT_VALID, `${name} access ${k + 1} ${key} ${kind}`).toBe(SLOT_VALID);
        }
        if (kind === 'fill') {
          const action = e.actions.filter((a) => `${a.level}:${a.set}:${a.way}` === key && a.kind === 'fill').at(-1)!;
          const sets = s.report.levels[lvl]!.sets;
          const tag = action.line >> BigInt(Math.log2(sets));
          expect(BigInt(grid.tags[slot]!), `${name} access ${k + 1} ${key} tag`).toBe(tag);
          expect((state & SLOT_DIRTY) !== 0).toBe(action.dirty);
        }
        if (kind === 'evict') expect(state & SLOT_VALID, `${name} access ${k + 1} ${key} evicted`).toBe(0);
      }
    });
  });

  it('the final snapshot of Demo B holds the lines of WORKING_DEMO step 10', () => {
    const s = scenario('demo_b');
    const final = s.grids.at(-1)!;
    // L1 set 0 holds lines 12 (dirty, written at step 6) and 16; set 1 holds line 1.
    const l1Lines = final.l1.states.map((st, i) => (st & SLOT_VALID ? `${BigInt(final.l1.tags[i]!) * 2n + BigInt(Math.floor(i / 2))}${st & SLOT_DIRTY ? 'd' : ''}` : '-'));
    expect(l1Lines.slice(0, 2).sort()).toEqual(['12d', '16']);
    expect(l1Lines.slice(2).filter((x) => x !== '-')).toEqual(['1']);
  });
});

describe('narration restates the engine actions in order', () => {
  const events = decodeEvents(Uint32Array.from(scenario('demo_b').event_words));
  const n = narrate(events[3]!, DEMO_CONFIGS.demo_b);

  it('headline', () => {
    expect(n.headline).toBe('Access 4: Load 0x80 — L1 miss, L2 miss, 111 cycles');
  });

  it('one sentence per action, write-back before the L2 demand lookup', () => {
    expect(n.steps).toHaveLength(events[3]!.actions.length);
    expect(n.steps[1]).toBe('L1 evicts line 0x0 from set 0, way 0 (dirty, victim chosen by LRU).');
    expect(n.steps[2]).toBe('Dirty line 0x0 is written back into L2 (already resident in set 0, way 0, now dirty).');
    expect(n.steps[3]).toBe('L2 lookup for line 0x8: miss in set 0.');
  });

  it('labels a write-around miss', () => {
    const e = decodeEvents(Uint32Array.from(scenario('demo_b_no_write_allocate').event_words)).find((x) => x.l1.outcome === 'miss_no_allocate')!;
    expect(narrate(e, DEMO_CONFIGS.demo_b).headline).toMatch(/L1 write miss, not allocated \(write-around\)/);
  });

  it('geometry of Demo B: L1 2 sets, L2 4 sets', () => {
    expect(geometry(DEMO_CONFIGS.demo_b.l1)?.sets).toBe(2);
    expect(geometry(DEMO_CONFIGS.demo_b.l2)?.sets).toBe(4);
  });
});
