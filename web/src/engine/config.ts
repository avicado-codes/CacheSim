// The hierarchy configuration as the UI holds it, its encoding into the ABI's flat config
// array, and the geometry derived from it. Geometry is computed from the configuration, never
// from the trace, so it is not simulation (FRONTEND_DESIGN section 3). The engine re-validates
// every configuration in session.create; the checks here only give the form instant feedback.

import {
  CONFIG_WORDS,
  INCLUSION_POLICIES,
  POLICY_NAMES,
  WRITE_MISS_POLICIES,
  WRITE_POLICIES,
  type InclusionName,
  type PolicyName,
  type WriteMissPolicyName,
  type WritePolicyName,
} from './abi';

export interface CacheConfigJS {
  sizeBytes: number;
  lineBytes: number;
  ways: number;
  hitLatency: number;
  policy: PolicyName;
  writePolicy: WritePolicyName;
  writeMissPolicy: WriteMissPolicyName;
}

export interface HierarchyConfigJS {
  l1: CacheConfigJS;
  l2: CacheConfigJS | null;
  memoryLatency: number;
  inclusion: InclusionName;
  seed: bigint;
}

const level = (sizeBytes: number, lineBytes: number, ways: number, hitLatency: number,
               policy: PolicyName = 'lru'): CacheConfigJS => ({
  sizeBytes, lineBytes, ways, hitLatency, policy,
  writePolicy: 'write_back', writeMissPolicy: 'write_allocate',
});

// Teaching defaults (ARCHITECTURE section 5.1).
export const DEFAULT_CONFIG: HierarchyConfigJS = {
  l1: level(32 * 1024, 64, 8, 4),
  l2: level(256 * 1024, 64, 8, 12),
  memoryLatency: 200,
  inclusion: 'non_inclusive',
  seed: 1n,
};

// Configurations of the hand-derived demos (docs/WORKING_DEMO.md section 2).
export const DEMO_CONFIGS = {
  demo_a_direct: { l1: level(64, 16, 1, 1), l2: null, memoryLatency: 100, inclusion: 'non_inclusive', seed: 1n },
  demo_a_2way: { l1: level(64, 16, 2, 1), l2: null, memoryLatency: 100, inclusion: 'non_inclusive', seed: 1n },
  demo_b: { l1: level(64, 16, 2, 1), l2: level(128, 16, 2, 10), memoryLatency: 100,
            inclusion: 'non_inclusive', seed: 1n },
  demo_c_fifo3: { l1: level(48, 16, 3, 1, 'fifo'), l2: null, memoryLatency: 100, inclusion: 'non_inclusive',
                  seed: 1n },
  demo_c_fifo4: { l1: level(64, 16, 4, 1, 'fifo'), l2: null, memoryLatency: 100, inclusion: 'non_inclusive',
                  seed: 1n },
} satisfies Record<string, HierarchyConfigJS>;

const index = <T extends string>(names: readonly T[], value: T): bigint => {
  const i = names.indexOf(value);
  if (i < 0) throw new Error(`unknown value ${value}`);
  return BigInt(i);
};

const encodeLevel = (c: CacheConfigJS): bigint[] => [
  BigInt(c.sizeBytes), BigInt(c.lineBytes), BigInt(c.ways), BigInt(c.hitLatency),
  index(POLICY_NAMES, c.policy), index(WRITE_POLICIES, c.writePolicy), index(WRITE_MISS_POLICIES, c.writeMissPolicy),
];

/** The uint64[19] config array of ccsim_session_create (layout in ccsim_api.h). */
export function encodeConfig(c: HierarchyConfigJS): BigUint64Array {
  const words = [
    1n,
    ...encodeLevel(c.l1),
    c.l2 ? 1n : 0n,
    ...(c.l2 ? encodeLevel(c.l2) : [0n, 0n, 0n, 0n, 0n, 0n, 0n]),
    BigInt(c.memoryLatency),
    index(INCLUSION_POLICIES, c.inclusion),
    BigInt.asUintN(64, c.seed),
  ];
  if (words.length !== CONFIG_WORDS) throw new Error('config layout mismatch');
  return BigUint64Array.from(words);
}

