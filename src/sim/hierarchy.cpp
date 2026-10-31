#include "ccsim/sim/hierarchy.hpp"

#include <stdexcept>
#include <string>

namespace ccsim {

std::optional<double> SimulationResult::amat_cycles() const {
    if (l1.accesses == 0) return std::nullopt;
    // One correctly rounded division of two exact integers: bit-identical on every
    // IEEE-754 platform (TECHNICAL_DESIGN section 6).
    return static_cast<double>(total_latency_cycles) / static_cast<double>(l1.accesses);
}

// Appends actions to the event when one is being recorded; a no-op otherwise.
class Hierarchy::Recorder {
public:
    explicit Recorder(AccessEvent* event) noexcept : ev_(event) {}
    bool active() const noexcept { return ev_ != nullptr; }
    AccessEvent* event() const noexcept { return ev_; }

    void push(ActionKind kind, LevelId level, std::uint8_t flags, std::uint32_t set,
              std::uint32_t way, std::uint64_t line) {
        if (ev_ == nullptr) return;
        if (ev_->action_count >= AccessEvent::kMaxActions) {
            throw std::logic_error("AccessEvent action log overflow");  // engine bug
        }
        Action& a = ev_->actions[ev_->action_count++];
        a.kind = kind;
        a.level = level;
        a.flags = flags;
        a.set = set;
        a.way = way;
        a.line = line;
    }

private:
    AccessEvent* ev_;
};

namespace {

std::uint8_t flags_of(bool hit, bool dirty, bool from_policy = false) noexcept {
    return static_cast<std::uint8_t>((hit ? Action::kHit : 0) | (dirty ? Action::kDirty : 0) |
                                     (from_policy ? Action::kFromPolicy : 0));
}

}  // namespace

void Hierarchy::check(const HierarchyConfig& config) {
    if (config.memory_latency_cycles == 0) throw ConfigError("memory_latency: must be at least 1");
    CacheConfig l1 = config.l1;
    if (l1.name.empty()) l1.name = "L1";
    (void)Geometry::from(l1);
    std::uint64_t worst = std::uint64_t{l1.hit_latency_cycles} + config.memory_latency_cycles;
    if (config.l2) {
        CacheConfig l2 = *config.l2;
        if (l2.name.empty()) l2.name = "L2";
        if (l2.line_bytes != l1.line_bytes) {
            throw ConfigError("L2.line: must equal L1.line (" + std::to_string(l1.line_bytes) + ") in this version");
        }
        (void)Geometry::from(l2);
        worst += l2.hit_latency_cycles;
    }
    // One access costs at most t1 + t2 + tmem, accumulated and reported as 32 bits.
    if (worst > 0xFFFFFFFFULL) {
        throw ConfigError("latency: L1 + L2 + memory latency is " + std::to_string(worst) +
                          " cycles, above the 32-bit per-access limit 4294967295");
    }
}

Hierarchy::Hierarchy(const HierarchyConfig& config, PolicyFactory factory) : config_(config) {
    if (factory == nullptr) throw ConfigError("policy: no policy factory supplied");
    check(config_);
    if (config_.l1.name.empty()) config_.l1.name = "L1";

    const Geometry g1 = Geometry::from(config_.l1);
    l1_ = std::make_unique<CacheLevel>(
        config_.l1, factory(config_.l1.policy, g1.sets, g1.ways, config_.seed + 0));
    if (config_.l2) {
        if (config_.l2->name.empty()) config_.l2->name = "L2";
        const Geometry g2 = Geometry::from(*config_.l2);
        l2_ = std::make_unique<CacheLevel>(
            *config_.l2, factory(config_.l2->policy, g2.sets, g2.ways, config_.seed + 1));
        result_.l2.emplace();
    } else {
        config_.inclusion = InclusionPolicy::NonInclusive;  // meaningless without L2
    }
}

std::size_t Hierarchy::memory_bytes() const noexcept {
    return l1_->memory_bytes() + (l2_ ? l2_->memory_bytes() : 0);
}

void Hierarchy::memory_read(std::uint64_t line, Recorder& rec) {
    ++result_.memory.reads;
    rec.push(ActionKind::MemoryRead, LevelId::Memory, 0, 0, 0, line);
}

void Hierarchy::memory_write(std::uint64_t line, Recorder& rec) {
    ++result_.memory.writes;
    rec.push(ActionKind::MemoryWrite, LevelId::Memory, 0, 0, 0, line);
}

// Removes the line in (set, way) of L2 to make room. Inclusive: the copy in L1, if any, is
// back-invalidated first and its dirty data merged, so at most one memory write results.
void Hierarchy::evict_l2_slot(std::uint32_t set, std::uint32_t way, bool from_policy,
                              Recorder& rec) {
    LevelStats& s2 = *result_.l2;
    const Victim v = l2_->take(set, way);
    if (!v.valid) return;
    ++s2.evictions;
    rec.push(ActionKind::Evict, LevelId::L2, flags_of(false, v.dirty, from_policy), set, way, v.line);
    bool dirty = v.dirty;
    if (config_.inclusion == InclusionPolicy::Inclusive) {
        const std::uint32_t s1 = l1_->geometry().set_of(v.line);
        const std::uint32_t w1 = l1_->find(s1, v.line);
        if (w1 != kNoWay) {
            const Victim b = l1_->take(s1, w1);
            ++result_.l1.back_invalidations;
            rec.push(ActionKind::BackInvalidate, LevelId::L1, flags_of(false, b.dirty), s1, w1, v.line);
            dirty = dirty || b.dirty;
        }
    }
    if (dirty) {
        ++s2.writebacks;
        memory_write(v.line, rec);
    }
}

// Demand fetch of `line` from L2 after an L1 miss (TECHNICAL_DESIGN 5.2 step 3;
// exclusive variant in ARCHITECTURE 5.3).
void Hierarchy::demand_fetch_l2(std::uint64_t line, Recorder& rec, std::uint32_t& latency,
                                Outcome& l2_outcome, bool& dirty_from_below) {
    CacheLevel& c2 = *l2_;
    LevelStats& s2 = *result_.l2;
    const std::uint32_t set = c2.geometry().set_of(line);
    ++s2.accesses;
    ++s2.reads;
    c2.count_access(set);
    latency += c2.config().hit_latency_cycles;

    const std::uint32_t way = c2.find(set, line);
    if (way != kNoWay) {
        ++s2.hits;
        l2_outcome = Outcome::Hit;
        rec.push(ActionKind::Lookup, LevelId::L2, Action::kHit, set, way, line);
        if (rec.active()) rec.event()->l2.way = way;
        if (config_.inclusion == InclusionPolicy::Exclusive) {
            const Victim moved = c2.take(set, way);
            dirty_from_below = moved.dirty;
            rec.push(ActionKind::MoveOut, LevelId::L2, flags_of(true, moved.dirty), set, way, line);
        } else {
            c2.touch(set, way);
        }
        return;
    }

    ++s2.misses;
    ++s2.read_misses;
    c2.count_miss(set);
    l2_outcome = Outcome::Miss;
    rec.push(ActionKind::Lookup, LevelId::L2, 0, set, 0, line);
    latency += config_.memory_latency_cycles;
    if (config_.inclusion == InclusionPolicy::Exclusive) {
        memory_read(line, rec);  // goes straight to L1; L2 only holds L1 victims
        return;
    }
    bool from_policy = false;
    const std::uint32_t target = c2.choose_way(set, &from_policy);
    evict_l2_slot(set, target, from_policy, rec);
    memory_read(line, rec);
    c2.install(set, target, line, false);
    rec.push(ActionKind::Fill, LevelId::L2, 0, set, target, line);
    if (rec.active()) rec.event()->l2.way = target;
}

// A dirty L1 victim (full line) arriving at L2 (TECHNICAL_DESIGN 5.3).
void Hierarchy::writeback_into_l2(std::uint64_t line, Recorder& rec) {
    CacheLevel& c2 = *l2_;
    LevelStats& s2 = *result_.l2;
    const bool write_back = c2.config().write_policy == WritePolicy::WriteBack;
    const std::uint32_t set = c2.geometry().set_of(line);
    ++s2.writebacks_received;
    const std::uint32_t way = c2.find(set, line);
    if (way != kNoWay) {
        ++s2.writeback_hits;
        c2.touch(set, way);  // a write-back counts as a use
        rec.push(ActionKind::Writeback, LevelId::L2, flags_of(true, true), set, way, line);
        if (write_back) {
            c2.mark_dirty(set, way);
        } else {
            ++s2.write_throughs_sent;
            memory_write(line, rec);
        }
        return;
    }
    ++s2.writeback_misses;
    rec.push(ActionKind::Writeback, LevelId::L2, flags_of(false, true), set, 0, line);
    if (!write_back) {  // write-through L2 does not allocate for a write
        ++s2.write_throughs_sent;
        memory_write(line, rec);
        return;
    }
    bool from_policy = false;
    const std::uint32_t target = c2.choose_way(set, &from_policy);
    evict_l2_slot(set, target, from_policy, rec);
    c2.install(set, target, line, true);  // full line supplied: no memory read
    rec.push(ActionKind::Fill, LevelId::L2, Action::kDirty, set, target, line);
}

// Exclusive: every L1 victim, clean or dirty, moves into L2.
void Hierarchy::insert_victim_into_l2(const Victim& victim, Recorder& rec) {
    CacheLevel& c2 = *l2_;
    LevelStats& s2 = *result_.l2;
    const std::uint32_t set = c2.geometry().set_of(victim.line);
    ++s2.victims_received;
    if (victim.dirty) {
        ++s2.writebacks_received;
        ++s2.writeback_misses;  // by exclusivity L2 never already holds it
    }
    rec.push(ActionKind::VictimInsert, LevelId::L2, flags_of(false, victim.dirty), set, 0, victim.line);
    bool from_policy = false;
    const std::uint32_t target = c2.choose_way(set, &from_policy);
    evict_l2_slot(set, target, from_policy, rec);
    bool dirty = victim.dirty;
    if (dirty && c2.config().write_policy == WritePolicy::WriteThrough) {
        ++s2.write_throughs_sent;
        memory_write(victim.line, rec);
        dirty = false;
    }
    c2.install(set, target, victim.line, dirty);
    rec.push(ActionKind::Fill, LevelId::L2, flags_of(false, dirty), set, target, victim.line);
}

// A partial-line store leaving L1 (write-through, or write-around on a miss). Partial
// stores never allocate below L1: on a miss they continue to memory.
void Hierarchy::write_through_below_l1(std::uint64_t line, Recorder& rec) {
    if (!l2_) {
        memory_write(line, rec);
        return;
    }
    CacheLevel& c2 = *l2_;
    LevelStats& s2 = *result_.l2;
    const std::uint32_t set = c2.geometry().set_of(line);
    ++s2.write_throughs_received;
    const std::uint32_t way = c2.find(set, line);
    const bool hit = way != kNoWay;
    rec.push(ActionKind::WriteThrough, LevelId::L2, flags_of(hit, false), set, hit ? way : 0, line);
    if (hit) {
        c2.touch(set, way);
        if (c2.config().write_policy == WritePolicy::WriteBack) {
            c2.mark_dirty(set, way);
            return;
        }
    }
    ++s2.write_throughs_sent;
    memory_write(line, rec);
}

AccessSummary Hierarchy::step(const MemoryAccess& access, AccessEvent* event) {
    Recorder rec(event);
    CacheLevel& c1 = *l1_;
    const CacheConfig& k1 = c1.config();
    const Geometry& g1 = c1.geometry();
    LevelStats& s1 = result_.l1;
    const bool write = access.type == AccessType::Write;
    const std::uint64_t line = g1.line_of(access.address);
    const std::uint32_t set = g1.set_of(line);

    AccessSummary summary;
    summary.line = line;
    if (event != nullptr) {
        event->seq = seq_;
        event->access = access;
        event->line = line;
        event->offset = g1.offset_of(access.address);
        event->l1 = {Outcome::NotAccessed, set, g1.tag_of(line), 0};
        event->l2 = {};
        if (l2_) {
            event->l2.set = l2_->geometry().set_of(line);
            event->l2.tag = l2_->geometry().tag_of(line);
        }
        event->action_count = 0;
    }

    ++s1.accesses;
    if (write) ++s1.writes; else ++s1.reads;
    c1.count_access(set);
    std::uint32_t latency = k1.hit_latency_cycles;

    std::uint32_t way = c1.find(set, line);
    if (way != kNoWay) {
        ++s1.hits;
        c1.touch(set, way);
        summary.l1 = Outcome::Hit;
        rec.push(ActionKind::Lookup, LevelId::L1, Action::kHit, set, way, line);
        if (write) {
            if (k1.write_policy == WritePolicy::WriteBack) {
                c1.mark_dirty(set, way);
            } else {
                ++s1.write_throughs_sent;
                write_through_below_l1(line, rec);
            }
        }
    } else {
        ++s1.misses;
        if (write) ++s1.write_misses; else ++s1.read_misses;
        c1.count_miss(set);
        rec.push(ActionKind::Lookup, LevelId::L1, 0, set, 0, line);

        if (write && k1.write_miss_policy == WriteMissPolicy::NoWriteAllocate) {
            // Write-around: the store retires into a write buffer (costs the L1 lookup only).
            ++s1.no_allocate_misses;
            ++s1.write_throughs_sent;
            summary.l1 = Outcome::MissNoAllocate;
            write_through_below_l1(line, rec);
        } else {
            summary.l1 = Outcome::Miss;
            // 1. Choose the L1 way and remove its line now, so an inclusive
            //    back-invalidation later cannot find (and double-count) it.
            bool from_policy = false;
            way = c1.choose_way(set, &from_policy);
            const Victim victim = c1.take(set, way);
            if (victim.valid) {
                ++s1.evictions;
                if (victim.dirty) ++s1.writebacks;
                rec.push(ActionKind::Evict, LevelId::L1, flags_of(false, victim.dirty, from_policy), set,
                         way, victim.line);
            }

            bool dirty_from_below = false;
            if (!l2_) {
                if (victim.valid && victim.dirty) memory_write(victim.line, rec);
                memory_read(line, rec);
                latency += config_.memory_latency_cycles;
            } else if (config_.inclusion == InclusionPolicy::Exclusive) {
                // 2. Demand lookup first (a hit frees an L2 slot), 3. then the victim moves down.
                demand_fetch_l2(line, rec, latency, summary.l2, dirty_from_below);
                if (victim.valid) insert_victim_into_l2(victim, rec);
            } else {
                // 2. Dirty victim into L2 first (it can change L2 replacement state),
                // 3. then the demand fetch (TECHNICAL_DESIGN 5.2, normative order).
                if (victim.valid && victim.dirty) writeback_into_l2(victim.line, rec);
                demand_fetch_l2(line, rec, latency, summary.l2, dirty_from_below);
            }

            // 4. Install in L1; a write-allocated store dirties it under write-back.
            const bool dirty = dirty_from_below || (write && k1.write_policy == WritePolicy::WriteBack);
            c1.install(set, way, line, dirty);
            rec.push(ActionKind::Fill, LevelId::L1, flags_of(false, dirty), set, way, line);
            if (write && k1.write_policy == WritePolicy::WriteThrough) {
                ++s1.write_throughs_sent;
                write_through_below_l1(line, rec);
            }
        }
    }

    result_.total_latency_cycles += latency;
    summary.latency_cycles = latency;
    if (event != nullptr) {
        event->l1.outcome = summary.l1;
        event->l1.way = way == kNoWay ? 0 : way;
        event->l2.outcome = summary.l2;
        event->latency_cycles = latency;
    }
    ++seq_;
    return summary;
}

}  // namespace ccsim
