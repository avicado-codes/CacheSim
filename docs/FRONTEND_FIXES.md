# Frontend fixes

Tracking list for reworking the frontend merged from PR #1 (`web/`, merge commit `af28f7b`, 2026-10-31).
The PR was written against the pre-2026-10-29 docs (offline, no build step, vanilla JS, NDJSON events with
`decompose` + `levels[]`). The docs then moved to the website + WebAssembly design, so most items below are
spec drift, not mistakes. The target is [docs/ARCHITECTURE.md](ARCHITECTURE.md) sections 4, 7, 8, 10, 15
and 16, and [docs/FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) section 7.

Line references are to `web/` as merged. Status: **Open**, **In progress**, **Fixed**. The rework is on branch
`feat/web-rework`; see [web/README.md](../web/README.md).

## How the review was done (2026-10-31)

- Read all five JS modules, the fixtures and the tests; skimmed `web/index.html`. CSS not reviewed line by line.
- Generated real engine output for Demo B (report + `ccsim.events/1` NDJSON) and for write-through,
  no-write-allocate (with and without L2), inclusive and exclusive variants, then ran the PR validator's
  invariant checks on them (ported to Python; the JS itself was not executed).
- **Not tested:** the PR's Node test scripts (no Node on the review machine) and the page in a browser.

## Blockers

