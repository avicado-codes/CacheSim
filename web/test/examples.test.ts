// Example traces offered for download, the trace format example, and the hash routes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, FORMAT_EXAMPLE } from '../src/examples';
import { parse } from '../src/router';

// The engine's line grammar (src/io/trace.cpp parse_trace_line), restated for the test.
const LINE = /^[ \t]*(R|W)[ \t]+0x[0-9a-fA-F]{1,16}[ \t]*$/;
const accesses = (text: string) =>
  text.split('\n').map((l) => l.replace(/#.*/, '').replace(/\r$/, '')).filter((l) => l.trim() !== '');

describe('trace examples', () => {
  it('the format example is all comments, blanks and valid accesses', () => {
    const lines = accesses(FORMAT_EXAMPLE);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(l).toMatch(LINE);
  });

  it('example downloads keep exactly the accesses of the checked traces', () => {
    const golden: Record<string, string> = {
      walkthrough: 'demo_b_two_level', conflict: 'demo_a_conflict', fifo: 'demo_c_belady',
    };
    for (const [id, file] of Object.entries(golden)) {
      const x = EXAMPLES.find((e) => e.id === id)!;
      const raw = readFileSync(new URL(`../../tests/data/golden/${file}.trace`, import.meta.url), 'utf8');
      expect(accesses(x.text!)).toEqual(accesses(raw));
    }
  });

  it('example downloads name no repository files or demo letters', () => {
    for (const x of EXAMPLES) {
      const visible = `${x.title} ${x.detail} ${x.fileName} ${x.text ?? ''}`;
      expect(visible).not.toMatch(/demo [abc]\b|\.md\b|docs\/|WORKING_DEMO|matmul64-O0/i);
    }
  });
});

describe('routes', () => {
  it('parses the compare sub-pages and falls back to home', () => {
    expect(parse('#/compare')).toBe('compare');
    expect(parse('#/compare/live')).toBe('race');
    expect(parse('#/compare/results')).toBe('results');
    expect(parse('#/compare/live/')).toBe('race');
    expect(parse('#/simulate')).toBe('simulate');
    expect(parse('#/nowhere')).toBe('home');
    expect(parse('')).toBe('home');
  });
});

describe('uint64 across the WASM boundary', () => {
  it('a fingerprint with the top bit set prints unsigned, like the engine JSON', () => {
    const signed = -0x71571fa5c1a03f01n;  // what an i64 export returns for 0x8ea8e05a3e5fc0ff
    expect(`0x${BigInt.asUintN(64, signed).toString(16)}`).toBe('0x8ea8e05a3e5fc0ff');
  });
});
