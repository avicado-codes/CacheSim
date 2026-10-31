# ccsim QA Report

The repository's standing quality-assurance record. It follows the *test completion report* structure of ISO/IEC/IEEE 29119-3. Each QA pass replaces the body and adds a row to the [revision history](#12-revision-history). Status labels follow the repository convention in [docs/ARCHITECTURE.md](ARCHITECTURE.md): **Implemented**, **Planned**, **Not tested**.

## 1. Document control

| Field | Value |
|---|---|
| Report ID | `QA-2026-10-31` |
| Status | Final for this pass |
| System under test | `ccsim` engine and native build, v0.1.0 |
| Baseline | `main` @ `9e5b276` (after PR #4), tested on branch `test/full-sim-stress` |
| Prepared by | Simulation track (`avicado-codes`) |
| Review | Simulation track; configuration track (`Code-r4Life`) for the shared-document changes |
| Test environment | Kali rolling x86-64 · GCC 16.2 · Clang 21.1 · CMake 4.4 + Ninja |

## 2. Introduction

### 2.1 Purpose

This report records what was tested, how, what was found and fixed, and what risk remains, so that a reviewer can accept the engine for the next phase (web UI) without re-running the analysis.

### 2.2 Scope

**In scope:** the C++ engine and everything below the planned web UI:

- trace parser (`io`), L1/L2 hierarchy (`sim`), replacement policies (`policy`);
- live session (`session`), analytics (`analytics`), JSON/CSV reports (`report`);
- comparison and sweeps (`compare`), the WebAssembly C ABI (`wasm`, natively compiled), and the CLI;
- the test suites, CI workflow and all repository documentation.

**Out of scope:** the web UI (not built yet) and hardware monitoring (Deferred).

### 2.3 References

| Document | Used for |
|---|---|
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | Specification: cache model (5), ABI (8), comparison (10), layering (11), ownership (12), tests (14) |
| [docs/TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) | Exact v1 rules: geometry, trace format, statistics |
| [docs/WORKING_DEMO.md](WORKING_DEMO.md) | Hand-derived golden expectations and acceptance criteria (AC-1 to AC-10) |
| [AGENTS.md](../AGENTS.md) | Code, test and data rules (4, 5) and the Definition of Done (3) |

## 3. Summary and verdict

**Verdict: accepted.** The engine is correct for normal use. An independent model of the cache semantics matches it exactly on 3,000 random configurations, and inclusion/exclusion hold after every one of 320,000 checked accesses. The code follows the architecture closely.

The pass found **one memory-safety defect, six correctness or contract defects and three robustness risks**, all at the edges of the input space. **All ten are closed** with a regression test that fails on the old code and passes on the new. The documentation lagged behind PR #4 and has been brought up to date. Two items need the configuration track or a contract-only PR ([section 9](#9-open-issues-and-residual-risk)).

## 4. Test items and environment

| Item | Version or configuration |
|---|---|
| Source | `main` @ `9e5b276` plus the fixes in [section 7](#7-defects) |
| Compilers | GCC 16.2 (Release `-O3` and Debug), Clang 21.1 (Release) |
| Warnings | `-Werror -Wall -Wextra -Wpedantic -Wshadow -Wconversion` |
| Sanitizers | AddressSanitizer + UndefinedBehaviorSanitizer, `-fno-sanitize-recover=all` |
| Data | `tests/data/standard/matmul64-O0.trace.gz` (4,051,312 accesses, SHA-256 pinned), golden traces Demos A–C, synthetic generators in `tests/support/fixtures.cpp` |
| Policies | Production LRU / FIFO / Random (`src/policy/`) and the test-only reference policies (`tests/support/`) |

## 5. Test approach

| # | Technique | What it establishes |
|---|---|---|
| 1 | Clean builds under three toolchains (section 4) | No warnings and no undefined behaviour on any suite |
| 2 | **Differential testing.** A second, deliberately naive simulator written from ARCHITECTURE 5.3 (vectors of structs, linear scans, its own LRU/FIFO/Random, none of the engine's data structures), fuzzed against the engine | Exact agreement on every counter, the total latency and the final valid/dirty/line state of every slot |
| 3 | Structural invariants after every access | Inclusive: each valid L1 line is in L2. Exclusive: no line is in both |
| 4 | Boundary-value analysis from the specification: address and latency extremes, empty traces, 64-bit values in JSON, CSV labels, sweep rejection, ABI misuse | Behaviour at edges a random fuzzer rarely reaches |
| 5 | **Mutation check.** The new tests rebuilt against the pre-fix code | The tests detect the defects they target and are not tautologies |
| 6 | Static review: real include graph vs ARCHITECTURE 11, purity scan (OS headers, clocks, threads, `rand`, unordered containers), append-only check of `types.hpp` since the contract commit | Layering, determinism and contract rules |
| 7 | Interleaved before/after benchmarks (`ctest -L bench` binary, same machine) | No hot-path regression |
| 8 | Evidence repeatability: `ctest` twice, then `git diff tests/results/` | Generated evidence is deterministic |
| 9 | Documentation audit: every status label and count checked against code, tests and git history | Docs match reality (AC-10) |

## 6. Test results

### 6.1 Quality gates

| Gate | Baseline | After fixes |
|---|---|---|
| GCC Release `-Werror`, `ctest` | 6/6 pass | 6/6 pass, 0 warnings (21.7 s) |
| Clang Release `-Werror`, `ctest` | 6/6 pass | 6/6 pass, 0 warnings (24.6 s) |
| GCC ASan + UBSan, `ctest` (stress included) | 6/6 pass | 6/6 pass (stress 845 s) |
| Differential fuzz, 3,000 configs × 1k–4k accesses | matched on ordinary addresses; **crashed** on address extremes | 3,000 configs, 7.49 M accesses, all exact, extremes included |
| Structural invariants | 320,000 states hold | 320,000 states hold |
| Committed evidence stable across runs | **no**: every run rewrote timings in `standard_dataset_report.md` | yes: a second run leaves `git diff` empty |
| Mutation check | — | 10 of 12 boundary tests fail or crash on the pre-fix code; the other 2 are equivalence tests and pass on both by design. The differential test reports a mismatch at config 19, then crashes |

### 6.2 Test inventory

| Suite (label) | Test cases on `main` | After this pass | Main additions |
|---|---|---|---|
| unit | 44 | 70 | `boundary.*` (12), `edge.*` |
| golden | 4 | 4 | — |
| stress | 4 | 12 | `differential.*` (2), `pipeline.*` (6) |
| dataset | 3 | 3 | report no longer stores timings |
| smoke | 2 checks | 2 checks | — (CLI contract, `ccsim --version`) |

`ctest` registers six entries (two smoke checks plus one per suite above), hence "6/6" in 6.1.

## 7. Defects

Severity: **High** = memory safety, **Medium** = wrong numbers for valid input, **Low** = contract or robustness gap. All defects below are **Closed**.

| ID | Sev. | Defect | Resolution | Regression test |
|---|---|---|---|---|
| F1 | High | **Out-of-bounds write.** `LineIndex` stored keys as `line + 1` with 0 meaning "empty", so line 2^64−1 (legal: 1-byte lines, address `0xFFFF…FFFF`) collided with the empty marker. `find` returned a stale slot; with an exclusive L2 of more than 16 ways, `CacheLevel::take` wrote outside `state_` (ASan at `src/sim/cache_level.cpp:83` via `hierarchy.cpp:134`). In Release/WASM this is silent heap corruption. Elsewhere it produced wrong counts: a hit on 41 distinct lines, and 1 instead of 2 first touches in 3C and reuse distance. | Line 2^64−1 gets a dedicated slot outside the table (`include/ccsim/sim/line_index.hpp`). Every other lookup pays one predictable compare. | `boundary.line_index_holds_the_top_line`, `boundary.top_line_in_a_fully_associative_cache`, `boundary.top_line_exclusive_wide_l2_stays_in_bounds`, `boundary.top_line_in_analytics`, `differential.*` |
| F2 | Medium | **Latency wrap-around.** Per-access latency was summed in `uint32_t`, so `t1 + t2 + tmem` ≥ 2^32 wrapped: one access cost 2^31 instead of 3×2^31, breaking the exact decomposition of ARCHITECTURE 5.4. | New `Hierarchy::check()` (also called by the constructor) refuses a worst case above 2^32−1 with a `ConfigError` naming `latency`. The 32-bit event field and the ABI layout are unchanged. | `boundary.per_access_latency_is_exact_or_refused` |
| F3 | Medium | **A failed upload could still complete.** After a format or limit error, `ccsim_trace_end` succeeded and the browser could simulate a silently truncated trace. | `TraceParser` stays failed after its first error (`src/io/trace.cpp`). Its 9 checks fail against `main`'s parser. | `edge.parser_is_failed_after_the_first_error`, `edge.c_abi_refuses_to_complete_a_failed_upload` |
| F4 | Low | **Seed above 2^53 lost precision in JavaScript.** `seed` was written only as a JSON number (AGENTS.md 4). | `seed_hex` (`"0x…"`) added next to `seed` in every config object. Additive, so the schema stays `ccsim.simulation/1`. | `boundary.seed_crosses_json_exactly` |
| F5 | Low | **Empty trace + reuse profile** wrote `fa_lru_miss_ratio` as `0.0`, not `null` (zero denominator). | JSON writes `null` when the trace has no accesses (`src/report/json.cpp`). | `boundary.empty_trace_miss_ratio_curve_is_null` |
| F6 | Low | **CSV labels were not escaped.** A label like `fast, "tuned"` produced an invalid row. | RFC 4180 quoting for every label field (`src/compare/compare.cpp`). | `boundary.comparison_csv_quotes_labels` |
| F7 | Low | **Sweeps accepted configs that later fail** (memory latency 0, or the F2 bound), against ARCHITECTURE 10's "listed as rejected". | `expand_sweep` validates with `Hierarchy::check()`, so every accepted config runs. | `boundary.sweep_rejects_everything_a_run_would_refuse`, `boundary.hierarchy_check_matches_the_constructor` |
| R1 | Low | **ABI handles were reused after release.** A stale JavaScript handle silently reached the next session or trace. | Handles are never reused (8 bytes per released slot). Documented in ARCHITECTURE 8.1. | `boundary.c_abi_never_reuses_a_released_handle` |
| R2 | Perf | **Turbo mode was ~30% slower than needed.** `Session::run()` recorded a full event per access even with no breakpoints. | With an empty breakpoint mask, `run()` takes the batch path and records only the last access. Same observable result, ~52 → ~71 M accesses/s. | `boundary.run_without_breakpoints_equals_step` |
| R3 | Low | **A weak test oracle.** `check_invariants` asserted "inclusive ⇒ no L2 write-back misses" only for write-back L2, but the spec states it unconditionally. Also, `ccsim_session_step` allocated a fresh event scratch per call. | Invariant made unconditional (holds on all suites). Scratch reused across calls. | all suites via `check_invariants` |

## 8. Conformance

### 8.1 Architecture

| Area | Status | Evidence |
|---|---|---|
| Five-stage pipeline, engine side (stages 2–5) | Aligned | Parser, session, analytics, compare and ABI exist as specified in sections 6–10 |
| Layering (11) | Aligned | The real include graph equals the diagram, with no cycles. `io` and `policy` include only `sim/types.hpp` |
| Engine purity and determinism (11, AGENTS 4) | Aligned | No OS headers, clocks, threads, `rand`, `uniform_*_distribution`, unordered containers or mutable globals in the engine. Random is `mt19937_64 % ways` |
| Cache semantics (5.3, 5.4) | Aligned | Differential model and structural invariants (6.1) |
| Shared contract append-only (12.2) | Aligned | `git diff f2e191a HEAD -- types.hpp` removes 0 lines |
| Contract protocol (12.3) | **Past deviation** | Extension 1.1 shipped inside PR #3 (77 files) instead of a contract-only PR. Nothing to fix; noted for future contract changes |
| Honest numbers (AGENTS 4) | Aligned after F4, F5 | |
| Hot paths allocation-free (AGENTS 4) | Aligned | The `LineIndex` fix adds no allocation; ABI step scratch reused (R3) |
| `.github/CODEOWNERS` (12.3 recommendation) | Not present | See section 9 |
| `validate()` (5.1) | Planned (configuration track) | Declared in `types.hpp`, not yet defined: see section 9 |

**Specification gap closed:** the docs did not say whether a write-back or a forwarded store that hits L2 updates L2's replacement order. The code does, and ARCHITECTURE 5.3 now states it as rule 9, so the differential model is fully derived from the spec.

### 8.2 Performance

AGENTS.md requires before/after numbers for any hot-path change. Standard dataset, GCC 16.2 `-O3`, one thread, same machine; batch runs alternated before/after, three times each:

| Path | Before (mean of 3) | After (mean of 3) |
|---|---|---|
| Batch, L1+L2 default | 84.5 M accesses/s | 87.0 M accesses/s |
| Batch, fully associative 512-way L1 (`LineIndex` path) | 75.9 M accesses/s | 75.0 M accesses/s |
| Session with 3C + timeline (`LineIndex` shadows) | 51.0 M accesses/s | 48.6 M accesses/s |
| Step with event recording (live UI path) | 22.4 M events/s | 23.0 M events/s |
| Exact reuse-distance profile | 26.1 M accesses/s | 25.9 M accesses/s |
| `run()` with no breakpoints (turbo) | ~52 M accesses/s | ~71 M accesses/s |

The before and after ranges overlap on every `LineIndex` path, so run-to-run noise (±10%) is larger than any difference. All bench minimums pass. `tests/results/benchmark_report.md` was not regenerated (per `tests/results/README.md`, only from the machine named in the PR).

### 8.3 Documentation

Every status label and count was checked against the code. Updated in this pass:

| File | Change |
|---|---|
| README.md | Policies Implemented; status line; repository structure; roadmap link (ARCHITECTURE 17); validation footnote |
| docs/ARCHITECTURE.md *(shared)* | Policies Implemented (5.6, 17); `select_victim` contract (5.6); `Hierarchy::check()` and the latency bound (5.1); rule 9 (5.3); handle lifetime (8.1); `seed_hex` (4.4); test counts and differential oracle (14); structure and document map |
| AGENTS.md *(shared)* | Suite time ~6 s → ~25 s; ownership table no longer lists NOTICE.md |
| NOTICE.md *(shared)* | **Removed.** A dated one-off handoff to the configuration track; its lasting rules are in ARCHITECTURE 5.1, 5.3, 5.6, 12 and AGENTS.md, and its open deliverables in ARCHITECTURE 17 |
| docs/TECHNICAL_DESIGN.md | Status line and module table; latency bound (3) |
| docs/OVERVIEW.md, docs/DEVELOPMENT.md | Current status; the WASM paragraph no longer says policies are pending |
| CONTRIBUTING.md | Milestone plan marked historical, pointing to ARCHITECTURE 17 |
| tests/results/README.md | Dataset evidence is deterministic; timings go to the console |

Regenerated evidence: `standard_dataset_report.md` (two timing rows removed) and `standard_dataset_default_run.json` (only `seed_hex` added, verified by diff).

## 9. Open issues and residual risk

### 9.1 Owner action required

| Item | Owner | Why it is not fixed here |
|---|---|---|
| `validate()` is declared in `include/ccsim/sim/types.hpp` but defined nowhere, so any caller fails to link. Its comment says "defined in src/sim/". | Configuration track (+ contract protocol for the comment) | `src/config/` belongs to that track. ARCHITECTURE 5.1 states the engine rules (`Hierarchy::check()`) it can reuse |
| `types.hpp` header comments still say the contract "freezes at the end of Milestone 1" and point `validate()` to `src/sim/` | Shared (ARCHITECTURE 12.3) | `types.hpp` changes need a `contract` issue and a contract-only PR |
| `.github/CODEOWNERS` mirroring ARCHITECTURE 12.1 | Build owner | Recommendation, not a defect |
| A trace starting with a UTF-8 BOM (common from Windows editors) is rejected as `expected operation 'R' or 'W', got '﻿R'` | Simulation track, product decision | The grammar (TECHNICAL_DESIGN 7) does not allow a BOM; accepting one is a format change. The error is correct but could be friendlier |

### 9.2 Not tested

- The Emscripten/WASM build and `tests/wasm/smoke.mjs` (no `emcc` or `node` on the test machine; CI runs both).
- Windows (MSVC) and macOS (Apple Clang).

## 10. Exit criteria

| Criterion (AGENTS.md 3) | Met | Evidence |
|---|---|---|
| Builds with zero warnings under `-Werror` | Yes | GCC and Clang Release, 0 warnings |
| Every suite passes | Yes | 6/6 on GCC, Clang and ASan + UBSan |
| New behaviour has a test | Yes | Each defect in section 7 has a named regression test; mutation check in 6.1 |
| Sanitizers before an engine PR | Yes | ASan + UBSan, stress included |
| Benchmarks before and after a hot-path change | Yes | Section 8.2 |
| Every commit builds on its own | Yes | Commits applied one by one to a clean export; each builds with `-Werror` and passes its non-stress suites |

## 11. Reproducing this pass

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCCSIM_WARNINGS_AS_ERRORS=ON
cmake --build build && ctest --test-dir build --output-on-failure
./build/tests/ccsim_unit_tests boundary.                # the regressions in section 7
./build/tests/ccsim_stress_tests differential.          # independent model, ~1 s in Release
cmake -S . -B build-asan -G Ninja -DCMAKE_BUILD_TYPE=Debug \
      -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all"
cmake --build build-asan && ctest --test-dir build-asan --output-on-failure
```

A differential mismatch prints the configuration (`describe()` string) and the first field that differs, so it can be replayed as a golden fixture.

**Updating this report:** run the commands above, replace sections 1 and 3 to 10 with the new pass, keep closed defect IDs unique (continue from F8 / R4), and add a row below.

## 12. Revision history

| Report ID | Date | Baseline | Summary |
|---|---|---|---|
| `QA-2026-10-31` | 2026-10-31 | `main` @ `9e5b276` | First full QA pass: 10 defects closed, differential oracle added, docs brought up to date, NOTICE.md retired |
