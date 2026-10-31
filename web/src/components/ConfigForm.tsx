// The hierarchy form (ARCHITECTURE 5.1): every control maps to a field of HierarchyConfig /
// CacheConfig. Used by Configure and by each run in Compare. Geometry is computed from the
// configuration, never from a trace.

import { useEffect, useState, type ReactNode } from 'react';
import {
  INCLUSION_POLICIES,
  POLICY_NAMES,
  WRITE_MISS_POLICIES,
  WRITE_POLICIES,
  type InclusionName,
  type PolicyName,
  type WriteMissPolicyName,
  type WritePolicyName,
} from '../engine/abi';
import { DEFAULT_CONFIG, geometry, type CacheConfigJS, type Geometry, type HierarchyConfigJS } from '../engine/config';
import { fmtBytes } from '../lib/format';

const UNITS = [
  { label: 'B', factor: 1 },
  { label: 'KiB', factor: 1024 },
  { label: 'MiB', factor: 1024 * 1024 },
];

const LABELS: Record<string, string> = {
  lru: 'LRU', fifo: 'FIFO', random: 'Random',
  write_back: 'Write-back', write_through: 'Write-through',
  write_allocate: 'Write-allocate', no_write_allocate: 'No-write-allocate (write-around)',
  non_inclusive: 'Non-inclusive', inclusive: 'Inclusive', exclusive: 'Exclusive',
};
export const optionLabel = (v: string) => LABELS[v] ?? v;

