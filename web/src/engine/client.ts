// Promise-based client over one engine worker. Each request resolves with its matching reply
// (by `rid`) or rejects with the engine's error message.

import type { FromEngine, ToEngine, WithoutRid } from './protocol';

type ReplyOf<T extends FromEngine['t']> = Extract<FromEngine, { t: T }>;

/** URL of the Emscripten module, resolved against the page so it works under any base path. */
export const engineModuleUrl = (): string => new URL('engine/ccsim.mjs', document.baseURI).href;

export class EngineClient {
  private readonly worker: Worker;
  private nextRid = 1;
  private readonly pending = new Map<number, { resolve: (r: FromEngine) => void; reject: (e: Error) => void }>();

  constructor() {
    // The worker reads the module URL from its name (see worker.ts).
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: engineModuleUrl() });
    this.worker.onmessage = (e: MessageEvent<FromEngine>) => {
      const p = this.pending.get(e.data.rid);
      if (!p) return;
      this.pending.delete(e.data.rid);
      if (e.data.t === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    this.worker.onerror = (e) => this.failAll(new Error(e.message || 'engine worker failed to start'));
  }

  request<T extends FromEngine['t']>(msg: WithoutRid<ToEngine>, expect: T,
                                     transfer: Transferable[] = []): Promise<ReplyOf<T>> {
    const rid = this.nextRid++;
    return new Promise((resolve, reject) => {
      this.pending.set(rid, {
        resolve: (r) => (r.t === expect ? resolve(r as ReplyOf<T>) : reject(new Error(`unexpected reply ${r.t}`))),
        reject,
      });
      this.worker.postMessage({ ...msg, rid } as ToEngine, transfer);
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.failAll(new Error('engine worker stopped'));
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
