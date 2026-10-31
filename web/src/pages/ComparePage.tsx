// Step 4: experiment comparison. Set up the trace and the configurations and check the comparison
// is fair (this page); watch them play side by side (RacePage); then the results, where deltas,
// winners, CSV and configuration strings are all the engine's (ResultsPage below).

import { useMemo, useState } from 'react';
import { axisStyle, baseOption, Chart } from '../components/Chart';
import { HierarchyForm } from '../components/ConfigForm';
import { Icon } from '../components/Icon';
import { Locked } from '../components/TopBar';
import { TracePicker } from '../components/TracePicker';
import { DEMO_CONFIGS } from '../engine/config';
import { useTraceCheck } from '../lib/traceCheck';
import { href, navigate } from '../router';
import { checkComparison, exportLog, metricRows, planSweep, summarize, SWEEP_AXES, type SweepAxis } from '../lib/comparison';
import { download, printPdf } from '../lib/export';
import { fmtMetric } from '../lib/format';
import { ink, seriesColor } from '../lib/palette';
import { MAX_RUNS, nextEntryKey, useApp, type CompareEntry } from '../store/useApp';
import { ExportBar } from './AnalyticsPage';

const HEADLINE = ['amat_cycles', 'l1.miss_rate', 'l2.local_miss_rate', 'memory.bytes_per_access'];

