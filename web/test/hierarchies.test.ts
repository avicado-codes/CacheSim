// The hierarchy choice on Configure: the selection is derived from the stored configuration, so it
// stays selected while that configuration does and reads "custom" after any edit. Also the one-shot
// autoplay flag that Run simulation and Watch side by side leave for the page they open.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from '../src/engine/config';
import { HIERARCHIES, hierarchyOf } from '../src/lib/hierarchies';
import { MAX_RUNS, useApp } from '../src/store/useApp';

describe('hierarchy choice', () => {
  it('names every hierarchy by its own id, and ids are unique', () => {
    for (const h of HIERARCHIES) expect(hierarchyOf(structuredClone(h.config))).toBe(h.id);
    expect(new Set(HIERARCHIES.map((h) => h.id)).size).toBe(HIERARCHIES.length);
  });

  it('every hierarchy is a valid cache', () => {
    for (const h of HIERARCHIES) expect(validateConfig(h.config).errors, h.id).toEqual([]);
  });

  it('starts on the typical desktop', () => {
    expect(hierarchyOf(DEFAULT_CONFIG)).toBe('desktop');
  });

  it('becomes custom after any edit', () => {
    expect(hierarchyOf({ ...DEFAULT_CONFIG, memoryLatency: DEFAULT_CONFIG.memoryLatency + 1 })).toBe('custom');
    expect(hierarchyOf({ ...DEFAULT_CONFIG, l1: { ...DEFAULT_CONFIG.l1, ways: 4 } })).toBe('custom');
  });
});

describe('autoplay flag', () => {
  it('is taken once, and only by the page it was left for', () => {
    useApp.setState({ autoplay: 'visualize' });
    expect(useApp.getState().takeAutoplay('race')).toBe(false);
    expect(useApp.getState().takeAutoplay('visualize')).toBe(true);
    expect(useApp.getState().takeAutoplay('visualize')).toBe(false);
  });
});

describe('comparison size', () => {
  it('holds at most four configurations', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ key: 1000 + i, label: `r${i}`, config: DEFAULT_CONFIG }));
    useApp.getState().setEntries(many);
    expect(MAX_RUNS).toBe(4);
    expect(useApp.getState().entries.map((e) => e.label)).toEqual(['r0', 'r1', 'r2', 'r3']);
  });
});