export interface Geometry {
  sets: number;
  ways: number;
  lineBytes: number;
  offsetBits: number;
  indexBits: number;
  tagBits: number;
}

const isPowerOfTwo = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0 && n <= 2 ** 31;
const log2 = (n: number) => Math.round(Math.log2(n));

/** Geometry of one level, or null when the configuration cannot build one. */
export function geometry(c: CacheConfigJS): Geometry | null {
  const setBytes = c.lineBytes * c.ways;
  if (!isPowerOfTwo(c.lineBytes) || c.ways < 1 || c.sizeBytes <= 0 || c.sizeBytes % setBytes !== 0) return null;
  const sets = c.sizeBytes / setBytes;
  if (!isPowerOfTwo(sets)) return null;
  const offsetBits = log2(c.lineBytes);
  const indexBits = log2(sets);
  return { sets, ways: c.ways, lineBytes: c.lineBytes, offsetBits, indexBits, tagBits: 64 - offsetBits - indexBits };
}

export interface Validation {
  errors: string[];
  warnings: string[];
}

const isCount = (n: number) => Number.isInteger(n) && n >= 1;

function checkLevel(name: string, c: CacheConfigJS, errors: string[]) {
  if (!isPowerOfTwo(c.lineBytes)) errors.push(`${name}.line: must be a power of two, got ${c.lineBytes}`);
  if (!isCount(c.ways)) errors.push(`${name}.ways: must be at least 1`);
  const setBytes = c.lineBytes * c.ways;
  if (!(c.sizeBytes > 0) || !Number.isInteger(c.sizeBytes) || (setBytes > 0 && c.sizeBytes % setBytes !== 0)) {
    errors.push(`${name}.size: ${c.sizeBytes} is not a positive multiple of line × ways = ${setBytes}`);
  } else if (setBytes > 0 && !isPowerOfTwo(c.sizeBytes / setBytes)) {
    errors.push(`${name}.size: derived set count ${c.sizeBytes / setBytes} must be a power of two`);
  }
  if (!isCount(c.hitLatency)) errors.push(`${name}.latency: must be at least 1`);
}

/** The rules of Geometry::from and Hierarchy::check, plus advisory warnings. */
export function validateConfig(c: HierarchyConfigJS): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isCount(c.memoryLatency)) errors.push('memory_latency: must be at least 1');
  checkLevel('L1', c.l1, errors);
  let worst = c.l1.hitLatency + c.memoryLatency;
  if (c.l2) {
    if (c.l2.lineBytes !== c.l1.lineBytes) errors.push(`L2.line: must equal L1.line (${c.l1.lineBytes}) in this version`);
    checkLevel('L2', c.l2, errors);
    worst += c.l2.hitLatency;
    if (c.inclusion === 'inclusive' && c.l2.sizeBytes <= c.l1.sizeBytes) {
      warnings.push('An inclusive L2 no larger than L1 back-invalidates L1 lines constantly.');
    }
    if (c.inclusion === 'exclusive' && c.l2.sizeBytes < c.l1.sizeBytes) {
      warnings.push('An exclusive L2 smaller than L1 holds only part of each L1 victim stream.');
    }
  }
  if (worst > 0xffffffff) {
    errors.push(`latency: L1 + L2 + memory latency is ${worst} cycles, above the 32-bit per-access limit`);
  }
  if (c.seed < 0n || c.seed >= 1n << 64n) errors.push('seed: must be an unsigned 64-bit integer');
  return { errors, warnings };
}

export function sameConfig(a: HierarchyConfigJS, b: HierarchyConfigJS): boolean {
  const wb = encodeConfig(b);
  return encodeConfig(a).every((w, i) => w === wb[i]);
}
