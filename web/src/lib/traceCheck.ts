// Checks an uploaded trace the moment it is chosen: the file streams through the engine's own
// parser in a short-lived worker, which accepts it (access count, fingerprint) or rejects it
// with the first bad line. The page never parses a trace itself.

import { useEffect, useState } from 'react';
import { EngineClient } from '../engine/client';
import { uploadTrace, type TraceInfo } from '../engine/trace';

export type TraceCheck =
  | { status: 'none' }
  | { status: 'checking'; file: File; bytes: number }
  | { status: 'ok'; file: File; info: TraceInfo }
  | { status: 'rejected'; file: File; reason: string };

const NAME_OK = /\.(trace|trace\.gz|txt|gz)$/i;

/** Checks `file` with the engine; a newer file supersedes a check still running. */
export function useTraceCheck(file: File | null): TraceCheck {
  const [check, setCheck] = useState<TraceCheck>({ status: 'none' });
  useEffect(() => {
    if (!file) {
      setCheck({ status: 'none' });
      return;
    }
    if (!NAME_OK.test(file.name)) {
      setCheck({ status: 'rejected', file, reason: `${file.name} is not a .trace or .trace.gz file` });
      return;
    }
    let live = true;
    const client = new EngineClient();
    setCheck({ status: 'checking', file, bytes: 0 });
    uploadTrace(client, { kind: 'file', file }, (bytes) => { if (live) setCheck({ status: 'checking', file, bytes }); })
      .then((info) => {
        if (!live) return;
        setCheck(info.accesses === 0
          ? { status: 'rejected', file, reason: `${file.name} has no accesses: every line is blank or a comment` }
          : { status: 'ok', file, info });
      })
      .catch((e: unknown) => {
        if (live) setCheck({ status: 'rejected', file, reason: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => client.terminate());
    return () => {
      live = false;
      client.terminate();
    };
  }, [file]);
  return check;
}
