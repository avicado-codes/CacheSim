// Set × way grid on <canvas> for caches too large for the sorting case (an L2 can have tens of
// thousands of cells). The contents come only from the engine's slot snapshot (session.grid);
// highlights mark the slots the current event's actions touched. Colours are read from the
// theme's CSS custom properties, and state is also given in words by the tooltip.
//
// Rows keep a readable height whatever the cache size: the scroll box holds a track as tall as
// every row, and a viewport-sized canvas sticks to the top of the box and draws only the rows
// in view. Very large caches fold several sets into one row so the track stays scrollable.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { SLOT_DIRTY, SLOT_VALID } from '../engine/abi';
import { fmtHex } from '../lib/format';
import type { Highlight } from '../lib/narrate';
import { useApp, type Grid } from '../store/useApp';

/** Tallest the track may get before sets are folded together (browsers cap element height). */
export const MAX_TRACK_HEIGHT = 1_000_000;

export const slotState = (b: number) => ((b & SLOT_VALID) === 0 ? 'invalid' : (b & SLOT_DIRTY) !== 0 ? 'dirty' : 'clean');
type SlotState = ReturnType<typeof slotState>;

export interface GridLayout {
  /** Height of one row in CSS pixels. */
  rowH: number;
  /** Sets drawn in one row (1 unless the cache is huge). */
  setsPerRow: number;
  rows: number;
  /** Height of the whole track. */
  height: number;
  /** Width of the set-label column. */
  labelW: number;
}

/** Row geometry of a cache with `sets` sets: pure, so it is tested without a canvas. */
export function gridLayout(sets: number): GridLayout {
  const rowH = sets <= 64 ? 28 : 22;
  const setsPerRow = Math.max(1, Math.ceil((sets * rowH) / MAX_TRACK_HEIGHT));
  const rows = Math.ceil(sets / setsPerRow);
  return { rowH, setsPerRow, rows, height: rows * rowH, labelW: setsPerRow > 1 ? 116 : 72 };
}

/** The rows at least partly inside a viewport of height `viewH` scrolled to `scrollTop`. */
export function visibleRows(layout: GridLayout, scrollTop: number, viewH: number): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / layout.rowH));
  const last = Math.min(layout.rows - 1, Math.floor((scrollTop + viewH - 1) / layout.rowH));
  return { first, last };
}

/** The scrollTop that centres `set` in the viewport, or null when its row is already fully visible. */
export function scrollToShow(layout: GridLayout, set: number, scrollTop: number, viewH: number): number | null {
  const y = Math.floor(set / layout.setsPerRow) * layout.rowH;
  if (y >= scrollTop && y + layout.rowH <= scrollTop + viewH) return null;
  return Math.max(0, Math.min(layout.height - viewH, Math.round(y - (viewH - layout.rowH) / 2)));
}

/** `text`, cut with an ellipsis to fit `maxW` pixels, so a clipped tag never passes for a whole one. */
function fitText(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let n = text.length - 1;
  while (n > 1 && g.measureText(`${text.slice(0, n)}…`).width > maxW) n--;
  return `${text.slice(0, n)}…`;
}

interface Props {
  level: 'L1' | 'L2';
  grid: Grid;
  sets: number;
  ways: number;
  highlights: Map<string, Highlight>;
  activeSet: number | null;
}

