// Comparison/sweep module and the C ABI used by the browser build.

#include <cstring>
#include <string>
#include <vector>

#include "ccsim/compare/compare.hpp"
#include "ccsim/wasm/api_internal.hpp"
#include "ccsim/wasm/ccsim_api.h"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

TEST_CASE("compare.sweep_expansion_and_rejection") {
    const HierarchyConfig base = l1_only(4096, 64, 4, PolicyKind::Lru, 1, 100);
    const SweepResult s = expand_sweep(base, {{SweepField::L1Ways, {1, 2, 3, 4}},
                                              {SweepField::L1Policy, {0, 1}}});
    CHECK_EQ(s.configs.size(), std::size_t{6});   // ways=3 -> 4096/(64*3) is not an integer
    CHECK_EQ(s.rejected.size(), std::size_t{2});
    CHECK_EQ(s.configs[0].l1.ways, 1u);
    CHECK(s.configs[1].l1.policy == PolicyKind::Fifo);  // last axis varies fastest
    CHECK_THROWS_AS(expand_sweep(base, {{SweepField::L2Ways, {1}}}), ConfigError);
    CHECK_THROWS_AS(expand_sweep(base, {{SweepField::L1Ways, std::vector<std::uint64_t>(300, 1)}}), ConfigError);
}

TEST_CASE("compare.demo_c_fifo_vs_lru") {
    const auto t = load_trace_file(data_dir() + "/golden/demo_c_belady.trace");
    std::vector<RunReport> runs;
    for (PolicyKind p : {PolicyKind::Fifo, PolicyKind::Lru}) {
        RunOptions o;
        o.label = p == PolicyKind::Fifo ? "fifo" : "lru";
        runs.push_back(run_batch(t, l1_only(64, 16, 4, p, 1, 100), kRef, o));
    }
    const Comparison c = compare_runs(runs);
    CHECK(c.same_trace);
    CHECK_EQ(c.differences.size(), std::size_t{1});
    CHECK_EQ(c.differences[0], std::string("L1.policy: fifo -> lru (lru)"));
    const ComparisonRow* miss = nullptr;
    for (const auto& r : c.rows) if (r.key == "l1.miss_rate") miss = &r;
    CHECK(miss != nullptr);
    if (miss != nullptr) {
        CHECK_NEAR(*miss->values[0], 10.0 / 12.0, 1e-12);
        CHECK_NEAR(*miss->values[1], 8.0 / 12.0, 1e-12);
        CHECK_NEAR(*miss->delta_rel[1], -0.2, 1e-12);
        CHECK(miss->best && *miss->best == 1);
    }
    const std::string csv = comparison_csv(c);
    CHECK(csv.rfind("metric,unit,better,\"fifo\",\"lru\"", 0) == 0);
    CHECK(comparison_log(c).find("best: lru") != std::string::npos);
}

