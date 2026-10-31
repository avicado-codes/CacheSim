// Boundary regressions from the QA pass of 2026-10-31 (docs/QA_REPORT.md). Each test pins one
// defect that slipped past the existing suites; expected values come from the documents, not
// from the implementation:
//   * line 2^64 - 1 (1-byte lines, address 0xFFFF...FFFF) is an ordinary line: TECHNICAL_DESIGN 4
//   * per-access latency is exact or the config is refused: ARCHITECTURE 5.3 rule 7, 5.4
//   * 64-bit values cross into JavaScript exactly; zero denominators are null: AGENTS.md 4
//   * sweeps list every combination a run would refuse as rejected: ARCHITECTURE 10
//   * comparison CSV is valid RFC 4180 for any label: ARCHITECTURE 10 (export)
//   * C ABI handles of released objects stay invalid: ARCHITECTURE 8.1, 16
//   * run() without breakpoints is observably identical to step(): ARCHITECTURE 7.1, 7.4

#include <cstring>
#include <string>
#include <vector>

#include "ccsim/compare/compare.hpp"
#include "ccsim/report/json.hpp"
#include "ccsim/session/session.hpp"
#include "ccsim/sim/line_index.hpp"
#include "ccsim/wasm/api_internal.hpp"
#include "ccsim/wasm/ccsim_api.h"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

namespace {

constexpr std::uint64_t kTop = ~std::uint64_t{0};

SimulationResult run_lines(const HierarchyConfig& c, const std::vector<std::uint64_t>& addresses) {
    Hierarchy h(c, kRef);
    for (const std::uint64_t a : addresses) h.access({AccessType::Read, a});
    return h.result();
}

}  // namespace

TEST_CASE("boundary.line_index_holds_the_top_line") {
    LineIndex idx(4);
    CHECK_EQ(idx.find(kTop), LineIndex::kAbsent);  // absent before insertion, not "bucket 0's value"
    idx.put(0, 7);
    idx.put(kTop, 9);
    CHECK_EQ(idx.size(), 2u);
    CHECK_EQ(idx.find(kTop), 9u);
    CHECK_EQ(idx.find(0), 7u);
    for (std::uint64_t i = 1; i < 100; ++i) idx.put(i, static_cast<std::uint32_t>(i));  // forces rehashes
    CHECK_EQ(idx.find(kTop), 9u);
    std::uint64_t visited_top = 0, visited = 0;
    idx.for_each([&](std::uint64_t line, std::uint32_t) {
        ++visited;
        if (line == kTop) ++visited_top;
    });
    CHECK_EQ(visited, 101u);
    CHECK_EQ(visited_top, 1u);
    idx.erase(kTop);
    CHECK_EQ(idx.find(kTop), LineIndex::kAbsent);
    CHECK_EQ(idx.size(), 100u);
    idx.erase(kTop);  // erasing an absent key is a no-op
    CHECK_EQ(idx.size(), 100u);
    idx.put(kTop, 1);
    idx.clear();
    CHECK_EQ(idx.size(), 0u);
    CHECK_EQ(idx.find(kTop), LineIndex::kAbsent);
}

TEST_CASE("boundary.top_line_in_a_fully_associative_cache") {
    // 1-byte lines, 1 set x 32 ways (> 16 ways: the LineIndex lookup path). 41 distinct lines.
    const HierarchyConfig c = l1_only(32, 1, 32, PolicyKind::Lru, 1, 100);
    std::vector<std::uint64_t> a{kTop};
    for (std::uint64_t i = 0; i < 40; ++i) a.push_back(i);
    SimulationResult r = run_lines(c, a);
    CHECK_EQ(r.l1.hits, 0u);
    CHECK_EQ(r.l1.misses, 41u);
    check_invariants(r, c, "FA top line");
    // Fresh cache: the second touch of the top line must hit, never alias line 0 or an empty way.
    a = {kTop, 0, kTop, 39};
    r = run_lines(c, a);
    CHECK_EQ(r.l1.hits, 1u);  // second kTop only
    CHECK_EQ(r.l1.misses, 3u);
}

TEST_CASE("boundary.top_line_exclusive_wide_l2_stays_in_bounds") {
    // The configuration that wrote outside CacheLevel's arrays before the fix: exclusive L2 with
    // > 16 ways, so L2 lookups go through LineIndex, and the top line moving between levels.
    HierarchyConfig c = l1_only(4, 1, 2, PolicyKind::Lru, 1, 100);
    c.l2 = level("L2", 64, 1, 32, PolicyKind::Lru, 10);
    c.inclusion = InclusionPolicy::Exclusive;
    std::vector<std::uint64_t> a;
    for (int round = 0; round < 50; ++round) {
        a.push_back(kTop);
        for (std::uint64_t i = 0; i < 6; ++i) a.push_back(i * 3 + static_cast<std::uint64_t>(round % 5));
    }
    const SimulationResult r = run_lines(c, a);
    check_invariants(r, c, "exclusive wide L2 top line");
    CHECK(r.l2->hits > 0u);  // the top line is found in L2 after it was pushed down
}

