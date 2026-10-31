// Stress: every hierarchy invariant (TECHNICAL_DESIGN 6 + ARCHITECTURE 5.4) over the full
// configuration matrix on >= 1,000,000 accesses (WORKING_DEMO AC-3), plus the 3C
// partition and event-log bounds. Deterministic: seeded generators, no clocks.

#include <algorithm>
#include <string>

#include "ccsim/report/json.hpp"
#include "ccsim/session/session.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

TEST_CASE("stress.invariants_full_matrix_1m") {
    const auto t = synthetic_mixed(1'000'000, 2026);
    int configs = 0;
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
                        const std::string ctx = std::string(to_string(pol)) + '/' + std::string(to_string(inc)) +
                                                '/' + std::string(to_string(w1)) + '/' + std::string(to_string(m1)) +
                                                '/' + std::string(to_string(w2));
                        check_invariants(simulate(*t, c), c, ctx);
                        ++configs;
                    }
                }
            }
        }
    }
    CHECK_EQ(configs, 72);
}

TEST_CASE("stress.invariants_l1_only_and_extreme_shapes") {
    const auto t = synthetic_random(1'000'000, 32ULL << 20, 0.3, 4242);
    struct Shape { std::uint64_t size; std::uint32_t line, ways; };
    const Shape shapes[] = {{1024, 64, 1}, {32 * 1024, 64, 8}, {48 * 1024, 64, 12},
                            {4096, 64, 64} /* fully associative, hash index */, {1U << 20, 16, 1}};
    for (const Shape& s : shapes) {
        for (WriteMissPolicy m : {WriteMissPolicy::WriteAllocate, WriteMissPolicy::NoWriteAllocate}) {
            HierarchyConfig c = l1_only(s.size, s.line, s.ways, PolicyKind::Lru, 1, 100);
            c.l1.write_miss_policy = m;
            check_invariants(simulate(*t, c), c, "L1-only " + std::to_string(s.size) + "/" + std::to_string(s.ways));
        }
    }
}

TEST_CASE("stress.three_c_partitions_misses") {
    const auto t = synthetic_mixed(1'000'000, 8);
    for (InclusionPolicy inc : {InclusionPolicy::NonInclusive, InclusionPolicy::Exclusive}) {
        HierarchyConfig c = default_hierarchy();
        c.l1.size_bytes = 8 * 1024;
        c.inclusion = inc;
        Session s(t, c, kRef);
        s.run_to_end();
        for (LevelId l : {LevelId::L1, LevelId::L2}) {
            // An exclusive L2 reports no 3C split (session.three_c_not_reported_for_exclusive_l2).
            if (l == LevelId::L2 && inc == InclusionPolicy::Exclusive) {
                CHECK(!s.three_c(l).has_value());
                continue;
            }
            const MissBreakdown b = *s.three_c(l);
            const LevelStats& st = l == LevelId::L1 ? s.result().l1 : *s.result().l2;
            // L1: write-around misses are demand misses too (classified), so all misses partition.
            CHECK_EQ(b.compulsory + b.capacity + b.conflict, st.misses);
        }
    }
}

TEST_CASE("stress.event_log_never_overflows") {
    // Worst case for actions per access: inclusive + dirty data + write-through below.
    const auto t = synthetic_mixed(200'000, 17);
    HierarchyConfig c;
    c.l1 = level("L1", 1024, 64, 2, PolicyKind::Random, 1);
    c.l2 = level("L2", 2048, 64, 1, PolicyKind::Random, 5);
    c.l1.write_policy = WritePolicy::WriteThrough;
    c.inclusion = InclusionPolicy::Inclusive;
    c.memory_latency_cycles = 50;
    Session s(t, c, kRef);
    std::vector<AccessEvent> ev;
    std::size_t max_actions = 0;
    while (!s.finished()) {
        ev.clear();
        s.step(4096, &ev);
        for (const auto& e : ev) max_actions = std::max<std::size_t>(max_actions, e.action_count);
    }
    CHECK(max_actions <= AccessEvent::kMaxActions);
    CHECK(max_actions >= 6);
}
