// App shell: one top bar, then the page for the current hash route. Pages that pull in ECharts
// or the long Learn article load on first use, so Home paints fast.

import { lazy, Suspense, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { HomePage } from './pages/HomePage';
import { useRoute, type Route } from './router';

const LearnPage = lazy(() => import('./pages/LearnPage').then((m) => ({ default: m.LearnPage })));
const ConfigurePage = lazy(() => import('./pages/ConfigurePage').then((m) => ({ default: m.ConfigurePage })));
const VisualizePage = lazy(() => import('./pages/VisualizePage').then((m) => ({ default: m.VisualizePage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const ResultsPage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ResultsPage })));
const RacePage = lazy(() => import('./pages/RacePage').then((m) => ({ default: m.RacePage })));

const TITLES: Record<Route, string> = {
  home: 'ccsim · watch a CPU cache sort your memory accesses',
  learn: 'ccsim · how CPU caches work',
  simulate: 'ccsim · configure a simulation',
  visualize: 'ccsim · cache visualizer',
  analytics: 'ccsim · analytics',
  compare: 'ccsim · compare configurations',
  race: 'ccsim · configurations side by side, live',
  results: 'ccsim · comparison results',
};

function Page({ route }: { route: Route }) {
  switch (route) {
    case 'home': return <HomePage />;
    case 'learn': return <LearnPage />;
    case 'simulate': return <ConfigurePage />;
    case 'visualize': return <VisualizePage />;
    case 'analytics': return <AnalyticsPage />;
    case 'compare': return <ComparePage />;
    case 'race': return <RacePage />;
    case 'results': return <ResultsPage />;
  }
}

export function App() {
  const route = useRoute();

  useEffect(() => {
    document.title = TITLES[route];
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [route]);

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <TopBar route={route} />
      <main id="main" tabIndex={-1} className={`page page-${route}`}>
        <Suspense fallback={<div className="page-loading" aria-busy="true">Loading…</div>}>
          <Page route={route} />
        </Suspense>
      </main>
    </>
  );
}
