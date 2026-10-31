// include/ccsim/compare/compare.hpp
//
// Benchmarking: run several configurations over ONE trace and line them up.
//
// * expand_sweep(): the cartesian product of the parameters worth varying
//   (size, ways, line, policy, inclusion, write policies, latencies) around a base config.
// * compare_runs(): per-metric table with absolute and relative deltas against the
//   baseline (run 0) and the winner of each metric. The simulator is deterministic, so a
//   delta is exact: there is no run-to-run noise to test significance against.
// * comparison_csv() / comparison_log() / write_comparison(): the exportable log.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "ccsim/analytics/metrics.hpp"
#include "ccsim/report/json.hpp"

namespace ccsim {

enum class SweepField : std::uint8_t {
    L1Size, L1Ways, L1Policy, L1WritePolicy, L1WriteMissPolicy, L1Latency,
    L2Size, L2Ways, L2Policy, L2WritePolicy, L2Latency,
    LineBytes,  // both levels (they must match)
    Inclusion, MemoryLatency, Seed,
};

struct SweepAxis {
    SweepField field;
    std::vector<std::uint64_t> values;  // enums by their integer value
};

// Configs in row-major order of `axes` (last axis varies fastest). Combinations whose
// geometry is invalid (e.g. a set count that is not a power of two) are skipped and
// listed in `rejected` with the reason, never silently dropped.
struct SweepResult {
    std::vector<HierarchyConfig> configs;
    std::vector<std::string> rejected;
};
SweepResult expand_sweep(const HierarchyConfig& base, const std::vector<SweepAxis>& axes,
                         std::size_t max_configs = 256);

enum class Better : std::uint8_t { Lower, Higher, Neither };

struct ComparisonRow {
    std::string key;    // stable id, e.g. "l1.miss_rate"
    std::string label;  // human label
    std::string unit;   // "ratio", "cycles", "count", "bytes", "x"
    Better better = Better::Lower;
    std::vector<Rate> values;     // one per run
    std::vector<Rate> delta_abs;  // value - baseline
    std::vector<Rate> delta_rel;  // (value - baseline) / baseline
    std::optional<std::size_t> best;  // index of the single winning run; nullopt if none or tied
    bool tie = false;                 // two or more runs share the best value (best is then nullopt)
};

struct Comparison {
    std::vector<std::string> labels;
    std::vector<std::string> descriptions;  // describe(config) per run
    std::vector<std::string> differences;   // "L1.ways: 4 -> 8 (run 1)"
    bool same_trace = true;
    std::vector<ComparisonRow> rows;
};

Comparison compare_runs(const std::vector<RunReport>& runs);
std::string comparison_csv(const Comparison& c);
std::string comparison_log(const Comparison& c);  // plain-text benchmark log
void write_comparison(JsonWriter& w, const Comparison& c);

}  // namespace ccsim
