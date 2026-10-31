// Standard dataset validation: tests/data/standard/matmul64-O0.trace.gz.
//
// Two questions, answered with evidence written to tests/results/:
//   1. Integrity: is this exactly the agreed dataset? (counts and fingerprint pinned)
//   2. Fitness: can it tell configurations apart? A benchmark trace that gives the same
//      miss rate for every cache is useless however "real" it is. Each criterion below is
//      fixed from first principles BEFORE looking at this trace's numbers, and the report
//      records the measured value next to the threshold so a failure is a finding, not noise.
//
// Criteria marked [gate] fail the test; [finding] criteria are reported only, because they
// describe the workload's character rather than a defect.

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <string>
#include <vector>

#include "ccsim/compare/compare.hpp"
#include "ccsim/report/json.hpp"
#include "ccsim/session/session.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

namespace {

constexpr std::uint64_t kAccesses = 4'051'312;
constexpr std::uint64_t kReads = 3'492'124;
constexpr std::uint64_t kWrites = 559'188;
constexpr std::uint64_t kFingerprint = 0xda2eb04afb87c2d8ULL;  // FNV-1a 64 of the records

std::shared_ptr<Trace> standard() {
    static std::shared_ptr<Trace> t;
    if (!t) t = load_trace_file(data_dir() + "/standard/matmul64-O0.trace.gz");
    return t;
}

struct Criterion {
    std::string id, name, measured, threshold;
    bool pass;
    bool gate;
};

std::string num(double v, const char* f = "%.4g") {
    char b[64];
    std::snprintf(b, sizeof b, f, v);
    return b;
}

}  // namespace

TEST_CASE("dataset.integrity") {
    const auto t = standard();
    CHECK_EQ(t->size(), kAccesses);
    CHECK_EQ(t->reads(), kReads);
    CHECK_EQ(t->writes(), kWrites);
    std::printf("fingerprint 0x%016llx, memory %.1f MiB\n", static_cast<unsigned long long>(t->fingerprint()),
                static_cast<double>(t->memory_bytes()) / (1 << 20));
    CHECK_EQ(t->fingerprint(), kFingerprint);
}

// The two standard benchmark profiles (tests/data/standard/README.md). "benchmark" is
// scaled below the 183 KiB footprint so that L2, inclusion and memory write-backs are
// exercised; "teaching" is the TECHNICAL_DESIGN section 3 default.
HierarchyConfig teaching_profile() { return default_hierarchy(); }
HierarchyConfig benchmark_profile() {
    HierarchyConfig c = default_hierarchy();
    c.l1.size_bytes = 8 * 1024;
    c.l2->size_bytes = 64 * 1024;
    return c;
}

TEST_CASE("dataset.regression_baseline") {
    // REGRESSION baselines, not goldens: pinned from the first run after the engine passed
    // the hand-derived goldens and the invariant suite. A change here means engine
    // behaviour changed; it must be explained in the PR, never silently re-pinned.
    const auto t = standard();
    struct Expect { const char* name; HierarchyConfig c; std::uint64_t l1_misses, l2_misses, mem_writes, latency; };
    const Expect cases[] = {
        {"teaching", teaching_profile(), 48219, 2934, 0, 17370676},
        {"benchmark", benchmark_profile(), 270833, 3536, 1444, 20162444},
    };
    for (const Expect& e : cases) {
        const SimulationResult r = simulate(*t, e.c);
        std::printf("%s: l1_misses=%llu l2_misses=%llu mem_writes=%llu latency=%llu\n", e.name,
                    static_cast<unsigned long long>(r.l1.misses), static_cast<unsigned long long>(r.l2->misses),
                    static_cast<unsigned long long>(r.memory.writes), static_cast<unsigned long long>(r.total_latency_cycles));
        CHECK_EQ(r.l1.misses, e.l1_misses);
        CHECK_EQ(r.l2->misses, e.l2_misses);
        CHECK_EQ(r.memory.writes, e.mem_writes);
        CHECK_EQ(r.total_latency_cycles, e.latency);
        check_invariants(r, e.c, std::string("standard dataset ") + e.name);
    }
}

