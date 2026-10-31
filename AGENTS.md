# AGENTS.md

Operating manual for any AI agent (Claude Code, Codex, Copilot, Cursor, …) or new contributor working in this repository. Read it fully before your first change. If it conflicts with another document, **this file and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) win**.

## 1. What this repo is

`ccsim`: a deterministic CPU cache simulator (L1 + optional L2 + memory) written in ISO C++17. It is built natively for tests and the CLI, and compiled to WebAssembly for a deployed website where the engine runs in a Web Worker. Pipeline: configure → upload trace → live step-by-step simulation → analytics → comparison. Hardware monitoring (`ccsim monitor`) is **deferred**; don't work on it unless asked.

## 2. Before you change anything

1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) sections 5 (cache model), 11 (layout) and 12 (ownership).
2. Find the owner of every path you will touch (table below). **Never edit another track's paths** without an explicit request from the user.
3. Work on a branch (`feat/<area>-<topic>`, `fix/…`, `docs/…`, `test/…`). Never commit to `main` directly.
4. **Do not `git commit` or `git push` on your own.** At every logical checkpoint, stop and tell the user exactly what to commit: the paths for `git add` and a Conventional Commits message. The user commits.

| Path | Owner | Agent may edit when working for… |
|---|---|---|
| `include/ccsim/policy/`, `src/policy/`, `include/ccsim/config/`, `src/config/`, `tests/unit/test_policy_*`, `tests/unit/test_config_*` | Configuration track (`Code-r4Life`) | that track only |
| `include/ccsim/{io,sim,analytics,session,report,compare,wasm}/` and matching `src/`, `tests/**` (rest), `tests/data/standard/` | Simulation track (repo owner) | that track only |
| `include/ccsim/sim/types.hpp`, root `CMakeLists.txt`, `docs/ARCHITECTURE.md`, `AGENTS.md` | **Shared**: append-only, one contract change per PR | either, following the [contract protocol](docs/ARCHITECTURE.md#123-shared-contract-protocol) |
| `web/` | Frontend track (later) | that track only |
| `src/monitor/`, `include/ccsim/monitor/` | Deferred | nobody, unless asked |

## 3. Build and test (Linux; see docs/DEVELOPMENT.md for other OSes)

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCCSIM_WARNINGS_AS_ERRORS=ON
cmake --build build
ctest --test-dir build --output-on-failure          # smoke, unit, golden, stress, dataset (~25 s; stress ~20 s)
ctest --test-dir build -L golden                    # one label
./build/tests/ccsim_unit_tests sim.                 # one suite, filtered by test-name substring
# Sanitizers (run before any engine PR):
cmake -S . -B build-asan -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer"
# Benchmarks (Release only, opt-in):
cmake -S . -B build -DCCSIM_BUILD_BENCHMARKS=ON && cmake --build build && ctest --test-dir build -L bench
```

No CMake? `python3 -m pip install --user cmake ninja` (or use a venv). zlib headers (`zlib1g-dev`) enable the dataset suite; without zlib it reports *skipped*, not passed.

**A change is not done until:** it builds with zero warnings under `-Werror`, every suite passes, and any new behaviour has a test.

## 4. Hard rules for code

- **Determinism:** no clocks, threads, `rand()`, `std::uniform_*_distribution`, or unordered iteration that affects results. Random policy = `std::mt19937_64` reduced with `% ways`.
- **Engine purity:** `src/{io,sim,policy,config,analytics,session,report,compare}` contain no OS headers, no I/O and no global mutable state. Only `src/wasm/` and the CLI may hold process state.
- **Contracts are append-only:** new enum values and struct fields go at the end, with defaults that keep current results bit-identical. Never reorder, rename or reformat `types.hpp`.
- **Honest numbers:** a rate with a zero denominator is `std::nullopt` → JSON `null` → UI "n/a", never 0. Don't invent values.
- **Performance:** hot paths (`Hierarchy::step`, `CacheLevel::find`, parser loop) must not allocate. Keep per-access cost O(ways) or better and memory O(cache lines + distinct lines). Measure with `ctest -L bench` before and after any hot-path change and report both numbers.
- **Integers:** `std::uint64_t` for addresses and counters, never `long`. Values above 2^53 cross into JavaScript as BigInt or `"0x…"` strings.
- **No `assert()`** in tests (Release removes it): use `CHECK`, `CHECK_EQ`, `CHECK_NEAR`, `CHECK_THROWS_AS` from `tests/support/harness.hpp`.
- **Style:** 4-space indent, about 110 columns, `snake_case` functions, `PascalCase` types, `kPascalCase` constants, `#pragma once`. Match the surrounding comment density; no mass reformatting.
- **Dependencies:** standard library only in the engine. zlib is allowed in `tests/` only.

## 5. Hard rules for tests and data

- Golden expectations come from **independent derivations** (hand calculations in `docs/WORKING_DEMO.md` or a separate model), never from copying the program's output.
- `tests/data/standard/matmul64-O0.trace.gz` is **the** shared benchmark dataset. Never modify, recompress or replace it; its SHA-256 and fingerprint are pinned. A new dataset gets a new name and manifest.
- Regression baselines in `tests/dataset/test_standard_dataset.cpp` may change only with a written explanation in the PR.
- `tests/results/` is generated: regenerate it, never hand-edit it. Only the files listed in `tests/results/README.md` are committed.
- Reference policies in `tests/support/` are **test-only**. Never link them into `ccsim_core`, the CLI or the WASM build.
- Fixtures: small text traces under `tests/data/golden/` with a header comment stating their purpose and where the expected values come from.

## 6. Adding things (recipes)

| Task | Steps |
|---|---|
| New engine module | `include/ccsim/<m>/`, `src/<m>/*.cpp`, `src/<m>/CMakeLists.txt` with `target_sources(ccsim_core PRIVATE …)`. The root CMake finds it automatically; don't edit the root. |
| New test file | Drop `tests/<suite>/test_<area>.cpp` with `TEST_CASE("<area>.<behaviour>")`. The suite glob picks it up. |
| New metric | Compute it in `src/analytics/metrics.cpp`, serialise it in `src/report/json.cpp`, and add a comparison row in `src/compare/compare.cpp`, plus a unit test and a row in ARCHITECTURE section 9.1. |
| New replacement policy (config track) | Append a `PolicyKind` value, append its name to `kPolicyKindNames` and bump `kPolicyKindCount` (all in `types.hpp`, one contract PR). Then add a file in `src/policy/` and a case in `make_policy`. Nothing else enumerates policies. |
| Contract change | Follow [ARCHITECTURE 12.3](docs/ARCHITECTURE.md#123-shared-contract-protocol): issue, append-only PR, update section 5.2. |

## 7. Commit checkpoint format (what to tell the user)

```text
Commit checkpoint: <what is now complete and verified>
  git add <paths>
  git commit -m "<type>(<scope>): <summary>"
Verified: <exact commands run and their result>
```

Types: `feat`, `fix`, `test`, `docs`, `build`, `ci`, `refactor`, `perf`, `chore`. Scopes: `io`, `sim`, `policy`, `config`, `analytics`, `session`, `report`, `compare`, `wasm`, `tests`, `data`, `docs`, `build`.

## 8. Reporting

State what you ran and what it printed. Label anything not executed as **Not tested** (for example Windows, macOS or the Emscripten build). Never claim a status (Implemented, Verified) without merged tests or recorded evidence.
