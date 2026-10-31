// Constants mirrored from the engine's C ABI (include/ccsim/wasm/ccsim_api.h) and the enums
// in include/ccsim/sim/{types,events}.hpp and include/ccsim/session/session.hpp. Enum values
// are the C++ enumerator order; contract enums are append-only, so this file only ever grows.

export const API_VERSION = 1;
export const CONFIG_WORDS = 19;
export const EVENT_HEADER_WORDS = 20;
export const ACTION_WORDS = 5;

// kPolicyKindNames in types.hpp. Append here when the configuration track appends a policy.
export const POLICY_NAMES = ['lru', 'fifo', 'random'] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];

export const WRITE_POLICIES = ['write_back', 'write_through'] as const;
export type WritePolicyName = (typeof WRITE_POLICIES)[number];

export const WRITE_MISS_POLICIES = ['write_allocate', 'no_write_allocate'] as const;
export type WriteMissPolicyName = (typeof WRITE_MISS_POLICIES)[number];

export const INCLUSION_POLICIES = ['non_inclusive', 'inclusive', 'exclusive'] as const;
export type InclusionName = (typeof INCLUSION_POLICIES)[number];

// enum class Outcome
export const OUTCOMES = ['none', 'hit', 'miss', 'miss_no_allocate'] as const;
export type OutcomeName = (typeof OUTCOMES)[number];

// enum class LevelId
export const LEVELS = ['L1', 'L2', 'memory'] as const;
export type LevelName = (typeof LEVELS)[number];

// enum class ActionKind
export const ACTION_KINDS = [
  'lookup',
  'evict',
  'fill',
  'writeback',
  'write_through',
  'back_invalidate',
  'move_out',
  'victim_insert',
  'memory_read',
  'memory_write',
] as const;
export type ActionKindName = (typeof ACTION_KINDS)[number];

// Action flags
export const FLAG_HIT = 1;
export const FLAG_DIRTY = 2;
export const FLAG_FROM_POLICY = 4;

// struct Breakpoints masks
export const BREAK = {
  l1Miss: 1 << 0,
  l2Miss: 1 << 1,
  memoryAccess: 1 << 2,
  eviction: 1 << 3,
  writeback: 1 << 4,
  backInvalidation: 1 << 5,
  line: 1 << 6,
} as const;
export type BreakOn = keyof typeof BREAK;

// enum class StopReason, as returned by ccsim_session_run
export const STOP_REASONS = ['budget', 'breakpoint', 'end'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// Slot state byte from ccsim_session_slot_states: bit 0 valid, bit 1 dirty.
export const SLOT_VALID = 1;
export const SLOT_DIRTY = 2;