export function ComparePage() {
  const s = useApp();
  const { run, analyticsReady, entries, setEntries, updateEntry, compareBusy, compareError, compareTrace, setCompareTrace,
          theme, race } = s;
  const [axis, setAxis] = useState<SweepAxis>('l1.ways');
  /** One line under the add buttons: why the last add did nothing, or added less than asked. */
  const [addNote, setAddNote] = useState<{ kind: 'error' | 'note'; text: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const check = useTraceCheck(compareTrace.kind === 'file' ? compareTrace.file : null);

  const traceCheck = compareTrace.kind === 'run'
    ? { ok: !!run, text: run ? `One trace for every run: ${run.trace.name}` : 'Upload a trace for the comparison' }
    : check.status === 'ok' ? { ok: true, text: `One trace for every run: ${check.file.name}` }
    : check.status === 'checking' ? { ok: false, text: `The engine is checking ${check.file.name}` }
    : check.status === 'rejected' ? { ok: false, text: `The trace was rejected: ${check.reason}` }
    : { ok: false, text: 'Upload a trace for the comparison' };
  const checks = useMemo(() => checkComparison(entries, MAX_RUNS, traceCheck), [entries, traceCheck.ok, traceCheck.text]);
  const ready = checks.every((c) => c.ok || !c.blocking);

  if (!run || !analyticsReady) {
    return <Locked what="Comparison" hint="Finish a run and open its analytics first; the comparison starts from that run." action={run ? 'Go to analytics' : 'Configure a run'} to={run ? 'analytics' : 'simulate'} />;
  }

  const room = MAX_RUNS - entries.length;
  const full = { kind: 'error' as const, text: `Can't run more than ${MAX_RUNS} configurations at once. Remove one to add another.` };
  const add = (label: string, config = run.config) => {
    if (room <= 0) return setAddNote(full);
    const key = nextEntryKey();
    setEntries([...entries, { key, label, config }]);
    setOpen(key);
    setAddNote(null);
  };
  const addSweep = () => {
    if (room <= 0) return setAddNote(full);
    const plan = planSweep(entries, entries[0]?.config ?? run.config, axis, MAX_RUNS);
    setEntries([...entries, ...plan.added.map((e) => ({ key: nextEntryKey(), ...e }))]);
    setAddNote(plan.note);
  };
  const preset = (id: 'assoc' | 'fifo') => {
    const pair: CompareEntry[] = id === 'assoc'
      ? [{ key: nextEntryKey(), label: 'direct-mapped', config: DEMO_CONFIGS.demo_a_direct },
         { key: nextEntryKey(), label: '2-way', config: DEMO_CONFIGS.demo_a_2way }]
      : [{ key: nextEntryKey(), label: 'FIFO 3 lines', config: DEMO_CONFIGS.demo_c_fifo3 },
         { key: nextEntryKey(), label: 'FIFO 4 lines', config: DEMO_CONFIGS.demo_c_fifo4 }];
    setEntries(pair);
    setAddNote(null);
    setOpen(null);
  };
  const toBaseline = (i: number) => setEntries([entries[i]!, ...entries.filter((_, j) => j !== i)]);

  return (
    <div className="flow-page compare">
      <header className="page-head">
        <div>
          <h1>Compare configurations</h1>
          <p className="lede">
            Set up two to {MAX_RUNS} caches on one trace and check the comparison is fair. They then play live side by
            side, and the results compare them metric by metric.
          </p>
        </div>
        <div className="presets" role="group" aria-label="Example comparisons">
          <button type="button" className="chip" onClick={() => preset('assoc')}>Direct-mapped vs 2-way</button>
          <button type="button" className="chip" onClick={() => preset('fifo')}>FIFO: 3 lines vs 4 lines</button>
        </div>
      </header>

      <div className="compare-setup">
        <section className="panel" aria-labelledby="h-ctrace">
          <h2 id="h-ctrace" className="panel-title"><span className="step-no">1</span> Trace</h2>
          <TracePicker check={check} onFile={(file) => setCompareTrace({ kind: 'file', file })}
                       runTrace={{ name: run.trace.name, accesses: run.trace.accesses, selected: compareTrace.kind === 'run',
                                   onSelect: () => setCompareTrace({ kind: 'run' }) }} />
        </section>

        <section className="panel" aria-labelledby="h-runs">
          <div className="panel-head">
            <h2 id="h-runs" className="panel-title"><span className="step-no">2</span> Configurations</h2>
            <span className="panel-sub">
              The first one is the baseline every delta is measured against · {entries.length} of {MAX_RUNS}
            </span>
          </div>
          <ol className="entries">
            {entries.map((e, i) => (
              <li key={e.key} className={`entry ${open === e.key ? 'open' : ''}`}>
                <div className="entry-row">
                  <span className="swatch" style={{ background: seriesColor(i, theme) }} aria-hidden />
                  <input className="entry-name" aria-label={`Name of run ${i + 1}`} value={e.label}
                         onChange={(x) => updateEntry(e.key, { label: x.target.value })} />
                  <span className="entry-summary">{summarize(e.config)}</span>
                  <span className="entry-actions">
                    {i === 0 ? <span className="tag">baseline</span>
                             : <button type="button" className="btn small" onClick={() => toBaseline(i)}>Make baseline</button>}
                    <button type="button" className="btn small" aria-expanded={open === e.key} onClick={() => setOpen(open === e.key ? null : e.key)}>
                      {open === e.key ? 'Done' : 'Edit'}
                    </button>
                    <button type="button" className="icon-btn ghost" aria-label={`Remove ${e.label}`}
                            onClick={() => { setEntries(entries.filter((_, j) => j !== i)); setAddNote(null); }}><Icon name="x" /></button>
                  </span>
                </div>
                {open === e.key && (
                  <div className="entry-edit">
                    <HierarchyForm prefix={`c${e.key}-`} config={e.config} onChange={(c) => updateEntry(e.key, { config: c })} />
                  </div>
                )}
              </li>
            ))}
            {entries.length === 0 && (
              <li className="entry-empty">No configurations yet. Start from your run, a preset above, or a sweep below.</li>
            )}
          </ol>
          <div className="entry-adders">
            <button type="button" className="btn" onClick={() => add(entries.length ? `run ${entries.length + 1}` : 'my run')}>
              <Icon name="plus" size={16} /> Add the current run's cache
            </button>
            <button type="button" className="btn" disabled={entries.length === 0}
                    onClick={() => add(`copy of ${entries[0]?.label ?? 'baseline'}`, entries[0]?.config)}>
              <Icon name="copy" size={16} /> Copy the baseline to edit
            </button>
            <span className="adder-sweep">
              <label className="inline-field">
                <span>Sweep</span>
                <select value={axis} onChange={(e) => setAxis(e.target.value as SweepAxis)}>
                  {SWEEP_AXES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </label>
              <button type="button" className="btn" onClick={addSweep}>Add sweep</button>
            </span>
            <button type="button" className="btn ghost" disabled={entries.length === 0} onClick={() => { setEntries([]); setAddNote(null); }}>Clear all</button>
          </div>
          {addNote && (
            <p className={`msg ${addNote.kind === 'error' ? 'error' : 'note'}`} role={addNote.kind === 'error' ? 'alert' : 'status'}>
              {addNote.kind === 'error' && <Icon name="alert" size={14} />} {addNote.text}
            </p>
          )}
        </section>

        <section className="panel checks-panel" aria-labelledby="h-check">
          <h2 id="h-check" className="panel-title"><span className="step-no">3</span> Is this a fair comparison?</h2>
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? 'ok' : c.blocking ? 'bad' : 'warn'}>
                <Icon name={c.ok ? 'check' : 'alert'} size={16} />
                <span>
                  {c.text}
                  {!c.ok && c.detail && c.detail.length > 0 && <ul className="check-detail">{c.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary btn-run" disabled={!ready || !!compareBusy}
                  onClick={() => void s.startRace()}>
            {compareBusy ? 'Preparing…' : 'Watch them side by side'} {!compareBusy && <Icon name="arrow" />}
          </button>
          {compareBusy && <p className="busy-note" aria-live="polite">{compareBusy.what}</p>}
          {compareError && <p className="msg error" role="alert"><Icon name="alert" size={14} /> {compareError}</p>}
          {race && !compareBusy && <p className="busy-note"><a href={href('race')}>Back to the live view</a> of the current set-up.</p>}
          <p className="busy-note">The engine checks again, when the results are computed, that every run used the same trace fingerprint.</p>
        </section>
      </div>

    </div>
  );
}

export function ResultsPage() {
  const { compare, theme, race, newRun } = useApp();
  const [extra, setExtra] = useState<string>('total_latency_cycles');
  const rows = useMemo(() => (compare ? metricRows(compare.doc) : []), [compare]);
  const labels = compare?.doc.runs.map((r) => r.label) ?? [];

  if (!compare) {
    return <Locked what="The comparison results" hint="Set up the configurations, watch them run, then press Results." action="Set up a comparison" to="compare" />;
  }

  const chartFor = (key: string) => {
    const m = compare?.doc.metrics.find((x) => x.key === key);
    if (!m) return null;
    const option = {
      ...baseOption(),
      tooltip: { ...(baseOption().tooltip as object), trigger: 'item', valueFormatter: (v: unknown) => fmtMetric(v as number, m.unit) },
      // One bar per run, coloured like the run list above; the axis names the runs, so no legend.
      legend: { show: false },
      grid: { left: 64, right: 24, top: 28, bottom: 48 },
      xAxis: { type: 'category', data: labels, ...axisStyle() },
      yAxis: { type: 'value', name: m.unit, ...axisStyle() },
      series: [{
        type: 'bar', name: m.label, barMaxWidth: 44,
        label: { show: labels.length <= 4, position: 'top', color: ink(theme).secondary, formatter: (p: { value: number }) => fmtMetric(p.value, m.unit) },
        data: m.values.map((v, i) => ({ value: v, itemStyle: { color: seriesColor(i, theme), borderRadius: [4, 4, 0, 0] } })),
      }],
    };
    const table = { columns: ['Run', m.label], rows: labels.map((l, i) => [l, fmtMetric(m.values[i], m.unit)]) };
    return <Chart key={`${key}-${theme}`} title={m.label} subtitle={`${m.better === 'lower' ? 'Lower' : m.better === 'higher' ? 'Higher' : 'Neither'} is better · ${m.unit}`} option={option} table={table} height={230} />;
  };

  return (
    <div className="flow-page compare">
        <section className="results" aria-labelledby="h-results">
          <header className="page-head">
            <div>
              <h1 id="h-results">Comparison results</h1>
              <p className={`verdict ${compare.doc.same_trace ? 'ok' : 'bad'}`}>
                <Icon name={compare.doc.same_trace ? 'check' : 'alert'} size={16} />
                {compare.doc.same_trace
                  ? `Same trace for every run: ${compare.trace.name}, ${compare.trace.accesses.toLocaleString('en-US')} accesses, fingerprint ${compare.trace.fingerprint}.`
                  : 'The runs used different traces, so these deltas are not a fair comparison.'}
              </p>
            </div>
            <ExportBar
              onPdf={() => printPdf('ccsim-comparison')}
              onCsv={() => download('ccsim-comparison.csv', compare.csv, 'text/csv')}
              onJson={() => download('ccsim-comparison.json', JSON.stringify(compare.doc, null, 2), 'application/json')}
              extra={<button type="button" className="btn" onClick={() => download('ccsim-comparison.log', exportLog(compare.doc, compare.trace), 'text/plain')}>
                <Icon name="download" size={16} /> Log</button>} />
          </header>

          <ol className="run-list">
            {compare.doc.runs.map((r, i) => (
              <li key={i}>
                <span className="swatch" style={{ background: seriesColor(i, theme) }} aria-hidden />
                <strong>{r.label}</strong>{i === 0 && <span className="tag">baseline</span>}
                <span className="entry-summary">{r.description}</span>
              </li>
            ))}
          </ol>
          {compare.doc.differences.length > 0 && <p className="diff-line">Differences from the baseline: {compare.doc.differences.join('; ')}</p>}

          <div className="chart-grid">{HEADLINE.map(chartFor)}</div>
          <div className="chart-grid">
            <div className="extra-metric">
              <label className="inline-field no-print">
                <span>Another metric</span>
                <select value={extra} onChange={(e) => setExtra(e.target.value)}>
                  {compare.doc.metrics.filter((m) => !HEADLINE.includes(m.key)).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </label>
              {chartFor(extra)}
            </div>
          </div>

          <section className="panel" aria-labelledby="h-allm">
            <div className="panel-head">
              <h3 id="h-allm" className="panel-title">Every metric</h3>
              <span className="panel-sub">Change against the baseline; best follows each metric's direction</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {labels.map((l, i) => <th key={i} scope="col">{l}</th>)}
                    {labels.slice(1).map((l, i) => <th key={`d${i}`} scope="col">Δ {l}</th>)}
                    <th scope="col">Best</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label} <span className="unit">({r.unit}, {r.better})</span></th>
                      {r.values.map((v, i) => <td key={i} className={`num ${r.bestIndex === i ? 'best' : ''}`}>{v}{r.bestIndex === i && <span className="sr-only"> (best)</span>}</td>)}
                      {r.deltas.slice(1).map((d, i) => <td key={`d${i}`} className="num">{d}</td>)}
                      <td>{r.best}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      <nav className="results-nav no-print" aria-label="Comparison">
        {race && <button type="button" className="btn" onClick={() => navigate('race')}><Icon name="back" size={16} /> Back to the live view</button>}
        <button type="button" className="btn" onClick={() => navigate('compare')}>Change the set-up</button>
        <button type="button" className="btn btn-primary" onClick={newRun}>Start a completely new run <Icon name="arrow" size={16} /></button>
      </nav>
    </div>
  );
}
