// A cache level as the visualiser draws it, the same way on every page:
//   * L1 is a post-office sorting case: one row of pigeonholes per set, one cubby per way, one
//     envelope per resident line. The current event's actions decide which cubby gets a
//     postmark, which envelope drops in and which one leaves.
//   * L2 is the canvas grid (GridCanvas), whatever its size.
// Contents come only from the engine's slot snapshot.
//
// The sorting case renders only the rows in view (plus a few either side), so a large L1 costs
// the same as a small one. Rows have a fixed height per size so the scroll position of any set
// is known without measuring; wide sets wrap onto several lines of at most MAX_COLS cubbies.

import { useEffect, useMemo, useRef, useState } from 'react';
import { SLOT_DIRTY, SLOT_VALID } from '../engine/abi';
import type { AccessEvent } from '../engine/events';
import { fmtHex } from '../lib/format';
import { highlights } from '../lib/narrate';
import type { Grid } from '../store/useApp';
import { GridCanvas } from './GridCanvas';
import { Postmark, type StampKind } from './Postmark';

type Size = 'lg' | 'md' | 'sm';

/** Cubbies per line; a set with more ways continues on the next line. */
export const MAX_COLS = 8;
/** Height of one line of cubbies, per size (fits a dirty envelope with its tag). */
export const ROW_H: Record<Size, number> = { lg: 92, md: 80, sm: 52 };
/** Space between lines (the .case-body gap). */
export const ROW_GAP = 6;
const OVERSCAN = 4;
/** .case-body padding-top: room for a postmark on the first row (it pokes 10px above its cubby). */
export const BODY_PAD_TOP = 10;

export interface CaseLayout {
  cols: number;
  linesPerSet: number;
  lines: number;
  pitch: number;
}

/** Line geometry of a sorting case: pure, so it is tested without a DOM. */
export function caseLayout(sets: number, ways: number, size: Size): CaseLayout {
  const cols = Math.min(ways, MAX_COLS);
  const linesPerSet = Math.ceil(ways / cols);
  return { cols, linesPerSet, lines: sets * linesPerSet, pitch: ROW_H[size] + ROW_GAP };
}

/** Lines to render for a viewport of height `viewH` scrolled to `scrollTop`. */
export function caseWindow(l: CaseLayout, scrollTop: number, viewH: number): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / l.pitch) - OVERSCAN);
  const last = Math.min(l.lines - 1, Math.floor((scrollTop + viewH) / l.pitch) + OVERSCAN);
  return { first, last };
}

interface Props {
  level: 'L1' | 'L2';
  sets: number;
  ways: number;
  indexBits: number;
  grid: Grid;
  event: AccessEvent | null;
  policy?: string;
  size?: Size;
  /** Number on the postmarks; defaults to the event's access number. */
  stampNumber?: number;
}