| ID | Issue | Where | Fix | Status |
|---|---|---|---|---|
| FE-01 | No engine integration: no Web Worker, no WASM, no `protocol.ts`; all data comes from `fixtures.js` and "Run simulation" only shows an offline notice. Stack is vanilla JS globals, not React 18 + TypeScript + Vite + Zustand + ECharts. | whole of `web/` | Rebuild on the ARCHITECTURE 15 stack behind the worker protocol (ARCHITECTURE 8.2). | Fixed: rebuilt on React + TS + Vite + Zustand + ECharts behind `protocol.ts`, the worker and its client. Verified in headless Chromium with the Emscripten module: upload, run, analytics, live comparison and results, on the walkthrough trace and the 4 M-access standard trace. CI `web` job builds against the `wasm` job artefact. |
| FE-02 | Event schema mismatch: `validateEvent` requires `decompose` and `levels[]`; the engine emits `l1`, `l2` and an ordered `actions[]`, so every real event is rejected. In the browser, events arrive as a `Uint32Array` (`ccsim_api.h` layout), not NDJSON. | `js/parser.js:294-344` | Decode the binary event layout in the worker client; accept the real NDJSON shape for files. | Fixed: `src/engine/events.ts` decodes the binary layout; tested against engine output for 9 scenarios (`test/events.test.ts`). |
| FE-03 | The visualiser simulates the cache in JS: write hit → dirty (wrong under write-through, `:87`), write miss → dirty fill (`:106`), L2 fill → clean (`:157`), write-back target found by comparing the L1 tag with L2 tags in the *demand* set (`:122-133`; correct only because Demo B's line 0 has tag 0 at both levels). No write-back misses, back-invalidations, `move_out` or `victim_insert`. Breaks "the frontend never simulates". | `js/visualizer.js:33-167` | Pure replay of `actions[]`; after a seek, redraw from `slot_states` / `slot_tags`. | Fixed: the visualiser replays `actions[]` and draws the engine snapshot; highlights checked against the snapshot after every access (`test/visualizer.test.ts`). |
| FE-04 | The validator rejects valid engine output under contract extension 1.1: it checks `L2.accesses = L1.misses`, `memory.reads = bottom.misses`, `memory.writes = bottom.writebacks` (the v1 forms). Measured: write-through, no-write-allocate, and no-write-allocate without L2 are rejected; Demo B, inclusive and exclusive pass. | `js/parser.js:198`, `:221-229` | Use the ARCHITECTURE 5.4 general forms, or drop client-side invariant enforcement (the engine tests it). | Fixed: no client-side invariant enforcement; reports are only schema-checked. |

## Major

| ID | Issue | Where | Fix | Status |
|---|---|---|---|---|
| FE-05 | Demo B geometry and latencies hard-coded: grids fixed at 2×2 / 4×2 with `% sets` hiding mismatches; bit-field labels (`Tag [63:5]`); "HIT (1c)", "HIT (10c)", "READ (100c)"; "What to notice" notes keyed to cursor 3–6, so they appear on any trace. | `js/visualizer.js:77`, `:371-398`, `:445-447`, `:486`, `:239-247` | Derive everything from the run's config and geometry (`sets`, `index_bits`, `offset_bits`, latencies); key demo notes to the trace fingerprint. | Fixed: grids, bit fields and latencies from the run config; Demo B notes shown only for the Demo B workload with the Demo B config. |
| FE-06 | Honest-numbers violations: `null * 100 → 0` for miss rates, so an empty run shows 0% and can win; percent change reported as 100% when the baseline is 0; '0%' in chart tooltips with zero accesses; Demo C narrative falls back to literal 9 / 10; Demo A narrative fires for any run pair matching its pattern. | `js/comparison.js:79`, `:118-125`, `:171-176`, `:451-452`; `js/analytics.js:185-186` | `null` stays `null` → "n/a" everywhere; no invented fallbacks; narratives only for the matching demo trace. | Fixed: `null` → "n/a" throughout (`src/lib/format.ts`, `test/views.test.ts`); no invented fallbacks; ties reported as ties. |
| FE-07 | Comparison re-implemented in JS: no trace-fingerprint check (the `demoB_vs_demoA` preset compares two different traces, which ARCHITECTURE 10 forbids); own metric set ("L1 Accesses: higher is better", summed "Total Evictions"); CSV carries a timestamp but no configuration strings, so it is not reproducible. | `js/comparison.js:42-202`, `:346-376`, `:555-557` | Use `ccsim_compare_json` / `ccsim_compare_csv` and the benchmark log; refuse mismatched fingerprints. | Fixed: comparison via `ccsim_compare_json` / `ccsim_compare_csv` on one trace in one worker; the CSV and log carry configurations and the fingerprint. Worker path verified in headless Chromium (results report the same trace for every run). |
| FE-08 | XSS: strings from uploaded JSON / NDJSON go into `innerHTML` unescaped: `lvl.name`, `victim.reason`, `writeback.to`, run names. Conflicts with the strict CSP and the planned share links. | `js/analytics.js:192,210,429`; `js/visualizer.js:204,206,221,636`; `js/comparison.js:458` | Render text through text nodes / JSX; never build HTML from data. | Fixed: all text rendered through JSX; no `innerHTML`. |
| FE-09 | Config form: no write-policy, write-miss-policy or inclusion fields (contract 1.1); no validation (48 KiB, 8-way, 64 B lines gives 96 sets, shown as 7 index bits instead of an error); the CLI preview omits `--seed`; `ccsim simulate` is still Planned (exits 3). | `index.html` form; `js/app.js:233-293` | Full ARCHITECTURE 5.1 surface; validate live (`Hierarchy::check()` now, `validate()` when the config track ships it); include the seed. | Fixed: full 5.1 surface incl. write policy, write-miss policy, inclusion, seed; live validation (96 sets → error). CLI preview dropped (`ccsim simulate` is Planned). |
| FE-10 | State and errors: uploading a report keeps the previous run's events, so the visualiser and analytics disagree; `.trace` accepted but never handled; `.gz` not accepted; errors go only to the console (some to `alert()`). | `js/app.js:474`, `:503-545`; `js/comparison.js:604,617,696` | One store for the active run; trace upload through the worker (ARCHITECTURE 6) with `DecompressionStream`; inline errors. | Fixed: one store for the active run; traces (text, `.trace`, `.gz`) stream through the worker; errors inline. |
| FE-11 | Does not scale: every step replays from 0 and rebuilds the DOM (O(N²) per playback); the trace table renders every event. Fine for 10 accesses, unusable for the 4 M-access standard trace. | `js/visualizer.js:259-300`, `:617-695` | Engine-side stepping and seek; canvas grids; virtualised trace list (ARCHITECTURE 7.3, 7.4). | Fixed: engine-side stepping and seek, canvas grids with aggregation, trace list keeps the last 500 events. Verified in headless Chromium on the 4 M-access standard trace (run to the end, analytics, four-lane comparison). |

## Minor

| ID | Issue | Status |
|---|---|---|
| FE-12 | Tests are standalone Node scripts at the `web/` root with no `package.json`, runner or CI job, and they only check the fixtures against the PR's own validator (circular). Move to Vitest + Playwright (ARCHITECTURE 14) and test against engine-generated fixtures. | In progress: Vitest suites against engine-generated fixtures; CI `web` job. Playwright Planned. |
| FE-13 | Fixtures exist twice (`fixtures/*.json` and `fixtures/fixtures.js`); the app uses only the JS copy. Replace with one set generated by the engine. | Fixed: one fixture set in `web/test/fixtures/`, generated by `tests/tools/web_fixtures.cpp` and checked by ctest. |
| FE-14 | The AMAT is labelled "Estimated" though the engine value is exact. | Fixed: AMAT shown as the engine value. |
| FE-15 | Mutable global `window.CacheSimState` shared across modules. | Fixed: Zustand store; no globals. |

## Keep

- Demo B fixtures are correct: all 10 steps (outcome, way, victim way, latency) and the totals (AMAT 68.0,
  memory 6 reads / 1 write) match the engine exactly.
- Sample-data provenance banner (`_is_sample_data`) and "n/a" handling in the analytics tiles.
- Accessibility: WAI-ARIA tablist with keyboard navigation, a table behind every chart, mobile drawer.
- Narration copy that follows [docs/WORKING_DEMO.md](WORKING_DEMO.md).
- The CSS design tokens, view layouts and component styles.

## Rework plan

Steps 1–6 done on `feat/web-rework` except the parts marked Not tested or Planned above.

1. Toolchain: Node (pinned) + Vite + TypeScript + React; Vitest; CI `web` job (ARCHITECTURE 15).
2. Engine-generated fixtures for Demos A–C (report JSON + event NDJSON + binary event buffers).
3. `web/src/engine/`: `protocol.ts`, worker, binary event decoder, WASM loader (once the Emscripten build runs in CI).
4. Visualiser as a pure replay of `actions[]` + slot snapshots (FE-03, FE-05, FE-11).
5. Analytics and comparison read engine JSON only (FE-06, FE-07); config form covers 1.1 and validates (FE-09).
6. Port the kept CSS, layout, accessibility and narration; then delete the old `web/js/` modules.
