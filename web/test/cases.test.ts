// Every page draws a level the same way: L1 as the sorting case (cubbies and envelopes), L2 as
// the canvas grid, whatever their sizes. Rendered to static markup with the real component.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { caseLayout, caseWindow, MAX_COLS, ROW_GAP, ROW_H, SortingCase } from '../src/components/SortingCase';

const emptyGrid = (slots: number) => ({ states: new Uint8Array(slots), tags: new BigUint64Array(slots) });

function render(level: 'L1' | 'L2', sets: number, ways: number, size: 'lg' | 'md' | 'sm' = 'md') {
  return renderToStaticMarkup(createElement(SortingCase, {
    level, sets, ways, indexBits: Math.log2(sets), grid: emptyGrid(sets * ways), event: null, size,
  }));
}

describe('one interface per level, on every page', () => {
  it.each([
    [4, 2], [64, 8], [256, 1], [1024, 1], [16384, 2],
  ])('L1 with %i sets × %i ways is a sorting case', (sets, ways) => {
    const html = render('L1', sets, ways);
    expect(html).toContain('class="cubby');
    expect(html).not.toContain('<canvas');
  });

  it.each([
    [4, 2], [16, 8], [512, 8], [65536, 4],
  ])('L2 with %i sets × %i ways is the canvas grid', (sets, ways) => {
    const html = render('L2', sets, ways);
    expect(html).toContain('<canvas');
    expect(html).not.toContain('class="cubby');
  });

  it('a large L1 renders only the rows near the top, not every set', () => {
    const html = render('L1', 16384, 2, 'sm');
    const rows = html.match(/class="case-row/g)!.length;
    expect(rows).toBeLessThan(30);
    expect(html).toContain('set 0<');
    expect(html).not.toContain('set 16383<');
  });

  it('wide sets wrap onto lines of at most MAX_COLS cubbies; the set label is on the first line only', () => {
    const html = render('L1', 2, 20);
    expect(html.match(/class="cubby/g)!.length).toBe(40);
    expect(html.match(/set-label cont/g)!.length).toBe(2 * 2);  // 20 ways = 3 lines per set
    expect(html).toContain(`--cols:${MAX_COLS}`);
  });
});

describe('sorting-case windowing', () => {
  it('derives lines and pitch from sets, ways and size', () => {
    expect(caseLayout(64, 8, 'md')).toEqual({ cols: 8, linesPerSet: 1, lines: 64, pitch: ROW_H.md + ROW_GAP });
    expect(caseLayout(1, 512, 'sm')).toEqual({ cols: 8, linesPerSet: 64, lines: 64, pitch: ROW_H.sm + ROW_GAP });
    expect(caseLayout(1024, 1, 'lg').lines).toBe(1024);
  });

  it('renders the lines in view plus a few either side, clamped to the case', () => {
    const l = caseLayout(1024, 1, 'sm');  // pitch 58
    expect(caseWindow(l, 0, 360)).toEqual({ first: 0, last: 10 });
    const mid = caseWindow(l, 58 * 500, 360);
    expect(mid.first).toBe(496);
    expect(mid.last).toBe(510);
    expect(caseWindow(l, 58 * 1024, 360).last).toBe(1023);
  });
});
