// The trace upload: a file (picker or drag and drop, as often as you like) that the engine checks
// at once; the standard dataset for anyone without a trace; one sample showing the format. In
// Compare it can also reuse the active run's trace.

import { useRef, useState, type DragEvent } from 'react';
import { downloadExample, FORMAT_EXAMPLE, STANDARD_TRACE, STANDARD_TRACE_SUMMARY, standardTraceFile } from '../examples';
import { fmtBytes } from '../lib/format';
import type { TraceCheck } from '../lib/traceCheck';
import { Icon } from './Icon';

const ACCEPT = '.trace,.gz,.txt';
const PREVIEW = FORMAT_EXAMPLE.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\s*#.*/, '')).slice(0, 4).join('\n');

interface Props {
  check: TraceCheck;
  onFile: (f: File) => void;
  /** Compare only: the active run's trace, offered instead of a new file. */
  runTrace?: { name: string; accesses: number; selected: boolean; onSelect: () => void } | null;
}

function Verdict({ check }: { check: TraceCheck }) {
  switch (check.status) {
    case 'none':
      return (
        <>
          <strong>Drop your trace file here</strong>
          <span><code>.trace</code> or <code>.trace.gz</code>, one access per line, like the sample below</span>
        </>
      );
    case 'checking':
      return (
        <>
          <strong>{check.file.name}</strong>
          <span aria-live="polite">The engine is reading it… {fmtBytes(check.bytes)} so far</span>
        </>
      );
    case 'ok':
      return (
        <>
          <strong>{check.file.name}</strong>
          <span className="verdict-ok"><Icon name="check" size={14} /> Accepted by the engine: {check.info.accesses.toLocaleString('en-US')} accesses, fingerprint {check.info.fingerprint}</span>
        </>
      );
    case 'rejected':
      return (
        <>
          <strong>{check.file.name}</strong>
          <span className="verdict-bad" role="alert"><Icon name="alert" size={14} /> Rejected: {check.reason}</span>
        </>
      );
  }
}

export function TracePicker({ check, onFile, runTrace }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const usingRun = !!runTrace?.selected;
  const usingStandard = !usingRun && check.status !== 'none' && check.file.name === STANDARD_TRACE.fileName;
  const useStandard = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      onFile(await standardTraceFile());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const take = (files: FileList | null | undefined) => {
    const f = files?.[0];
    if (f) onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files);
  };
  const state = usingRun ? '' : check.status === 'ok' ? 'chosen' : check.status === 'rejected' ? 'rejected' : '';

  return (
    <div className="trace-picker">
      {runTrace && (
        <div className="slips" role="radiogroup" aria-label="Trace">
          <label className={`slip ${usingRun ? 'chosen' : ''}`}>
            <input type="radio" name="compare-trace" checked={usingRun} onChange={runTrace.onSelect} />
            <span className="slip-title">Same trace as the current run</span>
            <span className="slip-detail">{runTrace.name} · {runTrace.accesses.toLocaleString('en-US')} accesses</span>
          </label>
          <label className={`slip ${!usingRun ? 'chosen' : ''}`}>
            <input type="radio" name="compare-trace" checked={!usingRun} onChange={() => input.current?.click()} />
            <span className="slip-title">Upload another trace</span>
            <span className="slip-detail">{check.status !== 'none' ? check.file.name : 'Every configuration runs on it'}</span>
          </label>
        </div>
      )}

      <div className={`dropzone ${over ? 'over' : ''} ${state}`}
           onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <Icon name="upload" size={22} />
        <div className="dropzone-text">
          {usingRun ? (
            <>
              <strong>Using the current run's trace</strong>
              <span>Drop or choose a file to compare on a different trace instead.</span>
            </>
          ) : <Verdict check={check} />}
        </div>
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          {check.status === 'none' || usingRun ? 'Choose a file' : 'Choose another file'}
        </button>
        <input ref={input} type="file" accept={ACCEPT} hidden
               onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      </div>

      <div className={`standard ${usingStandard ? 'chosen' : ''}`}>
        <div className="standard-text">
          <strong>No trace of your own? Use the standard dataset</strong>
          <span>{STANDARD_TRACE_SUMMARY}</span>
        </div>
        <button type="button" className="btn" disabled={loading || usingStandard} onClick={() => void useStandard()}>
          {usingStandard ? <><Icon name="check" size={16} /> In use</> : loading ? 'Loading…' : 'Use the standard dataset'}
        </button>
        {loadError && <p className="msg error" role="alert"><Icon name="alert" size={14} /> {loadError}</p>}
      </div>

      <div className="sample">
        <pre className="code-block"><code>{PREVIEW}</code></pre>
        <div className="sample-text">
          <p>
            One access per line: <code>R</code> (read) or <code>W</code> (write), a space, and a <code>0x</code> address.
            <code>#</code> starts a comment. A file with any other line is rejected.
          </p>
          <button type="button" className="btn" onClick={() => downloadExample('format')}>
            <Icon name="download" size={16} /> Download a sample trace
          </button>
        </div>
      </div>
    </div>
  );
}
