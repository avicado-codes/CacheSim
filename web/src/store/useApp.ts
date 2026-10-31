// Application state. A run = { config, trace fingerprint, session }; the visualizer and analytics
// read the active run. The comparison holds a set of configurations compared on one trace: they
// play live side by side (the race), then the engine compares them. Nothing here is a derived
// cache fact: grids, events and reports all come from the engine.

import { create } from 'zustand';
import type { BreakOn } from '../engine/abi';
import { EngineClient } from '../engine/client';
import { DEFAULT_CONFIG, type HierarchyConfigJS } from '../engine/config';
import { decodeEvents, type AccessEvent } from '../engine/events';
import { parseComparison, parseReport, type ComparisonDoc, type SimulationReport } from '../engine/report';
import { uploadTrace, type TraceInfo, type TraceSource } from '../engine/trace';
import type { Theme } from '../lib/palette';
import { navigate } from '../router';

export interface Grid {
  states: Uint8Array;
  tags: BigUint64Array;
}

export interface LiveRun {
  client: EngineClient;
  sessionId: string;
  label: string;
  config: HierarchyConfigJS;
  source: TraceSource;
  trace: TraceInfo;
}

export interface Busy {
  what: string;
  bytes?: number;
}

export interface CompareEntry {
  key: number;
  label: string;
  config: HierarchyConfigJS;
}

export interface CompareResult {
  doc: ComparisonDoc;
  csv: string;
  trace: TraceInfo;
}

/** Which trace the comparison runs on: the active run's, or a file uploaded for it. */
export type CompareTrace = { kind: 'run' } | { kind: 'file'; file: File };

/** At most this many configurations in one comparison; all of them play live side by side. */
export const MAX_RUNS = 4;

/** One configuration playing live in the comparison. */
export interface Lane {
  key: number;
  label: string;
  config: HierarchyConfigJS;
  sessionId: string;
  position: number;
  current: AccessEvent | null;
  grids: { l1: Grid | null; l2: Grid | null };
  /** The engine's report for the accesses so far (refreshed while playing). */
  stats: SimulationReport | null;
}

/** The live comparison: every entry has a session on one trace; each has a lane in the live view. */
export interface Race {
  client: EngineClient;
  /** False when the race borrowed the active run's worker (same trace, no second copy). */
  ownsClient: boolean;
  trace: TraceInfo;
  sessions: { key: number; label: string; sessionId: string }[];
  lanes: Lane[];
}

const RECENT_EVENTS = 500;

async function laneGrids(client: EngineClient, id: string, config: HierarchyConfigJS): Promise<Lane['grids']> {
  const grid = async (level: 0 | 1): Promise<Grid> => {
    const g = await client.request({ t: 'session.grid', id, level }, 'grid');
    return { states: g.states, tags: g.tags };
  };
  return { l1: await grid(0), l2: config.l2 ? await grid(1) : null };
}
const THEME_KEY = 'ccsim.theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage blocked: fall back to the system preference
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface AppState {
  theme: Theme;
  config: HierarchyConfigJS;
  /** The trace file uploaded for the next run (checked by the engine on the page). */
  traceFile: File | null;
  /** Set by Run simulation / Watch side by side: that page starts playing as soon as it opens. */
  autoplay: 'visualize' | 'race' | null;
  busy: Busy | null;
  error: string | null;

  run: LiveRun | null;
  position: number;
  current: AccessEvent | null;
  recent: AccessEvent[];
  grids: { l1: Grid | null; l2: Grid | null };
  stopNote: string | null;
  report: SimulationReport | null;
  /** Sticky per run: the trace has been executed to its last access at least once. */
  reachedEnd: boolean;
  /** Sticky per run: a complete analytics report has been produced. */
  analyticsReady: boolean;

  entries: CompareEntry[];
  compareTrace: CompareTrace;
  race: Race | null;
  compare: CompareResult | null;
  compareError: string | null;
  compareBusy: Busy | null;

  setTheme(t: Theme): void;
  setConfig(c: HierarchyConfigJS): void;
  setTraceFile(f: File | null): void;
  /** Hands the autoplay request to the page that opened (returns whether it was for that page). */
  takeAutoplay(page: 'visualize' | 'race'): boolean;
  /** Forgets the run, the comparison and the upload, for a completely new run. */
  newRun(): void;
  startRun(): Promise<void>;
  refreshGrids(): Promise<void>;
  step(n: number, record: boolean): Promise<boolean>;
  runUntil(maxSteps: number, breakOn: BreakOn[], line?: bigint): Promise<boolean>;
  goTo(position: number): Promise<void>;
  reset(): Promise<void>;
  loadReport(): Promise<void>;

  addEntry(label: string, config: HierarchyConfigJS): void;
  setEntries(e: CompareEntry[]): void;
  updateEntry(key: number, e: Partial<Omit<CompareEntry, 'key'>>): void;
  setCompareTrace(t: CompareTrace): void;
  startRace(): Promise<void>;
  raceStep(n: number): Promise<boolean>;
  raceRun(maxSteps: number): Promise<boolean>;
  raceGoTo(position: number): Promise<void>;
  raceReset(): Promise<void>;
  raceStats(): Promise<void>;
  finishRace(): Promise<void>;
}

