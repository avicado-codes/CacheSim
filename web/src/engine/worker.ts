/// <reference lib="webworker" />
// Engine worker: owns one ccsim.wasm instance and translates protocol messages into C ABI
// calls (ARCHITECTURE section 8). One trace per worker; any number of sessions on it.
//
// The module is loaded from the URL passed as the worker's `name` (see client.ts), i.e.
// <site>/engine/ccsim.mjs, copied there from the Emscripten build by `npm run wasm:copy`.

import { BREAK, CONFIG_WORDS, STOP_REASONS } from './abi';
import { encodeConfig, type HierarchyConfigJS } from './config';
import type { FromEngine, ToEngine } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

type Ptr = number;
interface CcsimModule {
  HEAPU8: Uint8Array;
  UTF8ToString(p: Ptr): string;
  stringToUTF8(s: string, p: Ptr, max: number): void;
  lengthBytesUTF8(s: string): number;
  _ccsim_api_version(): number;
  _ccsim_last_error(): Ptr;
  _ccsim_alloc(bytes: number): Ptr;
  _ccsim_free(p: Ptr): void;
  _ccsim_trace_begin(name: Ptr, max: bigint): number;
  _ccsim_trace_feed(t: number, data: Ptr, len: number): number;
  _ccsim_trace_end(t: number): number;
  _ccsim_trace_size(t: number): bigint;
  _ccsim_trace_fingerprint(t: number): bigint;
  _ccsim_trace_release(t: number): void;
  _ccsim_session_create(t: number, cfg: Ptr, words: number, flags: number): number;
  _ccsim_session_release(s: number): void;
  _ccsim_session_position(s: number): bigint;
  _ccsim_session_reset(s: number): number;
  _ccsim_session_seek(s: number, pos: bigint): number;
  _ccsim_session_step(s: number, n: number, record: number): number;
  _ccsim_session_run(s: number, max: number, mask: number, line: bigint): number;
  _ccsim_event_buffer(): Ptr;
  _ccsim_event_buffer_words(): number;
  _ccsim_session_slot_states(s: number, level: number): Ptr;
  _ccsim_session_slot_tags(s: number, level: number): Ptr;
  _ccsim_session_report_json(s: number, label: Ptr, withReuse: number): Ptr;
  _ccsim_compare_json(sessions: Ptr, count: number, labels: Ptr): Ptr;
  _ccsim_compare_csv(sessions: Ptr, count: number, labels: Ptr): Ptr;
}

interface SessionEntry {
  handle: number;
  config: HierarchyConfigJS;
}

let modulePromise: Promise<CcsimModule> | null = null;
let trace = 0;
let traceBytes = 0;
const sessions = new Map<string, SessionEntry>();

function load(): Promise<CcsimModule> {
  modulePromise ??= (async () => {
    const url = self.name;
    let factory: () => Promise<CcsimModule>;
    try {
      factory = (await import(/* @vite-ignore */ url)).default;
    } catch {
      // Shown to the user: no repository paths. Developers: build ccsim.wasm and run `npm run wasm:copy`.
      throw new Error(`The simulation engine could not be loaded from ${url}. This build of the site is missing ` +
                      'its WebAssembly engine.');
    }
    const M = await factory();
    if (M._ccsim_api_version() !== 1) throw new Error('engine ABI version mismatch');
    return M;
  })();
  return modulePromise;
}

function lastError(M: CcsimModule): string {
  return M.UTF8ToString(M._ccsim_last_error()) || 'unknown engine error';
}

function check(M: CcsimModule, ok: boolean): void {
  if (!ok) throw new Error(lastError(M));
}

function withString<T>(M: CcsimModule, s: string, f: (p: Ptr) => T): T {
  const n = M.lengthBytesUTF8(s) + 1;
  const p = M._ccsim_alloc(n);
  try {
    M.stringToUTF8(s, p, n);
    return f(p);
  } finally {
    M._ccsim_free(p);
  }
}

