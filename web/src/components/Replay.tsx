// The sorting office at work: the intake slot with the current envelope, the L1 and L2 cases,
// and the memory depot. `Office` draws one moment; `Replay` steps through an engine recording
// (Home and Learn) and needs no WebAssembly.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { geometry, type HierarchyConfigJS } from '../engine/config';
import type { AccessEvent } from '../engine/events';
import { fmtHex } from '../lib/format';
import type { Recording } from '../recordings';
import type { Grid } from '../store/useApp';
import { Icon } from './Icon';
import { Postmark } from './Postmark';
import { SortingCase } from './SortingCase';

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The envelope at the intake window: the access as the engine recorded it. */
export function Intake({ e, total }: { e: AccessEvent | null; total: number }) {
  if (!e) {
    return (
      <div className="intake empty">
        <div className="intake-slot" aria-hidden />
        <p className="intake-note">Waiting for the first access</p>
      </div>
    );
  }
  const l1 = e.l1.outcome;
  const l2 = e.l2.outcome;
  return (
    <div className="intake" aria-live="polite">
      <div key={e.seq} className={`intake-envelope ${e.op === 'W' ? 'store' : 'load'}`}>
        <span className="intake-op">{e.op === 'W' ? 'Store' : 'Load'}</span>
        <span className="intake-addr">{fmtHex(e.address)}</span>
        <span className="intake-meta">line {fmtHex(e.line)} · offset {e.offset}</span>
      </div>
      <div className="intake-facts">
        <span className="intake-count">Access {(e.seq + 1).toLocaleString('en-US')}{total ? ` of ${total.toLocaleString('en-US')}` : ''}</span>
        <span className="intake-route">
          <b className={`out out-${l1}`}>L1 {l1.replace(/_/g, ' ')}</b>
          {l2 !== 'none' && <b className={`out out-${l2}`}>L2 {l2.replace(/_/g, ' ')}</b>}
        </span>
        <span className="intake-latency"><b>{e.latency}</b> cycles</span>
      </div>
    </div>
  );
}

/** Line reads and writes the engine sent to memory up to and including access k. */
function depotCounts(events: AccessEvent[], k: number) {
  let reads = 0;
  let writes = 0;
  for (let i = 0; i < k; i++) {
    for (const a of events[i]!.actions) {
      if (a.kind === 'memory_read') reads++;
      else if (a.kind === 'memory_write') writes++;
    }
  }
  return { reads, writes };
}

interface OfficeProps {
  config: HierarchyConfigJS;
  grids: { l1: Grid | null; l2: Grid | null };
  event: AccessEvent | null;
  total: number;
  depot?: { reads: number; writes: number } | null;
  size?: 'lg' | 'md' | 'sm';
  intake?: boolean;
  children?: ReactNode;
}

export function Office({ config, grids, event, total, depot, size = 'md', intake = true, children }: OfficeProps) {
  const g1 = geometry(config.l1);
  const g2 = config.l2 ? geometry(config.l2) : null;
  const memTouched = event?.actions.filter((a) => a.level === 'memory') ?? [];
  return (
    <div className={`office office-${size}`}>
      {intake && <Intake e={event} total={total} />}
      <div className="office-cases">
        {g1 && grids.l1 && (
          <SortingCase level="L1" sets={g1.sets} ways={g1.ways} indexBits={g1.indexBits} grid={grids.l1} event={event}
                       policy={config.l1.policy} size={size} />
        )}
        {g2 && grids.l2 && config.l2 && (
          <SortingCase level="L2" sets={g2.sets} ways={g2.ways} indexBits={g2.indexBits} grid={grids.l2} event={event}
                       policy={config.l2.policy} size={size} />
        )}
      </div>
      <div className={`depot ${memTouched.length ? 'busy' : ''}`}>
        <span className="depot-name">Memory</span>
        <span className="depot-lat">{config.memoryLatency} cycles away</span>
        {depot && <span className="depot-count">{depot.reads} line reads · {depot.writes} writes</span>}
        <span className="depot-now" aria-live="polite">
          {memTouched.map((a, i) => (
            <span key={`${event?.seq}-${i}`} className={`depot-chip ${a.kind === 'memory_write' ? 'write' : 'read'}`}>
              {a.kind === 'memory_write' ? 'write' : 'read'} {fmtHex(a.line)}
            </span>
          ))}
        </span>
      </div>
      {children}
    </div>
  );
}

interface ReplayProps {
  rec: Recording;
  size?: 'lg' | 'md' | 'sm';
  autoplay?: boolean;
  intervalMs?: number;
  intake?: boolean;
  ticker?: boolean;
  label: string;
  /** Start at this many executed accesses (e.g. the end, to show a final state). */
  start?: number;
}

export function Replay({ rec, size = 'md', autoplay = false, intervalMs = 1500, intake = true, ticker = false, label, start = 0 }: ReplayProps) {
  const n = rec.events.length;
  // The first access, which a replay restarts from: an autoplaying replay opens on it rather than on
  // an empty "waiting" case, so it is moving from the first paint (and, under reduced motion, still
  // shows a real access).
  const first = Math.min(1, n);
  const [k, setK] = useState(autoplay && start === 0 ? first : start);
  const [playing, setPlaying] = useState(autoplay && !reducedMotion());
  const [hold, setHold] = useState(false);

  useEffect(() => {
    if (!playing || hold) return;
    // Nothing shown yet steps at once; the end lingers before the replay starts over at the first access.
    const delay = k === 0 ? 0 : k >= n ? intervalMs * 2.5 : intervalMs;
    const id = window.setTimeout(() => setK((x) => (x >= n ? first : x + 1)), delay);
    return () => window.clearTimeout(id);
  }, [playing, hold, k, n, first, intervalMs]);

  const event = k > 0 ? rec.events[k - 1]! : null;
  const depot = useMemo(() => depotCounts(rec.events, k), [rec, k]);
  const grids = rec.grids[k] ?? rec.grids[0]!;

  return (
    <section className={`replay replay-${size}`} aria-label={label}
             onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)}
             onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <Office config={rec.config} grids={grids} event={event} total={n} depot={depot} size={size} intake={intake} />
      <div className="replay-bar">
        <div className="replay-buttons">
          <button type="button" className="icon-btn" onClick={() => { setPlaying(false); setK(0); }} disabled={k === 0} aria-label="Back to the start"><Icon name="reset" /></button>
          <button type="button" className="icon-btn" onClick={() => { setPlaying(false); setK(Math.max(0, k - 1)); }} disabled={k === 0} aria-label="Previous access"><Icon name="back" /></button>
          <button type="button" className="icon-btn primary" onClick={() => { if (k >= n) setK(first); setPlaying(!playing); }}
                  aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button>
          <button type="button" className="icon-btn" onClick={() => { setPlaying(false); setK(Math.min(n, k + 1)); }} disabled={k >= n} aria-label="Next access"><Icon name="step" /></button>
        </div>
        <span className="replay-pos">{k} / {n}</span>
        {ticker && (
          <ol className="ticker" aria-label="Postmarks so far">
            {rec.events.slice(0, k).map((e) => (
              <li key={e.seq} title={`${e.op} ${fmtHex(e.address)}: L1 ${e.l1.outcome}, ${e.latency} cycles`}>
                <Postmark kind={e.l1.outcome === 'hit' ? 'hit' : e.l1.outcome === 'miss_no_allocate' ? 'around' : 'miss'} n={e.seq + 1} size={34} still />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
