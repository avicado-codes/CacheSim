// Learn: how CPU caches work, in the terms the simulator uses. Every worked example is the
// engine's own recording of a small hand-checked trace; tables worked out by hand say so.
// Nothing here is simulated in the page.

import { useEffect, useState, type ReactNode } from 'react';
import { AddressSplit } from '../components/ConfigForm';
import { Icon } from '../components/Icon';
import { Replay } from '../components/Replay';
import { DEFAULT_CONFIG, geometry, type HierarchyConfigJS } from '../engine/config';
import { downloadExample, exampleById, type Example } from '../examples';
import { fmtCycles, fmtHex, fmtInt, fmtPercent } from '../lib/format';
import { narrate } from '../lib/narrate';
import { loadRecording, type Recording, type RecordingName } from '../recordings';
import { navigate } from '../router';
import { useApp } from '../store/useApp';

const NAMES: RecordingName[] = [
  'demo_a_direct', 'demo_a_2way', 'demo_b', 'demo_b_write_through', 'demo_b_no_write_allocate',
  'demo_b_inclusive', 'demo_b_exclusive', 'demo_c_fifo3', 'demo_c_fifo4',
];

function useRecordings(): Partial<Record<RecordingName, Recording>> {
  const [recs, setRecs] = useState<Partial<Record<RecordingName, Recording>>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(NAMES.map(async (n) => [n, await loadRecording(n)] as const)).then((all) => {
      if (live) setRecs(Object.fromEntries(all));
    });
    return () => { live = false; };
  }, []);
  return recs;
}

