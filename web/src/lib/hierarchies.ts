// The cache hierarchies a user can pick on Configure, each with a one-line plain explanation.
// The selection is derived from the configuration itself, so it stays selected for as long as the
// configuration does (through the run, analytics and comparison) and becomes "custom" on any edit.

import { DEFAULT_CONFIG, DEMO_CONFIGS, sameConfig, type HierarchyConfigJS } from '../engine/config';

export interface Hierarchy {
  id: string;
  title: string;
  /** What it is, in one plain sentence. */
  explain: string;
  /** The shape, in numbers. */
  spec: string;
  config: HierarchyConfigJS;
}

// Variations on the typical desktop, each changing one idea.
const WRITE_THROUGH_L1: HierarchyConfigJS = {
  ...DEFAULT_CONFIG,
  l1: { ...DEFAULT_CONFIG.l1, writePolicy: 'write_through', writeMissPolicy: 'no_write_allocate' },
};
const EXCLUSIVE_L2: HierarchyConfigJS = { ...DEFAULT_CONFIG, inclusion: 'exclusive' };
const EMBEDDED: HierarchyConfigJS = {
  l1: { sizeBytes: 8 * 1024, lineBytes: 32, ways: 2, hitLatency: 1, policy: 'lru',
        writePolicy: 'write_back', writeMissPolicy: 'write_allocate' },
  l2: null,
  memoryLatency: 50,
  inclusion: 'non_inclusive',
  seed: 1n,
};

export const HIERARCHIES: Hierarchy[] = [
  {
    id: 'desktop',
    title: 'Typical desktop',
    explain: 'Two levels like a laptop processor: a small, fast L1 backed by a larger L2. Best for real program traces.',
    spec: 'L1 32 KiB, 8-way · L2 256 KiB, 8-way · LRU · memory 200 cycles',
    config: DEFAULT_CONFIG,
  },
  {
    id: 'write-through',
    title: 'Write-through L1',
    explain: 'The desktop, but every store goes straight on to L2 and a store miss does not fetch the line. Shows what writes cost.',
    spec: 'L1 32 KiB, 8-way, write-through · L2 256 KiB, 8-way · LRU · memory 200 cycles',
    config: WRITE_THROUGH_L1,
  },
  {
    id: 'exclusive',
    title: 'Exclusive L2',
    explain: 'The desktop, but L1 and L2 never hold the same line, so together they keep more of the program.',
    spec: 'L1 32 KiB, 8-way · L2 256 KiB, 8-way, exclusive · LRU · memory 200 cycles',
    config: EXCLUSIVE_L2,
  },
  {
    id: 'embedded',
    title: 'Embedded',
    explain: 'One small cache and fast memory, like a microcontroller. Watch a real program outgrow it.',
    spec: 'L1 8 KiB, 2-way, 32 B lines · no L2 · LRU · memory 50 cycles',
    config: EMBEDDED,
  },
  {
    id: 'small-two-level',
    title: 'Small two-level',
    explain: 'A tiny L1 and L2 you can follow line by line: L2 hits, evictions and dirty write-backs.',
    spec: 'L1 64 B, 2-way · L2 128 B, 2-way · LRU · memory 100 cycles',
    config: DEMO_CONFIGS.demo_b,
  },
  {
    id: 'direct-mapped',
    title: 'Direct-mapped',
    explain: 'Every line has exactly one slot. Cheap to build, but two lines that share a slot keep evicting each other.',
    spec: 'L1 64 B, 1 way · no L2 · memory 100 cycles',
    config: DEMO_CONFIGS.demo_a_direct,
  },
  {
    id: 'two-way',
    title: '2-way set-associative',
    explain: 'Every line may use either of two slots in its set, so two clashing lines can both stay.',
    spec: 'L1 64 B, 2-way · LRU · no L2 · memory 100 cycles',
    config: DEMO_CONFIGS.demo_a_2way,
  },
  {
    id: 'fifo',
    title: 'FIFO, fully associative',
    explain: 'Any line can go anywhere; when full, the line that arrived first leaves, however often it is used.',
    spec: 'L1 3 lines · FIFO · no L2 · memory 100 cycles',
    config: DEMO_CONFIGS.demo_c_fifo3,
  },
];

/** The hierarchy this configuration is, or 'custom' once any setting differs from all of them. */
export function hierarchyOf(config: HierarchyConfigJS): string {
  return HIERARCHIES.find((h) => sameConfig(h.config, config))?.id ?? 'custom';
}
