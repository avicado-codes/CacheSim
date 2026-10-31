// A cache level drawn as a post-office sorting case: one row of pigeonholes per set, one cubby
// per way, one envelope per resident line. Contents come only from the engine's slot snapshot;
// the current event's actions decide which cubby gets a postmark, which envelope drops in and
// which one leaves. Caches too large for cubbies fall back to the canvas grid.

import { useEffect, useMemo, useRef } from 'react';
import { SLOT_DIRTY, SLOT_VALID } from '../engine/abi';
import type { AccessEvent } from '../engine/events';
import { fmtHex } from '../lib/format';
import { highlights } from '../lib/narrate';
import type { Grid } from '../store/useApp';
import { GridCanvas } from './GridCanvas';
import { Postmark, type StampKind } from './Postmark';

/** Above this many slots the case is drawn on canvas (an L2 can have tens of thousands). */
export const MAX_CUBBIES = 512;

interface Props {
  level: 'L1' | 'L2';
  sets: number;
  ways: number;
  indexBits: number;
  grid: Grid;
  event: AccessEvent | null;
  policy?: string;
  size?: 'lg' | 'md' | 'sm';
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

  // Keep the set being accessed in view inside a tall case, scrolling only the case, never the page.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = body.current;
    const row = activeSet !== null ? (box?.children[activeSet] as HTMLElement | undefined) : undefined;
    if (!box || !row || box.scrollHeight <= box.clientHeight) return;
    const top = row.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - (box.clientHeight - row.offsetHeight) / 2;
    }
  }, [activeSet, event]);
  const plate = (
    <figcaption className="case-plate">
      <span className="case-name">{level}</span>
      <span>{sets.toLocaleString('en-US')} {sets === 1 ? 'set' : 'sets'} × {ways} {ways === 1 ? 'way' : 'ways'}</span>
      {policy && <span className="case-policy">{policy.toUpperCase()}</span>}
    </figcaption>
  );

  if (sets * ways > MAX_CUBBIES) {
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

  return (
    <figure className={`case case-${size}`} style={{ ['--ways' as string]: ways }}>
      {plate}
      <div className="case-body" ref={body}>
        {Array.from({ length: sets }, (_, s) => (
          <div key={s} className={`case-row ${s === activeSet ? 'active' : ''}`}>
            <span className="set-label">set {s}</span>
            <div className="cubbies">
              {Array.from({ length: ways }, (_, w) => {
                const i = s * ways + w;
                const st = grid.states[i] ?? 0;
                const valid = (st & SLOT_VALID) !== 0;
                const dirty = (st & SLOT_DIRTY) !== 0;
                const tag = grid.tags[i] ?? 0n;
                const line = (tag << BigInt(indexBits)) | BigInt(s);
                const hl = marks.get(`${level}:${s}:${w}`);
                const gone = leaving.get(`${s}:${w}`);
                const stamp = stampFor(hl);
                const seq = event?.seq ?? -1;
                return (
                  <div key={w} className={`cubby ${hl ? `hl-${hl}` : ''}`}
                       aria-label={`${level} set ${s}, way ${w}: ${valid ? `line ${fmtHex(line)}, ${dirty ? 'dirty' : 'clean'}` : 'empty'}${stamp ? `, ${stamp}` : ''}`}>
                    <span className="way-label" aria-hidden>way {w}</span>
                    {gone && (
                      <div key={`g${seq}`} className={`envelope ghost ${gone.dirty ? 'dirty' : ''}`} aria-hidden>
                        <span className="env-line">{fmtHex(gone.line)}</span>
                      </div>
                    )}
                    {valid && (
                      <div key={`${tag}:${hl === 'fill' ? seq : 'r'}`} className={`envelope ${dirty ? 'dirty' : ''} ${hl === 'fill' ? 'drop' : ''}`} aria-hidden>
                        <span className="env-line">{fmtHex(line)}</span>
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
          </div>
        ))}
      </div>
    </figure>
  );
}
