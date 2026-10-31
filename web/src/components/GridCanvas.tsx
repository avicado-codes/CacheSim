// Set × way grid on <canvas> for caches too large for the sorting case (an L2 can have tens of
// thousands of cells). The contents come only from the engine's slot snapshot (session.grid);
// highlights mark the slots the current event's actions touched. Colours are read from the
// theme's CSS custom properties, and state is also given in words by the tooltip.

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { SLOT_DIRTY, SLOT_VALID } from '../engine/abi';
import { fmtHex } from '../lib/format';
import type { Highlight } from '../lib/narrate';
import { useApp, type Grid } from '../store/useApp';

const MAX_HEIGHT = 2048;

export const slotState = (b: number) => ((b & SLOT_VALID) === 0 ? 'invalid' : (b & SLOT_DIRTY) !== 0 ? 'dirty' : 'clean');

interface Props {
  level: 'L1' | 'L2';
  grid: Grid;
  sets: number;
  ways: number;
  highlights: Map<string, Highlight>;
  activeSet: number | null;
}

export function GridCanvas({ level, grid, sets, ways, highlights, activeSet }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useApp((s) => s.theme);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<string>('');

  // Rows per set (zoomed in) or sets per pixel row (large caches).
  const rowH = sets <= 64 ? 28 : Math.max(1, Math.floor(MAX_HEIGHT / sets));
  const setsPerRow = sets * rowH > MAX_HEIGHT ? Math.ceil(sets / MAX_HEIGHT) : 1;
  const rows = Math.ceil(sets / setsPerRow);
  const height = rows * rowH;
  const labelW = sets <= 64 ? 56 : 0;
  const cellW = Math.max(1, (width - labelW) / ways);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, Math.floor(e!.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const css = getComputedStyle(c);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const fill = { invalid: v('--cell-empty'), clean: v('--cell-clean'), dirty: v('--cell-dirty') };
    const stroke: Record<Highlight, string> = { hit: v('--st-hit'), fill: v('--st-miss'), evict: v('--st-evict'), update: v('--st-fwd') };
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const big = rowH >= 20;
    g.font = `11px ${v('--font-mono') || 'monospace'}`;
    g.textBaseline = 'middle';

    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      if (big) {
        g.fillStyle = r === activeSet ? v('--red') : v('--ink-3');
        g.fillText(`set ${r}`, 4, y + rowH / 2);
      }
      for (let w = 0; w < ways; w++) {
        // With several sets per pixel row, show the "strongest" state among them.
        let state: 'invalid' | 'clean' | 'dirty' = 'invalid';
        for (let s = r * setsPerRow; s < Math.min(sets, (r + 1) * setsPerRow); s++) {
          const st = slotState(grid.states[s * ways + w] ?? 0);
          if (st === 'dirty' || (st === 'clean' && state === 'invalid')) state = st;
        }
        const x = labelW + w * cellW;
        g.fillStyle = fill[state];
        g.fillRect(x + (big ? 1 : 0), y + (big ? 1 : 0), cellW - (big ? 2 : 0), rowH - (big ? 2 : 0));
        if (big && state !== 'invalid' && cellW > 60) {
          g.fillStyle = v('--ink');
          g.fillText(`${state === 'dirty' ? 'D ' : ''}${fmtHex(grid.tags[r * ways + w] ?? 0n)}`, x + 6, y + rowH / 2);
        }
      }
    }
    // Highlights last, so they sit on top. Evictions are dashed.
    for (const [key, kind] of highlights) {
      const [lvl, s, w] = key.split(':');
      if (lvl !== level) continue;
      const r = Math.floor(Number(s) / setsPerRow);
      g.strokeStyle = stroke[kind];
      g.lineWidth = 2;
      g.setLineDash(kind === 'evict' ? [4, 3] : []);
      g.strokeRect(labelW + Number(w) * cellW + 1, r * rowH + 1, Math.max(2, cellW - 2), Math.max(2, rowH - 2));
    }
    if (activeSet !== null && !big) {
      g.setLineDash([]);
      g.strokeStyle = v('--red');
      g.lineWidth = 1;
      g.strokeRect(0.5, Math.floor(activeSet / setsPerRow) * rowH + 0.5, width - 1, Math.max(1, rowH - 1));
    }
  }, [grid, sets, ways, highlights, activeSet, width, height, rowH, rows, setsPerRow, cellW, labelW, level, theme]);

  // Keep the active set in view.
  useEffect(() => {
    if (activeSet === null || !wrap.current) return;
    const y = Math.floor(activeSet / setsPerRow) * rowH;
    const box = wrap.current;
    if (y < box.scrollTop || y > box.scrollTop + box.clientHeight - rowH) box.scrollTop = Math.max(0, y - box.clientHeight / 2);
  }, [activeSet, rowH, setsPerRow]);

  const onMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const w = Math.floor((e.clientX - rect.left - labelW) / cellW);
    const r = Math.floor((e.clientY - rect.top) / rowH);
    if (w < 0 || w >= ways || r < 0 || r >= rows) return setHover('');
    const s = r * setsPerRow;
    const b = grid.states[s * ways + w] ?? 0;
    const st = slotState(b);
    setHover(`${level} set ${s}${setsPerRow > 1 ? `–${Math.min(sets, s + setsPerRow) - 1}` : ''}, way ${w}: ${
      st}${st === 'invalid' || setsPerRow > 1 ? '' : `, tag ${fmtHex(grid.tags[s * ways + w] ?? 0n)}`}`);
  };

  return (
    <div>
      <div ref={wrap} className="grid-scroll">
        <canvas ref={canvas} style={{ width, height }} onMouseMove={onMove} onMouseLeave={() => setHover('')}
                title={hover} role="img"
                aria-label={`${level}: ${sets} sets × ${ways} ways. The current set is listed in the table below.`} />
      </div>
      <p className="grid-caption" aria-live="polite">
        {hover || (setsPerRow > 1 ? `Each pixel row shows ${setsPerRow} sets (dirty wins, then clean).` : ' ')}
      </p>
    </div>
  );
}