TEST_CASE("wasm_api.end_to_end") {
    api::set_policy_factory(nullptr);
    const std::int32_t trace = ccsim_trace_begin("demo_b.trace", 0);
    CHECK(trace > 0);
    const char* part1 = "R 0x000\nW 0x008\nR 0x0";
    const char* part2 = "40\nR 0x080\nR 0x000\nW 0x0C0\nR 0x100\nR 0x010\nR 0x018\nR 0x0C4";
    CHECK_EQ(ccsim_trace_feed(trace, part1, static_cast<std::uint32_t>(std::strlen(part1))), 0);
    CHECK_EQ(ccsim_trace_feed(trace, part2, static_cast<std::uint32_t>(std::strlen(part2))), 0);
    CHECK_EQ(ccsim_trace_end(trace), 0);
    CHECK_EQ(ccsim_trace_size(trace), 10u);

    std::uint64_t cfg[CCSIM_CONFIG_WORDS] = {1, 64, 16, 2, 1, 0, 0, 0, 1, 128, 16, 2, 10, 0, 0, 0, 100, 0, 1};
    CHECK_EQ(ccsim_session_create(trace, cfg, CCSIM_CONFIG_WORDS, 0), 0);  // no policies linked yet
    CHECK(std::string(ccsim_last_error()).find("no replacement policies") != std::string::npos);

    api::set_policy_factory(kRef);
    const std::int32_t s = ccsim_session_create(trace, cfg, CCSIM_CONFIG_WORDS, 0);
    CHECK(s > 0);
    CHECK_EQ(ccsim_session_step(s, 4, 1), 4);
    // Decode the 4th event (step 4 of Demo B) from the flat buffer.
    const std::uint32_t* buf = ccsim_event_buffer();
    const std::uint32_t words = ccsim_event_buffer_words();
    std::uint32_t off = 0, last = 0;
    while (off < words) {
        last = off;
        off += CCSIM_EVENT_HEADER_WORDS + buf[off + 19] * CCSIM_ACTION_WORDS;
    }
    CHECK_EQ(off, words);
    CHECK_EQ(buf[last + 0], 3u);    // seq
    CHECK_EQ(buf[last + 3], 0x80u); // address low word
    CHECK_EQ(buf[last + 8], 2u);    // L1 outcome: miss
    CHECK_EQ(buf[last + 18], 111u); // latency
    CHECK_EQ(buf[last + 19], 8u);   // actions
    CHECK_EQ(buf[last + 20 + 2 * 5] & 0xFFu, static_cast<std::uint32_t>(ActionKind::Writeback));

    CHECK_EQ(ccsim_session_run(s, 1000, 0, 0), 2);  // StopReason::End
    const std::string json = ccsim_session_report_json(s, "demo-b", 1);
    CHECK(json.find("\"amat_cycles\":68.0") != std::string::npos);
    CHECK(json.find("\"source\":\"demo_b.trace\"") != std::string::npos);

    const std::uint8_t* states = ccsim_session_slot_states(s, 0);
    CHECK(states != nullptr);
    CHECK(ccsim_session_slot_states(s, 5) == nullptr);

    cfg[5] = 1;  // L1 FIFO
    const std::int32_t s2 = ccsim_session_create(trace, cfg, CCSIM_CONFIG_WORDS, 1);
    CHECK_EQ(ccsim_session_step(s2, 100, 0), 10);
    const std::int32_t both[] = {s, s2};
    const char* labels[] = {"lru", "fifo"};
    const std::string cmp = ccsim_compare_json(both, 2, labels);
    CHECK(cmp.find("\"schema\":\"ccsim.comparison/1\"") != std::string::npos);
    CHECK(std::string(ccsim_compare_csv(both, 2, labels)).find("l1.miss_rate") != std::string::npos);

    CHECK_EQ(ccsim_session_seek(s, 2), 0);
    CHECK_EQ(ccsim_session_position(s), 2u);
    CHECK_EQ(ccsim_session_step(999, 1, 0), -1);  // bad handle: error, not a crash
    CHECK(std::string(ccsim_last_error()).find("invalid handle") != std::string::npos);
    cfg[0] = 9;
    CHECK_EQ(ccsim_session_create(trace, cfg, CCSIM_CONFIG_WORDS, 0), 0);

    ccsim_trace_release(trace);   // sessions keep the trace alive
    CHECK_EQ(ccsim_session_step(s, 100, 0), 8);
    ccsim_session_release(s);
    ccsim_session_release(s2);
    api::set_policy_factory(nullptr);
}

TEST_CASE("compare.ties_name_no_winner") {
    // Demo A: direct-mapped vs 2-way on the conflict trace. Both have 2 compulsory misses
    // (WORKING_DEMO.md section 2), so that row is a tie; AMAT has a unique winner (2-way).
    const auto t = load_trace_file(data_dir() + "/golden/demo_a_conflict.trace");
    std::vector<RunReport> runs;
    for (std::uint32_t ways : {1u, 2u}) {
        RunOptions o;
        o.label = ways == 1 ? "direct" : "2-way";
        runs.push_back(run_batch(t, l1_only(64, 16, ways, PolicyKind::Lru, 1, 100), kRef, o));
    }
    const Comparison c = compare_runs(runs);
    const ComparisonRow* compulsory = nullptr;
    const ComparisonRow* amat = nullptr;
    for (const auto& r : c.rows) {
        if (r.key == "l1.compulsory") compulsory = &r;
        if (r.key == "amat_cycles") amat = &r;
    }
    CHECK(compulsory != nullptr && amat != nullptr);
    if (compulsory != nullptr && amat != nullptr) {
        CHECK_EQ(*compulsory->values[0], 2.0);
        CHECK_EQ(*compulsory->values[1], 2.0);
        CHECK(compulsory->tie);
        CHECK(!compulsory->best.has_value());
        CHECK(!amat->tie);
        CHECK(amat->best && *amat->best == 1);
    }
    const std::string csv = comparison_csv(c);
    CHECK(csv.find("\nl1.compulsory,count,lower,2,2,0,tie\n") != std::string::npos);
    CHECK(comparison_log(c).find("L1 compulsory misses [count]:  direct=2  2-way=2 (+0.00%)  -> tie\n") !=
          std::string::npos);
    JsonWriter w;
    write_comparison(w, c);
    const std::string json = w.take();
    CHECK(json.find("\"key\":\"l1.compulsory\"") != std::string::npos);
    CHECK(json.find("\"best\":null,\"tie\":true") != std::string::npos);
    CHECK(json.find("\"best\":1,\"tie\":false") != std::string::npos);
}

