// Session: the live controller must be observationally identical to a batch run, however
// it is driven (step sizes, seeks backwards and forwards, breakpoints, reset).

#include <vector>

#include "ccsim/session/session.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

namespace {

bool same(const LevelStats& a, const LevelStats& b) {
    return a.accesses == b.accesses && a.hits == b.hits && a.misses == b.misses && a.evictions == b.evictions &&
           a.writebacks == b.writebacks && a.back_invalidations == b.back_invalidations &&
           a.write_throughs_sent == b.write_throughs_sent && a.victims_received == b.victims_received;
}

bool same(const SimulationResult& a, const SimulationResult& b) {
    return same(a.l1, b.l1) && a.l2.has_value() == b.l2.has_value() && (!a.l2 || same(*a.l2, *b.l2)) &&
           a.memory.reads == b.memory.reads && a.memory.writes == b.memory.writes &&
           a.total_latency_cycles == b.total_latency_cycles;
}

HierarchyConfig small_two_level(InclusionPolicy p) {
    HierarchyConfig c;
    c.l1 = level("L1", 1024, 64, 2, PolicyKind::Lru, 1);
    c.l2 = level("L2", 4096, 64, 4, PolicyKind::Random, 10);
    c.memory_latency_cycles = 100;
    c.inclusion = p;
    c.seed = 7;
    return c;
}

}  // namespace

TEST_CASE("session.stepping_equals_batch") {
    const auto t = synthetic_mixed(60000, 3);
    for (InclusionPolicy p : {InclusionPolicy::NonInclusive, InclusionPolicy::Inclusive, InclusionPolicy::Exclusive}) {
        const HierarchyConfig c = small_two_level(p);
        const SimulationResult batch = simulate(*t, c);
        Session s(t, c, kRef);
        std::vector<AccessEvent> events;
        std::size_t k = 1;
        while (!s.finished()) {
            events.clear();
            s.step(k, &events);
            k = k * 3 % 1013 + 1;  // irregular slice sizes
        }
        CHECK(same(s.result(), batch));
        CHECK_EQ(s.timeline().back().accesses, t->size());
    }
}

TEST_CASE("session.events_are_consistent_with_counters") {
    const auto t = synthetic_mixed(20000, 11);
    const HierarchyConfig c = small_two_level(InclusionPolicy::Inclusive);
    Session s(t, c, kRef);
    std::vector<AccessEvent> events;
    s.step(t->size(), &events);
    std::uint64_t mem_r = 0, mem_w = 0, latency = 0, l1_hits = 0;
    for (std::size_t i = 0; i < events.size(); ++i) {
        const AccessEvent& e = events[i];
        CHECK_EQ(e.seq, i);
        latency += e.latency_cycles;
        if (e.l1.outcome == Outcome::Hit) ++l1_hits;
        for (std::uint8_t a = 0; a < e.action_count; ++a) {
            if (e.actions[a].kind == ActionKind::MemoryRead) ++mem_r;
            if (e.actions[a].kind == ActionKind::MemoryWrite) ++mem_w;
        }
    }
    CHECK_EQ(mem_r, s.result().memory.reads);
    CHECK_EQ(mem_w, s.result().memory.writes);
    CHECK_EQ(latency, s.result().total_latency_cycles);
    CHECK_EQ(l1_hits, s.result().l1.hits);
}

TEST_CASE("session.seek_backwards_and_forwards") {
    const auto t = synthetic_mixed(30000, 5);
    const HierarchyConfig c = small_two_level(InclusionPolicy::Exclusive);
    Session ref(t, c, kRef);
    ref.seek(12345);
    const SimulationResult at = ref.result();

    Session s(t, c, kRef);
    s.seek(25000);
    s.seek(100);
    s.seek(12345);
    CHECK_EQ(s.position(), 12345u);
    CHECK(same(s.result(), at));
    s.seek(1U << 30);  // clamps to the end
    CHECK(s.finished());
    s.reset();
    CHECK_EQ(s.position(), 0u);
    CHECK_EQ(s.result().l1.accesses, 0u);
}

TEST_CASE("session.breakpoints") {
    // Demo B: the first L2 hit is step 5 (seq 4); the first memory write is step 7 (seq 6).
    const auto t = load_trace_file(data_dir() + "/golden/demo_b_two_level.trace");
    HierarchyConfig c;
    c.l1 = level("L1", 64, 16, 2, PolicyKind::Lru, 1);
    c.l2 = level("L2", 128, 16, 2, PolicyKind::Lru, 10);
    c.memory_latency_cycles = 100;
    Session s(t, c, kRef);
    AccessEvent e;
    Breakpoints bp;
    bp.mask = Breakpoints::kWriteback;
    CHECK(s.run(100, bp, &e) == StopReason::Breakpoint);
    CHECK_EQ(e.seq, 3u);  // step 4: dirty line 0 leaves L1
    bp.mask = Breakpoints::kMemoryAccess;
    CHECK(s.run(100, bp, &e) == StopReason::Breakpoint);
    CHECK_EQ(e.seq, 5u);  // step 6 reads memory (step 5 was an L2 hit)
    bp.mask = Breakpoints::kLine;
    bp.line = 12;  // 0x0C4 >> 4
    CHECK(s.run(100, bp, &e) == StopReason::Breakpoint);
    CHECK_EQ(e.seq, 9u);
    CHECK(s.run(100, bp, &e) == StopReason::End);
    Session s2(t, c, kRef);
    CHECK(s2.run(3, Breakpoints{}, &e) == StopReason::Budget);
    CHECK_EQ(s2.position(), 3u);
}

TEST_CASE("session.random_policy_is_reproducible") {
    const auto t = synthetic_random(100000, 1U << 16, 0.25, 77);
    HierarchyConfig c = l1_only(4096, 64, 8, PolicyKind::Random, 1, 100);
    c.seed = 2024;
    const SimulationResult a = simulate(*t, c);
    const SimulationResult b = simulate(*t, c);
    CHECK(same(a, b));
    c.seed = 2025;
    const SimulationResult d = simulate(*t, c);
    CHECK(a.l1.misses != d.l1.misses);  // the seed matters
}

TEST_CASE("session.three_c_not_reported_for_exclusive_l2") {
    // An exclusive L2 holds only L1 victims, so a shadow fed with its demand lookups does not
    // model it: L2 gets no 3C split (null in JSON), while L1 keeps its classification.
    const auto t = trace_from_text("R 0x000\nR 0x040\nR 0x080\nR 0x000\nR 0x0C0\nR 0x040\n");
    for (InclusionPolicy inc : {InclusionPolicy::NonInclusive, InclusionPolicy::Inclusive, InclusionPolicy::Exclusive}) {
        HierarchyConfig c = default_hierarchy();
        c.inclusion = inc;
        Session s(t, c, kRef);
        s.run_to_end();
        CHECK(s.three_c(LevelId::L1).has_value());
        CHECK_EQ(s.three_c(LevelId::L2).has_value(), inc != InclusionPolicy::Exclusive);
        CHECK_EQ(s.report("r").levels[1].three_c.has_value(), inc != InclusionPolicy::Exclusive);
    }
}
