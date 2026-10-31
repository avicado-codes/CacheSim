// Streams a trace into an engine worker (ARCHITECTURE section 6): the browser decompresses
// .gz with DecompressionStream, chunks of about 1 MiB are transferred to the worker, and the
// engine's push parser does the rest. The trace never leaves the machine.

import type { EngineClient } from './client';

export const CHUNK_BYTES = 1 << 20;
export const DEFAULT_MAX_ACCESSES = 50_000_000;

export type TraceSource =
  | { kind: 'text'; name: string; text: string }
  | { kind: 'file'; file: File }
  | { kind: 'url'; name: string; url: string };

export interface TraceInfo {
  name: string;
  accesses: number;
  fingerprint: string;
}

export const sourceName = (s: TraceSource): string => (s.kind === 'file' ? s.file.name : s.name);

async function byteStream(source: TraceSource): Promise<ReadableStream<Uint8Array>> {
  let stream: ReadableStream<Uint8Array>;
  if (source.kind === 'text') {
    stream = new Blob([source.text]).stream();
  } else if (source.kind === 'file') {
    stream = source.file.stream();
  } else {
    const res = await fetch(source.url);
    if (!res.ok || !res.body) throw new Error(`could not load ${source.name}: HTTP ${res.status}`);
    stream = res.body;
  }
  return gunzipIfNeeded(stream);
}

/**
 * Decompresses when the data starts with the gzip magic bytes (1f 8b), whatever the file is
 * called: a host may already have decoded a .gz (Content-Encoding), or a plain trace may be
 * named .gz. Plain text traces can never start with 0x1f.
 */
export async function gunzipIfNeeded(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  let first = await reader.read();
  while (!first.done && first.value.length === 0) first = await reader.read();
  const head = first.done ? new Uint8Array(0) : first.value;
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length) controller.enqueue(head);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const gzip = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
  return gzip
    ? replay.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    : replay;
}

/** Re-chunks a byte stream into fresh ~1 MiB ArrayBuffers that can be transferred. */
async function* chunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<ArrayBuffer> {
  const reader = stream.getReader();
  let buf = new Uint8Array(CHUNK_BYTES);
  let used = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let off = 0;
    while (off < value.length) {
      const n = Math.min(CHUNK_BYTES - used, value.length - off);
      buf.set(value.subarray(off, off + n), used);
      used += n;
      off += n;
      if (used === CHUNK_BYTES) {
        yield buf.buffer;
        buf = new Uint8Array(CHUNK_BYTES);
        used = 0;
      }
    }
  }
  if (used > 0) yield buf.slice(0, used).buffer;
}

export async function uploadTrace(client: EngineClient, source: TraceSource,
                                  onProgress?: (bytes: number) => void,
                                  maxAccesses = DEFAULT_MAX_ACCESSES): Promise<TraceInfo> {
  const name = sourceName(source);
  await client.request({ t: 'trace.begin', name, maxAccesses }, 'ok');
  for await (const bytes of chunks(await byteStream(source))) {
    const p = await client.request({ t: 'trace.chunk', bytes }, 'trace.progress', [bytes]);
    onProgress?.(p.bytes);
  }
  const ready = await client.request({ t: 'trace.end' }, 'trace.ready');
  return { name, accesses: ready.accesses, fingerprint: ready.fingerprint };
}
