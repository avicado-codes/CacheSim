// Differential oracle for the engine (QA pass 2026-10-31, docs/QA_REPORT.md).
//
// `Model` below is a second, deliberately naive implementation of the cache semantics, written
// from docs/ARCHITECTURE.md 5.3 (order of operations, rules 1-8) and TECHNICAL_DESIGN 4-5:
// vectors of structs, a linear scan per lookup, its own LRU / FIFO / seeded Random, and none of
// the engine's machinery (no LineIndex, no per-set fill counters, no policy objects). It is
// fuzzed against the shipped engine over random configurations, from direct-mapped to more
// than 16 ways, 1- to 128-byte lines, every inclusion and write policy, and random traces that
// include the address extremes. Every counter, the total latency and the final contents of
// every slot (valid, dirty, line) must match exactly.
//
// A second test checks the structural meaning of inclusion after EVERY access: inclusive keeps
// each valid L1 line in L2; exclusive never holds a line in both.
//
// Engine under test: the production policies when src/policy/ exists, else the reference
// stand-ins (tests/support/), so the oracle also guards the engine on its own.

#include <cstdio>
#include <optional>
#include <random>
#include <string>
#include <vector>

#include "ccsim/report/json.hpp"
#include "ccsim/sim/hierarchy.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

namespace {

#ifdef CCSIM_HAS_PRODUCTION_POLICIES
constexpr PolicyFactory kEngine = &make_policy;
#else
constexpr PolicyFactory kEngine = kRef;
#endif

struct Slot {
    bool valid = false, dirty = false;
    std::uint64_t line = 0;
    std::uint64_t stamp = 0;  // LRU: last touch; FIFO: fill time
};

struct Level {
    CacheConfig cfg;
    std::uint32_t sets = 0, ways = 0;
    std::vector<std::vector<Slot>> s;
    std::uint64_t clock = 0;
    std::mt19937_64 rng;
    LevelStats st;

    Level(const CacheConfig& c, std::uint64_t seed) : cfg(c), ways(c.ways), rng(seed) {
        sets = static_cast<std::uint32_t>(c.size_bytes / (std::uint64_t{c.line_bytes} * c.ways));
        s.assign(sets, std::vector<Slot>(ways));
    }
    std::uint32_t set_of(std::uint64_t line) const { return static_cast<std::uint32_t>(line % sets); }
    std::optional<std::uint32_t> find(std::uint64_t line) const {
        const auto& set = s[set_of(line)];
        for (std::uint32_t w = 0; w < ways; ++w)
            if (set[w].valid && set[w].line == line) return w;
        return std::nullopt;
    }
    // A use: demand hit, write-back hit or forwarded store hit (ARCHITECTURE 5.3).
    void touch(std::uint32_t set, std::uint32_t w) {
        if (cfg.policy == PolicyKind::Lru) s[set][w].stamp = ++clock;
    }
    // Lowest invalid way, else the policy's victim (TECHNICAL_DESIGN 5.1).
    std::uint32_t choose(std::uint32_t set) {
        for (std::uint32_t w = 0; w < ways; ++w)
            if (!s[set][w].valid) return w;
        if (cfg.policy == PolicyKind::Random) return static_cast<std::uint32_t>(rng() % ways);
        std::uint32_t v = 0;
        for (std::uint32_t w = 1; w < ways; ++w)
            if (s[set][w].stamp < s[set][v].stamp) v = w;
        return v;
    }
    void install(std::uint32_t set, std::uint32_t w, std::uint64_t line, bool dirty) {
        s[set][w] = {true, dirty, line, cfg.policy == PolicyKind::Random ? 0 : ++clock};
    }
};

struct Model {
    HierarchyConfig c;
    Level l1;
    std::optional<Level> l2;
    MemoryStats mem;
    std::uint64_t total = 0;
    std::uint32_t shift = 0;

    explicit Model(const HierarchyConfig& cfg) : c(cfg), l1(cfg.l1, cfg.seed) {
        if (cfg.l2) l2.emplace(*cfg.l2, cfg.seed + 1);
        else c.inclusion = InclusionPolicy::NonInclusive;
        while ((std::uint64_t{1} << shift) < cfg.l1.line_bytes) ++shift;
    }