TEST_CASE("boundary.top_line_in_analytics") {
    const auto t = trace_from_text("R 0x0\nR 0xFFFFFFFFFFFFFFFF\nR 0xFFFFFFFFFFFFFFFF\n");
    Session s(t, l1_only(8, 1, 2, PolicyKind::Lru, 1, 100), kRef);
    s.run_to_end();
    const MissBreakdown b = *s.three_c(LevelId::L1);
    CHECK_EQ(b.compulsory, 2u);  // two distinct first touches
    CHECK_EQ(b.compulsory + b.capacity + b.conflict, s.result().l1.misses);
    const ReuseProfile p = reuse_profile(*t, 1);
    CHECK_EQ(p.cold, 2u);
    CHECK_EQ(p.histogram[0], 1u);  // immediate re-touch of the top line: distance 0
}

TEST_CASE("boundary.per_access_latency_is_exact_or_refused") {
    HierarchyConfig c = default_hierarchy();
    // Worst case exactly 2^32 - 1 cycles: accepted, and the total is exact.
    c.l1.hit_latency_cycles = 1;
    c.l2->hit_latency_cycles = 1;
    c.memory_latency_cycles = 0xFFFFFFFDU;
    const auto t = trace_from_text("R 0x0\nR 0x0\n");
    const SimulationResult r = simulate(*t, c);
    CHECK_EQ(r.total_latency_cycles, 0xFFFFFFFFULL + 1u);  // miss to memory, then an L1 hit
    check_invariants(r, c, "max latency");
    // One cycle more would wrap the 32-bit per-access latency: refused, naming the field.
    c.memory_latency_cycles = 0xFFFFFFFEU;
    CHECK_THROWS_AS(Hierarchy(c, kRef), ConfigError);
    try {
        Hierarchy::check(c);
    } catch (const ConfigError& e) {
        CHECK(std::string(e.what()).rfind("latency:", 0) == 0);
    }
    // Without L2 the bound is t1 + tmem.
    HierarchyConfig n = l1_only(1024, 64, 2, PolicyKind::Lru, 2, 0xFFFFFFFEU);
    CHECK_THROWS_AS(Hierarchy::check(n), ConfigError);
    n.memory_latency_cycles = 0xFFFFFFFDU;
    Hierarchy::check(n);
}

TEST_CASE("boundary.hierarchy_check_matches_the_constructor") {
    HierarchyConfig c = default_hierarchy();
    Hierarchy::check(c);
    c.memory_latency_cycles = 0;
    CHECK_THROWS_AS(Hierarchy::check(c), ConfigError);
    c = default_hierarchy();
    c.l2->line_bytes = 128;
    CHECK_THROWS_AS(Hierarchy::check(c), ConfigError);
    c = default_hierarchy();
    c.l1.ways = 3;  // 32 KiB / (64 x 3) is not an integer
    CHECK_THROWS_AS(Hierarchy::check(c), ConfigError);
}

TEST_CASE("boundary.seed_crosses_json_exactly") {
    HierarchyConfig c = default_hierarchy();
    c.seed = kTop;
    JsonWriter w;
    write_config(w, c);
    CHECK(w.str().find("\"seed_hex\":\"0xffffffffffffffff\"") != std::string::npos);
    c.seed = 1;
    JsonWriter v;
    write_config(v, c);
    CHECK(v.str().find("\"seed\":1,\"seed_hex\":\"0x1\"") != std::string::npos);  // additive: seed kept
}

TEST_CASE("boundary.empty_trace_miss_ratio_curve_is_null") {
    RunOptions o;
    o.reuse_profile = true;
    const std::string j = report_to_json(run_batch(trace_from_text(""), default_hierarchy(), kRef, o), "t");
    CHECK(j.find("\"fa_lru_miss_ratio\":[null,null,") != std::string::npos);
    CHECK(j.find("\"fa_lru_miss_ratio\":[0.0") == std::string::npos);
}

