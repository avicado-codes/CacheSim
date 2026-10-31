// The one bar across the top: brand, the two reading pages and the simulator, the four-step
// simulation route with its locks, and the next step's button at the top right.

import logoUrl from '../assets/logo-96.png';
import { href, navigate, type Route } from '../router';
import { useApp } from '../store/useApp';
import { Icon } from './Icon';

type FlowRoute = 'simulate' | 'visualize' | 'analytics' | 'compare';

const FLOW: { id: FlowRoute; label: string }[] = [
  { id: 'simulate', label: 'Configure' },
  { id: 'visualize', label: 'Visualize' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'compare', label: 'Compare' },
];

/** The compare step has three pages: set-up, the live race and the results. */
const COMPARE_PAGES: Route[] = ['compare', 'race', 'results'];
const stepOf = (r: Route): FlowRoute | null => (COMPARE_PAGES.includes(r) ? 'compare' : FLOW.find((f) => f.id === r)?.id ?? null);

export const isFlow = (r: Route): boolean => stepOf(r) !== null;

/** The live race is over when every configuration has reached the last access. */
export function useRaceDone(): boolean {
  return useApp((s) => !!s.race && s.race.lanes.every((l) => l.position >= s.race!.trace.accesses));
}

/** Which steps of the route are open, from the active run's progress. */
export function useUnlocked(): Record<FlowRoute, boolean> {
  const run = useApp((s) => s.run);
  const reachedEnd = useApp((s) => s.reachedEnd);
  const analyticsReady = useApp((s) => s.analyticsReady);
  return { simulate: true, visualize: !!run, analytics: !!run && reachedEnd, compare: !!run && analyticsReady };
}

const LOCK_HINT: Record<FlowRoute, string> = {
  simulate: '',
  visualize: 'Run a simulation first',
  analytics: 'Play or finish the run to the last access',
  compare: 'Open the analytics of a finished run first',
};

export function TopBar({ route }: { route: Route }) {
  const unlocked = useUnlocked();
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const step = stepOf(route);
  const flow = step !== null;
  const at = FLOW.findIndex((f) => f.id === step);
  const next = flow && at >= 1 && at < FLOW.length - 1 ? FLOW[at + 1]! : null;
  const raceDone = useRaceDone();
  const compareBusy = useApp((s) => !!s.compareBusy);
  const finishRace = useApp((s) => s.finishRace);
  const hasResults = useApp((s) => !!s.compare);

  return (
    <header className={`topbar ${flow ? 'in-flow' : ''}`}>
      <a className="brand" href={href('home')} aria-label="ccsim home">
        <img className="brand-mark" src={logoUrl} width={40} height={40} alt="" />
        <span className="brand-name">ccsim</span>
      </a>
      <nav className="site-nav" aria-label="Site">
        <a href={href('home')} aria-current={route === 'home' ? 'page' : undefined}>Home</a>
        <a href={href('learn')} aria-current={route === 'learn' ? 'page' : undefined}>Learn caches</a>
        <a href={href('simulate')} aria-current={flow ? 'page' : undefined}>Simulator</a>
      </nav>

      {flow && (
        <ol className="route-strip" aria-label="Simulation steps">
          {FLOW.map((f, i) => {
            const open = unlocked[f.id];
            const here = f.id === step;
            return (
              <li key={f.id} className={`${here ? 'here' : ''} ${open ? 'open' : 'locked'} ${i < at ? 'done' : ''}`}>
                {open && (!here || route !== f.id) ? (
                  <a href={href(f.id)} aria-current={here ? 'step' : undefined}><span className="stop" aria-hidden>{i + 1}</span>{f.label}</a>
                ) : (
                  <span aria-current={here ? 'step' : undefined} title={open ? undefined : LOCK_HINT[f.id]}>
                    <span className="stop" aria-hidden>{open ? i + 1 : <Icon name="lock" size={12} />}</span>{f.label}
                    {!open && <span className="sr-only"> (locked: {LOCK_HINT[f.id]})</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="topbar-end">
        {route === 'race' && (
          <button type="button" className="btn next-btn" disabled={!raceDone || compareBusy}
                  onClick={() => (hasResults ? navigate('results') : void finishRace())}
                  title={raceDone ? undefined : 'Play every run to the last access, or press Finish all'}>
            {raceDone ? null : <Icon name="lock" size={14} />}
            {compareBusy ? 'Comparing…' : 'Results'}
            <Icon name="arrow" size={16} />
          </button>
        )}
        {next && (
          <button type="button" className="btn next-btn" disabled={!unlocked[next.id]} onClick={() => navigate(next.id)}
                  title={unlocked[next.id] ? undefined : LOCK_HINT[next.id]}>
            {unlocked[next.id] ? null : <Icon name="lock" size={14} />}
            {next.label}
            <Icon name="arrow" size={16} />
          </button>
        )}
        <button type="button" className="icon-btn ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}

export function Locked({ what, hint, action, to }: { what: string; hint: string; action: string; to: Route }) {
  return (
    <div className="locked-page">
      <Icon name="lock" size={28} />
      <h1>{what} is not open yet</h1>
      <p>{hint}</p>
      <a className="btn btn-primary" href={href(to)}>{action}</a>
    </div>
  );
}
