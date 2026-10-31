// Step 4b: the configurations of a comparison, playing live side by side on one trace. Every lane
// is an engine session in one worker; each tick steps all of them by the same number of accesses
// and redraws each sorting office from its own snapshot. The scoreboard is the engine's report so
// far for each lane. When every lane reaches the end (or Finish all), Results opens.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Office } from '../components/Replay';
import { Locked, useRaceDone } from '../components/TopBar';
import { summarize } from '../lib/comparison';
import { fmtCycles, fmtPercent, NA } from '../lib/format';
import { seriesColor } from '../lib/palette';
import { SPEEDS, type Speed } from '../lib/playback';
import { navigate } from '../router';
import { useApp, type Lane } from '../store/useApp';

const STATS_EVERY_MS = 600;

function Scoreboard({ lanes, colorOf }: { lanes: Lane[]; colorOf: (key: number) => string }) {
  const amats = lanes.map((l) => l.stats?.amat_cycles ?? null);
  const known = amats.filter((x): x is number => x !== null);
  const max = known.length ? Math.max(...known) : 0;
  const best = known.length ? Math.min(...known) : null;
  return (
    <section className="panel scoreboard" aria-labelledby="h-score">
      <div className="panel-head">
        <h2 id="h-score" className="panel-title">Scoreboard so far</h2>
        <span className="panel-sub">The engine's numbers for the accesses each run has made · lower AMAT is better</span>
      </div>
      <div className="table-wrap">
      <table className="score-table">
        <thead>
          <tr><th scope="col">Run</th><th scope="col">AMAT so far</th><th scope="col">L1 miss rate</th><th scope="col">L2 local miss rate</th><th scope="col">Memory traffic</th></tr>
        </thead>
        <tbody>
          {lanes.map((l, i) => {
            const a = amats[i] ?? null;
            const st = l.stats;
            const atBest = a !== null && best !== null && a === best && known.length > 1;
            const tied = known.filter((x) => x === best).length > 1;
            return (
              <tr key={l.key}>
                <th scope="row"><span className="swatch" style={{ background: colorOf(l.key) }} aria-hidden /> {l.label}
                  {atBest && <span className={`tag ${tied ? 'tie' : 'lead'}`}>{tied ? 'tied best' : 'leads'}</span>}</th>
                <td className="score-amat">
                  <span className="score-track" aria-hidden>
                    <span className="score-bar" style={{ width: a !== null && max > 0 ? `${(100 * a) / max}%` : '0%', background: colorOf(l.key) }} />
                  </span>
                  <span className="num">{fmtCycles(a)}</span>
                </td>
                <td className="num">{fmtPercent(st?.levels[0]?.miss_rate ?? null)}</td>
                <td className="num">{st && st.levels[1] ? fmtPercent(st.levels[1].local_miss_rate) : st ? 'no L2' : NA}</td>
                <td className="num">{st ? `${(st.memory.reads + st.memory.writes).toLocaleString('en-US')} lines` : NA}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </section>
  );
}

export function RacePage() {
  const s = useApp();
  const { race, entries, theme, compareBusy, compareError, compare } = s;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(SPEEDS[1]!);
  const [scrub, setScrub] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const lastStats = useRef(0);
  const done = useRaceDone();

  const total = race?.trace.accesses ?? 0;
  const position = race?.lanes[0]?.position ?? 0;
  const atEnd = done;

  /** One engine action at a time; the scoreboard refreshes after it, at most every 600 ms. */
  const act = async (f: () => Promise<unknown>, forceStats = false) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await f();
      const now = performance.now();
      if (forceStats || now - lastStats.current > STATS_EVERY_MS) {
        lastStats.current = now;
        await s.raceStats();
      }
    } catch (e) {
      setPlaying(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!playing || !race) return;
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
        n = speed.perFrame ?? 250_000;
      }
      void act(async () => {
        const go = speed.turbo ? await s.raceRun(n) : await s.raceStep(n);
        if (!go) {
          setPlaying(false);
          lastStats.current = 0;
        }
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, race]);

  // A finished race refreshes its scoreboard once more, so the final numbers are complete.
  useEffect(() => {
    if (done && race) void act(async () => {}, true);
  }, [done]);

  // Watch them side by side lands here playing.
  useEffect(() => {
    if (race && s.takeAutoplay('race')) setPlaying(true);
  }, [race?.client, race?.trace.fingerprint]);

  if (!race) {
    return <Locked what="The live comparison" hint="Set up two or more configurations and check the comparison is fair first." action="Set up a comparison" to="compare" />;
  }

  const colorOf = (key: number) => seriesColor(Math.max(0, entries.findIndex((e) => e.key === key)), theme);
  const pct = total ? (100 * (scrub ?? position)) / total : 0;
  const results = () => (compare ? navigate('results') : void s.finishRace());

  return (
    <div className="flow-page race">
      <header className="page-head">
        <div>
          <h1>Side by side, live</h1>
          <p className="lede mono-line">{race.trace.name} · {total.toLocaleString('en-US')} accesses · fingerprint {race.trace.fingerprint}</p>
          <p className="lede">
            Every run reads the same access at the same moment. Watch where their caches start to disagree.
          </p>
        </div>
        <div className="pulse" aria-live="polite">
          <span className="pulse-n">{position.toLocaleString('en-US')}</span>
          <span className="pulse-of">of {total.toLocaleString('en-US')} accesses</span>
        </div>
      </header>

      {done && (
        <div className="done-banner" role="status">
          <Icon name="check" />
          <span><strong>Every run reached the end.</strong> The engine can now compare them.</span>
          <button type="button" className="btn btn-primary" disabled={!!compareBusy} onClick={results}>
            {compareBusy ? 'Comparing…' : 'See the results'} <Icon name="arrow" size={16} />
          </button>
        </div>
      )}
      {compareError && <p className="msg error" role="alert"><Icon name="alert" size={14} /> {compareError}</p>}

      <section className="panel deck" aria-label="Playback for every run">
        <div className="deck-row">
          <div className="deck-buttons">
            <button type="button" className="icon-btn" onClick={() => void act(s.raceReset, true)} disabled={position === 0 || playing} aria-label="Reset every run to the start"><Icon name="reset" /></button>
            <button type="button" className="icon-btn" onClick={() => void act(() => s.raceGoTo(position - 1), true)} disabled={position === 0 || playing} aria-label="Previous access"><Icon name="back" /></button>
            <button type="button" className="icon-btn primary lg" onClick={() => setPlaying(!playing)} disabled={atEnd && !playing}
                    aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
            <button type="button" className="icon-btn" onClick={() => void act(() => s.raceStep(1), true)} disabled={atEnd || playing} aria-label="Next access"><Icon name="step" /></button>
          </div>
          <label className="inline-field">
            <span>Speed</span>
            <select value={speed.id} onChange={(e) => setSpeed(SPEEDS.find((x) => x.id === e.target.value) ?? SPEEDS[0]!)}>
              {SPEEDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn finish" onClick={() => { setPlaying(false); void act(() => s.raceRun(0xffffffff), true); }} disabled={atEnd}>
            <Icon name="end" size={16} /> Finish all
          </button>
        </div>
        <div className="strip" style={{ ['--pct' as string]: `${pct}%` }}>
          <input type="range" className="scrubber" min={0} max={total} value={scrub ?? position} aria-label="Seek every run to access"
                 onChange={(e) => setScrub(Number(e.target.value))}
                 onPointerUp={() => { if (scrub !== null) void act(() => s.raceGoTo(scrub), true).then(() => setScrub(null)); }}
                 onKeyUp={() => { if (scrub !== null) void act(() => s.raceGoTo(scrub), true).then(() => setScrub(null)); }} />
        </div>
        {error && <p className="msg error" role="alert">{error}</p>}
      </section>

      <Scoreboard lanes={race.lanes} colorOf={colorOf} />

      <div className={`race-grid lanes-${race.lanes.length}`}>
        {race.lanes.map((l) => (
          <section key={l.key} className="panel lane" aria-label={`${l.label}: live`}>
            <header className="lane-head">
              <span className="lane-chip" style={{ background: colorOf(l.key) }}>{l.label}</span>
              <span className="entry-summary">{summarize(l.config)}</span>
            </header>
            <Office config={l.config} grids={l.grids} event={l.current} total={total} size="sm" />
          </section>
        ))}
      </div>

      <ul className="legend" aria-label="Legend">
        <li><span className="lg-env" /> resident line</li>
        <li><span className="lg-env dirty" /> dirty line (airmail stripe)</li>
        <li><span className="lg-pm hit" /> HIT</li>
        <li><span className="lg-pm miss" /> MISS, line filed here</li>
        <li><span className="lg-pm evict" /> EVICT, line leaves</li>
        <li><span className="lg-pm fwd" /> FWD, write-back or write-through received</li>
      </ul>
    </div>
  );
}
