// A round postmark carrying an outcome and the access number. The word is always printed, so
// the stamp's ink colour never carries the meaning alone.

export type StampKind = 'hit' | 'miss' | 'evict' | 'fill' | 'writeback' | 'around';

const WORD: Record<StampKind, string> = {
  hit: 'HIT',
  miss: 'MISS',
  evict: 'EVICT',
  fill: 'FILED',
  writeback: 'FWD',
  around: 'AROUND',
};

export function Postmark({ kind, n, size = 56, still = false }: { kind: StampKind; n?: number; size?: number; still?: boolean }) {
  const word = WORD[kind];
  return (
    <svg className={`postmark pm-${kind} ${still ? 'still' : ''}`} width={size} height={size} viewBox="0 0 64 64"
         role="img" aria-label={`${word}${n !== undefined ? `, access ${n}` : ''}`}>
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.5" />
      <text x="32" y={n !== undefined ? 31 : 37} textAnchor="middle" className="pm-word"
            fontSize={word.length > 4 ? 10.5 : 14}>{word}</text>
      {n !== undefined && <text x="32" y="45" textAnchor="middle" className="pm-num" fontSize="10">#{n}</text>}
    </svg>
  );
}
