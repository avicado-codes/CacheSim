// Formatting only. A value the engine reports as null (zero denominator) is shown as "n/a",
// never as 0 (ARCHITECTURE section 9, FRONTEND_DESIGN FE-3).

import type { Rate } from '../engine/report';

export const NA = 'n/a';

const isNum = (v: Rate | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export const fmtInt = (v: Rate | undefined): string => (isNum(v) ? Math.round(v).toLocaleString('en-US') : NA);

export const fmtPercent = (v: Rate | undefined, digits = 2): string =>
  isNum(v) ? `${(v * 100).toFixed(digits)}%` : NA;

export const fmtFixed = (v: Rate | undefined, digits = 2): string => (isNum(v) ? v.toFixed(digits) : NA);

export const fmtCycles = (v: Rate | undefined): string => (isNum(v) ? `${v.toFixed(2)} cycles` : NA);

export function fmtBytes(v: Rate | undefined): string {
  if (!isNum(v)) return NA;
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let x = v;
  let u = 0;
  while (x >= 1024 && u < units.length - 1 && x % 1024 === 0) {
    x /= 1024;
    u++;
  }
  return `${x.toLocaleString('en-US')} ${units[u]}`;
}

export const fmtHex = (v: bigint): string => `0x${v.toString(16)}`;

/** Signed relative change, e.g. "-66.01%"; n/a when the engine has none. */
export const fmtDeltaRel = (v: Rate | undefined): string =>
  isNum(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%` : NA;

/** Value of a comparison metric in its unit. */
export function fmtMetric(v: Rate | undefined, unit: string): string {
  if (!isNum(v)) return NA;
  switch (unit) {
    case 'ratio':
      return fmtPercent(v);
    case 'cycles':
      return Number.isInteger(v) ? fmtInt(v) : v.toFixed(2);
    case 'x':
      return `${v.toFixed(2)}×`;
    case 'bytes':
      return v.toFixed(2);
    default:
      return Number.isInteger(v) ? fmtInt(v) : v.toFixed(2);
  }
}

/** Ratio of two engine counters for display; null (n/a) when the denominator is 0. */
export const ratio = (num: number, den: number): Rate => (den > 0 ? num / den : null);