function session(id: string): SessionEntry {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown session ${id}`);
  return s;
}

// Views are taken after each call: memory growth replaces the heap buffer.
function eventWords(M: CcsimModule): Uint32Array {
  const n = M._ccsim_event_buffer_words();
  return new Uint32Array(M.HEAPU8.buffer, M._ccsim_event_buffer(), n).slice();
}

// uint64 results cross as BigInt but signed (i64): reinterpret them as unsigned, or a fingerprint
// with its top bit set prints as "0x-…".
const u64 = (x: bigint): bigint => BigInt.asUintN(64, x);
const position = (M: CcsimModule, h: number) => Number(u64(M._ccsim_session_position(h)));

async function handle(msg: ToEngine): Promise<[FromEngine, Transferable[]]> {
  const M = await load();
  const rid = msg.rid;
  switch (msg.t) {
    case 'trace.begin': {
      if (trace > 0) M._ccsim_trace_release(trace);  // sessions keep their own reference
      trace = withString(M, msg.name, (p) => M._ccsim_trace_begin(p, BigInt(msg.maxAccesses)));
      check(M, trace > 0);
      traceBytes = 0;
      return [{ t: 'ok', rid }, []];
    }
    case 'trace.chunk': {
      const bytes = new Uint8Array(msg.bytes);
      const p = M._ccsim_alloc(bytes.length);
      try {
        M.HEAPU8.set(bytes, p);
        check(M, M._ccsim_trace_feed(trace, p, bytes.length) === 0);
      } finally {
        M._ccsim_free(p);
      }
      traceBytes += bytes.length;
      return [{ t: 'trace.progress', rid, bytes: traceBytes }, []];
    }
    case 'trace.end': {
      check(M, M._ccsim_trace_end(trace) === 0);
      const accesses = Number(u64(M._ccsim_trace_size(trace)));
      // Same text as the engine's JSON ("0x" + lowercase hex, no padding), so the two compare equal.
      const fingerprint = `0x${u64(M._ccsim_trace_fingerprint(trace)).toString(16)}`;
      return [{ t: 'trace.ready', rid, accesses, fingerprint }, []];
    }
    case 'session.create': {
      if (sessions.has(msg.id)) throw new Error(`session ${msg.id} already exists`);
      const words = encodeConfig(msg.config);
      const p = M._ccsim_alloc(CONFIG_WORDS * 8);
      let h: number;
      try {
        new BigUint64Array(M.HEAPU8.buffer, p, CONFIG_WORDS).set(words);
        h = M._ccsim_session_create(trace, p, CONFIG_WORDS, msg.classify ? 0 : 1);
      } finally {
        M._ccsim_free(p);
      }
      check(M, h > 0);
      sessions.set(msg.id, { handle: h, config: msg.config });
      return [{ t: 'session.created', rid, id: msg.id, size: Number(u64(M._ccsim_trace_size(trace))) }, []];
    }
    case 'session.step': {
      const { handle: h } = session(msg.id);
      check(M, M._ccsim_session_step(h, Math.min(msg.n, 0xffffffff), msg.record ? 1 : 0) >= 0);
      const words = msg.record ? eventWords(M) : new Uint32Array(0);
      return [{ t: 'events', rid, id: msg.id, words, position: position(M, h) }, [words.buffer]];
    }
    case 'session.run': {
      const { handle: h } = session(msg.id);
      const mask = msg.breakOn.reduce((m, b) => m | BREAK[b], 0);
      const r = M._ccsim_session_run(h, Math.min(msg.maxSteps, 0xffffffff), mask, msg.line ?? 0n);
      check(M, r >= 0);
      const words = eventWords(M);
      const reason = STOP_REASONS[r] ?? 'end';
      return [{ t: 'stopped', rid, id: msg.id, reason, words, position: position(M, h) }, [words.buffer]];
    }
    case 'session.seek':
      check(M, M._ccsim_session_seek(session(msg.id).handle, BigInt(msg.position)) === 0);
      return [{ t: 'ok', rid }, []];
    case 'session.reset':
      check(M, M._ccsim_session_reset(session(msg.id).handle) === 0);
      return [{ t: 'ok', rid }, []];
    case 'session.grid': {
      const s = session(msg.id);
      const c = msg.level === 0 ? s.config.l1 : s.config.l2;
      if (!c) throw new Error('this configuration has no L2');
      const slots = c.sizeBytes / c.lineBytes;
      const sp = M._ccsim_session_slot_states(s.handle, msg.level);
      const tp = M._ccsim_session_slot_tags(s.handle, msg.level);
      check(M, sp !== 0 && tp !== 0);
      const states = new Uint8Array(M.HEAPU8.buffer, sp, slots).slice();
      const tags = new BigUint64Array(M.HEAPU8.buffer, tp, slots).slice();
      return [{ t: 'grid', rid, id: msg.id, level: msg.level, states, tags }, [states.buffer, tags.buffer]];
    }
    case 'session.report': {
      const { handle: h } = session(msg.id);
      const json = withString(M, msg.label, (p) => {
        const out = M._ccsim_session_report_json(h, p, msg.withReuse ? 1 : 0);
        check(M, out !== 0);
        return M.UTF8ToString(out);
      });
      return [{ t: 'report', rid, id: msg.id, json }, []];
    }
    case 'session.release': {
      const s = sessions.get(msg.id);
      if (s) M._ccsim_session_release(s.handle);
      sessions.delete(msg.id);
      return [{ t: 'ok', rid }, []];
    }
    case 'compare': {
      const n = msg.ids.length;
      const ids = M._ccsim_alloc(4 * n);
      const labels = M._ccsim_alloc(4 * n);
      const strings: Ptr[] = [];
      try {
        msg.ids.forEach((id, i) => {
          const label = msg.labels[i] ?? id;
          const len = M.lengthBytesUTF8(label) + 1;
          const p = M._ccsim_alloc(len);
          M.stringToUTF8(label, p, len);
          strings.push(p);
          new Int32Array(M.HEAPU8.buffer, ids, n)[i] = session(id).handle;
          new Uint32Array(M.HEAPU8.buffer, labels, n)[i] = p;
        });
        const out = msg.format === 'json' ? M._ccsim_compare_json(ids, n, labels) : M._ccsim_compare_csv(ids, n, labels);
        check(M, out !== 0);
        const text = M.UTF8ToString(out);
        return [msg.format === 'json' ? { t: 'compare', rid, json: text } : { t: 'compare', rid, csv: text }, []];
      } finally {
        strings.forEach((p) => M._ccsim_free(p));
        M._ccsim_free(ids);
        M._ccsim_free(labels);
      }
    }
  }
}

// Requests are handled strictly in arrival order.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<ToEngine>) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      const [reply, transfer] = await handle(msg);
      self.postMessage(reply, transfer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ t: 'error', rid: msg.rid, request: msg.t, message } satisfies FromEngine);
    }
  });
};
