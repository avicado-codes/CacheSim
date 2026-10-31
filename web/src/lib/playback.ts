// Playback speeds shared by the visualizer and the side-by-side comparison.

export interface Speed {
  id: string;
  label: string;
  perSecond?: number;  // animated: one access every 1/perSecond s
  perFrame?: number;   // fast: k accesses per animation frame
  turbo?: boolean;     // run() without events, many accesses per frame
}

export const SPEEDS: Speed[] = [
  { id: 'a1', label: '1 access / s', perSecond: 1 },
  { id: 'a2', label: '2 accesses / s', perSecond: 2 },
  { id: 'a5', label: '5 accesses / s', perSecond: 5 },
  { id: 'f60', label: '60 / s', perFrame: 1 },
  { id: 'f600', label: '600 / s', perFrame: 10 },
  { id: 'f6000', label: '6,000 / s', perFrame: 100 },
  { id: 'turbo', label: 'Turbo (no per-access detail)', turbo: true },
];