export function SortingCase({ level, sets, ways, indexBits, grid, event, policy, size = 'md', stampNumber }: Props) {
  const marks = useMemo(() => highlights(event), [event]);
  const leaving = useMemo(() => {
    const out = new Map<string, { line: bigint; dirty: boolean }>();
    for (const a of event?.actions ?? []) {
      if (a.level !== level) continue;
      if (a.kind === 'evict' || a.kind === 'back_invalidate' || a.kind === 'move_out') {
        out.set(`${a.set}:${a.way}`, { line: a.line, dirty: a.dirty });
      }
    }
    return out;
  }, [event, level]);

  const view = event ? (level === 'L1' ? event.l1 : event.l2) : null;
  const activeSet = view && view.outcome !== 'none' ? view.set : null;
  const n = stampNumber ?? (event ? event.seq + 1 : undefined);

  const layout = useMemo(() => caseLayout(sets, ways, size), [sets, ways, size]);
  const body = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(560);

  useEffect(() => {
    const box = body.current;
    if (!box || level === 'L2') return;
    const ro = new ResizeObserver(() => setViewH(box.clientHeight));
    ro.observe(box);
    return () => ro.disconnect();
  }, [level]);

  // Keep the set being accessed in view inside a tall case, scrolling only the case, never the page.
  useEffect(() => {
    const box = body.current;
    if (!box || activeSet === null || level === 'L2') return;
    const top = BODY_PAD_TOP + activeSet * layout.linesPerSet * layout.pitch;
    const h = layout.linesPerSet * layout.pitch - ROW_GAP;
    if (top < box.scrollTop || top + h > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - (box.clientHeight - h) / 2);
      setScrollTop(box.scrollTop);
    }
  }, [activeSet, event, layout, level]);

  const plate = (
    <figcaption className="case-plate">
      <span className="case-name">{level}</span>
      <span>{sets.toLocaleString('en-US')} {sets === 1 ? 'set' : 'sets'} × {ways} {ways === 1 ? 'way' : 'ways'}</span>
      {policy && <span className="case-policy">{policy.toUpperCase()}</span>}
    </figcaption>
  );

  if (level === 'L2') {
    return (
      <figure className="case case-canvas">
        {plate}
        <GridCanvas level={level} grid={grid} sets={sets} ways={ways} highlights={marks} activeSet={activeSet} />
      </figure>
    );
  }

  const stampFor = (kind: string | undefined): StampKind | null => {
    if (kind === 'hit') return 'hit';
    if (kind === 'fill') return view?.outcome === 'miss' ? 'miss' : 'fill';
    if (kind === 'update') return 'writeback';
    if (kind === 'evict') return 'evict';
    return null;
  };

  const { first, last } = caseWindow(layout, Math.max(0, scrollTop - BODY_PAD_TOP), viewH);
  const seq = event?.seq ?? -1;
  const rows = [];
  for (let line = first; line <= last; line++) {
    const s = Math.floor(line / layout.linesPerSet);
    const part = line % layout.linesPerSet;
    const w0 = part * layout.cols;
    const w1 = Math.min(ways, w0 + layout.cols);
    rows.push(
      <div key={line} className={`case-row ${s === activeSet ? 'active' : ''} ${part > 0 ? 'cont' : ''}`}>
        {part === 0 ? <span className="set-label">set {s}</span> : <span className="set-label cont" aria-hidden />}
        <div className="cubbies">
          {Array.from({ length: w1 - w0 }, (_, k) => {
            const w = w0 + k;
            const i = s * ways + w;
            const st = grid.states[i] ?? 0;
            const valid = (st & SLOT_VALID) !== 0;
            const dirty = (st & SLOT_DIRTY) !== 0;
            const tag = grid.tags[i] ?? 0n;
            const lineNo = (tag << BigInt(indexBits)) | BigInt(s);
            const hl = marks.get(`${level}:${s}:${w}`);
            const gone = leaving.get(`${s}:${w}`);
            const stamp = stampFor(hl);
            return (
              <div key={w} className={`cubby ${hl ? `hl-${hl}` : ''}`}
                   aria-label={`${level} set ${s}, way ${w}: ${valid ? `line ${fmtHex(lineNo)}, ${dirty ? 'dirty' : 'clean'}` : 'empty'}${stamp ? `, ${stamp}` : ''}`}>
                <span className="way-label" aria-hidden>way {w}</span>
                {gone && (
                  <div key={`g${seq}`} className={`envelope ghost ${gone.dirty ? 'dirty' : ''}`} aria-hidden>
                    <span className="env-line">{fmtHex(gone.line)}</span>
                  </div>
                )}
                {valid && (
                  <div key={`${tag}:${hl === 'fill' ? seq : 'r'}`} className={`envelope ${dirty ? 'dirty' : ''} ${hl === 'fill' ? 'drop' : ''}`} aria-hidden>
                    <span className="env-line">{fmtHex(lineNo)}</span>
                    <span className="env-tag">tag {fmtHex(tag)}</span>
                    {dirty && <span className="env-dirty">dirty</span>}
                  </div>
                )}
                {stamp && (
                  <span key={`p${seq}`} className="cubby-stamp" aria-hidden>
                    <Postmark kind={stamp} n={n} size={size === 'lg' ? 52 : size === 'sm' ? 34 : 44} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>,
    );
  }

  return (
    <figure className={`case case-${size}`}
            style={{ ['--cols' as string]: layout.cols, ['--row-h' as string]: `${ROW_H[size]}px` }}>
      {plate}
      <div className="case-body" ref={body} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {/* The rows not rendered are padding on this inner track, never on the scroll box itself:
            with border-box sizing, padding on the box would count against its max-height. */}
        <div className="case-track" style={{ paddingTop: first * layout.pitch, paddingBottom: (layout.lines - 1 - last) * layout.pitch }}>
          {rows}
        </div>
      </div>
    </figure>
  );
}
