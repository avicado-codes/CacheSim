// An autoplaying replay (the Home hero and "Watch it sort") opens on the first access of the
// engine's recording, so a visitor never lands on an empty "waiting" case. Replays that do not
// autoplay (Learn) still start empty or wherever `start` puts them. Rendered to static markup
// with the real component: this is exactly the first paint, before any timer has run.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Replay } from '../src/components/Replay';
import { toRecording, type RecordingJson } from '../src/recordings';
import demoBJson from './fixtures/demo_b.json';

const demoB = toRecording(demoBJson as unknown as RecordingJson);
const n = demoB.events.length;

const render = (props: { autoplay?: boolean; start?: number }) =>
  renderToStaticMarkup(createElement(Replay, { rec: demoB, label: 'replay', ...props }));

describe('replay first paint', () => {
  it('an autoplaying replay shows the first access straight away', () => {
    const html = render({ autoplay: true });
    expect(html).not.toContain('Waiting for the first access');
    expect(html).toContain(`Access 1 of ${n}`);
    expect(html).toContain(`1 / ${n}`);
    // Demo B's first access is R 0x000: a compulsory miss whose line drops into L1.
    expect(html).toContain('0x0');
    expect(html).toContain('envelope');
  });

  it('a replay that does not autoplay still opens empty', () => {
    const html = render({});
    expect(html).toContain('Waiting for the first access');
    expect(html).toContain(`0 / ${n}`);
  });

  it('an explicit start wins over autoplay', () => {
    expect(render({ autoplay: true, start: n })).toContain(`${n} / ${n}`);
  });
});