    // Rule 3: an L2 eviction back-invalidates L1 under inclusion; one memory write if dirty.
    void evict_l2(std::uint32_t set, std::uint32_t w) {
        const Slot v = l2->s[set][w];
        l2->s[set][w].valid = false;
        if (!v.valid) return;
        ++l2->st.evictions;
        bool dirty = v.dirty;
        if (c.inclusion == InclusionPolicy::Inclusive) {
            if (const auto w1 = l1.find(v.line)) {
                Slot& b = l1.s[l1.set_of(v.line)][*w1];
                dirty = dirty || b.dirty;
                b.valid = false;
                ++l1.st.back_invalidations;
            }
        }
        if (dirty) {
            ++l2->st.writebacks;
            ++mem.writes;
        }
    }

    // Rule 5: a partial store updates a resident lower copy, never allocates.
    void partial_store(std::uint64_t line) {
        if (!l2) {
            ++mem.writes;
            return;
        }
        ++l2->st.write_throughs_received;
        if (const auto w = l2->find(line)) {
            const std::uint32_t set = l2->set_of(line);
            l2->touch(set, *w);
            if (l2->cfg.write_policy == WritePolicy::WriteBack) {
                l2->s[set][*w].dirty = true;
                return;
            }
        }
        ++l2->st.write_throughs_sent;
        ++mem.writes;
    }

    // Rule 2: a dirty L1 victim reaches L2 before the demand fetch.
    void writeback(std::uint64_t line) {
        ++l2->st.writebacks_received;
        const std::uint32_t set = l2->set_of(line);
        const bool wb = l2->cfg.write_policy == WritePolicy::WriteBack;
        if (const auto w = l2->find(line)) {
            ++l2->st.writeback_hits;
            l2->touch(set, *w);
            if (wb) {
                l2->s[set][*w].dirty = true;
            } else {
                ++l2->st.write_throughs_sent;
                ++mem.writes;
            }
            return;
        }
        ++l2->st.writeback_misses;
        if (!wb) {
            ++l2->st.write_throughs_sent;
            ++mem.writes;
            return;
        }
        const std::uint32_t t = l2->choose(set);
        evict_l2(set, t);
        l2->install(set, t, line, true);
    }

    std::uint64_t demand(std::uint64_t line, bool& dirty_below) {
        std::uint64_t lat = l2->cfg.hit_latency_cycles;
        ++l2->st.accesses;
        ++l2->st.reads;
        const std::uint32_t set = l2->set_of(line);
        if (const auto w = l2->find(line)) {
            ++l2->st.hits;
            if (c.inclusion == InclusionPolicy::Exclusive) {  // rule 4: moves up, no L2 touch
                dirty_below = l2->s[set][*w].dirty;
                l2->s[set][*w].valid = false;
            } else {
                l2->touch(set, *w);
            }
            return lat;
        }
        ++l2->st.misses;
        ++l2->st.read_misses;
        lat += c.memory_latency_cycles;
        ++mem.reads;
        if (c.inclusion == InclusionPolicy::Exclusive) return lat;  // memory fills L1 directly
        const std::uint32_t t = l2->choose(set);
        evict_l2(set, t);
        l2->install(set, t, line, false);
        return lat;
    }

    void victim_into_l2(const Slot& v) {
        ++l2->st.victims_received;
        if (v.dirty) {
            ++l2->st.writebacks_received;
            ++l2->st.writeback_misses;
        }
        const std::uint32_t set = l2->set_of(v.line);
        const std::uint32_t t = l2->choose(set);
        evict_l2(set, t);
        bool dirty = v.dirty;
        if (dirty && l2->cfg.write_policy == WritePolicy::WriteThrough) {
            ++l2->st.write_throughs_sent;
            ++mem.writes;
            dirty = false;
        }
        l2->install(set, t, v.line, dirty);
    }

