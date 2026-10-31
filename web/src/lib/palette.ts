// Chart colours, one validated categorical palette per theme, in fixed order (dataviz
// validate_palette.js: light against #ffffff, dark against #18241f; lightness band, chroma floor,
// adjacent CVD separation, normal-vision floor and 3:1 contrast all pass). Assign by entity,
// never by rank; a ninth series folds into small multiples instead of a generated hue.

export type Theme = 'light' | 'dark';

const LIGHT = ['#2a5bc4', '#c8102e', '#0b8aa5', '#b8740f', '#c2357a', '#e0603a', '#8a3fb5', '#1f8a4c'];
const DARK = ['#5a85e0', '#e8435f', '#1fa3bb', '#bd7f1a', '#d14b94', '#d76d33', '#9c68d4', '#36ad66'];

/** Slots available per chart; one colour per run in comparisons. */
export const SERIES_COUNT = LIGHT.length;

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export const seriesColor = (i: number, theme: Theme = currentTheme()): string =>
  (theme === 'dark' ? DARK : LIGHT)[i % SERIES_COUNT]!;

export interface Ink {
  primary: string;
  secondary: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  tooltip: string;
}

/** Text and chrome for charts: ink tokens, never series colours. Mirrors styles/app.css. */
export function ink(theme: Theme = currentTheme()): Ink {
  return theme === 'dark'
    ? { primary: '#eef2ec', secondary: '#c4cec7', muted: '#93a199', grid: '#2a3a33', axis: '#3d5048',
        surface: '#18241f', tooltip: '#0f1714' }
    : { primary: '#16181d', secondary: '#3b4149', muted: '#5f6670', grid: '#e4e7e2', axis: '#c4cac3',
        surface: '#ffffff', tooltip: '#ffffff' };
}
