// include/ccsim/sim/hierarchy.hpp
//
// The L1 / optional L2 / memory engine. Semantics: TECHNICAL_DESIGN sections 5-6 (v1)
// plus contract extension 1.1 (ARCHITECTURE section 5): inclusion policy, write-through,
// no-write-allocate. Single-threaded, deterministic, no clocks, no I/O.

#pragma once

#include <cstdint>
#include <memory>
#include <optional>

#include "ccsim/policy/replacement_policy.hpp"
#include "ccsim/sim/cache_level.hpp"
#include "ccsim/sim/events.hpp"
#include "ccsim/sim/types.hpp"

namespace ccsim {

struct SimulationResult {
    LevelStats l1;
    std::optional<LevelStats> l2;
    MemoryStats memory;
    std::uint64_t total_latency_cycles = 0;
    // total_latency_cycles / l1.accesses; nullopt when there were no accesses.
    std::optional<double> amat_cycles() const;
};

// Same signature as make_policy, so the production factory and test stand-ins are
// interchangeable. Lets the engine be built and tested before src/policy/ exists.
using PolicyFactory = std::unique_ptr<ReplacementPolicy> (*)(PolicyKind, std::uint32_t sets,
                                                            std::uint32_t ways, std::uint64_t seed);

class Hierarchy {
public:
    // Contract constructor (TECHNICAL_DESIGN 9): uses the production make_policy. Defined
    // inline so that only code which calls it needs src/policy/ at link time.
    explicit Hierarchy(const HierarchyConfig& config) : Hierarchy(config, &make_policy) {}
    Hierarchy(const HierarchyConfig& config, PolicyFactory factory);

    // Throws ConfigError for every configuration the constructor would refuse, without
    // building anything: geometry of each level, memory latency >= 1, equal line sizes, and a
    // worst-case per-access latency (t1 + t2 + tmem) that fits the 32-bit event field.
    // Sweeps use it to reject combinations up front (ARCHITECTURE 10).
    static void check(const HierarchyConfig& config);

    // Contract entry point: one demand access.
    void access(const MemoryAccess& access) { (void)step(access, nullptr); }

    // Same access; also returns a summary and, when `event` is non-null, records the full
    // ordered action log for the visualiser.
    AccessSummary step(const MemoryAccess& access, AccessEvent* event);

    const SimulationResult& result() const noexcept { return result_; }
    const HierarchyConfig& config() const noexcept { return config_; }
    const CacheLevel& l1() const noexcept { return *l1_; }
    const CacheLevel* l2() const noexcept { return l2_.get(); }
    std::uint64_t accesses_done() const noexcept { return seq_; }

    std::size_t memory_bytes() const noexcept;

private:
    class Recorder;

    void demand_fetch_l2(std::uint64_t line, Recorder& rec, std::uint32_t& latency,
                         Outcome& l2_outcome, bool& dirty_from_below);
    void writeback_into_l2(std::uint64_t line, Recorder& rec);
    void insert_victim_into_l2(const Victim& victim, Recorder& rec);
    void write_through_below_l1(std::uint64_t line, Recorder& rec);
    void evict_l2_slot(std::uint32_t set, std::uint32_t way, bool from_policy, Recorder& rec);
    void memory_write(std::uint64_t line, Recorder& rec);
    void memory_read(std::uint64_t line, Recorder& rec);

    HierarchyConfig config_;
    std::unique_ptr<CacheLevel> l1_;
    std::unique_ptr<CacheLevel> l2_;
    SimulationResult result_;
    std::uint64_t seq_ = 0;
};

}  // namespace ccsim
