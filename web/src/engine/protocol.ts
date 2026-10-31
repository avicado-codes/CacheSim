// The UI <-> engine worker protocol (ARCHITECTURE section 8.2): the only engine API UI code
// uses. UI code never touches WASM memory.
//
// Additive to section 8.2, so every request has exactly one reply and the client can await it:
//   - every message carries `rid`, echoed by the reply (or by `error`);
//   - requests that 8.2 left without a reply (trace.begin, session.create, session.reset,
//     session.seek) are answered with `ok` / `session.created`;
//   - `trace.progress` reports bytes only (the ABI does not expose a line count mid-upload);
//   - `trace.ready` carries the fingerprint as a "0x..." string (64-bit, ARCHITECTURE 4.4).

import type { BreakOn, StopReason } from './abi';
import type { HierarchyConfigJS } from './config';

export type ToEngine =
  | { t: 'trace.begin'; rid: number; name: string; maxAccesses: number }
  | { t: 'trace.chunk'; rid: number; bytes: ArrayBuffer }
  | { t: 'trace.end'; rid: number }
  | { t: 'session.create'; rid: number; id: string; config: HierarchyConfigJS; classify: boolean }
  | { t: 'session.step'; rid: number; id: string; n: number; record: boolean }
  | { t: 'session.run'; rid: number; id: string; maxSteps: number; breakOn: BreakOn[]; line?: bigint }
  | { t: 'session.seek'; rid: number; id: string; position: number }
  | { t: 'session.reset'; rid: number; id: string }
  | { t: 'session.grid'; rid: number; id: string; level: 0 | 1 }
  | { t: 'session.report'; rid: number; id: string; label: string; withReuse: boolean }
  | { t: 'session.release'; rid: number; id: string }
  | { t: 'compare'; rid: number; ids: string[]; labels: string[]; format: 'json' | 'csv' };

export type FromEngine =
  | { t: 'ok'; rid: number }
  | { t: 'trace.progress'; rid: number; bytes: number }
  | { t: 'trace.ready'; rid: number; accesses: number; fingerprint: string }
  | { t: 'session.created'; rid: number; id: string; size: number }
  | { t: 'events'; rid: number; id: string; words: Uint32Array; position: number }
  | { t: 'stopped'; rid: number; id: string; reason: StopReason; words: Uint32Array; position: number }
  | { t: 'grid'; rid: number; id: string; level: 0 | 1; states: Uint8Array; tags: BigUint64Array }
  | { t: 'report'; rid: number; id: string; json: string }
  | { t: 'compare'; rid: number; json?: string; csv?: string }
  | { t: 'error'; rid: number; request: ToEngine['t']; message: string };

/** Distributes Omit over a union, so `request()` can take a message without its rid. */
export type WithoutRid<T> = T extends unknown ? Omit<T, 'rid'> : never;