let entryKey = 1;
export const nextEntryKey = () => entryKey++;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Stops a race: releases its sessions on a borrowed worker, or stops its own worker. */
function endRace(r: Race | null): void {
  if (!r) return;
  if (r.ownsClient) {
    r.client.terminate();
  } else {
    for (const x of r.sessions) void r.client.request({ t: 'session.release', id: x.sessionId }, 'ok').catch(() => {});
  }
}

export const useApp = create<AppState>((set, get) => {
  /** Applies a batch of encoded events and the new cursor. */
  const applyEvents = (words: Uint32Array, position: number) => {
    const events = decodeEvents(words);
    const last = events.at(-1) ?? null;
    set((s) => ({
      position,
      current: last ?? s.current,
      recent: events.length ? [...s.recent, ...events].slice(-RECENT_EVENTS) : s.recent,
      report: null,
      reachedEnd: s.reachedEnd || (s.run !== null && position >= s.run.trace.accesses),
    }));
  };

  const live = (): LiveRun => {
    const run = get().run;
    if (!run) throw new Error('no active run');
    return run;
  };

  const race = (): Race => {
    const r = get().race;
    if (!r) throw new Error('no live comparison');
    return r;
  };
  const setLanes = (lanes: Lane[]) => set((s) => (s.race ? { race: { ...s.race, lanes } } : {}));

  const theme = initialTheme();
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;

  return {
    theme,
    config: DEFAULT_CONFIG,
    traceFile: null,
    autoplay: null,
    busy: null,
    error: null,

    run: null,
    position: 0,
    current: null,
    recent: [],
    grids: { l1: null, l2: null },
    stopNote: null,
    report: null,
    reachedEnd: false,
    analyticsReady: false,

    entries: [],
    compareTrace: { kind: 'run' },
    race: null,
    compare: null,
    compareError: null,
    compareBusy: null,

    setTheme(t) {
      document.documentElement.dataset.theme = t;
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {
        // not persisted; the page still switches
      }
      set({ theme: t });
    },
    setConfig: (config) => set({ config }),
    setTraceFile: (traceFile) => set({ traceFile }),
    takeAutoplay(page) {
      if (get().autoplay !== page) return false;
      set({ autoplay: null });
      return true;
    },
    newRun() {
      endRace(get().race);
      get().run?.client.terminate();
      set({
        config: DEFAULT_CONFIG, traceFile: null, autoplay: null, busy: null, error: null,
        run: null, position: 0, current: null, recent: [], grids: { l1: null, l2: null }, stopNote: null, report: null,
        reachedEnd: false, analyticsReady: false,
        entries: [], compareTrace: { kind: 'run' }, race: null, compare: null, compareError: null, compareBusy: null,
      });
      navigate('simulate');
    },

    async startRun() {
      const { config, traceFile } = get();
      if (!traceFile) {
        set({ error: 'Upload a trace file first.' });
        return;
      }
      endRace(get().race);
      set({ race: null, compare: null });
      get().run?.client.terminate();
      set({ run: null, busy: { what: 'Loading trace' }, error: null, report: null, stopNote: null, reachedEnd: false,
            analyticsReady: false, position: 0, current: null, recent: [], grids: { l1: null, l2: null } });
      const client = new EngineClient();
      try {
        const source: TraceSource = { kind: 'file', file: traceFile };
        const trace = await uploadTrace(client, source, (bytes) => set({ busy: { what: 'Loading trace', bytes } }));
        if (trace.accesses === 0) throw new Error(`${trace.name} contains no accesses`);
        set({ busy: { what: 'Creating session' } });
        const sessionId = 'live';
        await client.request({ t: 'session.create', id: sessionId, config, classify: true }, 'session.created');
        set({ run: { client, sessionId, label: trace.name, config, source, trace }, busy: null, autoplay: 'visualize' });
        await get().refreshGrids();
        navigate('visualize');
      } catch (e) {
        client.terminate();
        set({ busy: null, error: message(e) });
      }
    },

    async refreshGrids() {
      const run = live();
      const grid = async (level: 0 | 1): Promise<Grid> => {
        const g = await run.client.request({ t: 'session.grid', id: run.sessionId, level }, 'grid');
        return { states: g.states, tags: g.tags };
      };
      const l1 = await grid(0);
      const l2 = run.config.l2 ? await grid(1) : null;
      set({ grids: { l1, l2 } });
    },

    /** Executes up to n accesses; returns false at the end of the trace. */
    async step(n, record) {
      const run = live();
      const r = await run.client.request({ t: 'session.step', id: run.sessionId, n, record }, 'events');
      applyEvents(r.words, r.position);
      if (!record) set({ current: null });
      await get().refreshGrids();
      return r.position < run.trace.accesses;
    },

    /** Runs to a breakpoint, the budget or the end; returns true while playback may continue. */
    async runUntil(maxSteps, breakOn, line) {
      const run = live();
      const r = await run.client.request({ t: 'session.run', id: run.sessionId, maxSteps, breakOn, line }, 'stopped');
      applyEvents(r.words, r.position);
      await get().refreshGrids();
      if (r.reason === 'breakpoint') set({ stopNote: `Paused at a breakpoint after access ${r.position.toLocaleString('en-US')}.` });
      if (r.reason === 'end') set({ stopNote: 'End of trace. Analytics are ready.' });
      return r.reason === 'budget';
    },

    /** Moves the cursor so that `position` accesses have executed, showing the last one. */
    async goTo(position) {
      const run = live();
      const target = Math.max(0, Math.min(position, run.trace.accesses));
      set({ stopNote: null });
      if (target === 0) {
        await get().reset();
        return;
      }
      await run.client.request({ t: 'session.seek', id: run.sessionId, position: target - 1 }, 'ok');
      const r = await run.client.request({ t: 'session.step', id: run.sessionId, n: 1, record: true }, 'events');
      const events = decodeEvents(r.words);
      const current = events.at(-1) ?? null;
      // The log never lists accesses after the cursor: drop them on a backward move, and put
      // the access now shown at the end (a forward jump leaves a gap, which the # column shows).
      set((s) => ({ position: r.position, current, report: null,
                    recent: [...s.recent.filter((e) => e.seq < target - 1), ...(current ? [current] : [])].slice(-RECENT_EVENTS),
                    reachedEnd: s.reachedEnd || r.position >= run.trace.accesses }));
      await get().refreshGrids();
    },

    async reset() {
      const run = live();
      await run.client.request({ t: 'session.reset', id: run.sessionId }, 'ok');
      set({ position: 0, current: null, recent: [], stopNote: null, report: null });
      await get().refreshGrids();
    },

    async loadReport() {
      const run = live();
      try {
        const r = await run.client.request(
          { t: 'session.report', id: run.sessionId, label: run.label, withReuse: true }, 'report');
        const report = parseReport(r.json);
        set((s) => ({ report, analyticsReady: s.analyticsReady || report.complete }));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    addEntry: (label, config) => get().setEntries([...get().entries, { key: nextEntryKey(), label, config }]),
    setEntries: (entries) => {
      endRace(get().race);
      set({ entries: entries.slice(0, MAX_RUNS), race: null, compare: null });
    },
    updateEntry: (key, e) => {
      endRace(get().race);
      set((s) => ({ entries: s.entries.map((x) => (x.key === key ? { ...x, ...e } : x)), race: null, compare: null }));
    },
    setCompareTrace: (compareTrace) => {
      endRace(get().race);
      set({ compareTrace, race: null, compare: null });
    },

    /**
     * Loads the comparison trace once and gives every configuration a session on it. Every
     * configuration waits at access 0 for the live view.
     * With the active run's trace, the sessions join the run's worker instead of a second copy.
     */
    async startRace() {
      const { entries, compareTrace, run } = get();
      if (entries.length < 2) return;
      endRace(get().race);
      set({ race: null, compare: null, compareError: null, compareBusy: { what: 'Loading trace' } });
      const borrow = compareTrace.kind === 'run' && run !== null;
      const client = borrow ? run.client : new EngineClient();
      try {
        let trace: TraceInfo;
        if (borrow) {
          trace = run.trace;
        } else if (compareTrace.kind === 'file') {
          trace = await uploadTrace(client, { kind: 'file', file: compareTrace.file },
                                    (bytes) => set({ compareBusy: { what: 'Loading trace', bytes } }));
          if (trace.accesses === 0) throw new Error(`${trace.name} contains no accesses`);
        } else {
          throw new Error('There is no active run to take the trace from; upload a trace for the comparison.');
        }
        const sessions = entries.map((e) => ({ key: e.key, label: e.label, sessionId: `cmp-${e.key}` }));
        for (const [i, e] of entries.entries()) {
          set({ compareBusy: { what: `Preparing ${i + 1} of ${entries.length}: ${e.label}` } });
          const id = sessions[i]!.sessionId;
          await client.request({ t: 'session.create', id, config: e.config, classify: true }, 'session.created');
        }
        const lanes: Lane[] = [];
        for (const e of entries) {
          const sessionId = `cmp-${e.key}`;
          lanes.push({ key: e.key, label: e.label, config: e.config, sessionId, position: 0, current: null, stats: null,
                       grids: await laneGrids(client, sessionId, e.config) });
        }
        set({ race: { client, ownsClient: !borrow, trace, sessions, lanes }, compareBusy: null, autoplay: 'race' });
        navigate('race');
      } catch (e) {
        if (!borrow) client.terminate();
        set({ compareError: message(e), compareBusy: null });
      }
    },

    /** Steps every configuration by n accesses, in lockstep; false once all are at the end. */
    async raceStep(n) {
      const r = race();
      const next = await Promise.all(r.lanes.map(async (l) => {
        const ev = await r.client.request({ t: 'session.step', id: l.sessionId, n, record: true }, 'events');
        const events = decodeEvents(ev.words);
        return { ...l, position: ev.position, current: events.at(-1) ?? l.current,
                 grids: await laneGrids(r.client, l.sessionId, l.config) };
      }));
      setLanes(next);
      return next.some((l) => l.position < r.trace.accesses);
    },

    /** Runs every configuration up to maxSteps further without per-access events (fast). */
    async raceRun(maxSteps) {
      const r = race();
      const next = await Promise.all(r.lanes.map(async (l) => {
        const st = await r.client.request({ t: 'session.run', id: l.sessionId, maxSteps, breakOn: [] }, 'stopped');
        const events = decodeEvents(st.words);
        return { ...l, position: st.position, current: events.at(-1) ?? null,
                 grids: await laneGrids(r.client, l.sessionId, l.config) };
      }));
      setLanes(next);
      return next.some((l) => l.position < r.trace.accesses);
    },

    /** Moves every configuration so that `position` accesses have executed. */
    async raceGoTo(position) {
      const r = race();
      const target = Math.max(0, Math.min(position, r.trace.accesses));
      if (target === 0) {
        await get().raceReset();
        return;
      }
      const next = await Promise.all(r.lanes.map(async (l) => {
        await r.client.request({ t: 'session.seek', id: l.sessionId, position: target - 1 }, 'ok');
        const ev = await r.client.request({ t: 'session.step', id: l.sessionId, n: 1, record: true }, 'events');
        return { ...l, position: ev.position, current: decodeEvents(ev.words).at(-1) ?? null,
                 grids: await laneGrids(r.client, l.sessionId, l.config) };
      }));
      setLanes(next);
    },

    async raceReset() {
      const r = race();
      const next = await Promise.all(r.lanes.map(async (l) => {
        await r.client.request({ t: 'session.reset', id: l.sessionId }, 'ok');
        return { ...l, position: 0, current: null, stats: null, grids: await laneGrids(r.client, l.sessionId, l.config) };
      }));
      setLanes(next);
    },

    /** Asks the engine for each configuration's report so far (the live scoreboard). */
    async raceStats() {
      const r = race();
      const stats = await Promise.all(r.lanes.map(async (l) => {
        if (l.position === 0) return null;
        const rep = await r.client.request({ t: 'session.report', id: l.sessionId, label: l.label, withReuse: false }, 'report');
        return parseReport(rep.json);
      }));
      const cur = get().race;
      if (cur !== r) return;
      setLanes(cur.lanes.map((l, i) => ({ ...l, stats: stats[i] ?? null })));
    },

    /**
     * Brings every configuration to the end of the trace and asks the engine for the comparison
     * (ccsim_compare_json / _csv), so deltas and winners are the engine's. Opens the results.
     */
    async finishRace() {
      const r = race();
      set({ compareBusy: { what: 'Finishing every run' }, compareError: null });
      try {
        await get().raceRun(0xffffffff);
        const ids = r.sessions.map((x) => x.sessionId);
        const labels = r.sessions.map((x) => x.label);
        const json = await r.client.request({ t: 'compare', ids, labels, format: 'json' }, 'compare');
        const csv = await r.client.request({ t: 'compare', ids, labels, format: 'csv' }, 'compare');
        set({ compare: { doc: parseComparison(json.json ?? ''), csv: csv.csv ?? '', trace: r.trace }, compareBusy: null });
        void get().raceStats();
        navigate('results');
      } catch (e) {
        set({ compareError: message(e), compareBusy: null });
      }
    },
  };
});

