# Frontend Design

**Implemented** in `web/` (see [web/README.md](../web/README.md)). This document specifies the `ccsim` web frontend (`web/`): what it looks like and how it is laid out. **How it talks to the engine is defined in [ARCHITECTURE.md sections 4, 7 and 8](ARCHITECTURE.md#4-the-api-decision-webassembly-in-a-web-worker-not-fastapi)**: the site is deployed publicly, and the C++ engine runs inside the visitor's browser as WebAssembly in a Web Worker. The engine side (events, analytics, comparison, C ABI) and the UI are Implemented and tested. Where the shipped UI differs from this brief (for example, L1 is always drawn as the sorting case and L2 as the canvas grid), [ARCHITECTURE.md section 7.3](ARCHITECTURE.md#73-what-the-visualiser-shows-ui-contract) wins.

The four screenshots under [`assets/images/`](../assets/images) are **visual references** for look and feel — layout density, dark theme, component style — taken from existing dashboards and one cache simulator. They are mood boards, not the target product; the content in every view is `ccsim`'s own data. Each view below names the reference it adapts.

## 1. Design principles

These follow directly from the architecture rules in [TECHNICAL_DESIGN.md section 2](TECHNICAL_DESIGN.md#2-architecture); the frontend inherits them rather than inventing its own.

1. **The frontend never simulates.** It decodes no address, decides no hit, and chooses no victim. The engine (`ccsim_core`, Role 2) is the single source of truth; the UI renders the data the engine emits and nothing more. A hit shown on screen is a hit the engine reported. This is the AC-11 equality in [WORKING_DEMO.md section 4](WORKING_DEMO.md#4-interactive-cache-debugger-demo).
2. **Client-side compute.** The site is static files on a CDN. All simulation happens in a Web Worker running `ccsim.wasm`. Traces never leave the user's machine, and no server is involved in a run (ARCHITECTURE.md section 4).
3. **Honest reporting.** Anything the engine marks unavailable (`null`, `n/a`) is shown as such, never as `0` and never silently hidden.
4. **Deterministic in, deterministic out.** The same result file renders identically every time and on every browser; the UI adds no randomness of its own.
5. **Accessible and themeable.** Keyboard-operable controls, labelled state (never color alone), a data-table view behind every chart, and a selected dark theme — not an automatic invert.

## 2. Information architecture

A single-page app with four views reachable from a left rail, mirroring the four features. The rail and top bar style follow the **simulator.png** (ESP‑DASH) and **performance_analytics.png** (Nuxt Charts) references.

```mermaid
flowchart LR
    subgraph Shell["ccsim web (web/, Role 5)"]
        NAV["Left rail + top bar"]
        V1["1 · Simulator<br/>configure & run"]
        V2["2 · Cache visualizer<br/>step through access events"]
        V3["3 · Performance analytics<br/>rates, traffic, AMAT"]
        V4["4 · Experiment comparison<br/>policies & configs side by side"]
    end
    NAV --> V1 --> V2
    V1 --> V3
    V1 --> V4
```

A **run** is the shared object all four views revolve around: one `HierarchyConfig` plus one trace, producing one result document and (optionally) one event stream. Views 2–4 are empty until at least one run exists; view 4 holds several runs at once.

## 3. View 1 — Simulator (configure and run)

![Simulator configuration reference](../assets/images/simulator.png)

*Reference: ESP‑DASH settings — labelled sliders, numeric fields, an upload tile, and a primary action button, in cards on a dark surface.*

**Purpose.** Let the user define the hierarchy and workload, then run the simulation. This view is the UI form over the CLI contract: every control maps to a field of `HierarchyConfig`/`CacheConfig` or a `simulate` option ([TECHNICAL_DESIGN.md sections 9–10](TECHNICAL_DESIGN.md#9-module-interfaces)).

**Layout.** Two cards, **L1** and **L2** (L2 has an enable/disable toggle, matching "optional L2"), plus a hierarchy card and a workload card.

| Control | Maps to | Rules the UI enforces client-side (the engine re-validates) |
|---|---|---|
| Capacity (`size`, with KiB/MiB) | `CacheConfig.size_bytes` | divisible by `line × ways` ([section 3](TECHNICAL_DESIGN.md#3-cache-configuration)) |
| Line size (`line`) | `CacheConfig.line_bytes` | power of two; L1 and L2 equal in v1 |
| Associativity (`ways`) | `CacheConfig.ways` | ≥ 1; `size/line` = fully associative |
| Policy | `CacheConfig.policy` | `lru` \| `fifo` \| `random` |
| Hit latency | `CacheConfig.hit_latency_cycles` | ≥ 1 |
| Memory latency | `HierarchyConfig.memory_latency_cycles` | ≥ 1 |
| Seed | `HierarchyConfig.seed` | 64-bit; only meaningful for Random |
| Write policy (per level) | `CacheConfig.write_policy` | `write_back` \| `write_through` |
| Write-miss policy (per level) | `CacheConfig.write_miss_policy` | `write_allocate` \| `no_write_allocate` |
| Inclusion (hierarchy, L2 only) | `HierarchyConfig.inclusion` | `non_inclusive` \| `inclusive` \| `exclusive` |

The derived **set count** (`size / (line × ways)`) is shown live so the user sees the organisation the engine will build, and the address-split preview (tag/index/offset widths) updates with it — the same decomposition view 2 uses, computed from config, not simulated.

**Workload.** A trace is either **uploaded** (`.trace` or `.trace.gz`, format v1, [section 7](TECHNICAL_DESIGN.md#7-trace-format-v1); streamed through `DecompressionStream` into the worker with a progress bar, ARCHITECTURE.md section 6), picked from the **standard dataset** (`matmul64-O0`), or **generated** from the synthetic generator's patterns — sequential, strided, random, loop (Role 8, issue M2‑13). Parse errors from a bad upload surface as `<file>:<line>: <message>`, exactly as the backend reports them, with no result rendered.

**Run.** The primary button produces a run (section 7 describes the two transports that back it) and routes the user to the cache visualizer, with analytics and comparison now populated.

**Validation defaults.** The form seeds the teaching defaults from [section 3](TECHNICAL_DESIGN.md#3-cache-configuration) (L1 32 KiB/64 B/8‑way/LRU/4, L2 256 KiB/.../12, memory 200) so a first run works with no input.

## 4. View 2 — Cache visualizer (step through access events)

![Cache visualizer reference](../assets/images/cache_visualizer.png)

*Reference: a CPU & Cache simulator — a load panel, step/previous/jump-to-end/reset controls, per-line cards showing Valid/Tag/Index/Words/Current-Access, a running stats sidebar, and an execution trace list. This is the closest reference to the real target.*

**Purpose.** This is the interactive cache debugger of [TECHNICAL_DESIGN.md section 12](TECHNICAL_DESIGN.md#12-visualization-architecture): it renders the engine's `ccsim.events/1` stream one access at a time. The four surfaces from section 12.2 map onto this layout:

- **Set/way grid** (center) — one row per set, one cell per way, for L1 and, when present, L2. Each cell shows line state (invalid / valid‑clean / valid‑dirty) and tag, with transient highlights for *just filled*, *just hit*, and *just evicted*. These are the "Cache Line" cards in the reference, generalised to a set×way grid.
- **Address inspector** (top) — splits the current access into tag, set index, and block offset using the configured widths ([section 4](TECHNICAL_DESIGN.md#4-address-mapping)) and highlights the selected set. This is the reference's `Tag [31:10] / Index [9:4] / Offset` readout.
- **Hierarchy path** (top/side) — L1 → L2 → RAM, lighting only the levels consulted for this access, with a dirty write-back drawn as a separate downward arrow ([section 5.2](TECHNICAL_DESIGN.md#52-l1l2-hierarchy)).
- **Decision panel** (side) — the per-access outcome in words: hit/miss per level, the chosen way (invalid-first or the policy's victim), eviction and write-back, and the policy's reason for the victim. Mirrors the reference's "Current Access / Operation" block and the "What to notice" narration in [Demo B](WORKING_DEMO.md#demo-b-two-level-walkthrough).

**Playback controls** (section 12.4): **Next/Step**, **Previous**, **Play**, **Pause**, **Jump to End**, **Reset**. The reference's "Step → / ← Previous / Jump to End / Reset" and "Total Steps / Current" counter are exactly this. Stepping backward is replay-from-start to the target `seq`, because cache state is not reversible.

**Execution trace** (bottom) — the scrollable access list with the current access highlighted, clickable to jump the cursor to any `seq`. This is the reference's "Execution Trace" panel.

The visualizer holds the event list and a cursor and never re-runs the engine to move within a loaded stream. Changing config or policy starts a new run (back through view 1 or the compare action), which produces a fresh stream.

## 5. View 3 — Performance analytics

![Performance analytics reference](../assets/images/performance_analytics.png)

*Reference: Nuxt Charts — a KPI stat-tile row over a grid of chart cards on a dark surface.*

**Purpose.** Summarise one completed run: hit/miss rates, memory traffic, eviction counts, and estimated AMAT, all read from the `ccsim.simulation/1` result ([sections 6 and 11](TECHNICAL_DESIGN.md#6-statistics-and-amat)). No value here is recomputed from the trace; the UI formats what the result already contains.

Chart choices follow the `dataviz` method (form first, then color, then validate):

- **KPI stat tiles** (top row, hero numbers — *not* charts): L1 miss rate, L2 local/global miss rate, AMAT (cycles), total memory traffic. A tile with no denominator shows `n/a`, never `0` ([section 6](TECHNICAL_DESIGN.md#6-statistics-and-amat)).
- **Per-level breakdown** — a grouped bar per level (L1, L2) of hits vs misses, read vs write. Hit and miss are a two-state distinction: encode them with a fixed categorical pair **plus a label and icon**, not red/green alone, so they survive color-vision deficiency and print. A legend is always present; the data-table view sits behind the chart.
- **AMAT contribution** — a single stacked bar decomposing total latency into L1, L2-hit, and memory components, matching the additive model in [section 6](TECHNICAL_DESIGN.md#6-statistics-and-amat). This makes "where the cycles go" legible without a second y-axis.
- **Access timeline** (optional, when an event stream is loaded) — cumulative hits/misses over `seq`, a line/area chart with a crosshair tooltip, letting a user see the working set warming up.

**One axis, always.** Miss rate (a ratio) and AMAT (cycles) are never plotted on one chart with two scales — they are separate tiles/charts. Every chart ships with a hover tooltip and a table view; the implementer runs `scripts/validate_palette.js` on the chosen palette before shipping (see the `dataviz` skill's `references/palette.md`).

## 6. View 4 — Experiment comparison

![Experiment comparison reference](../assets/images/experiment_comparison.png)

*Reference: "Model Benchmark Results" — grouped, color-coded bars with a per-entity legend, top-N callouts, hover-to-highlight, and a normalization note. The structure maps directly onto comparing cache experiments.*

**Purpose.** Run the **same trace** under varied configuration — LRU vs FIFO vs Random, or swept cache size / associativity / workload — and compare the outcomes, then export. Each experiment is a run; the view holds a set of runs and lines them up.

**Layout and encoding** (per `dataviz`):

- **Grouped bars**, grouped by metric (miss rate, AMAT, evictions, memory traffic) with one bar per experiment, or grouped by experiment with one bar per metric — the user toggles the grouping. **Color follows the experiment** (the entity), assigned in fixed categorical order and never cycled; changing which experiments are shown must not repaint the survivors.
- A **legend is always present**; the top result per metric is direct-labeled (the reference's medal callouts), the rest on hover.
- Because metrics have different units, **each metric is its own chart or panel** (ratios with ratios, cycles with cycles) — never one axis spanning miss rate and AMAT. A normalization note, like the reference's footer, states any 0–100 scaling if a combined view is offered.
- **Export**: the comparison table as CSV and the current chart as a self-contained SVG/PNG, plus a copyable list of the exact `ccsim` invocations that produced each run, so a result is reproducible from the doc.

A comparison needs no new engine capability: it is several `simulate` runs over one trace, each yielding a `ccsim.simulation/1` document, aggregated in the browser.

## 7. Frontend ↔ engine contract (the API)

This section was rewritten on 2026-10-29. The earlier plan (an offline file picker, later a localhost `ccsim serve`) is **superseded**, because the product is a deployed website. The contract is now:

- **Transport:** a typed `postMessage` protocol between the UI thread and an engine Web Worker. Message types are defined in [ARCHITECTURE.md section 8.2](ARCHITECTURE.md#82-worker-protocol-ui--worker) and will live in `web/src/engine/protocol.ts`. UI code imports only that module; it never touches WASM memory.
- **Payloads:** reports are `ccsim.simulation/1` JSON, comparisons are `ccsim.comparison/1` JSON or CSV, and live events are a transferred `Uint32Array` in the ABI layout of `include/ccsim/wasm/ccsim_api.h` (20 header words plus 5 per action). A decoder in `web/src/engine/events.ts` turns them into typed objects. A real sample report is [`tests/results/standard_dataset_default_run.json`](../tests/results/standard_dataset_default_run.json), so build against it.
- **Sessions:** one worker per configuration, so a comparison of N configs runs on N cores in parallel.
- **No server** is involved in simulation. A future share-link service would store only configs and reports (ARCHITECTURE.md section 4.5).

## 8. Application state and data flow

```mermaid
flowchart LR
    CFG["Config form + trace file<br/>(View 1)"] -->|"trace.chunk × N, session.create"| W["Engine worker<br/>ccsim.wasm"]
    W -->|"events (Uint32Array)"| VIZ["View 2 visualiser<br/>cursor + canvas grids"]
    W -->|"report JSON"| AN["View 3 analytics"]
    W -->|"compare JSON / CSV"| CMP["View 4 comparison"]
    VIZ -->|"step / run / seek / reset"| W
```

- A **run** = `{ config, traceFingerprint, sessionId, report? }`. The store (Zustand) keeps the active run for views 2 and 3 and a set of runs for view 4.
- **The visualiser is driven, not replayed:** Play requests `session.step` batches once per animation frame, pipelined one batch ahead; Step requests 1; scrubbing sends `session.seek` and then redraws the grid from `session.grid`. Speed modes and the playback state machine are in [ARCHITECTURE.md section 7.4](ARCHITECTURE.md#74-playback-model).
- No derived cache fact is stored unless the engine emitted it. If a number isn't in the schema, the UI doesn't show it (or shows `n/a`).

## 9. Technology and constraints

- **Stack:** React 18 + TypeScript + Vite; state in Zustand; charts in Apache ECharts (canvas rendering for large heatmaps and long series); set/way grids drawn on `<canvas>` (an L2 can have 32,768 cells). Testing: Vitest (Playwright end-to-end Planned).
- **Deployment:** static build on Cloudflare Pages (GitHub Pages as fallback), with `.wasm` served as `application/wasm` and hashed immutable assets (ARCHITECTURE.md section 15).
- **Charts** follow the `dataviz` method (form → colour → validate → marks → hover → accessibility): a legend whenever there are two or more series, a table view behind every chart, and no second y-axis.
- **Browsers:** current Chrome, Firefox, Edge and Safari (all support WebAssembly, BigInt, Web Workers and `DecompressionStream`).
- **Accessibility:** keyboard-operable playback, focus-visible controls, state conveyed by text or icon as well as colour, and `prefers-reduced-motion` honoured for transient highlights.

## 10. Acceptance criteria and ownership

Owner: **Role 5** ([CONTRIBUTING.md](../CONTRIBUTING.md#role-5-frontend--visualization)). Depends on the schema v1 and sample files (Role 6, M1) and the event stream (Role 2, section 12). The frontend-specific criteria:

1. **FE‑1** A full run (upload, simulate, analyse, compare) makes no network request after the site has loaded. All compute happens in the engine worker.
2. **FE‑2** The cache visualizer's on-screen state equals the engine events at every step, and its final grid/counters equal the `ccsim.simulation/1` result for the golden traces — the UI runs no cache logic of its own (this is **AC‑11**, [WORKING_DEMO.md section 6](WORKING_DEMO.md#6-acceptance-criteria)).
3. **FE‑3** Unavailable values render as `n/a`/`null` with the reason, never as `0`.
4. **FE‑4** Every chart has a legend (≥ 2 series), a hover tooltip, and a data-table view; the palette passes the `dataviz` validator in light and dark modes.
5. **FE‑5** Comparison export reproduces each run's exact `ccsim` invocation alongside the numbers.

**Decided (2026-10-29):** the interactive debugger is in v1, and the engine runs client-side as WebAssembly (ARCHITECTURE.md section 4). Remaining open items are in [ARCHITECTURE.md section 17](ARCHITECTURE.md#17-roadmap-and-open-decisions).

## 11. References

- Visualization architecture and event stream: [TECHNICAL_DESIGN.md section 12](TECHNICAL_DESIGN.md#12-visualization-architecture)
- Results schema v1, CLI contract, address mapping, statistics/AMAT: [TECHNICAL_DESIGN.md sections 4, 6, 10, 11](TECHNICAL_DESIGN.md#4-address-mapping)
- Debugger walkthrough and acceptance: [WORKING_DEMO.md section 4](WORKING_DEMO.md#4-interactive-cache-debugger-demo) and [AC‑11](WORKING_DEMO.md#6-acceptance-criteria)
- Role 5 scope and acceptance: [CONTRIBUTING.md](../CONTRIBUTING.md#role-5-frontend--visualization)
- Chart method: the `dataviz` skill (`references/choosing-a-form.md`, `color-formula.md`, `palette.md`, `scripts/validate_palette.js`)