const SECTIONS = [
  { id: 'why', title: 'Why caches exist' },
  { id: 'address', title: 'Lines, sets, ways and tags' },
  { id: 'placement', title: 'Where a line may live' },
  { id: 'replacement', title: 'Who gets evicted' },
  { id: 'writes', title: 'What happens on a write' },
  { id: 'levels', title: 'Two levels and inclusion' },
  { id: 'amat', title: 'Measuring a cache: AMAT and miss rates' },
  { id: 'threec', title: 'Why misses happen: the three Cs' },
  { id: 'reuse', title: 'Reuse distance and the miss-ratio curve' },
  { id: 'traces', title: 'Traces' },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="learn-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

/** Opens the simulator with this example's cache, and offers its trace to download and upload. */
function TryIt({ example, config }: { example: Example['id']; config?: HierarchyConfigJS }) {
  const setConfig = useApp((s) => s.setConfig);
  const x = exampleById(example);
  return (
    <div className="try">
      <button type="button" className="btn" onClick={() => { setConfig(config ?? x.config ?? DEFAULT_CONFIG); navigate('simulate'); }}>
        Open this cache in the simulator <Icon name="arrow" size={16} />
      </button>
      <button type="button" className="btn ghost" onClick={() => downloadExample(x)}>
        <Icon name="download" size={16} /> Download its trace
      </button>
    </div>
  );
}

const Wait = () => <p className="muted fig-wait">Loading the engine recording…</p>;

function Ladder() {
  const rows = [
    { name: 'L1 hit', cycles: 4, note: '1×', cls: 'l1' },
    { name: 'L2 hit, after an L1 miss', cycles: 4 + 12, note: '4×', cls: 'l2' },
    { name: 'Main memory, after both miss', cycles: 4 + 12 + 200, note: '54×', cls: 'mem' },
  ];
  return (
    <figure className="ladder">
      {rows.map((r) => (
        <div key={r.name} className="ladder-row">
          <span className="ladder-name">{r.name}</span>
          <span className="ladder-track"><span className={`ladder-bar ${r.cls}`} style={{ width: `${(100 * r.cycles) / 216}%` }} /></span>
          <span className="ladder-val"><b>{r.cycles}</b> cycles · {r.note}</span>
        </div>
      ))}
      <figcaption>The simulator's default latencies: L1 4 cycles, L2 12, memory 200. Each miss sends the request one level further.</figcaption>
    </figure>
  );
}

function Placement() {
  const shapes = [
    { name: 'Direct-mapped', sets: 4, ways: 1 },
    { name: '2-way set-associative', sets: 2, ways: 2 },
    { name: 'Fully associative', sets: 1, ways: 4 },
  ];
  const line = 6;
  return (
    <figure className="placement">
      <div className="placement-row">
        {shapes.map((s) => (
          <div key={s.name} className="mini-case">
            <span className="mini-case-name">{s.name}</span>
            <span className="mini-case-shape">{s.sets} {s.sets === 1 ? 'set' : 'sets'} × {s.ways} {s.ways === 1 ? 'way' : 'ways'}</span>
            <div className="mini-grid" style={{ ['--ways' as string]: s.ways }}>
              {Array.from({ length: s.sets }, (_, set) => (
                <div key={set} className="mini-row">
                  <span>set {set}</span>
                  {Array.from({ length: s.ways }, (_, w) => (
                    <i key={w} className={set === line % s.sets ? 'allowed' : ''} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <figcaption>The same four-line cache, three shapes. Highlighted: every slot where line {line} is allowed to live (set = line mod sets).</figcaption>
    </figure>
  );
}

function Pair({ a, b, la, lb }: { a?: Recording; b?: Recording; la: string; lb: string }) {
  if (!a || !b) return <Wait />;
  const facts = (r: Recording) => r.report.levels[0]!;
  return (
    <div className="pair">
      {[{ r: a, l: la }, { r: b, l: lb }].map(({ r, l }) => (
        <figure key={l} className="pair-item">
          <figcaption><b>{l}</b> · {fmtInt(facts(r).hits)} hits, {fmtInt(facts(r).misses)} misses, AMAT {fmtCycles(r.report.amat_cycles)}</figcaption>
          <Replay rec={r} size="sm" intake={false} label={`${l}, replayed from the engine's recording`} />
        </figure>
      ))}
    </div>
  );
}

function WriteStory({ rec, title }: { rec?: Recording; title: string }) {
  if (!rec) return <Wait />;
  const e = rec.events[5]!;
  const n = narrate(e, rec.config);
  return (
    <div className="write-story">
      <h4>{title}</h4>
      <p className="story-head">{n.headline}</p>
      <ol className="story-steps">{n.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
      <p className="write-totals">Whole trace: {fmtInt(rec.report.memory.writes)} memory {rec.report.memory.writes === 1 ? 'write' : 'writes'}, AMAT {fmtCycles(rec.report.amat_cycles)}</p>
    </div>
  );
}

export function LearnPage() {
  const r = useRecordings();
  const b = r.demo_b;
  const e10 = b?.events[9];
  const l1 = b?.report.levels[0];
  const l2 = b?.report.levels[1];
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <article className="learn">
      <header className="learn-head">
        <h1>How CPU caches work</h1>
        <p className="learn-lede">
          Everything the simulator shows, explained from the ground up. The examples are the engine's own recordings of
          small traces checked by hand, so what you read here is exactly what you will see in the visualizer.
        </p>
        <nav className="contents" aria-label="Contents">
          <ol>
            {SECTIONS.map((s) => <li key={s.id}><button type="button" className="link" onClick={() => go(s.id)}>{s.title}</button></li>)}
          </ol>
        </nav>
      </header>

      <Section id="why" title={SECTIONS[0].title}>
        <p>
          A processor can do a simple operation in about one clock cycle, but fetching a value from main memory takes
          hundreds. If every load went to memory, the processor would spend almost all its time waiting. A cache is a
          small, fast memory close to the processor that keeps copies of recently used data, so that most loads and
          stores never travel that far.
        </p>
        <p>
          Caches work because programs are predictable in two ways. <b>Temporal locality</b>: data used now is likely to
          be used again soon (a loop counter, the top of the stack). <b>Spatial locality</b>: data next to something used
          now is likely to be used soon (the next element of an array). Real machines stack several caches, small and
          fast near the core, larger and slower further out.
        </p>
        <Ladder />
      </Section>

      <Section id="address" title={SECTIONS[1].title}>
        <p>
          Memory moves between levels in fixed-size blocks called <b>lines</b> (64 bytes on most desktop processors).
          Asking for one byte brings in its whole line, which is how spatial locality pays off. The cache is organised
          as <b>sets</b>, and each set has a few slots called <b>ways</b>. A line can only live in one particular set,
          in any of that set's ways.
        </p>
        <p>The cache finds a line by splitting the address into three fields:</p>
        <ul className="terms">
          <li><b>Offset</b>: the byte within the line. With 64-byte lines that is the lowest 6 bits.</li>
          <li><b>Set index</b>: which set the line must go to. With 64 sets, the next 6 bits.</li>
          <li><b>Tag</b>: everything above. It is stored next to the line so the cache can tell which line of the many
            that share a set is actually there.</li>
        </ul>
        <figure className="fig">
          <AddressSplit geo={geometry(DEFAULT_CONFIG.l1)} />
          <figcaption>The default L1: 32 KiB with 64-byte lines and 8 ways gives 32768 ÷ (64 × 8) = 64 sets.</figcaption>
        </figure>
        {e10 && (
          <p className="worked">
            In the two-level walkthrough, lines are 16 bytes and L1 has 2 sets. The last access, <code>{e10.op} {fmtHex(e10.address)}</code>, is
            byte {e10.offset} of line {fmtHex(e10.line)}. The engine put that line in L1 set {e10.l1.set} with tag {fmtHex(e10.l1.tag)},
            found it there, and the access took {e10.latency} cycle{e10.latency === 1 ? '' : 's'}.
          </p>
        )}
        <p>
          A lookup reads every way of the chosen set and compares tags. A match is a <b>hit</b>. No match is a
          <b> miss</b>: the line is fetched from the next level and filed in that set, and if the set is full one of its
          lines has to leave first.
        </p>
      </Section>

      <Section id="placement" title={SECTIONS[2].title}>
        <p>
          The number of ways is the cache's <b>associativity</b>. With one way the cache is <b>direct-mapped</b>: each
          line has exactly one possible slot, which makes lookup cheap but lets two busy lines that share a set throw
          each other out forever. With all slots in one set the cache is <b>fully associative</b>: any line can go
          anywhere, but every lookup must check every tag. Real caches sit in between, usually 4 to 16 ways.
        </p>
        <Placement />
        <p>
          A direct-mapped cache next to a 2-way one makes the difference concrete. The trace reads lines 0 and 4 in turn, three times each, through a 64-byte cache
          with 16-byte lines. Direct-mapped, both lines map to set 0 and keep evicting each other: six accesses, six
          misses. With two ways, each line gets its own way and only the first touch of each misses.
        </p>
        <Pair a={r.demo_a_direct} b={r.demo_a_2way} la="Direct-mapped" lb="2-way" />
        <TryIt example="conflict" />
      </Section>

      <Section id="replacement" title={SECTIONS[3].title}>
        <p>When a miss lands in a full set, the <b>replacement policy</b> picks the victim:</p>
        <ul className="terms">
          <li><b>LRU</b> (least recently used) evicts the line that has gone longest without being touched. It follows
            temporal locality closely and is the usual reference.</li>
          <li><b>FIFO</b> (first in, first out) evicts the line that arrived first, however often it has been used since.
            Cheaper to build, sometimes much worse.</li>
          <li><b>Random</b> evicts any line. In ccsim it is seeded, so the same seed always picks the same victims, and
            empty ways are always filled first.</li>
        </ul>
        <p>
          A dirty line (one that was written) has to be written back to the next level when it is evicted; a clean one can
          simply be dropped. The FIFO example below is the classic reference string 1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5 in a fully
          associative cache. Under FIFO, giving the cache a fourth line makes it <em>worse</em>: Belady's anomaly.
        </p>
        <Pair a={r.demo_c_fifo3} b={r.demo_c_fifo4} la="FIFO, 3 lines" lb="FIFO, 4 lines" />
        <div className="table-wrap">
          <table className="data-table">
            <caption>The same reference string worked out by hand. LRU can never get worse with more lines; FIFO can.</caption>
            <thead><tr><th scope="col">Policy</th><th scope="col">3 lines</th><th scope="col">4 lines</th></tr></thead>
            <tbody>
              <tr><th scope="row">FIFO</th><td>3 hits, 9 misses</td><td>2 hits, 10 misses</td></tr>
              <tr><th scope="row">LRU</th><td>2 hits, 10 misses</td><td>4 hits, 8 misses</td></tr>
            </tbody>
          </table>
        </div>
        <TryIt example="fifo" />
      </Section>

      <Section id="writes" title={SECTIONS[4].title}>
        <p>Stores raise two separate questions, and ccsim lets you answer each one per level.</p>
        <ul className="terms">
          <li><b>On a write hit</b>: <b>write-back</b> only updates the cached copy and marks it dirty; memory hears about it
            when the line is evicted. <b>Write-through</b> forwards every store to the next level straight away, so lines
            are never dirty but traffic goes up.</li>
          <li><b>On a write miss</b>: <b>write-allocate</b> fetches the line and then writes into it, so later accesses
            hit. <b>No-write-allocate</b> (write-around) sends the store down without filing the line.</li>
        </ul>
        <p>Here is access 6 of the two-level walkthrough, a store to <code>0x0C0</code> that misses in L1, under three policies:</p>
        <div className="write-grid">
          <WriteStory rec={r.demo_b} title="Write-back, write-allocate" />
          <WriteStory rec={r.demo_b_write_through} title="Write-through, write-allocate" />
          <WriteStory rec={r.demo_b_no_write_allocate} title="Write-back, no-write-allocate" />
        </div>
      </Section>

      <Section id="levels" title={SECTIONS[5].title}>
        <p>
          With two levels, an L1 miss asks L2, and only an L2 miss goes to memory. How the two levels share lines is the
          <b> inclusion</b> policy:
        </p>
        <ul className="terms">
          <li><b>Non-inclusive</b>: no rule. A line can be in L1, L2, both or neither. The two-level walkthrough uses this.</li>
          <li><b>Inclusive</b>: everything in L1 is also in L2. When L2 evicts a line, any L1 copy must be thrown out too,
            a <b>back-invalidation</b>.</li>
          <li><b>Exclusive</b>: a line lives in L1 or L2, never both. Lines evicted from L1 move down into L2 as victims,
            and an L2 hit moves the line up and out of L2, so the two levels together hold more distinct lines.</li>
        </ul>
        {r.demo_b_inclusive && r.demo_b_exclusive ? (
          <>
            <div className="pair">
              <figure className="pair-item">
                <figcaption><b>Inclusive</b> · {fmtInt(r.demo_b_inclusive.report.levels[0]!.back_invalidations)} back-invalidation in L1, {fmtInt(r.demo_b_inclusive.report.memory.writes)} memory write</figcaption>
                <Replay rec={r.demo_b_inclusive} size="sm" intake={false} start={r.demo_b_inclusive.events.length} label="The two-level walkthrough with an inclusive L2, final state" />
              </figure>
              <figure className="pair-item">
                <figcaption><b>Exclusive</b> · {fmtInt(r.demo_b_exclusive.report.levels[1]!.victims_received)} victims moved into L2, {fmtInt(r.demo_b_exclusive.report.memory.writes)} memory writes</figcaption>
                <Replay rec={r.demo_b_exclusive} size="sm" intake={false} start={r.demo_b_exclusive.events.length} label="The two-level walkthrough with an exclusive L2, final state" />
              </figure>
            </div>
            <p className="fig-note">Both start at the end of the walkthrough. Step backwards to see how each got there.</p>
          </>
        ) : <Wait />}
        <TryIt example="walkthrough" />
      </Section>

      <Section id="amat" title={SECTIONS[6].title}>
        <p>
          The headline number is the <b>average memory access time</b> (AMAT): total cycles spent on memory accesses
          divided by the number of accesses. ccsim adds up the actual latency of every access, so its AMAT is exact for
          its model. For a simple two-level hierarchy like the walkthrough's it comes out the same as the textbook formula:
        </p>
        <p className="formula">AMAT = L1 hit time + L1 miss rate × (L2 hit time + L2 local miss rate × memory latency)</p>
        {b && l1 && l2 && (
          <p className="worked">
            The walkthrough: 1 + {fmtPercent(l1.miss_rate, 0)} × (10 + 6/7 × 100) = <b>{fmtCycles(b.report.amat_cycles)}</b>, which is
            {' '}{fmtInt(b.report.total_latency_cycles)} cycles over {b.report.trace.accesses} accesses.
          </p>
        )}
        <p>
          There are two kinds of miss rate for L2. The <b>local</b> miss rate divides L2's misses by the accesses that
          reached L2 (only L1's misses). The <b>global</b> miss rate divides them by all accesses.
          {l2 && <> In the walkthrough, L2 missed 6 of the 7 requests it saw: local {fmtPercent(l2.local_miss_rate)}, global {fmtPercent(l2.global_miss_rate)}.</>}
          {' '}When a rate has nothing to divide by (an L2 nobody asked yet), ccsim says n/a rather than inventing a 0.
        </p>
      </Section>

      <Section id="threec" title={SECTIONS[7].title}>
        <p>Every miss can be put in one of three classes (Hill and Smith):</p>
        <ul className="terms">
          <li><b>Compulsory</b>: the first touch of a line. No cache could have had it.</li>
          <li><b>Capacity</b>: a fully associative LRU cache of the same size would also have missed. The working set
            simply does not fit; only a bigger cache helps.</li>
          <li><b>Conflict</b>: a fully associative cache of the same size would have hit. The line was thrown out because
            its set was crowded; more ways or a better mapping help.</li>
        </ul>
        {r.demo_a_direct && r.demo_a_2way && (
          <div className="table-wrap">
            <table className="data-table">
              <caption>Direct-mapped vs 2-way on the conflict trace, from the engine's reports: associativity removes exactly the conflict misses.</caption>
              <thead><tr><th scope="col">L1</th><th scope="col">Compulsory</th><th scope="col">Capacity</th><th scope="col">Conflict</th></tr></thead>
              <tbody>
                {[{ l: 'Direct-mapped', x: r.demo_a_direct }, { l: '2-way', x: r.demo_a_2way }].map(({ l, x }) => {
                  const c = x.report.levels[0]!.three_c;
                  return <tr key={l}><th scope="row">{l}</th><td className="num">{fmtInt(c?.compulsory)}</td><td className="num">{fmtInt(c?.capacity)}</td><td className="num">{fmtInt(c?.conflict)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="reuse" title={SECTIONS[8].title}>
        <p>
          The <b>reuse distance</b> of an access is the number of different lines touched since the previous access to the
          same line. In a fully associative LRU cache that holds N lines, an access hits exactly when its reuse distance
          is below N. So one pass over the trace, counting reuse distances, tells you the miss ratio for every cache
          size at once: the <b>miss-ratio curve</b>.
        </p>
        <p>
          ccsim reports that curve for capacities of 1, 2, 4, 8, … lines. Where it flattens, more capacity stops helping
          and the remaining misses are compulsory; where it drops steeply, a slightly larger cache would pay off. It is
          the quickest way for an engineer to see how much cache a program actually needs.
        </p>
        {r.demo_c_fifo3?.report.reuse && (
          <div className="table-wrap">
            <table className="data-table">
              <caption>The FIFO example's reference string: miss ratio of a fully associative LRU cache, from the engine's reuse analysis.</caption>
              <thead><tr><th scope="col">Lines</th>{r.demo_c_fifo3.report.reuse.fa_lru_miss_ratio.slice(0, 5).map((_, k) => <th key={k} scope="col">{2 ** k}</th>)}</tr></thead>
              <tbody><tr><th scope="row">Miss ratio</th>{r.demo_c_fifo3.report.reuse.fa_lru_miss_ratio.slice(0, 5).map((m, k) => <td key={k} className="num">{fmtPercent(m)}</td>)}</tr></tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="traces" title={SECTIONS[9].title}>
        <p>
          A trace is the list of memory accesses a program made, in order. ccsim reads plain text, one access per line:
        </p>
        <pre className="code-block"><code>{`# ccsim trace v1: one access per line
R 0x7ffd1a20
W 0x7ffd1a28   # trailing comments are allowed`}</code></pre>
        <p>
          The simulator takes a trace only as a file you upload, and the engine reads it the moment you choose it. A file
          with any line in another form is rejected whole, with that line's number, so you never simulate half a trace.
        </p>
        <ul className="terms">
          <li><code>R</code> is a load and <code>W</code> a store, upper case, followed by a <code>0x</code> hexadecimal address of up to 16 digits.</li>
          <li><code>#</code> starts a comment; blank lines are ignored; LF and CRLF both work.</li>
          <li>Access size is not modelled: each record touches the line that contains its address.</li>
          <li>Files can be gzip-compressed (<code>.trace.gz</code>).</li>
        </ul>
        <p>
          For something realistic, download the 64 × 64 matrix-multiply trace: about four million accesses of a program
          compiled without optimisation, recorded with Valgrind. Traces of your own programs can be made the same way,
          with a memory tracer such as Valgrind's Lackey or Intel Pin, and converted to this format.
        </p>
        <div className="try">
          <button type="button" className="btn" onClick={() => downloadExample('format')}><Icon name="download" size={16} /> Download the format example</button>
          <button type="button" className="btn ghost" onClick={() => downloadExample(exampleById('matmul'))}><Icon name="download" size={16} /> Matrix multiply trace (.trace.gz)</button>
        </div>
      </Section>

      <footer className="learn-close">
        <h2>Now watch it happen</h2>
        <p>Every term on this page appears in the visualizer, one access at a time.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('simulate')}>Open the simulator <Icon name="arrow" size={16} /></button>
      </footer>
    </article>
  );
}
