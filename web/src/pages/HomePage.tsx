// Home: what ccsim is, who it is for and how to run a simulation, shown with the engine's own
// recordings of hand-checked example traces. Nothing here is simulated in the page.

import demoAJson from '../../test/fixtures/demo_a_direct.json';
import demoBJson from '../../test/fixtures/demo_b.json';
import demoCCompare from '../../test/fixtures/demo_c.compare.json';
import { AddressSplit } from '../components/ConfigForm';
import { Icon } from '../components/Icon';
import { Postmark } from '../components/Postmark';
import { Replay } from '../components/Replay';
import logoUrl from '../assets/logo-96.png';
import { DEFAULT_CONFIG, geometry } from '../engine/config';
import type { ComparisonDoc } from '../engine/report';
import { kpis } from '../lib/analytics';
import { fmtPercent } from '../lib/format';
import { toRecording, type RecordingJson } from '../recordings';
import { href, navigate } from '../router';

const demoB = toRecording(demoBJson as unknown as RecordingJson);
const demoA = toRecording(demoAJson as unknown as RecordingJson);
const belady = demoCCompare as unknown as ComparisonDoc;

const TRACE_LINES = ['# two-level write-back walkthrough', 'R 0x000', 'W 0x008', 'R 0x040', 'R 0x080', 'R 0x000', 'W 0x0C0', 'R 0x100'];

function Stop({ n, title, children, visual }: { n: number; title: string; children: React.ReactNode; visual: React.ReactNode }) {
  return (
    <li className="stop-row">
      <div className="stop-text">
        <span className="stop-badge" aria-hidden>{n}</span>
        <h3>{title}</h3>
        {children}
      </div>
      <div className="stop-visual">{visual}</div>
    </li>
  );
}

function BeladyBars() {
  const rate = belady.metrics.find((m) => m.key === 'l1.miss_rate');
  const values = rate?.values ?? [];
  return (
    <figure className="mini-compare">
      {belady.runs.map((r, i) => (
        <div key={r.label} className="mc-row">
          <span className="mc-label">{r.label}</span>
          <span className={`mc-bar mc-${i}`} style={{ width: `${100 * (values[i] ?? 0)}%` }} />
          <span className="mc-value">{fmtPercent(values[i])} missed</span>
        </div>
      ))}
      <figcaption>FIFO replacement, fully associative: one more line of cache, and 10 of 12 accesses miss instead of 9. Belady's anomaly, from the engine's own comparison.</figcaption>
    </figure>
  );
}

function MiniAnalytics() {
  const r = demoB.report;
  const k = kpis(r).filter((x) => ['AMAT', 'L1 miss rate', 'L2 local miss rate'].includes(x.label));
  const lb = r.latency_breakdown;
  const parts = [
    { name: 'L1', v: lb.l1_cycles, c: 'lb-l1' },
    { name: 'L2', v: lb.l2_cycles, c: 'lb-l2' },
    { name: 'Memory', v: lb.memory_cycles, c: 'lb-mem' },
  ];
  return (
    <figure className="mini-analytics">
      <div className="mini-kpis">
        {k.map((x) => (
          <div key={x.label}><span className="mk-value">{x.value}</span><span className="mk-label">{x.label}</span></div>
        ))}
      </div>
      <div className="lat-bar" role="img" aria-label={`Total ${r.total_latency_cycles} cycles: ${parts.map((p) => `${p.name} ${p.v}`).join(', ')}`}>
        {parts.map((p) => <span key={p.name} className={p.c} style={{ flex: p.v }}><b>{p.name}</b> {p.v}</span>)}
      </div>
      <figcaption>The two-level walkthrough: {r.total_latency_cycles} cycles over {r.trace.accesses} accesses. Exported as PDF, CSV or JSON.</figcaption>
    </figure>
  );
}