export function GridCanvas({ level, grid, sets, ways, highlights, activeSet }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useApp((s) => s.theme);
  const [width, setWidth] = useState(600);
  const [viewH, setViewH] = useState(480);
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState<string>('');

  const layout = useMemo(() => gridLayout(sets), [sets]);
  const { rowH, setsPerRow, rows, labelW } = layout;
  const canvasH = Math.min(layout.height, viewH);
  const cellW = Math.max(1, (width - labelW) / ways);

  // The scroll box's content width excludes its scrollbar, so the last way is never hidden.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const ro = new ResizeObserver(([e]) => {
      setWidth(Math.max(120, Math.floor(e!.contentRect.width)));
      setViewH(Math.max(rowH, Math.floor(e!.contentRect.height)));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [rowH]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const css = getComputedStyle(c);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const fill: Record<SlotState, string> = { invalid: v('--cell-empty'), clean: v('--cell-clean'), dirty: v('--cell-dirty') };
    const stroke: Record<Highlight, string> = { hit: v('--st-hit'), fill: v('--st-miss'), evict: v('--st-evict'), update: v('--st-fwd') };
    const cellInk = v('--cell-ink');
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(canvasH * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, canvasH);
    g.font = `11px ${v('--font-mono') || 'monospace'}`;
    g.textBaseline = 'middle';
    const activeRow = activeSet === null ? -1 : Math.floor(activeSet / setsPerRow);
    const { first, last } = visibleRows(layout, scrollTop, canvasH);

    for (let r = first; r <= last; r++) {
      const y = r * rowH - scrollTop;
      const s0 = r * setsPerRow;
      const s1 = Math.min(sets, s0 + setsPerRow) - 1;
      // The set being accessed is a full-width band, not a hairline.
      if (r === activeRow) {
        g.fillStyle = v('--red');
        g.globalAlpha = 0.35;
        g.fillRect(0, y, width, rowH);
        g.globalAlpha = 1;
      }
      g.fillStyle = r === activeRow ? v('--case-ink') : v('--case-ink-2');
      g.font = `${r === activeRow ? '700 ' : ''}11px ${v('--font-mono') || 'monospace'}`;
      g.fillText(setsPerRow > 1 ? `sets ${s0}–${s1}` : `set ${s0}`, 6, y + rowH / 2);
      g.font = `11px ${v('--font-mono') || 'monospace'}`;

      for (let w = 0; w < ways; w++) {
        // With several sets per row, show the "strongest" state among them.
        let state: SlotState = 'invalid';
        for (let s = s0; s <= s1; s++) {
          const st = slotState(grid.states[s * ways + w] ?? 0);
          if (st === 'dirty' || (st === 'clean' && state === 'invalid')) state = st;
        }
        const x = labelW + w * cellW;
        const cw = Math.max(1, cellW - 2);
        g.fillStyle = fill[state];
        g.fillRect(x + 1, y + 1, cw, rowH - 2);
        if (state === 'dirty' && cw >= 8) {
          // Dirty is marked by shape too, not by colour alone: a corner tab.
          g.fillStyle = cellInk;
          g.beginPath();
          g.moveTo(x + 1 + cw - 7, y + 1);
          g.lineTo(x + 1 + cw, y + 1);
          g.lineTo(x + 1 + cw, y + 8);
          g.closePath();
          g.fill();
        }
        if (setsPerRow === 1 && state !== 'invalid' && cw > 48) {
          g.fillStyle = cellInk;
          g.fillText(fitText(g, fmtHex(grid.tags[s0 * ways + w] ?? 0n), cw - 14), x + 6, y + rowH / 2);
        }
      }
      if (r === activeRow) {
        // Outlined as well as tinted: light empty cells would otherwise hide the band.
        g.strokeStyle = v('--red');
        g.lineWidth = 2;
        g.strokeRect(1, y + 1, width - 2, rowH - 2);
      }
    }
    // Highlights last, so they sit on top. Evictions are dashed.
    for (const [key, kind] of highlights) {
      const [lvl, s, w] = key.split(':');
      if (lvl !== level) continue;
      const r = Math.floor(Number(s) / setsPerRow);
      if (r < first || r > last) continue;
      g.strokeStyle = stroke[kind];
      g.lineWidth = 2;
      g.setLineDash(kind === 'evict' ? [4, 3] : []);
      g.strokeRect(labelW + Number(w) * cellW + 2, r * rowH - scrollTop + 2, Math.max(2, cellW - 4), rowH - 4);
    }
    g.setLineDash([]);
  }, [grid, sets, ways, highlights, activeSet, width, canvasH, scrollTop, layout, rowH, setsPerRow, cellW, labelW, level, theme]);

  // Keep the active set in view, centred, scrolling only the box, never the page.
  useEffect(() => {
    const box = scroller.current;
    if (activeSet === null || !box) return;
    const top = scrollToShow(layout, activeSet, box.scrollTop, box.clientHeight || viewH);
    if (top !== null) {
      box.scrollTop = top;
      setScrollTop(box.scrollTop);
    }
  }, [activeSet, layout, viewH]);

  const onMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const w = Math.floor((e.clientX - rect.left - labelW) / cellW);
    const r = Math.floor((e.clientY - rect.top + scrollTop) / rowH);
    if (w < 0 || w >= ways || r < 0 || r >= rows) return setHover('');
    const s = r * setsPerRow;
    const b = grid.states[s * ways + w] ?? 0;
    const st = slotState(b);
    setHover(`${level} set ${s}${setsPerRow > 1 ? `–${Math.min(sets, s + setsPerRow) - 1}` : ''}, way ${w}: ${
      st}${st === 'invalid' || setsPerRow > 1 ? '' : `, tag ${fmtHex(grid.tags[s * ways + w] ?? 0n)}`}`);
  };

  return (
    <div>
      <div ref={scroller} className="grid-scroll" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="grid-track" style={{ height: layout.height }}>
          <canvas ref={canvas} className="grid-canvas" style={{ width, height: canvasH }} onMouseMove={onMove}
                  onMouseLeave={() => setHover('')} title={hover} role="img"
                  aria-label={`${level}: ${sets} sets × ${ways} ways. The current set is listed in the table below.`} />
        </div>
      </div>
      <p className="grid-caption" aria-live="polite">
        {hover || (setsPerRow > 1 ? `Each row shows ${setsPerRow} sets (dirty wins, then clean).` : ' ')}
      </p>
    </div>
  );
}
