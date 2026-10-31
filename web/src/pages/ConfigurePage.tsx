// Step 1 of the simulation route: choose the cache hierarchy (explained in a sentence each, with
// every setting adjustable), upload a trace the engine accepts, run. The choice is the stored
// configuration itself, so it stays selected through the run, analytics and comparison until the
// user changes it here.

import { useCallback, useMemo, useState } from 'react';
import { AddressSplit, HierarchyForm } from '../components/ConfigForm';
import { Icon } from '../components/Icon';
import { TracePicker } from '../components/TracePicker';
import { geometry, sameConfig, validateConfig, type HierarchyConfigJS } from '../engine/config';
import { fmtBytes } from '../lib/format';
import { HIERARCHIES, hierarchyOf } from '../lib/hierarchies';
import { useTraceCheck } from '../lib/traceCheck';
import { href } from '../router';
import { useApp } from '../store/useApp';

function summary(c: HierarchyConfigJS): string {
  const lvl = (l: HierarchyConfigJS['l1']) => `${fmtBytes(l.sizeBytes)}, ${l.ways === 1 ? '1 way' : `${l.ways}-way`}`;
  return [`L1 ${lvl(c.l1)}`, c.l2 ? `L2 ${lvl(c.l2)}` : 'no L2', c.l1.policy.toUpperCase(), `memory ${c.memoryLatency} cycles`].join(' · ');
}

export function ConfigurePage() {
  const { config, setConfig, traceFile, setTraceFile, startRun, busy, error, run } = useApp();
  const check = useTraceCheck(traceFile);
  const chosen = hierarchyOf(config);
  const [adjustOpen, setAdjustOpen] = useState(chosen === 'custom');
  const [seedBad, setSeedBad] = useState(false);
  const onSeedError = useCallback((bad: boolean) => setSeedBad(bad), []);
  const v = useMemo(() => validateConfig(config), [config]);
  const traceOk = check.status === 'ok';
  const canRun = traceOk && v.errors.length === 0 && !seedBad && !busy;

  return (
    <div className="flow-page configure">
      <header className="page-head">
        <div>
          <h1>Configure the cache</h1>
          <p className="lede">Choose a cache hierarchy, upload a trace, and run. The engine runs in this tab; your trace never leaves it.</p>
        </div>
        {run && (
          <a className="btn" href={href('visualize')}>Back to the current run <Icon name="arrow" size={16} /></a>
        )}
      </header>

      <div className="configure-grid">
        <div className="configure-main">
          <section className="panel" aria-labelledby="h-cache">
            <div className="panel-head">
              <h2 id="h-cache" className="panel-title">Cache hierarchy</h2>
              <span className="panel-sub">Stays selected for this run and its comparisons until you change it here</span>
            </div>
            <div className="hier-choices" role="radiogroup" aria-labelledby="h-cache">
              {HIERARCHIES.map((h) => (
                <label key={h.id} className={`slip hier-choice ${chosen === h.id ? 'chosen' : ''}`}>
                  <input type="radio" name="hierarchy" checked={chosen === h.id} onChange={() => setConfig(h.config)} />
                  <span className="slip-title">{h.title}</span>
                  <span className="hier-explain">{h.explain}</span>
                  <span className="hier-spec">{h.spec}</span>
                </label>
              ))}
              {chosen === 'custom' && (
                <label className="slip hier-choice chosen">
                  <input type="radio" name="hierarchy" checked readOnly />
                  <span className="slip-title">Your own settings</span>
                  <span className="hier-explain">You changed the settings below, so this is no longer one of the hierarchies above.</span>
                  <span className="hier-spec">{summary(config)}</span>
                </label>
              )}
            </div>
            {run && !sameConfig(run.config, config) && (
              <p className="msg note" role="status">The current run keeps the hierarchy it started with. This choice applies when you run again.</p>
            )}
            <details className="adjust" open={adjustOpen} onToggle={(e) => setAdjustOpen((e.target as HTMLDetailsElement).open)}>
              <summary>Adjust the settings</summary>
              <HierarchyForm config={config} onChange={setConfig} onSeedError={onSeedError} />
            </details>
          </section>

          <section className="panel" aria-labelledby="h-trace">
            <h2 id="h-trace" className="panel-title">Trace</h2>
            <TracePicker check={check} onFile={setTraceFile} />
          </section>
        </div>

        <aside className="configure-side" aria-label="Summary and run">
          <section className="panel ticket">
            <h2 className="panel-title">How L1 reads an address</h2>
            <AddressSplit geo={geometry(config.l1)} />
            <dl className="ticket-facts">
              <div><dt>L1</dt><dd>{fmtBytes(config.l1.sizeBytes)}, {config.l1.ways}-way, {config.l1.policy.toUpperCase()}</dd></div>
              <div><dt>L2</dt><dd>{config.l2 ? `${fmtBytes(config.l2.sizeBytes)}, ${config.l2.ways}-way, ${config.l2.policy.toUpperCase()}` : 'none'}</dd></div>
              <div><dt>Memory</dt><dd>{config.memoryLatency} cycles</dd></div>
              <div><dt>Trace</dt><dd>{check.status === 'ok' ? `${check.file.name}, ${check.info.accesses.toLocaleString('en-US')} accesses`
                : check.status === 'checking' ? 'checking…' : check.status === 'rejected' ? 'rejected, upload another' : 'not uploaded yet'}</dd></div>
            </dl>

            {(v.errors.length > 0 || seedBad) && (
              <ul className="msg error" role="alert">
                {v.errors.map((e) => <li key={e}><Icon name="alert" size={14} /> {e}</li>)}
                {seedBad && <li><Icon name="alert" size={14} /> seed: enter a whole number below 2^64</li>}
              </ul>
            )}
            {v.warnings.length > 0 && <ul className="msg warning">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            {error && <p className="msg error" role="alert"><Icon name="alert" size={14} /> {error}</p>}

            <button type="button" className="btn btn-primary btn-run" disabled={!canRun} onClick={() => void startRun()}>
              {busy ? 'Starting…' : 'Run simulation'} {!busy && <Icon name="arrow" />}
            </button>
            {busy && (
              <p className="busy-note" aria-live="polite">
                {busy.what}{busy.bytes !== undefined ? ` · ${fmtBytes(busy.bytes)} read` : ''}
              </p>
            )}
            {!busy && (
              <p className="busy-note">
                {traceOk ? 'Opens the visualizer. Analytics unlock when the run reaches its last access.'
                         : 'Upload a trace the engine accepts, or use the standard dataset in the trace card, to run.'}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