function SizeInput({ id, value, onChange }: { id: string; value: number; onChange: (bytes: number) => void }) {
  const best = [...UNITS].reverse().find((u) => value % u.factor === 0 && value >= u.factor) ?? UNITS[0]!;
  const [unit, setUnit] = useState(best.factor);
  const shown = value % unit === 0 ? value / unit : value;
  const effective = value % unit === 0 ? unit : 1;
  return (
    <div className="input-group">
      <input id={id} type="number" min={1} step={1} value={Number.isFinite(shown) ? shown : ''}
             onChange={(e) => onChange(Math.round(Number(e.target.value) * effective))} />
      <select aria-label="Size unit" value={effective} onChange={(e) => setUnit(Number(e.target.value))}>
        {UNITS.map((u) => <option key={u.label} value={u.factor}>{u.label}</option>)}
      </select>
    </div>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function Select<T extends string>({ id, value, options, onChange, disabled }: {
  id: string; value: T; options: readonly T[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
    </select>
  );
}

function LevelFields({ prefix, name, c, onChange, lineLocked, geo }: {
  prefix: string; name: 'L1' | 'L2'; c: CacheConfigJS; onChange: (c: CacheConfigJS) => void; lineLocked?: boolean; geo: Geometry | null;
}) {
  const p = `${prefix}${name.toLowerCase()}`;
  const set = <K extends keyof CacheConfigJS>(k: K, v: CacheConfigJS[K]) => onChange({ ...c, [k]: v });
  return (
    <div className="form-grid">
      <Field id={`${p}-size`} label="Capacity"><SizeInput id={`${p}-size`} value={c.sizeBytes} onChange={(v) => set('sizeBytes', v)} /></Field>
      <Field id={`${p}-line`} label="Line size (bytes)" hint={lineLocked ? 'Same as L1 in this version' : 'A power of two'}>
        <input id={`${p}-line`} type="number" min={1} value={c.lineBytes} disabled={lineLocked}
               onChange={(e) => set('lineBytes', Number(e.target.value))} />
      </Field>
      <Field id={`${p}-ways`} label="Ways" hint="1 = direct-mapped">
        <input id={`${p}-ways`} type="number" min={1} value={c.ways} onChange={(e) => set('ways', Number(e.target.value))} />
      </Field>
      <Field id={`${p}-lat`} label="Hit latency (cycles)">
        <input id={`${p}-lat`} type="number" min={1} value={c.hitLatency} onChange={(e) => set('hitLatency', Number(e.target.value))} />
      </Field>
      <Field id={`${p}-policy`} label="Replacement">
        <Select<PolicyName> id={`${p}-policy`} value={c.policy} options={POLICY_NAMES} onChange={(v) => set('policy', v)} />
      </Field>
      <Field id={`${p}-wp`} label="On a write hit">
        <Select<WritePolicyName> id={`${p}-wp`} value={c.writePolicy} options={WRITE_POLICIES} onChange={(v) => set('writePolicy', v)} />
      </Field>
      <Field id={`${p}-wmp`} label="On a write miss" hint={name === 'L2' ? 'Applies to stores, so effectively at L1' : undefined}>
        <Select<WriteMissPolicyName> id={`${p}-wmp`} value={c.writeMissPolicy} options={WRITE_MISS_POLICIES}
                                     onChange={(v) => set('writeMissPolicy', v)} />
      </Field>
      <div className="field derived" aria-live="polite">
        <span className="field-label">Organisation</span>
        <span className={`derived-value ${geo ? '' : 'bad'}`}>
          {geo ? `${geo.sets.toLocaleString('en-US')} sets × ${geo.ways} ways · ${fmtBytes(c.sizeBytes)}` : 'not a valid shape yet'}
        </span>
      </div>
    </div>
  );
}

const bits = (n: number) => `${n} bit${n === 1 ? '' : 's'}`;

export function AddressSplit({ geo }: { geo: Geometry | null }) {
  if (!geo) return <p className="muted">The address split appears once L1 is valid.</p>;
  const hi = geo.offsetBits + geo.indexBits;
  return (
    <div className="split">
      <div className="bit-bar" role="img"
           aria-label={`64-bit address: tag ${geo.tagBits} bits, set index ${geo.indexBits} bits, offset ${geo.offsetBits} bits`}>
        <span className="bit-tag" style={{ flex: Math.max(geo.tagBits, 14) }}><b>tag</b> {bits(geo.tagBits)} <small>[63:{hi}]</small></span>
        {geo.indexBits > 0 && <span className="bit-index" style={{ flex: Math.max(geo.indexBits, 9) }}><b>set</b> {bits(geo.indexBits)} <small>[{hi - 1}:{geo.offsetBits}]</small></span>}
        <span className="bit-offset" style={{ flex: Math.max(geo.offsetBits, 9) }}><b>offset</b> {bits(geo.offsetBits)} <small>[{geo.offsetBits - 1}:0]</small></span>
      </div>
      <p className="split-note">line = address ≫ {geo.offsetBits} · set = line mod {geo.sets.toLocaleString('en-US')} · tag = line ≫ {geo.indexBits}</p>
    </div>
  );
}

const MAX_SEED = 1n << 64n;

/** The whole hierarchy. `prefix` keeps ids unique when several forms share a page. */
export function HierarchyForm({ config, onChange, prefix = '', onSeedError }: {
  config: HierarchyConfigJS; onChange: (c: HierarchyConfigJS) => void; prefix?: string; onSeedError?: (bad: boolean) => void;
}) {
  const [savedL2, setSavedL2] = useState<CacheConfigJS>(config.l2 ?? DEFAULT_CONFIG.l2!);
  const [seedText, setSeedText] = useState(config.seed.toString());
  const seedOk = /^\d+$/.test(seedText) && BigInt(seedText) < MAX_SEED;

  useEffect(() => setSeedText(config.seed.toString()), [config.seed]);
  useEffect(() => onSeedError?.(!seedOk), [seedOk, onSeedError]);

  const g1 = geometry(config.l1);
  const g2 = config.l2 ? geometry(config.l2) : null;
  const setL1 = (l1: CacheConfigJS) => onChange({ ...config, l1, l2: config.l2 ? { ...config.l2, lineBytes: l1.lineBytes } : null });
  const toggleL2 = (on: boolean) => {
    if (on) onChange({ ...config, l2: { ...savedL2, lineBytes: config.l1.lineBytes } });
    else {
      if (config.l2) setSavedL2(config.l2);
      onChange({ ...config, l2: null });
    }
  };

  return (
    <div className="hierarchy-form">
      <fieldset className="level-block">
        <legend><span className="level-tag">L1</span> First-level cache</legend>
        <LevelFields prefix={prefix} name="L1" c={config.l1} onChange={setL1} geo={g1} />
      </fieldset>
      <fieldset className="level-block">
        <legend>
          <span className="level-tag">L2</span> Second-level cache
          <label className="switch">
            <input type="checkbox" checked={!!config.l2} onChange={(e) => toggleL2(e.target.checked)} />
            <span>{config.l2 ? 'On' : 'Off'}</span>
          </label>
        </legend>
        {config.l2 ? <LevelFields prefix={prefix} name="L2" c={config.l2} onChange={(l2) => onChange({ ...config, l2 })} lineLocked geo={g2} />
                   : <p className="muted level-off">No L2: every L1 miss goes straight to memory.</p>}
      </fieldset>
      <fieldset className="level-block">
        <legend><span className="level-tag mem">MEM</span> Memory and hierarchy</legend>
        <div className="form-grid">
          <Field id={`${prefix}mem-lat`} label="Memory latency (cycles)">
            <input id={`${prefix}mem-lat`} type="number" min={1} value={config.memoryLatency}
                   onChange={(e) => onChange({ ...config, memoryLatency: Number(e.target.value) })} />
          </Field>
          <Field id={`${prefix}inclusion`} label="Inclusion" hint={config.l2 ? undefined : 'Needs an L2'}>
            <Select<InclusionName> id={`${prefix}inclusion`} value={config.inclusion} options={INCLUSION_POLICIES} disabled={!config.l2}
                                   onChange={(v) => onChange({ ...config, inclusion: v })} />
          </Field>
          <Field id={`${prefix}seed`} label="Seed" hint="Used by the Random policy only">
            <input id={`${prefix}seed`} inputMode="numeric" value={seedText} aria-invalid={!seedOk}
                   onChange={(e) => {
                     const t = e.target.value.trim();
                     setSeedText(t);
                     if (/^\d+$/.test(t) && BigInt(t) < MAX_SEED) onChange({ ...config, seed: BigInt(t) });
                   }} />
          </Field>
        </div>
      </fieldset>
    </div>
  );
}