    void access(const MemoryAccess& a) {
        const bool write = a.type == AccessType::Write;
        const bool wb1 = l1.cfg.write_policy == WritePolicy::WriteBack;
        const std::uint64_t line = a.address >> shift;
        const std::uint32_t set = l1.set_of(line);
        LevelStats& s1 = l1.st;
        ++s1.accesses;
        if (write) ++s1.writes; else ++s1.reads;
        std::uint64_t lat = l1.cfg.hit_latency_cycles;
        if (const auto w = l1.find(line)) {
            ++s1.hits;
            l1.touch(set, *w);
            if (write && wb1) l1.s[set][*w].dirty = true;
            if (write && !wb1) {
                ++s1.write_throughs_sent;
                partial_store(line);
            }
            total += lat;
            return;
        }
        ++s1.misses;
        if (write) ++s1.write_misses; else ++s1.read_misses;
        if (write && l1.cfg.write_miss_policy == WriteMissPolicy::NoWriteAllocate) {  // write-around
            ++s1.no_allocate_misses;
            ++s1.write_throughs_sent;
            partial_store(line);
            total += lat;
            return;
        }
        const std::uint32_t way = l1.choose(set);  // rule 1: the victim leaves first
        const Slot victim = l1.s[set][way];
        l1.s[set][way].valid = false;
        if (victim.valid) {
            ++s1.evictions;
            if (victim.dirty) ++s1.writebacks;
        }
        bool dirty_below = false;
        if (!l2) {
            if (victim.valid && victim.dirty) ++mem.writes;
            ++mem.reads;
            lat += c.memory_latency_cycles;
        } else if (c.inclusion == InclusionPolicy::Exclusive) {
            lat += demand(line, dirty_below);
            if (victim.valid) victim_into_l2(victim);
        } else {
            if (victim.valid && victim.dirty) writeback(victim.line);
            lat += demand(line, dirty_below);
        }
        l1.install(set, way, line, dirty_below || (write && wb1));
        if (write && !wb1) {
            ++s1.write_throughs_sent;
            partial_store(line);
        }
        total += lat;
    }
};

std::string compare_stats(const LevelStats& e, const LevelStats& m) {
    const std::uint64_t LevelStats::*f[] = {
        &LevelStats::accesses, &LevelStats::reads, &LevelStats::writes, &LevelStats::hits, &LevelStats::misses,
        &LevelStats::read_misses, &LevelStats::write_misses, &LevelStats::evictions, &LevelStats::writebacks,
        &LevelStats::writebacks_received, &LevelStats::writeback_hits, &LevelStats::writeback_misses,
        &LevelStats::no_allocate_misses, &LevelStats::write_throughs_sent, &LevelStats::write_throughs_received,
        &LevelStats::back_invalidations, &LevelStats::victims_received};
    for (std::size_t i = 0; i < sizeof f / sizeof f[0]; ++i) {
        if (e.*f[i] != m.*f[i]) {
            return "stats field #" + std::to_string(i) + " engine=" + std::to_string(e.*f[i]) +
                   " model=" + std::to_string(m.*f[i]);
        }
    }
    return {};
}

std::string compare_slots(const CacheLevel& e, const Level& m) {
    const Geometry& g = e.geometry();
    for (std::uint32_t s = 0; s < g.sets; ++s) {
        for (std::uint32_t w = 0; w < g.ways; ++w) {
            const Slot& ms = m.s[s][w];
            const std::string at = " at set " + std::to_string(s) + " way " + std::to_string(w);
            if (e.is_valid(s, w) != ms.valid) return "valid bit" + at;
            if (!ms.valid) continue;
            if (e.is_dirty(s, w) != ms.dirty) return "dirty bit" + at;
            if (g.line_from(e.tag_at(s, w), s) != ms.line) return "line" + at;
        }
    }
    return {};
}

template <class T>
T pick(std::mt19937_64& r, std::initializer_list<T> xs) {
    return *(xs.begin() + static_cast<std::ptrdiff_t>(r() % xs.size()));
}

HierarchyConfig random_config(std::mt19937_64& r) {
    const std::uint32_t line = pick<std::uint32_t>(r, {1, 2, 4, 8, 16, 32, 64, 128});
    auto lvl = [&](const char* name, std::initializer_list<std::uint32_t> ways, std::initializer_list<std::uint32_t> sets) {
        CacheConfig k;
        k.name = name;
        k.line_bytes = line;
        k.ways = pick<std::uint32_t>(r, ways);
        k.size_bytes = std::uint64_t{line} * k.ways * pick<std::uint32_t>(r, sets);
        k.hit_latency_cycles = 1 + static_cast<std::uint32_t>(r() % 40);
        k.policy = static_cast<PolicyKind>(r() % kPolicyKindCount);
        k.write_policy = static_cast<WritePolicy>(r() % 2);
        k.write_miss_policy = static_cast<WriteMissPolicy>(r() % 2);
        return k;
    };
    HierarchyConfig c;
    c.l1 = lvl("L1", {1, 2, 3, 4, 8, 12, 16, 17, 32}, {1, 2, 4, 8, 16});
    if (r() % 3 != 0) c.l2 = lvl("L2", {1, 2, 4, 6, 8, 16, 20, 64}, {1, 2, 4, 8, 32, 64});
    c.memory_latency_cycles = 1 + static_cast<std::uint32_t>(r() % 400);
    c.inclusion = static_cast<InclusionPolicy>(r() % 3);
    c.seed = r();
    return c;
}

std::vector<MemoryAccess> random_trace(std::mt19937_64& r, std::size_t n, std::uint32_t line) {
    const std::uint64_t footprint = 4 + r() % 300;  // distinct lines: from all-hits to thrashing
    const std::uint64_t base = (r() % 4 == 0) ? 0xFFFF'FFFF'0000'0000ULL : (r() & 0xFFFFF000ULL);
    const std::uint64_t write_permille = r() % 1000;
    std::vector<MemoryAccess> t;
    t.reserve(n);
    for (std::size_t i = 0; i < n; ++i) {
        MemoryAccess a;
        a.type = r() % 1000 < write_permille ? AccessType::Write : AccessType::Read;
        const std::uint64_t l = (r() % 5 == 0) ? (i % footprint) : (r() % footprint);  // some streaming
        a.address = base + l * line * pick<std::uint64_t>(r, {1, 1, 1, 3, 16}) + (r() % line);
        if (r() % 97 == 0) a.address = pick<std::uint64_t>(r, {0ULL, ~0ULL, 0x8000000000000000ULL, ~0ULL - 1});
        t.push_back(a);
    }
    return t;
}

}  // namespace