export function HomePage() {
  const start = () => navigate('simulate');

  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">Every address has a pigeonhole.</h1>
          <p className="hero-lede">
            ccsim sorts a program's memory accesses through L1, L2 and main memory exactly the way a CPU cache does,
            and shows you every hit, eviction and write-back as it happens.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={start}>Start a simulation <Icon name="arrow" /></button>
            <a className="btn btn-lg" href={href('learn')}>How caches work</a>
          </div>
          <p className="hero-note">
            The sorting case here replays a two-level write-back walkthrough: ten accesses through a 2-way L1 and a
            2-way L2, from the engine's own recording. Hover over it to hold it still.
          </p>
        </div>
        <div className="hero-office">
          <Replay rec={demoB} size="lg" autoplay intervalMs={1700} ticker label="Two-level write-back walkthrough, replayed from the engine's recording" />
        </div>
      </section>

      <section className="band what" aria-labelledby="what-title">
        <h2 id="what-title">A cache simulator you can watch</h2>
        <p className="band-lede">
          Pick a cache, hand it a trace of loads and stores, and ccsim plays the trace through it one access at a time.
          The C++ engine behind it is the same deterministic simulator the test suites check against hand-worked
          examples, compiled to WebAssembly and running in your browser.
        </p>
        <ul className="facts">
          <li><Postmark kind="hit" size={46} still /><span><b>Every step shown.</b> Lookups, evictions, fills and write-backs, in the order the engine did them.</span></li>
          <li><Postmark kind="fill" size={46} still /><span><b>Real decisions.</b> L1 and L2 size, ways, LRU, FIFO or Random, write-back or write-through, inclusive or exclusive.</span></li>
          <li><Postmark kind="writeback" size={46} still /><span><b>Numbers you can defend.</b> AMAT, miss rates, the 3Cs and miss-ratio curves, exported as PDF, CSV or JSON.</span></li>
        </ul>
      </section>

      <section className="howto" aria-labelledby="howto-title">
        <h2 id="howto-title">How to run a simulation</h2>
        <p className="band-lede">Five steps. The top bar walks you through them, and each step opens once the one before it is done.</p>
        <ol className="route">
          <Stop n={1} title="Describe the cache" visual={
            <figure className="mini-config">
              <dl>
                <div><dt>L1</dt><dd>32 KiB · 64 B lines · 8 ways · LRU</dd></div>
                <div><dt>L2</dt><dd>256 KiB · 64 B lines · 8 ways · LRU</dd></div>
                <div><dt>Memory</dt><dd>200 cycles</dd></div>
              </dl>
              <AddressSplit geo={geometry(DEFAULT_CONFIG.l1)} />
            </figure>
          }>
            <p>Open <a href={href('simulate')}>Configure</a> and set the capacity, line size, ways, latency and policies of L1 and,
              if you want one, L2. Start from a preset if you like. The page shows the number of sets and how an address
              splits into tag, set and offset as you type, and refuses shapes a real cache could not have.</p>
          </Stop>
          <Stop n={2} title="Hand it a trace" visual={
            <figure className="trace-slip" aria-label="A trace file">
              {TRACE_LINES.map((l, i) => <code key={i} style={{ ['--i' as string]: i }} className={l.startsWith('#') ? 'cm' : ''}>{l}</code>)}
            </figure>
          }>
            <p>Upload your program's trace as a <code>.trace</code> or <code>.trace.gz</code> file: one access per line,
              <code>R</code> or <code>W</code> and a hex address. The engine reads it the moment you drop it and rejects a
              file with a malformed line, naming the line. A format example and sample traces sit right under the upload
              area to download. The file never leaves your browser tab.</p>
          </Stop>
          <Stop n={3} title="Watch it sort" visual={<Replay rec={demoA} size="sm" autoplay intervalMs={1300} intake={false} label="Conflict misses in a direct-mapped cache, replayed" />}>
            <p>Press <b>Run simulation</b> and the visualizer opens. Play, pause, step, seek, or pause on an event such as an
              L2 miss. Each envelope is a cache line in its set and way; postmarks say what just happened, and a plain-English
              account lists every action. Here, a direct-mapped cache: two lines fighting over one pigeonhole.</p>
          </Stop>
          <Stop n={4} title="Read the analytics" visual={<MiniAnalytics />}>
            <p>When the run reaches its last access (or you press <b>Finish run</b>), the <b>Analytics</b> button at the top right
              opens: AMAT and where the cycles went, miss rates per level, the 3C split, reuse distance, the miss-ratio curve and
              per-set balance. Export them as PDF, CSV or JSON.</p>
          </Stop>
          <Stop n={5} title="Compare and decide" visual={<BeladyBars />}>
            <p>From the analytics, <b>Compare</b> opens. Line up two to eight caches on the same trace and let ccsim check
              that the comparison is fair. Up to four then play live side by side, access for access, before the engine
              lays out the deltas against your baseline. That is where a bigger cache, more ways or a different policy
              proves it is worth it, or not.</p>
          </Stop>
        </ol>
        <div className="howto-cta">
          <button type="button" className="btn btn-primary btn-lg" onClick={start}>Open the simulator <Icon name="arrow" /></button>
        </div>
      </section>

      <section className="band who" aria-labelledby="who-title">
        <h2 id="who-title">Who it is for</h2>
        <ul className="labels">
          <li className="label">
            <span className="label-to">To</span>
            <h3>Students</h3>
            <p>Step through an access, predict the outcome, then check it against the engine. The Learn page explains every term the visualizer uses.</p>
          </li>
          <li className="label">
            <span className="label-to">To</span>
            <h3>Instructors</h3>
            <p>Project the two-level walkthrough one access at a time, pause on the dirty write-back, then race a direct-mapped and a 2-way cache side by side.</p>
          </li>
          <li className="label">
            <span className="label-to">To</span>
            <h3>Engineers</h3>
            <p>Run your own program's trace, sweep sizes, ways and policies, watch the candidates side by side, and take the numbers that justify a design into a report.</p>
          </li>
        </ul>
      </section>

      <section className="band private" aria-labelledby="private-title">
        <div className="private-text">
          <h2 id="private-title">Your trace never leaves your desk</h2>
          <p>There is no server doing the work. The simulator is C++ compiled to WebAssembly and runs in a background
            worker in this tab, so a trace from your own program is read, simulated and forgotten on your machine.</p>
          <p>Runs are deterministic: the same trace and configuration give the same numbers every time, on every browser,
            the Random policy included. A rate the engine cannot compute is shown as n/a, never as 0.</p>
        </div>
        <figure className="private-diagram" aria-label="Your browser tab holds the page, a worker and the engine; nothing is sent to a server">
          <div className="pd-tab">
            <span className="pd-title">Your browser tab</span>
            <div className="pd-row">
              <span className="pd-box">Page</span>
              <span className="pd-arrow" aria-hidden />
              <span className="pd-box">Worker</span>
              <span className="pd-arrow" aria-hidden />
              <span className="pd-box strong">ccsim.wasm</span>
            </div>
            <span className="pd-file">trace.gz</span>
          </div>
          <div className="pd-server">
            <span className="pd-box muted">Server</span>
            <span className="pd-none">not used</span>
          </div>
        </figure>
      </section>

      <section className="close" aria-labelledby="close-title">
        <h2 id="close-title">Ready to sort your own trace?</h2>
        <div className="hero-actions">
          <button type="button" className="btn btn-on-red btn-lg" onClick={start}>Start a simulation <Icon name="arrow" /></button>
          <a className="btn btn-on-red ghost btn-lg" href={href('learn')}>Learn how caches work</a>
        </div>
      </section>

      <footer className="site-foot">
        <span className="foot-brand"><img src={logoUrl} width={32} height={32} alt="" /> ccsim · a deterministic CPU cache simulator · C++17 engine compiled to WebAssembly</span>
        <span>The examples on this page are the engine's recordings of small hand-checked traces.</span>
      </footer>
    </div>
  );
}
