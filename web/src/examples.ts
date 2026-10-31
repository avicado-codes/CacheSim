// Example traces, offered as downloads next to the upload area. A run always starts from a file
// the user uploads, so these are files to save, look at and upload back. The bodies come from the
// traces the native test suites check; their repository comments are replaced with a header
// written for the reader (comments never change a trace's accesses or fingerprint).

import conflictRaw from '../../tests/data/golden/demo_a_conflict.trace?raw';
import walkthroughRaw from '../../tests/data/golden/demo_b_two_level.trace?raw';
import fifoRaw from '../../tests/data/golden/demo_c_belady.trace?raw';
import matmulUrl from '../../tests/data/standard/matmul64-O0.trace.gz?url';
import { DEFAULT_CONFIG, DEMO_CONFIGS, type HierarchyConfigJS } from './engine/config';
import { download } from './lib/export';

const accessesOnly = (raw: string): string =>
  raw.split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#')).join('\n');

const withHeader = (header: string[], raw: string): string =>
  `${header.map((h) => `# ${h}`).join('\n')}\n${accessesOnly(raw)}\n`;

/** How a trace must look. Every line here is accepted by the engine's parser. */
export const FORMAT_EXAMPLE = `# ccsim trace, format version 1
#
# One memory access per line:   <op> <address>
#   op       R for a read (load) or W for a write (store), in upper case
#   address  0x followed by 1 to 16 hexadecimal digits: a 64-bit byte address
#
# Everything after a # is a comment. Blank lines are ignored. LF or CRLF line ends.
# A line may be at most 4,096 bytes long, comment included.
# Spaces or tabs may surround the two fields; nothing else may follow the address.
# Access sizes are not modelled: each access touches the cache line holding its address.
# Any other line rejects the whole file and reports its line number.
# The file may be gzip-compressed (.trace.gz).

R 0x1000
R 0x1008          # same 64-byte line as 0x1000: a hit in any cache with lines of 64 bytes
W 0x2040          # a store
R 0x7ffe3a10
W 0x1000          # a store to a line that is already cached
R 0xFFFFFFFFFFFFFFF8
`;

export const FORMAT_EXAMPLE_NAME = 'ccsim-trace-format-example.trace';

export interface Example {
  id: 'walkthrough' | 'conflict' | 'fifo' | 'matmul';
  title: string;
  detail: string;
  fileName: string;
  /** Plain text, or a URL for the large gzip-compressed trace. */
  text?: string;
  url?: string;
  /** The cache this trace was written to show, if any. */
  config?: HierarchyConfigJS;
}

export const EXAMPLES: Example[] = [
  {
    id: 'walkthrough',
    title: 'Two-level write-back walkthrough',
    detail: '10 accesses through a 2-way L1 and a 2-way L2: misses, an L2 hit and a dirty write-back',
    fileName: 'two-level-write-back.trace',
    text: withHeader([
      'Two-level write-back walkthrough: 10 accesses.',
      'Use with L1 64 B, 16 B lines, 2-way, LRU, write-back, write-allocate, 1 cycle;',
      'L2 128 B, 16 B lines, 2-way, 10 cycles; memory 100 cycles; non-inclusive.',
    ], walkthroughRaw),
    config: DEMO_CONFIGS.demo_b,
  },
  {
    id: 'conflict',
    title: 'Direct-mapped conflict misses',
    detail: '6 accesses to two lines that share one set of a direct-mapped cache',
    fileName: 'direct-mapped-conflict.trace',
    text: withHeader([
      'Direct-mapped conflict misses: lines 0x000 and 0x040 alternate.',
      'In a 64 B direct-mapped cache with 16 B lines both map to set 0 and evict each other;',
      'with 2 ways both fit and only the first touch of each misses.',
    ], conflictRaw),
    config: DEMO_CONFIGS.demo_a_direct,
  },
  {
    id: 'fifo',
    title: "FIFO replacement and Belady's anomaly",
    detail: '12 accesses; under FIFO a 4-line cache misses more than a 3-line one',
    fileName: 'fifo-belady-anomaly.trace',
    text: withHeader([
      "FIFO replacement and Belady's anomaly: the reference string 1,2,3,4,1,2,5,1,2,3,4,5",
      'as 16-byte lines. Fully associative FIFO with 3 lines: 9 misses; with 4 lines: 10.',
    ], fifoRaw),
    config: DEMO_CONFIGS.demo_c_fifo3,
  },
  {
    id: 'matmul',
    title: 'Matrix multiply, 64 × 64',
    detail: '4,051,312 accesses of an unoptimised 64 × 64 matrix multiply (1.2 MB, gzip)',
    fileName: 'matrix-multiply-64x64.trace.gz',
    url: matmulUrl,
    config: DEFAULT_CONFIG,
  },
];

export const exampleById = (id: Example['id']): Example => EXAMPLES.find((e) => e.id === id)!;

/** The standard dataset, offered on every trace card for anyone without a trace of their own. */
export const STANDARD_TRACE = exampleById('matmul');
export const STANDARD_TRACE_SUMMARY = 'Matrix multiply, 64 × 64: 4,051,312 accesses from a real program (1.2 MB download). Best on the Typical desktop hierarchy.';

/** The standard dataset as a File, byte for byte the shipped one, so it goes through the same engine check as an upload. */
export async function standardTraceFile(): Promise<File> {
  const res = await fetch(STANDARD_TRACE.url!);
  if (!res.ok) throw new Error(`could not load the standard trace (HTTP ${res.status})`);
  return new File([await res.blob()], STANDARD_TRACE.fileName, { type: 'application/gzip' });
}

/** Saves an example (or the format example) as a file. */
export function downloadExample(e: Example | 'format'): void {
  if (e === 'format') {
    download(FORMAT_EXAMPLE_NAME, FORMAT_EXAMPLE, 'text/plain');
  } else if (e.text !== undefined) {
    download(e.fileName, e.text, 'text/plain');
  } else if (e.url) {
    const a = document.createElement('a');
    a.href = e.url;
    a.download = e.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