TEST_CASE("dataset.fitness_report") {
    const auto t = standard();
    std::vector<Criterion> crit;
    auto add = [&](std::string id, std::string name, std::string measured, std::string threshold, bool pass, bool gate) {
        crit.push_back({std::move(id), std::move(name), std::move(measured), std::move(threshold), pass, gate});
        if (gate && !pass) report_failure(__FILE__, __LINE__, "dataset criterion failed: " + crit.back().name);
    };

    // --- Workload character (one pass, every capacity at once) -------------------------
    const auto t0 = std::chrono::steady_clock::now();
    const ReuseProfile rp = reuse_profile(*t, 64);
    const double reuse_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    const double footprint_kib = static_cast<double>(rp.footprint_bytes()) / 1024.0;
    const double writes = static_cast<double>(t->writes()) / static_cast<double>(t->size());

    add("C1", "Scale: at least 1M accesses (stable rates, matches AC-3)", std::to_string(t->size()), ">= 1000000",
        t->size() >= 1'000'000, true);
    add("C2", "Write share high enough for write-policy experiments", num(100 * writes, "%.1f%%"), ">= 5%",
        writes >= 0.05, true);
    add("C3", "Footprint exceeds the default L1 (32 KiB): L1 is under pressure", num(footprint_kib, "%.1f KiB"),
        "> 32 KiB", footprint_kib > 32, true);
    add("C4", "Footprint exceeds the default L2 (256 KiB): L2 sees more than cold misses",
        num(footprint_kib, "%.1f KiB"), "> 256 KiB", footprint_kib > 256, false);

    // Miss-ratio curve of FA-LRU, 64 B lines: 2^k lines, k = 4 (1 KiB) .. 14 (1 MiB).
    std::string mrc;
    bool monotone = true;
    for (std::uint32_t k = 4; k <= 14; ++k) {
        const double r = rp.fa_lru_miss_ratio_pow2(k);
        if (k > 4 && r > rp.fa_lru_miss_ratio_pow2(k - 1) + 1e-15) monotone = false;
        mrc += (k > 4 ? ", " : "") + num(static_cast<double>(std::uint64_t{64} << k) / 1024, "%g") + "K:" + num(r, "%.4f");
    }
    const double r1k = rp.fa_lru_miss_ratio_pow2(4), r64k = rp.fa_lru_miss_ratio_pow2(10);
    add("C5", "Capacity sensitivity: FA-LRU miss ratio 1 KiB vs 64 KiB", num(r1k / std::max(r64k, 1e-12), "%.2fx"),
        ">= 2x", r1k >= 2 * r64k, true);
    add("C6", "LRU stack property: miss ratio never rises with capacity", monotone ? "monotone" : "NOT monotone",
        "monotone", monotone, true);

    // --- Organisation sensitivity on the default teaching L1 ----------------------------
    std::vector<RunReport> ways_runs;
    for (std::uint32_t w : {1u, 2u, 4u, 8u, 16u}) {
        HierarchyConfig c = default_hierarchy();
        c.l1.ways = w;
        RunOptions o;
        o.label = "L1 " + std::to_string(w) + "-way";
        o.trace_source = "matmul64-O0";
        ways_runs.push_back(run_batch(t, c, kRef, o));
    }
    const double dm = *ways_runs[0].levels[0].miss_rate, w8 = *ways_runs[3].levels[0].miss_rate;
    add("C7", "Associativity sensitivity: 32 KiB L1 direct-mapped vs 8-way miss rate",
        num(dm, "%.4f") + " vs " + num(w8, "%.4f"), ">= 10% relative", dm >= 1.10 * w8, true);
    const std::uint64_t conflict_dm = ways_runs[0].levels[0].three_c->conflict;
    const std::uint64_t conflict_w8 = ways_runs[3].levels[0].three_c->conflict;
    add("C8", "Conflict misses fall with associativity (3C)", std::to_string(conflict_dm) + " -> " + std::to_string(conflict_w8),
        "decreasing", conflict_w8 < conflict_dm, true);

    std::vector<RunReport> policy_runs;
    for (PolicyKind p : {PolicyKind::Lru, PolicyKind::Fifo, PolicyKind::Random}) {
        HierarchyConfig c = default_hierarchy();
        c.l1.size_bytes = 8 * 1024;  // below the footprint knee, where policies matter
        c.l1.policy = p;
        RunOptions o;
        o.label = "8K L1 " + std::string(to_string(p));
        o.trace_source = "matmul64-O0";
        policy_runs.push_back(run_batch(t, c, kRef, o));
    }
    std::uint64_t lo = ~0ULL, hi = 0;
    for (const auto& r : policy_runs) {
        lo = std::min(lo, r.result.l1.misses);
        hi = std::max(hi, r.result.l1.misses);
    }
    add("C9", "Policy sensitivity: LRU/FIFO/Random L1 misses spread (8 KiB L1)",
        num(100.0 * static_cast<double>(hi - lo) / static_cast<double>(lo), "%.2f%%"), ">= 1% relative",
        static_cast<double>(hi - lo) >= 0.01 * static_cast<double>(lo), true);

    std::vector<RunReport> inc_runs;
    for (InclusionPolicy p : {InclusionPolicy::NonInclusive, InclusionPolicy::Inclusive, InclusionPolicy::Exclusive}) {
        HierarchyConfig c = default_hierarchy();
        c.l1.size_bytes = 8 * 1024;
        c.l2->size_bytes = 64 * 1024;  // scaled so the footprint exceeds L2 as well
        c.inclusion = p;
        RunOptions o;
        o.label = std::string(to_string(p));
        o.trace_source = "matmul64-O0";
        inc_runs.push_back(run_batch(t, c, kRef, o));
    }
    add("C10", "Inclusion sensitivity: L2 hits NINE vs exclusive (8K L1 / 64K L2)",
        std::to_string(inc_runs[0].result.l2->hits) + " vs " + std::to_string(inc_runs[2].result.l2->hits),
        "different", inc_runs[0].result.l2->hits != inc_runs[2].result.l2->hits, true);

    const double mr_nine = static_cast<double>(inc_runs[0].result.memory.reads);
    const double mr_excl = static_cast<double>(inc_runs[2].result.memory.reads);
    add("C10b", "Inclusion effect size: memory reads NINE vs exclusive",
        num(100.0 * (mr_nine - mr_excl) / mr_nine, "%.2f%%"), ">= 5% relative", mr_nine - mr_excl >= 0.05 * mr_nine, false);

    const SetHeatmap& hm = ways_runs[3].levels[0].heatmap;
    add("C11", "Set coverage: no unused L1 sets (default 32 KiB 8-way)", std::to_string(hm.untouched_sets) + " unused of " +
        std::to_string(hm.sets), "0 unused", hm.untouched_sets == 0, false);
    add("C12", "Set balance: hottest set / mean", num(hm.max_to_mean_access ? *hm.max_to_mean_access : 0, "%.2fx"),
        "<= 8x", hm.max_to_mean_access && *hm.max_to_mean_access <= 8.0, false);

    // --- Determinism and throughput ------------------------------------------------------
    const RunReport again = run_batch(t, default_hierarchy(), kRef, {});
    add("C13", "Determinism: identical counters on a repeated run",
        again.result.total_latency_cycles == ways_runs[3].result.total_latency_cycles ? "identical" : "DIFFERENT",
        "identical", again.result.total_latency_cycles == ways_runs[3].result.total_latency_cycles, true);
    const auto t1 = std::chrono::steady_clock::now();
    (void)simulate(*t, default_hierarchy());
    const double sim_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t1).count();
    const double maps = static_cast<double>(t->size()) / (sim_ms * 1000.0);

    // --- Write the evidence ---------------------------------------------------------------
    int gates_failed = 0, findings = 0;
    std::string md = "# Standard dataset fitness report\n\n";
    md += "Generated by `tests/dataset/test_standard_dataset.cpp` (label `dataset`). Do not edit by hand.\n\n";
    md += "| | |\n|---|---|\n";
    md += "| Dataset | `tests/data/standard/matmul64-O0.trace.gz` |\n";
    md += "| Accesses | " + std::to_string(t->size()) + " (" + std::to_string(t->reads()) + " R, " + std::to_string(t->writes()) + " W) |\n";
    char fp[32];
    std::snprintf(fp, sizeof fp, "0x%016llx", static_cast<unsigned long long>(t->fingerprint()));
    md += std::string("| Fingerprint (FNV-1a 64) | `") + fp + "` |\n";
    md += "| Footprint (64 B lines) | " + std::to_string(rp.cold) + " lines = " + num(footprint_kib, "%.1f") + " KiB |\n";
    md += "| Median reuse distance | <= " + std::to_string(rp.median_distance_upper_bound()) + " lines |\n";
    md += "| In-memory size | " + num(static_cast<double>(t->memory_bytes()) / (1 << 20), "%.1f") + " MiB |\n\n";
    // Timings vary per run and build, so they go to the console only: the committed report must
    // regenerate byte-identically (tests/results/README.md). Tracked numbers: benchmark_report.md.
    std::printf("timing (this machine, this build; not written to the report): reuse profile %.0f ms, "
                "engine %.1f M accesses/s\n", reuse_ms, maps);
    md += "## Criteria\n\n| ID | Criterion | Measured | Threshold | Kind | Result |\n|---|---|---|---|---|---|\n";
    for (const Criterion& c : crit) {
        if (c.gate && !c.pass) ++gates_failed;
        if (!c.gate && !c.pass) ++findings;
        md += "| " + c.id + " | " + c.name + " | " + c.measured + " | " + c.threshold + " | " + (c.gate ? "gate" : "finding") +
              " | " + (c.pass ? "pass" : (c.gate ? "**FAIL**" : "noted")) + " |\n";
    }
    md += "\n## Miss-ratio curve (fully associative LRU, 64 B lines)\n\n" + mrc + "\n";
    md += "\n## Associativity sweep (32 KiB L1, default L2)\n\n```text\n" + comparison_log(compare_runs(ways_runs)) + "```\n";
    md += "\n## Policy sweep (8 KiB L1)\n\n```text\n" + comparison_log(compare_runs(policy_runs)) + "```\n";
    md += "\n## Inclusion sweep (8 KiB L1, 64 KiB L2)\n\n```text\n" + comparison_log(compare_runs(inc_runs)) + "```\n";
    md += "\n## Verdict\n\n";
    md += gates_failed == 0 ? "All gate criteria pass: the dataset discriminates between configurations and is fit to be the shared benchmark."
                            : "One or more gate criteria FAILED: do not use this dataset as the shared benchmark until resolved.";
    md += findings == 0 ? "\n" : " Findings (not defects) are listed above; see tests/data/standard/README.md for how to read them.\n";

    const std::string dir = results_dir();
    write_text_file(dir + "/standard_dataset_report.md", md);
    write_text_file(dir + "/standard_dataset_ways.csv", comparison_csv(compare_runs(ways_runs)));
    RunReport full = ways_runs[3];
    full.reuse = rp;
    write_text_file(dir + "/standard_dataset_default_run.json", report_to_json(full, CCSIM_VERSION_STRING));
    std::printf("%s", md.c_str());
}