TEST_CASE("differential.engine_matches_independent_model") {
    std::mt19937_64 r(20261031);
    constexpr int kConfigs = 3000;
    int failures = 0;
    std::uint64_t accesses = 0;
    for (int iter = 0; iter < kConfigs && failures < 5; ++iter) {
        const HierarchyConfig c = random_config(r);
        const auto trace = random_trace(r, 1000 + r() % 3000, c.l1.line_bytes);
        Hierarchy h(c, kEngine);
        Model m(c);
        for (const MemoryAccess& a : trace) {
            h.access(a);
            m.access(a);
        }
        accesses += trace.size();
        const SimulationResult& e = h.result();
        std::string why = compare_stats(e.l1, m.l1.st);
        if (why.empty() && c.l2) why = compare_stats(*e.l2, m.l2->st);
        if (why.empty() && (e.memory.reads != m.mem.reads || e.memory.writes != m.mem.writes)) why = "memory traffic";
        if (why.empty() && e.total_latency_cycles != m.total) why = "total latency";
        if (why.empty()) why = compare_slots(h.l1(), m.l1);
        if (why.empty() && c.l2) why = compare_slots(*h.l2(), *m.l2);
        if (!why.empty()) {
            ++failures;
            std::printf("  config %d: %s\n    %s\n", iter, why.c_str(), describe(c).c_str());
        }
        CHECK(why.empty());
        check_invariants(e, c, "differential config " + std::to_string(iter));
    }
    std::printf("  %d configurations, %llu accesses compared\n", kConfigs, static_cast<unsigned long long>(accesses));
}

TEST_CASE("differential.inclusion_holds_after_every_access") {
    std::mt19937_64 r(4242);
    std::uint64_t states = 0;
    for (int iter = 0; iter < 400; ++iter) {
        HierarchyConfig c = random_config(r);
        if (!c.l2) {
            c.l2 = c.l1;
            c.l2->name = "L2";
            c.l2->size_bytes *= 4;
        }
        c.inclusion = iter % 2 != 0 ? InclusionPolicy::Inclusive : InclusionPolicy::Exclusive;
        const auto trace = random_trace(r, 800, c.l1.line_bytes);
        Hierarchy h(c, kEngine);
        const CacheLevel& a = h.l1();
        const CacheLevel& b = *h.l2();
        for (std::size_t i = 0; i < trace.size(); ++i) {
            h.access(trace[i]);
            ++states;
            for (std::uint32_t s = 0; s < a.geometry().sets; ++s) {
                for (std::uint32_t w = 0; w < a.geometry().ways; ++w) {
                    if (!a.is_valid(s, w)) continue;
                    const std::uint64_t line = a.geometry().line_from(a.tag_at(s, w), s);
                    const bool in_l2 = b.find(b.geometry().set_of(line), line) != kNoWay;
                    const bool ok = c.inclusion == InclusionPolicy::Inclusive ? in_l2 : !in_l2;
                    if (!ok) {
                        std::printf("  access %zu, line 0x%llx: %s\n    %s\n", i, static_cast<unsigned long long>(line),
                                    in_l2 ? "in both levels (exclusive)" : "missing from L2 (inclusive)", describe(c).c_str());
                        CHECK(ok);
                        return;
                    }
                }
            }
        }
    }
    std::printf("  %llu post-access states checked\n", static_cast<unsigned long long>(states));
}
