// Full-pipeline stress on the PRODUCTION policies (src/policy/). The reference stand-ins in
// tests/support/ are an independent model of TECHNICAL_DESIGN 5.4, so the production build
// must agree with them bit for bit: same counters, same victim ways, same event stream, same
// reports. Covers the whole matrix, the standard dataset, live-session controls and the
// comparison stage. Skipped (77) when src/policy/ is absent.

#include <cstdio>
#include <iterator>
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

#ifdef CCSIM_HAS_PRODUCTION_POLICIES
constexpr PolicyFactory kProd = &make_policy;
void require_production() {}
#else
constexpr PolicyFactory kProd = nullptr;
void require_production() { throw SkipTest{"no production policies (src/policy/) in this build"}; }
#endif

void check_same_level(const LevelStats& a, const LevelStats& b, const std::string& ctx) {
    const std::uint64_t LevelStats::*fields[] = {
        &LevelStats::accesses, &LevelStats::reads, &LevelStats::writes, &LevelStats::hits,
        &LevelStats::misses, &LevelStats::read_misses, &LevelStats::write_misses, &LevelStats::evictions,
        &LevelStats::writebacks, &LevelStats::writebacks_received, &LevelStats::writeback_hits,
        &LevelStats::writeback_misses, &LevelStats::no_allocate_misses, &LevelStats::write_throughs_sent,
        &LevelStats::write_throughs_received, &LevelStats::back_invalidations, &LevelStats::victims_received};
    for (std::size_t i = 0; i < std::size(fields); ++i) {
        if (a.*fields[i] != b.*fields[i]) {
            CHECK(false && "production and reference counters differ");
            std::printf("  %s: field #%zu prod=%llu ref=%llu\n", ctx.c_str(), i,
                        static_cast<unsigned long long>(a.*fields[i]), static_cast<unsigned long long>(b.*fields[i]));
            return;
        }
    }
}

void check_same_result(const SimulationResult& a, const SimulationResult& b, const std::string& ctx) {
    check_same_level(a.l1, b.l1, ctx + " L1");
    CHECK_EQ(a.l2.has_value(), b.l2.has_value());
    if (a.l2 && b.l2) check_same_level(*a.l2, *b.l2, ctx + " L2");
    CHECK_EQ(a.memory.reads, b.memory.reads);
    CHECK_EQ(a.memory.writes, b.memory.writes);
    CHECK_EQ(a.total_latency_cycles, b.total_latency_cycles);
}

std::vector<HierarchyConfig> full_matrix() {
    std::vector<HierarchyConfig> out;
    for (PolicyKind pol : {PolicyKind::Lru, PolicyKind::Fifo, PolicyKind::Random}) {
        for (InclusionPolicy inc : {InclusionPolicy::NonInclusive, InclusionPolicy::Inclusive, InclusionPolicy::Exclusive}) {
            for (WritePolicy w1 : {WritePolicy::WriteBack, WritePolicy::WriteThrough}) {
                for (WriteMissPolicy m1 : {WriteMissPolicy::WriteAllocate, WriteMissPolicy::NoWriteAllocate}) {
                    for (WritePolicy w2 : {WritePolicy::WriteBack, WritePolicy::WriteThrough}) {
                        HierarchyConfig c;
                        c.l1 = level("L1", 8 * 1024, 64, 4, pol, 4);
                        c.l1.write_policy = w1;
                        c.l1.write_miss_policy = m1;
                        c.l2 = level("L2", 64 * 1024, 64, 8, pol, 12);
                        c.l2->write_policy = w2;
                        c.inclusion = inc;
                        c.memory_latency_cycles = 200;
                        c.seed = 99;
                        out.push_back(c);
                    }
                }
            }
        }
    }
    return out;
}

std::string name_of(const HierarchyConfig& c) { return describe(c); }

std::shared_ptr<Trace> standard_trace() {
    static std::shared_ptr<Trace> t;
    if (!t) t = load_trace_file(data_dir() + "/standard/matmul64-O0.trace.gz");
    return t;
}

}  // namespace

TEST_CASE("pipeline.production_matches_reference_full_matrix_1m") {
    require_production();
    const auto t = synthetic_mixed(1'000'000, 2026);
    const auto matrix = full_matrix();
    for (const HierarchyConfig& c : matrix) {
        const SimulationResult prod = simulate(*t, c, kProd);
        check_invariants(prod, c, "production " + name_of(c));
        check_same_result(prod, simulate(*t, c, kRef), name_of(c));
    }
    CHECK_EQ(matrix.size(), 72u);
}

