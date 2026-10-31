# tests/results

Evidence written by the test suites. Files here are **generated**: never edit them by hand. Regenerate them and commit the diff when engine behaviour changes on purpose.

| File | Written by | Committed |
|---|---|---|
| `standard_dataset_report.md` | `ctest -L dataset` | yes: fitness evidence for the standard dataset |
| `standard_dataset_ways.csv` | `ctest -L dataset` | yes: associativity sweep, comparison CSV format |
| `standard_dataset_default_run.json` | `ctest -L dataset` | yes: a complete `ccsim.simulation/1` document (sample for the frontend) |
| `benchmark_report.md` | `ctest -L bench` (needs `-DCCSIM_BUILD_BENCHMARKS=ON`, Release) | yes, but only from the machine named in the PR |
| anything else (`*.ndjson`, scratch output) | ad-hoc runs | no (git-ignored) |

The dataset files are deterministic: regenerating them on any machine must leave `git diff` empty (timings are printed to the console, not written). Throughput numbers depend on the machine and compiler. Compare them only against runs on the same machine.