TEST_CASE("wasm_api.reuse_only_in_complete_reports") {
    api::set_policy_factory(kRef);
    const std::int32_t trace = ccsim_trace_begin("r.trace", 0);
    const char* text = "R 0x000\nR 0x040\nR 0x000\nR 0x080\n";
    CHECK_EQ(ccsim_trace_feed(trace, text, static_cast<std::uint32_t>(std::strlen(text))), 0);
    CHECK_EQ(ccsim_trace_end(trace), 0);
    std::uint64_t cfg[CCSIM_CONFIG_WORDS] = {1, 1024, 64, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 1};
    const std::int32_t s = ccsim_session_create(trace, cfg, CCSIM_CONFIG_WORDS, 0);
    CHECK(s > 0);
    CHECK_EQ(ccsim_session_step(s, 2, 0), 2);
    const std::string mid = ccsim_session_report_json(s, "mid", 1);
    CHECK(mid.find("\"complete\":false") != std::string::npos);
    CHECK(mid.find("\"reuse\":null") != std::string::npos);  // whole-trace data next to partial counters: no

    CHECK_EQ(ccsim_session_step(s, 10, 0), 2);
    const std::string end1 = ccsim_session_report_json(s, "end", 1);
    CHECK(end1.find("\"complete\":true") != std::string::npos);
    // 4 accesses, 3 distinct lines (cold), one reuse at distance 1 (bucket 1).
    CHECK(end1.find("\"reuse\":{\"line_bytes\":64,\"cold\":3,\"footprint_bytes\":192,\"histogram\":[0,1]") !=
          std::string::npos);
    // A second session on the same trace gets the same profile (served from the cache).
    const std::int32_t s2 = ccsim_session_create(trace, cfg, CCSIM_CONFIG_WORDS, 1);
    CHECK_EQ(ccsim_session_step(s2, 10, 0), 4);
    const std::string end2 = ccsim_session_report_json(s2, "end", 1);
    CHECK_EQ(end2.substr(end2.find("\"reuse\":")), end1.substr(end1.find("\"reuse\":")));
    // Seeking back makes the report partial again.
    CHECK_EQ(ccsim_session_seek(s, 1), 0);
    CHECK(std::string(ccsim_session_report_json(s, "back", 1)).find("\"reuse\":null") != std::string::npos);

    ccsim_session_release(s);
    ccsim_session_release(s2);
    ccsim_trace_release(trace);
    api::set_policy_factory(nullptr);
}

TEST_CASE("wasm_api.totals_must_stay_exact_in_javascript") {
    HierarchyConfig c = default_hierarchy();  // 4 + 12 + 200 = 216 cycles worst case
    constexpr std::uint64_t kSafe = (std::uint64_t{1} << 53) - 1;
    api::check_js_safe_totals(c, 50'000'000);  // the website's upload limit: fine
    c.l1.line_bytes = 16;                       // small lines, so the cycle total is the binding limit
    c.l2->line_bytes = 16;
    api::check_js_safe_totals(c, kSafe / 216);
    CHECK_THROWS_AS(api::check_js_safe_totals(c, kSafe / 216 + 1), ConfigError);

    c.memory_latency_cycles = 0xFFFF0000U;  // ~2^32 cycles per access
    api::check_js_safe_totals(c, 1'000'000);
    CHECK_THROWS_AS(api::check_js_safe_totals(c, 4'000'000), ConfigError);

    HierarchyConfig big_lines = default_hierarchy();
    big_lines.l1.line_bytes = 1U << 30;
    big_lines.l2->line_bytes = 1U << 30;
    api::check_js_safe_totals(big_lines, 1U << 20);                        // 4 * 2^20 * 2^30 = 2^52 bytes
    CHECK_THROWS_AS(api::check_js_safe_totals(big_lines, 1U << 21), ConfigError);  // 2^53: one too many
}
