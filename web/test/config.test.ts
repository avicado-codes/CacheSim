import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEMO_CONFIGS, encodeConfig, geometry, sameConfig, validateConfig, type HierarchyConfigJS } from '../src/engine/config';
import { scenario, SCENARIOS } from './fixtures';

const b = DEMO_CONFIGS.demo_b;
const VARIANTS: Record<(typeof SCENARIOS)[number], HierarchyConfigJS> = {
  demo_a_direct: DEMO_CONFIGS.demo_a_direct,
  demo_a_2way: DEMO_CONFIGS.demo_a_2way,
  demo_b: b,
  demo_b_write_through: { ...b, l1: { ...b.l1, writePolicy: 'write_through' }, l2: { ...b.l2, writePolicy: 'write_through' } },
  demo_b_no_write_allocate: { ...b, l1: { ...b.l1, writeMissPolicy: 'no_write_allocate' } },
  demo_b_inclusive: { ...b, inclusion: 'inclusive' },
  demo_b_exclusive: { ...b, inclusion: 'exclusive' },
  demo_c_fifo3: DEMO_CONFIGS.demo_c_fifo3,
  demo_c_fifo4: DEMO_CONFIGS.demo_c_fifo4,
};

describe('config encoding', () => {
  it.each(SCENARIOS)('%s: matches the ABI words the engine fixture was built with', (name) => {
    expect(Array.from(encodeConfig(VARIANTS[name]), Number)).toEqual(scenario(name).config_words);
  });

  it('carries a full 64-bit seed', () => {
    const words = encodeConfig({ ...DEFAULT_CONFIG, seed: (1n << 64n) - 1n });
    expect(words[18]).toBe((1n << 64n) - 1n);
  });

  it('compares configurations by their encoding', () => {
    expect(sameConfig(b, { ...b })).toBe(true);
    expect(sameConfig(b, VARIANTS.demo_b_inclusive)).toBe(false);
  });
});

describe('geometry from the configuration', () => {
  it.each(SCENARIOS)('%s: agrees with the engine report', (name) => {
    const s = scenario(name);
    const levels = [VARIANTS[name].l1, ...(VARIANTS[name].l2 ? [VARIANTS[name].l2!] : [])];
    levels.forEach((c, i) => {
      const g = geometry(c)!;
      const r = s.report.levels[i]!;
      expect({ sets: g.sets, ways: g.ways, offset: g.offsetBits, index: g.indexBits })
        .toEqual({ sets: r.sets, ways: r.ways, offset: r.offset_bits, index: r.index_bits });
    });
  });

  it('teaching default L1: 64 sets, 6 offset bits, 6 index bits, 52 tag bits', () => {
    expect(geometry(DEFAULT_CONFIG.l1)).toEqual({ sets: 64, ways: 8, lineBytes: 64, offsetBits: 6, indexBits: 6, tagBits: 52 });
  });
});

describe('client-side validation (mirrors Geometry::from and Hierarchy::check)', () => {
  it('accepts the defaults and every demo', () => {
    for (const c of [DEFAULT_CONFIG, ...Object.values(VARIANTS)]) expect(validateConfig(c).errors).toEqual([]);
  });

  it('rejects a set count that is not a power of two (48 KiB, 8-way, 64 B lines = 96 sets)', () => {
    const c = { ...DEFAULT_CONFIG, l1: { ...DEFAULT_CONFIG.l1, sizeBytes: 48 * 1024 } };
    expect(validateConfig(c).errors).toEqual(['L1.size: derived set count 96 must be a power of two']);
    expect(geometry(c.l1)).toBeNull();
  });

  it('rejects size not divisible by line × ways, bad line, zero latency, unequal lines', () => {
    const l1 = DEFAULT_CONFIG.l1;
    expect(validateConfig({ ...DEFAULT_CONFIG, l1: { ...l1, sizeBytes: 1000 } }).errors[0]).toMatch(/^L1\.size: 1000 is not a positive multiple/);
    expect(validateConfig({ ...DEFAULT_CONFIG, l1: { ...l1, lineBytes: 48 } }).errors[0]).toMatch(/^L1\.line: must be a power of two/);
    expect(validateConfig({ ...DEFAULT_CONFIG, memoryLatency: 0 }).errors).toContain('memory_latency: must be at least 1');
    expect(validateConfig({ ...DEFAULT_CONFIG, l2: { ...DEFAULT_CONFIG.l2!, lineBytes: 32 } }).errors[0]).toMatch(/^L2\.line: must equal L1\.line/);
  });

  it('rejects a per-access latency above 32 bits', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, memoryLatency: 0xffffffff }).errors.at(-1)).toMatch(/32-bit per-access limit/);
  });

  it('warns about an inclusive L2 no larger than L1', () => {
    const c: HierarchyConfigJS = { ...DEFAULT_CONFIG, inclusion: 'inclusive', l2: { ...DEFAULT_CONFIG.l2!, sizeBytes: 32 * 1024 } };
    expect(validateConfig(c).warnings[0]).toMatch(/back-invalidates/);
  });
});
