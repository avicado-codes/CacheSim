// The trace loader decides on decompression from the gzip magic bytes, not the file name.

import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzipIfNeeded } from '../src/engine/trace';

const TEXT = 'R 0x0\nW 0x40\nR 0x80\n';

function streamOf(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
}

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('gunzipIfNeeded', () => {
  it('passes plain text through unchanged, across chunks', async () => {
    const bytes = new TextEncoder().encode(TEXT);
    expect(await text(await gunzipIfNeeded(streamOf(new Uint8Array(0), bytes.subarray(0, 3), bytes.subarray(3))))).toBe(TEXT);
  });

  it('decompresses gzip data', async () => {
    const gz = new Uint8Array(gzipSync(TEXT));
    expect(await text(await gunzipIfNeeded(streamOf(gz.subarray(0, 5), gz.subarray(5))))).toBe(TEXT);
  });

  it('handles an empty stream', async () => {
    expect(await text(await gunzipIfNeeded(streamOf()))).toBe('');
  });
});
