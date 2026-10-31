# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Students** learning how CPU caches work, usually in a computer architecture course. They configure
  a hierarchy, step through a trace one access at a time, and check their understanding of hits, misses,
  evictions, write-backs and inclusion against what the engine reports.
- **Instructors** who demo cache behaviour live in class and set exercises around the worked examples
  (Demos A–C) or their own traces.
- **Engineers** who simulate their own program traces and draw design decisions from the results: which
  cache size, associativity, policy, write or inclusion policy is worth it, judged by AMAT, miss rates,
  memory traffic, 3C breakdown, miss-ratio curves and side-by-side comparisons.

All use the same site; there are no accounts or roles.

## Product Purpose

ccsim is a website that shows exactly how a CPU cache hierarchy (L1, optional L2, memory) handles every
access of a memory trace: configure → upload trace → watch it live (play, step, seek) → analyse
(AMAT, 3C, reuse, heatmaps) → compare configurations.

It is a course/team project built by a small team: the simulation track (repository owner), the
configuration track (replacement policies, validation) and a frontend contributor. Success is a working,
correct, deployed site that can be demonstrated and graded, whose every number matches the hand-derived
examples in `docs/WORKING_DEMO.md`.

## Positioning

- The C++ engine runs in the visitor's browser as WebAssembly in a Web Worker. Traces never leave the
  machine, and no server is involved in a run.
- **The frontend never simulates.** Every hit, victim, latency and grid state on screen is one the engine
  reported, in the engine's own order of actions; the UI decodes and draws, it decides nothing.
- Results are deterministic and reproducible: the same configuration and trace give bit-identical results
  on every run and browser (seeded Random policy included).
- Correctness is checked against independent, hand-derived examples, not the program's own output.

## Operating Context

- A student working alone at a laptop, stepping through a small demo trace with the narration, or
  uploading a trace from an assignment (`.trace`, `.trace.gz`).
- An instructor presenting in a lecture: running Demo B step by step, then comparing configurations
  (direct-mapped vs 2-way, FIFO with 3 vs 4 lines) side by side.
- An engineer uploading a trace captured from their own program, running it to the end, exporting the
  analytics, then comparing candidate configurations on the same trace to justify a choice.
- Larger runs on the shared standard dataset (`matmul64-O0`, about 4 M accesses) for analytics and
  comparison, where stepping gives way to run-to-end and charts.

## Capabilities and Constraints

- Configuration: L1 and optional L2 size, line size, associativity, hit latency, replacement policy
  (LRU, FIFO, seeded Random), write policy (write-back / write-through), write-miss policy
  (write-allocate / no-write-allocate); inclusion (inclusive / exclusive / non-inclusive); memory
  latency; seed. Invalid geometries are rejected with a reason, never silently adjusted.
- Live session: step, run until a breakpoint, seek, reset, with a per-access ordered action log.
- Analytics: hit/miss rates, exact AMAT and its breakdown, 3C classification, reuse distance and
  miss-ratio curve, per-set heatmaps, timeline.
- Comparison: runs on the same trace only (fingerprint-checked), per-metric deltas and best, sweeps,
  JSON / CSV / text-log export.
- **Honest numbers:** a rate with a zero denominator is shown as "n/a", never 0; nothing is invented.
- Static site (planned hosting: Cloudflare Pages) with a strict CSP; no third-party scripts or analytics.
- Planned, not yet available: more replacement policies (PLRU, SRRIP, LFU, Belady's optimal), the
  `ccsim simulate` CLI command, deployment, education content. Hardware monitoring is deferred.
- Terminology follows `docs/ARCHITECTURE.md` and `docs/WORKING_DEMO.md` (line, set, way, tag, victim,
  write-back, fill, back-invalidate, local vs global miss rate, AMAT in cycles).

## Brand Commitments

- Name: **ccsim** (long form "CPU Cache Simulator").

## Evidence on Hand

- Worked examples with hand-derived expected values: Demos A–C in `docs/WORKING_DEMO.md`, traces in
  `tests/data/golden/`.
- The shared benchmark dataset `tests/data/standard/matmul64-O0.trace.gz` (pinned; never modified).
- Engine test suites (unit, golden, stress, dataset) and the QA report `docs/QA_REPORT.md`.
- Not on hand, and not to be fabricated: users, testimonials, course adoptions, usage numbers, a live
  deployment URL, performance claims beyond the recorded benchmark report.

## Product Principles

1. The engine is the single source of truth; the interface only shows what it reported.
2. Every step is explainable: a student can see why an access hit or missed and what moved where.
3. Honest over impressive: "n/a" over a made-up 0, ties shown as ties, unfinished features labelled.
4. The same input always gives the same picture, so a class can follow one shared run.
5. Small demos and the 4 M-access dataset both stay usable.

## Accessibility & Inclusion

No formal standard required. The principles in `docs/FRONTEND_DESIGN.md` section 1 apply: keyboard-
operable controls, state never shown by color alone, a data table behind every chart, and a designed
dark theme rather than an automatic invert.
