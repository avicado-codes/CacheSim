// Step 3: analytics of the finished run (ARCHITECTURE section 9). Everything shown comes from the
// engine's ccsim.simulation/1 report; exports are that report as JSON, its tables as CSV, and the
// page as PDF.

import { useEffect, useMemo } from 'react';
import { Chart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Locked } from '../components/TopBar';
import {
  hitsMisses,
  kpis,
  latencyBreakdown,
  levelTable,
  missRateOverTime,
  missRatioCurve,
  reuseHistogram,
  setHeatmap,
  threeC,
} from '../lib/analytics';
import { analyticsCsv, download, printPdf, safeName } from '../lib/export';
import { navigate } from '../router';
import { useApp } from '../store/useApp';

export function ExportBar({ onPdf, onCsv, onJson, extra }: { onPdf: () => void; onCsv: () => void; onJson: () => void; extra?: React.ReactNode }) {
  return (
    <div className="export-bar no-print" role="group" aria-label="Export">
      <span className="export-label">Export</span>
      <button type="button" className="btn" onClick={onPdf}><Icon name="file" size={16} /> PDF</button>
      <button type="button" className="btn" onClick={onCsv}><Icon name="download" size={16} /> CSV</button>
      <button type="button" className="btn" onClick={onJson}><Icon name="download" size={16} /> JSON</button>
      {extra}
    </div>
  );
}

export function AnalyticsPage() {
  const { run, report, loadReport, reachedEnd, analyticsReady, theme } = useApp();

  useEffect(() => {
    if (run && reachedEnd && !report) void loadReport();
  }, [run, reachedEnd, report, loadReport]);

  const charts = useMemo(() => {
    if (!report) return null;
    return {
      hm: hitsMisses(report),
      lat: latencyBreakdown(report),
      c3: threeC(report),
      time: missRateOverTime(report),
      heat: report.levels.map((l) => ({ name: l.name, h: setHeatmap(l) })),
      mrc: missRatioCurve(report),
      reuse: reuseHistogram(report),
      table: levelTable(report),
    };
    // theme: options carry the theme's ink and series colours
  }, [report, theme]);

  if (!run) return <Locked what="Analytics" hint="Run a simulation and play it to the last access." action="Configure a run" to="simulate" />;
  if (!reachedEnd) return <Locked what="Analytics" hint="Play the run to its last access, or press Finish run in the visualizer." action="Back to the visualizer" to="visualize" />;
  if (!report || !charts) return <div className="flow-page"><p className="page-loading" aria-busy="true">Asking the engine for the report…</p></div>;

  const base = safeName(`${report.label}-analytics`);
  return (
    <div className="flow-page analytics">
      <header className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="lede mono-line">{report.config.description}</p>
          <p className="lede mono-line">{report.trace.source} · {report.trace.accesses.toLocaleString('en-US')} accesses · fingerprint {report.trace.fingerprint}</p>
        </div>
        <ExportBar
          onPdf={() => printPdf(base)}
          onCsv={() => download(`${base}.csv`, analyticsCsv(report), 'text/csv')}
          onJson={() => download(`${base}.simulation.json`, JSON.stringify(report, null, 2), 'application/json')} />
      </header>

      {!report.complete && (
        <p className="msg warning" role="status">This report covers {report.trace.accesses.toLocaleString('en-US')} accesses but the session is not at the end: seek back to the last access in the visualizer for the full report.</p>
      )}

      <section className="kpis" aria-label="Headline numbers">
        {kpis(report).map((k) => (
          <div key={k.label} className="kpi">
            <span className="kpi-label">{k.label}</span>
            <span className={`kpi-value ${k.na ? 'na' : ''}`}>{k.value}</span>
            <span className="kpi-sub">{k.sub}</span>
          </div>
        ))}
      </section>

      <div className="chart-grid">
        <Chart title="Hits and misses per level" subtitle="Demand accesses at each level" option={charts.hm.option} table={charts.hm.table} />
        <Chart title="Where the cycles go" subtitle="Exact split of total latency (additive, serial model)" option={charts.lat.option} table={charts.lat.table} height={200} />
        {charts.c3 && <Chart title="Why the misses happened (3C)" subtitle="Compulsory, capacity and conflict misses (Hill and Smith)" option={charts.c3.option} table={charts.c3.table} />}
        {charts.time && <Chart title="Miss rate over time" subtitle="Cumulative, sampled at about 512 points: warm-up and phase changes" option={charts.time.option} table={charts.time.table} />}
        {charts.mrc && <Chart title="Miss-ratio curve" subtitle={charts.mrc.subtitle} option={charts.mrc.option} table={charts.mrc.table} />}
        {charts.reuse && <Chart title="Reuse distance" subtitle="Distinct lines touched between two uses of a line (log₂ buckets)" option={charts.reuse.option} table={charts.reuse.table} />}
        {charts.heat.map(({ name, h }) => h && (
          <Chart key={name} title={`${name} set balance`} subtitle={h.subtitle} option={h.option} table={h.table} />
        ))}
      </div>

      <section className="panel" aria-labelledby="h-all">
        <h2 id="h-all" className="panel-title">Every per-level counter</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{charts.table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>
              {charts.table.rows.map((r) => <tr key={r[0]}>{r.map((v, i) => (i === 0 ? <th key={i} scope="row">{v}</th> : <td key={i} className="num">{v}</td>))}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {analyticsReady && (
        <div className="done-banner no-print" role="status">
          <Icon name="check" />
          <span><strong>Comparison is open.</strong> Try other configurations on this trace and see which one wins.</span>
          <button type="button" className="btn btn-primary" onClick={() => navigate('compare')}>Compare configurations <Icon name="arrow" size={16} /></button>
        </div>
      )}
    </div>
  );
}