TEST_CASE("boundary.comparison_csv_quotes_labels") {
    const auto t = trace_from_text("R 0x0\nR 0x40\n");
    RunOptions a, b;
    a.label = "fast, \"tuned\"";
    b.label = "plain";
    std::vector<RunReport> runs{run_batch(t, default_hierarchy(), kRef, a), run_batch(t, default_hierarchy(), kRef, b)};
    const std::string csv = comparison_csv(compare_runs(runs));
    const std::string header = csv.substr(0, csv.find('\n'));
    CHECK_EQ(header, std::string("metric,unit,better,\"fast, \"\"tuned\"\"\",\"plain\",\"delta_rel plain\",best"));
    // Every data row has the header's field count when quoted fields are honoured.
    auto fields = [](const std::string& row) {
        std::size_t n = 1;
        bool quoted = false;
        for (const char ch : row) {
            if (ch == '"') quoted = !quoted;
            else if (ch == ',' && !quoted) ++n;
        }
        return n;
    };
    std::size_t start = csv.find('\n') + 1;
    while (start < csv.size()) {
        const std::size_t end = csv.find('\n', start);
        CHECK_EQ(fields(csv.substr(start, end - start)), fields(header));
        start = end + 1;
    }
}

TEST_CASE("boundary.sweep_rejects_everything_a_run_would_refuse") {
    const SweepResult s = expand_sweep(default_hierarchy(), {{SweepField::MemoryLatency, {0, 100, 0xFFFFFFFFULL}}});
    CHECK_EQ(s.configs.size(), 1u);
    CHECK_EQ(s.rejected.size(), 2u);
    CHECK(s.rejected[0].find("memory_latency") != std::string::npos);
    CHECK(s.rejected[1].find("latency:") != std::string::npos);
    const auto t = trace_from_text("R 0x0\n");
    for (const HierarchyConfig& c : s.configs) (void)run_batch(t, c, kRef);  // must not throw
}

TEST_CASE("boundary.c_abi_never_reuses_a_released_handle") {
    api::set_policy_factory(kRef);
    const char text[] = "R 0x0\nW 0x40\n";
    const std::int32_t t = ccsim_trace_begin("h.trace", 0);
    CHECK_EQ(ccsim_trace_feed(t, text, static_cast<std::uint32_t>(std::strlen(text))), 0);
    CHECK_EQ(ccsim_trace_end(t), 0);
    std::uint64_t cfg[CCSIM_CONFIG_WORDS] = {1, 32768, 64, 8, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200, 0, 1};
    const std::int32_t a = ccsim_session_create(t, cfg, CCSIM_CONFIG_WORDS, 0);
    CHECK(a > 0);
    ccsim_session_release(a);
    const std::int32_t b = ccsim_session_create(t, cfg, CCSIM_CONFIG_WORDS, 0);
    CHECK(b > 0 && b != a);
    CHECK_EQ(ccsim_session_step(a, 1, 0), -1);  // the stale handle fails loudly
    CHECK(std::string(ccsim_last_error()).find("invalid handle") != std::string::npos);
    CHECK_EQ(ccsim_session_step(b, 1, 0), 1);
    ccsim_session_release(b);
    ccsim_trace_release(t);
    const std::int32_t t2 = ccsim_trace_begin("h2.trace", 0);
    CHECK(t2 > 0 && t2 != t);
    CHECK_EQ(ccsim_trace_size(t), 0u);
    CHECK(std::string(ccsim_last_error()).find("invalid handle") != std::string::npos);
    ccsim_trace_release(t2);
}

TEST_CASE("boundary.run_without_breakpoints_equals_step") {
    const auto t = synthetic_mixed(20000, 3);
    for (const InclusionPolicy inc : {InclusionPolicy::NonInclusive, InclusionPolicy::Inclusive, InclusionPolicy::Exclusive}) {
        HierarchyConfig c = default_hierarchy();
        c.l1.size_bytes = 4096;
        c.inclusion = inc;
        Session ran(t, c, kRef), stepped(t, c, kRef);
        AccessEvent last;
        CHECK(ran.run(12345, Breakpoints{}, &last) == StopReason::Budget);
        std::vector<AccessEvent> events;
        CHECK_EQ(stepped.step(12345, &events), 12345u);
        CHECK_EQ(ran.position(), 12345u);
        CHECK_EQ(last.seq, events.back().seq);
        CHECK_EQ(event_to_json(last), event_to_json(events.back()));
        CHECK_EQ(report_to_json(ran.report("x"), "t"), report_to_json(stepped.report("x"), "t"));
        CHECK(ran.run(1u << 30, Breakpoints{}, nullptr) == StopReason::End);
        CHECK(ran.finished());
        CHECK(ran.run(5, Breakpoints{}, &last) == StopReason::End);  // already at the end
        CHECK(ran.run(0, Breakpoints{}, &last) == StopReason::End);
    }
    Session s(t, default_hierarchy(), kRef);
    CHECK(s.run(0, Breakpoints{}) == StopReason::Budget);
    CHECK_EQ(s.position(), 0u);
}
