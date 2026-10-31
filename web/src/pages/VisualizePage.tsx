// Step 2: the live simulation. Every move asks the engine to step, run
// or seek, then redraws the sorting office from the engine's snapshot. The page decides no hit,
// picks no victim and decodes no address beyond the bit widths of the configured geometry.

import { useEffect, useRef, useState } from 'react';
import walkthroughJson from '../../test/fixtures/demo_b.json';
import { Icon } from '../components/Icon';
import { Office } from '../components/Replay';
import { slotState } from '../components/GridCanvas';
import { Locked } from '../components/TopBar';
import type { BreakOn } from '../engine/abi';
import { DEMO_CONFIGS, geometry, sameConfig } from '../engine/config';
import { fmtHex } from '../lib/format';
import { narrate } from '../lib/narrate';
import { SPEEDS, type Speed } from '../lib/playback';
import { href, navigate } from '../router';
import { useApp, type Grid } from '../store/useApp';

const BREAKS: { id: BreakOn; label: string }[] = [
  { id: 'l1Miss', label: 'L1 miss' },
  { id: 'l2Miss', label: 'L2 miss' },
  { id: 'memoryAccess', label: 'Memory access' },
  { id: 'eviction', label: 'Eviction' },
  { id: 'writeback', label: 'Dirty write-back' },
  { id: 'backInvalidation', label: 'Back-invalidation' },
];

// What to notice in the two-level write-back walkthrough (worked out by hand), keyed by access
// number. Shown only when the uploaded trace is that walkthrough and the cache is the one it was
// written for.
const WALKTHROUGH_FINGERPRINT = (walkthroughJson as { report: { trace: { fingerprint: string } } }).report.trace.fingerprint;
const WALKTHROUGH_NOTES: Record<number, string> = {
  4: "The dirty L1 victim (line 0x0) is written into L2 before the demand fetch, and that write-back refreshes line 0x0's LRU position, so L2 evicts line 0x4 instead.",
  5: 'Line 0x4 left L2 at access 4 but stayed in L1 until now: the hierarchy is non-inclusive. An L1 miss that hits in L2 costs 1 + 10 = 11 cycles.',
  6: 'A write miss allocates the line in L1 and marks it dirty there.',
  7: "L2 evicts the dirty line 0x0, causing the only memory write. L1's own copy of line 0x0 had been re-fetched clean at access 5.",
};