TEST_CASE("pipeline.production_extreme_shapes_and_seeds") {
    require_production();
    const auto t = synthetic_random(500'000, 16ULL << 20, 0.3, 7);
    struct Shape { std::uint64_t size; std::uint32_t line, ways; };
    const Shape shapes[] = {{1024, 64, 1}, {48 * 1024, 64, 12}, {4096, 64, 64}, {64 * 1024, 32, 16}, {1U << 20, 16, 1}};
    for (const Shape& s : shapes) {
        for (PolicyKind pol : {PolicyKind::Lru, PolicyKind::Fifo, PolicyKind::Random}) {
            for (std::uint64_t seed : {1ULL, 2ULL, 0xFFFFFFFFFFFFFFFFULL}) {
                HierarchyConfig c = l1_only(s.size, s.line, s.ways, pol, 1, 100);
                c.seed = seed;
                const std::string ctx = name_of(c) + " seed " + std::to_string(seed);
                const SimulationResult prod = simulate(*t, c, kProd);
                check_invariants(prod, c, ctx);
                check_same_result(prod, simulate(*t, c, kRef), ctx);
                if (pol != PolicyKind::Random) break;  // the seed only matters for Random
            }
        }
    }
}

TEST_CASE("pipeline.production_event_stream_identical") {
    // Same counters could hide different victim ways; the event stream cannot.
    require_production();
    const auto t = synthetic_mixed(20'000, 11);
    for (const HierarchyConfig& c : full_matrix()) {
        Session prod(t, c, kProd), ref(t, c, kRef);
        std::vector<AccessEvent> pe, re;
        while (prod.position() < t->size()) {
            pe.clear();
            re.clear();
            CHECK_EQ(prod.step(4096, &pe), ref.step(4096, &re));
            for (std::size_t i = 0; i < pe.size(); ++i) {
                if (event_to_json(pe[i]) != event_to_json(re[i])) {
                    CHECK(false && "event streams differ");
                    std::printf("  %s\n  prod %s\n  ref  %s\n", name_of(c).c_str(), event_to_json(pe[i]).c_str(),
                                event_to_json(re[i]).c_str());
                    return;
                }
            }
        }
    }
}

TEST_CASE("pipeline.standard_dataset_on_production") {
    // The pinned regression baselines (tests/dataset/) must hold on the production policies,
    // and every policy x inclusion x write-policy combination must match the reference.
    require_production();
    const auto t = standard_trace();
    HierarchyConfig teaching = default_hierarchy();
    HierarchyConfig bench = default_hierarchy();
    bench.l1.size_bytes = 8 * 1024;
    bench.l2->size_bytes = 64 * 1024;

    const SimulationResult a = simulate(*t, teaching, kProd);
    CHECK_EQ(a.l1.misses, 48219u);
    CHECK_EQ(a.l2->misses, 2934u);
    CHECK_EQ(a.memory.writes, 0u);
    CHECK_EQ(a.total_latency_cycles, 17370676u);
    const SimulationResult b = simulate(*t, bench, kProd);
    CHECK_EQ(b.l1.misses, 270833u);
    CHECK_EQ(b.l2->misses, 3536u);
    CHECK_EQ(b.memory.writes, 1444u);
    CHECK_EQ(b.total_latency_cycles, 20162444u);

    int runs = 0;
    for (PolicyKind pol : {PolicyKind::Lru, PolicyKind::Fifo, PolicyKind::Random}) {
        for (InclusionPolicy inc : {InclusionPolicy::NonInclusive, InclusionPolicy::Inclusive, InclusionPolicy::Exclusive}) {
            for (WritePolicy w : {WritePolicy::WriteBack, WritePolicy::WriteThrough}) {
                HierarchyConfig c = bench;
                c.l1.policy = c.l2->policy = pol;
                c.inclusion = inc;
                c.l1.write_policy = w;
                const SimulationResult prod = simulate(*t, c, kProd);
                check_invariants(prod, c, "standard " + name_of(c));
                check_same_result(prod, simulate(*t, c, kRef), "standard " + name_of(c));
                ++runs;
            }
        }
    }
    CHECK_EQ(runs, 18);
}

TEST_CASE("pipeline.live_session_controls_on_standard_dataset") {
    // What the website does: step with events, run to breakpoints, seek back and forth,
    // reset, then finish. The final report must equal a one-shot batch run byte for byte.
    require_production();
    const auto t = standard_trace();
    HierarchyConfig c = default_hierarchy();
    c.l1.size_bytes = 8 * 1024;
    c.l2->size_bytes = 64 * 1024;
    c.inclusion = InclusionPolicy::Inclusive;

    RunOptions opt;
    opt.label = "batch";
    const std::string batch = report_to_json(run_batch(t, c, kProd, opt), "test");

    Session s(t, c, kProd);
    std::vector<AccessEvent> ev;
    CHECK_EQ(s.step(1000, &ev), 1000u);
    CHECK_EQ(ev.size(), 1000u);
    Breakpoints bp;
    bp.mask = Breakpoints::kL2Miss;
    AccessEvent last;
    int stops = 0;
    while (stops < 50 && s.run(1'000'000, bp, &last) == StopReason::Breakpoint) {
        CHECK(last.l2.outcome == Outcome::Miss);
        ++stops;
    }
    CHECK_EQ(stops, 50);
    const std::uint64_t mid = s.position();
    const SimulationResult at_mid = s.result();
    s.seek(mid / 3);
    CHECK_EQ(s.position(), mid / 3);
    s.seek(mid);
    check_same_result(s.result(), at_mid, "seek round trip");
    s.reset();
    CHECK_EQ(s.position(), 0u);
    s.seek(t->size() / 2);
    s.run_to_end();
    CHECK_EQ(s.position(), t->size());
    CHECK_EQ(report_to_json(s.report("batch"), "test"), batch);
}

TEST_CASE("pipeline.comparison_stage_on_production") {
    require_production();
    const auto t = standard_trace();
    HierarchyConfig base = default_hierarchy();
    base.l1.size_bytes = 8 * 1024;
    base.l2->size_bytes = 64 * 1024;
    const SweepResult sweep = expand_sweep(base, {{SweepField::L1Policy, {0, 1, 2}}, {SweepField::L1Ways, {2, 8}}});
    CHECK_EQ(sweep.configs.size(), 6u);
    std::vector<RunReport> prod, ref;
    for (const HierarchyConfig& c : sweep.configs) {
        RunOptions o;
        o.label = describe(c);
        o.session.classify_misses = false;
        prod.push_back(run_batch(t, c, kProd, o));
        ref.push_back(run_batch(t, c, kRef, o));
    }
    const Comparison cp = compare_runs(prod);
    CHECK_EQ(comparison_csv(cp), comparison_csv(compare_runs(ref)));
    CHECK_EQ(comparison_log(cp), comparison_log(compare_runs(ref)));
    CHECK(!cp.rows.empty());
}
