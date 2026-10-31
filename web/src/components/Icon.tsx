// One authored icon set: 24px grid, 2px round strokes, currentColor. Decorative unless labelled.

type Name =
  | 'play' | 'pause' | 'step' | 'back' | 'reset' | 'end' | 'download' | 'upload' | 'arrow' | 'lock'
  | 'sun' | 'moon' | 'check' | 'alert' | 'x' | 'plus' | 'file' | 'copy';

const PATHS: Record<Name, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  step: 'M6 5l9 7-9 7zM18 5v14',
  back: 'M18 5l-9 7 9 7zM6 5v14',
  reset: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5',
  end: 'M5 5l7 7-7 7M12 5l7 7-7 7',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  copy: 'M9 9h11v11H9zM5 15V4h11',
};

const FILLED = new Set<Name>(['play', 'step', 'back']);

export function Icon({ name, label, size = 18 }: { name: Name; label?: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill={FILLED.has(name) ? 'currentColor' : 'none'}
         stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
         role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name]} />
    </svg>
  );
}