function SetTable({ level, grid, set, ways }: { level: string; grid: Grid; set: number; ways: number }) {
  return (
    <table className="data-table compact">
      <caption>{level} set {set}</caption>
      <thead><tr><th scope="col">Way</th><th scope="col">State</th><th scope="col">Tag</th></tr></thead>
      <tbody>
        {Array.from({ length: ways }, (_, w) => {
          const st = slotState(grid.states[set * ways + w] ?? 0);
          return (
            <tr key={w}>
              <th scope="row">{w}</th>
              <td>{st === 'invalid' ? 'empty' : st}</td>
              <td className="num">{st === 'invalid' ? '—' : fmtHex(grid.tags[set * ways + w] ?? 0n)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function VisualizePage() {
  const s = useApp();
  const { run, position, current, recent, grids, stopNote, reachedEnd } = s;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(SPEEDS[1]!);
  const [breakOn, setBreakOn] = useState<BreakOn[]>([]);
  const [scrub, setScrub] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const total = run?.trace.accesses ?? 0;
  const atEnd = position >= total;

  /** Runs one engine call at a time; errors stop playback and are shown inline. */
  const act = async (f: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await f();
    } catch (e) {
      setPlaying(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!playing || !run) return;
    let raf = 0;
    let last = performance.now();
    let due = 0;
    const frame = (now: number) => {
      due += now - last;
      last = now;
      raf = requestAnimationFrame(frame);
      if (busy.current) return;
      let n = 0;
      if (speed.perSecond) {
        if (due < 1000 / speed.perSecond) return;
        due = 0;
        n = 1;
      } else {
        due = 0;
        n = speed.perFrame ?? 1_000_000;
      }
      void act(async () => {
        const go = speed.turbo || breakOn.length > 0 ? await s.runUntil(n, breakOn) : await s.step(n, true);
        if (!go) setPlaying(false);
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, breakOn, run]);

  // Run simulation lands here playing; coming back to the page later does not restart playback.
  useEffect(() => {
    if (run && s.takeAutoplay('visualize')) setPlaying(true);
  }, [run]);

  if (!run) {
    return <Locked what="The visualizer" hint="Configure a cache and choose a trace, then press Run simulation." action="Configure a run" to="simulate" />;
  }

  const g2 = run.config.l2 ? geometry(run.config.l2) : null;
  const isWalkthrough = run.trace.fingerprint === WALKTHROUGH_FINGERPRINT && sameConfig(run.config, DEMO_CONFIGS.demo_b);
  const note = current && isWalkthrough ? WALKTHROUGH_NOTES[current.seq + 1] : undefined;
  const story = current ? narrate(current, run.config) : null;
  // L2 is drawn on canvas, so the set being accessed is also listed as a table (L1's cubbies are
  // ordinary elements and already say what they hold).
  const bigCases = [
    { name: 'L2', g: g2, grid: grids.l2, set: current && current.l2.outcome !== 'none' ? current.l2.set : null },
  ].filter((x) => x.g && x.grid && x.set !== null);
  const pct = total ? (100 * (scrub ?? position)) / total : 0;

  return (
    <div className="flow-page visualize">
      <header className="page-head">
        <div>
          <h1>Cache visualizer</h1>
          <p className="lede mono-line">{run.trace.name} · {total.toLocaleString('en-US')} accesses · fingerprint {run.trace.fingerprint}</p>
        </div>
        <div className="pulse" aria-live="polite">
          <span className="pulse-n">{position.toLocaleString('en-US')}</span>
          <span className="pulse-of">of {total.toLocaleString('en-US')} accesses</span>
        </div>
      </header>

      {reachedEnd && (
        <div className="done-banner" role="status">
          <Icon name="check" />
          <span><strong>Run complete.</strong> Every access has been sorted; the analytics are open.</span>
          <button type="button" className="btn btn-primary" onClick={() => navigate('analytics')}>Open analytics <Icon name="arrow" size={16} /></button>
        </div>
      )}

      <section className="panel deck" aria-label="Playback">
        <div className="deck-row">
          <div className="deck-buttons">
            <button type="button" className="icon-btn" onClick={() => void act(s.reset)} disabled={position === 0 || playing} aria-label="Reset to the start"><Icon name="reset" /></button>
            <button type="button" className="icon-btn" onClick={() => void act(() => s.goTo(position - 1))} disabled={position === 0 || playing} aria-label="Previous access"><Icon name="back" /></button>
            <button type="button" className="icon-btn primary lg" onClick={() => setPlaying(!playing)} disabled={atEnd && !playing}
                    aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
            <button type="button" className="icon-btn" onClick={() => void act(() => s.step(1, true))} disabled={atEnd || playing} aria-label="Next access"><Icon name="step" /></button>
          </div>
          <label className="inline-field">
            <span>Speed</span>
            <select value={speed.id} onChange={(e) => setSpeed(SPEEDS.find((x) => x.id === e.target.value) ?? SPEEDS[0]!)}>
              {SPEEDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn finish" onClick={() => { setPlaying(false); void act(() => s.runUntil(0xffffffff, [])); }} disabled={atEnd}>
            <Icon name="end" size={16} /> Finish run
          </button>
        </div>
        <div className="strip" style={{ ['--pct' as string]: `${pct}%` }}>
          <input type="range" className="scrubber" min={0} max={total} value={scrub ?? position} aria-label="Seek to access"
                 onChange={(e) => setScrub(Number(e.target.value))}
                 onPointerUp={() => { if (scrub !== null) void act(() => s.goTo(scrub)).then(() => setScrub(null)); }}
                 onKeyUp={() => { if (scrub !== null) void act(() => s.goTo(scrub)).then(() => setScrub(null)); }} />
        </div>
        <fieldset className="breaks">
          <legend>Pause on</legend>
          {BREAKS.map((b) => (
            <label key={b.id} className="check-chip">
              <input type="checkbox" checked={breakOn.includes(b.id)}
                     onChange={(e) => setBreakOn(e.target.checked ? [...breakOn, b.id] : breakOn.filter((x) => x !== b.id))} />
              <span>{b.label}</span>
            </label>
          ))}
        </fieldset>
        {(stopNote || error) && <p className={error ? 'msg error' : 'msg note'} role="status">{error ?? stopNote}</p>}
      </section>

      <div className="visualize-grid">
        <section className="panel office-panel" aria-label="The sorting office">
          <Office config={run.config} grids={grids} event={current} total={total} size="md" />
          {bigCases.map((c) => (
            <SetTable key={c.name} level={c.name} grid={c.grid!} set={c.set!} ways={c.g!.ways} />
          ))}
          <ul className="legend" aria-label="Legend">
            <li><span className="lg-env" /> resident line</li>
            <li><span className="lg-env dirty" /> dirty line (airmail stripe)</li>
            <li><span className="lg-pm hit" /> HIT</li>
            <li><span className="lg-pm miss" /> MISS, line filed here</li>
            <li><span className="lg-pm evict" /> EVICT, line leaves</li>
            <li><span className="lg-pm fwd" /> FWD, write-back or write-through received</li>
          </ul>
        </section>

        <div className="side-stack">
          <section className="panel" aria-labelledby="h-why">
            <h2 id="h-why" className="panel-title">What the engine did</h2>
            <div aria-live="polite">
              {story ? (
                <>
                  <p className="story-head">{story.headline}</p>
                  <ol className="story-steps">{story.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
                  {note && <p className="notice"><strong>Notice:</strong> {note}</p>}
                </>
              ) : (
                <p className="muted">{position === 0 ? 'The caches are empty. Press play or step to sort the first access.' : 'Turbo and Finish run record no per-access detail. Step or seek to inspect one access.'}</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="h-log">
            <div className="panel-head">
              <h2 id="h-log" className="panel-title">Sorted so far</h2>
              <span className="panel-sub">last {recent.length} recorded · click to revisit</span>
            </div>
            <div className="table-wrap tall">
              <table className="data-table compact clickable">
                <thead><tr><th scope="col">#</th><th scope="col">Op</th><th scope="col">Address</th><th scope="col">L1</th><th scope="col">L2</th><th scope="col">Cycles</th></tr></thead>
                <tbody>
                  {[...recent].reverse().map((e) => (
                    <tr key={e.seq} className={current?.seq === e.seq ? 'active' : ''} tabIndex={0}
                        onClick={() => void act(() => s.goTo(e.seq + 1))}
                        onKeyDown={(k) => { if (k.key === 'Enter') void act(() => s.goTo(e.seq + 1)); }}>
                      <th scope="row">{e.seq + 1}</th><td>{e.op}</td><td className="num">{fmtHex(e.address)}</td>
                      <td><span className={`out out-${e.l1.outcome}`}>{e.l1.outcome.replace(/_/g, ' ')}</span></td>
                      <td>{e.l2.outcome === 'none' ? '—' : <span className={`out out-${e.l2.outcome}`}>{e.l2.outcome}</span>}</td>
                      <td className="num">{e.latency}</td>
                    </tr>
                  ))}
                  {recent.length === 0 && <tr><td colSpan={6} className="muted">Nothing sorted yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          {!reachedEnd && (
            <p className="hint-line">Analytics open when the run reaches access {total.toLocaleString('en-US')}. <a href={href('learn')}>What am I looking at?</a></p>
          )}
        </div>
      </div>
    </div>
  );
}
