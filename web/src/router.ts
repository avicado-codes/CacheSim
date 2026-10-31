// Hash routes, so the static build works from any path (Cloudflare Pages, GitHub Pages, a file
// server) without rewrite rules.

import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'learn' | 'simulate' | 'visualize' | 'analytics' | 'compare' | 'race' | 'results';

const PATHS: Record<Route, string> = {
  home: '#/',
  learn: '#/learn',
  simulate: '#/simulate',
  visualize: '#/visualize',
  analytics: '#/analytics',
  compare: '#/compare',
  race: '#/compare/live',
  results: '#/compare/results',
};

export const href = (r: Route): string => PATHS[r];

export function parse(hash: string): Route {
  const path = `#/${hash.replace(/^#\/?/, '').split('?')[0]!.replace(/\/+$/, '')}`;
  return (Object.keys(PATHS) as Route[]).find((r) => r !== 'home' && PATHS[r] === path) ?? 'home';
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parse(window.location.hash), () => 'home');
}

export function navigate(r: Route): void {
  if (parse(window.location.hash) === r && window.location.hash) return;
  window.location.hash = PATHS[r];
}
