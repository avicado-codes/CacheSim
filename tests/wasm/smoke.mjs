// tests/wasm/smoke.mjs: loads the Emscripten build of the C ABI in Node and checks it
// end to end on Demo B (docs/WORKING_DEMO.md section 2). The native suite already proves
// the ABI logic (tests/unit/test_compare_api.cpp); this proves the *browser artefact*:
// exports, BigInt marshalling, heap views and the policy wiring in wasm_main.cpp.
//
// Usage: node tests/wasm/smoke.mjs <path/to/ccsim.mjs>
// Exit: 0 pass, 1 fail, 77 skipped (same convention as the native suites). Session checks
// need the production policies (src/policy/, merged); a build without them reports SKIPPED,
// which CI treats as a failure.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const modulePath = process.argv[2];
if (!modulePath) {
    console.error('usage: node tests/wasm/smoke.mjs <path/to/ccsim.mjs>');
    process.exit(2);
}

let failures = 0;
const check = (cond, what) => {
    if (!cond) {
        failures += 1;
        console.error(`FAILED: ${what}`);
    }
};

const createModule = (await import(pathToFileURL(resolve(modulePath)).href)).default;
const M = await createModule();

const CONFIG_WORDS = 19;
const HEADER_WORDS = 20;
const ACTION_WORDS = 5;

const cstr = (s) => {
    const n = M.lengthBytesUTF8(s) + 1;
    const p = M._ccsim_alloc(n);
    M.stringToUTF8(s, p, n);
    return p;
};
const lastError = () => M.UTF8ToString(M._ccsim_last_error());

check(M._ccsim_api_version() === 1, 'api version is 1');

// Trace upload in two chunks split mid-token, exactly as the worker streams a File.
const name = cstr('demo_b.trace');
const trace = M._ccsim_trace_begin(name, 0n);
check(trace > 0, `trace_begin (${lastError()})`);
for (const chunk of ['R 0x000\nW 0x008\nR 0x0',
                     '40\nR 0x080\nR 0x000\nW 0x0C0\nR 0x100\nR 0x010\nR 0x018\nR 0x0C4']) {
    const bytes = new TextEncoder().encode(chunk);
    const p = M._ccsim_alloc(bytes.length);
    M.HEAPU8.set(bytes, p);
    check(M._ccsim_trace_feed(trace, p, bytes.length) === 0, `trace_feed (${lastError()})`);
    M._ccsim_free(p);
}
check(M._ccsim_trace_end(trace) === 0, `trace_end (${lastError()})`);
check(M._ccsim_trace_size(trace) === 10n, 'trace has 10 accesses (uint64 crosses as BigInt)');

// Parse errors must surface with the source name and line number.
const bad = M._ccsim_trace_begin(cstr('bad.trace'), 0n);
const badText = M._ccsim_alloc(16);
M.stringToUTF8('R 0x0\nX 0x1\n', badText, 16);
check(M._ccsim_trace_feed(bad, badText, 12) !== 0, 'malformed trace is rejected');
check(lastError().startsWith('bad.trace:2:'), `parse error names file and line (${lastError()})`);

// Demo B configuration: L1 64 B / 16 B lines / 2-way / 1 cycle, L2 128 B / 2-way / 10, memory 100.
const cfg = M._ccsim_alloc(CONFIG_WORDS * 8);
new BigUint64Array(M.HEAPU8.buffer, cfg, CONFIG_WORDS)
    .set([1n, 64n, 16n, 2n, 1n, 0n, 0n, 0n, 1n, 128n, 16n, 2n, 10n, 0n, 0n, 0n, 100n, 0n, 1n]);
const session = M._ccsim_session_create(trace, cfg, CONFIG_WORDS, 0);

let skipped = false;
if (session === 0 && lastError().includes('no replacement policies')) {
    skipped = true;
    console.log('SKIPPED session checks: no production policies linked into this build');
} else {
    check(session > 0, `session_create (${lastError()})`);
    check(M._ccsim_session_step(session, 4, 1) === 4, 'step 4 recorded');
    // Views are taken after the call: memory growth replaces the buffer.
    const words = M._ccsim_event_buffer_words();
    const buf = new Uint32Array(M.HEAPU8.buffer, M._ccsim_event_buffer(), words);
    let off = 0, last = 0;
    while (off < words) {
        last = off;
        off += HEADER_WORDS + buf[off + 19] * ACTION_WORDS;
    }
    check(off === words, 'event buffer decodes exactly');
    check(buf[last + 3] === 0x80, 'event 4 address 0x80');
    check(buf[last + 18] === 111, 'event 4 latency 111 (hand-derived, WORKING_DEMO step 4)');
    check(M._ccsim_session_run(session, 1000, 0, 0n) === 2, 'run to end');
    const json = M.UTF8ToString(M._ccsim_session_report_json(session, cstr('demo-b'), 1));
    check(json.includes('"amat_cycles":68.0'), 'AMAT 68.0 (hand-derived)');
    check(M._ccsim_session_seek(session, 2n) === 0 && M._ccsim_session_position(session) === 2n,
          'seek back to 2');
    M._ccsim_session_release(session);
}
check(M._ccsim_session_step(999, 1, 0) === -1 && lastError().includes('invalid handle'),
      'bad handle reports an error instead of trapping');
M._ccsim_trace_release(trace);

if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
}
console.log(skipped ? 'wasm smoke: PASSED (ABI + trace), session checks SKIPPED' : 'wasm smoke: PASSED');
process.exit(skipped ? 77 : 0);
