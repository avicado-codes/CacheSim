#include "ccsim/session/session.hpp"

#include <stdexcept>
#include <utility>

namespace ccsim {

Session::Session(std::shared_ptr<const Trace> trace, const HierarchyConfig& config,
                 PolicyFactory factory, SessionOptions options)
    : trace_(std::move(trace)), config_(config), factory_(factory), options_(options) {
    if (!trace_) throw std::invalid_argument("Session: null trace");
    const std::uint64_t points = options_.timeline_points == 0 ? 1 : options_.timeline_points;
    window_ = trace_->size() / points + (trace_->size() % points != 0 ? 1 : 0);
    if (window_ == 0) window_ = 1;
    reset();
}

void Session::reset() {
    hierarchy_ = std::make_unique<Hierarchy>(config_, factory_);
    c1_.reset();
    c2_.reset();
    if (options_.classify_misses) {
        c1_.emplace(hierarchy_->l1().geometry().capacity_lines());
        if (const CacheLevel* l2 = hierarchy_->l2()) c2_.emplace(l2->geometry().capacity_lines());
    }
    timeline_.clear();
    position_ = 0;
}

void Session::execute(std::size_t i, AccessEvent* event) {
    const AccessSummary s = hierarchy_->step((*trace_)[i], event);
    if (c1_) c1_->observe(s.line, s.l1 == Outcome::Hit);
    // L2 demand stream = allocating L1 misses; write-around misses never reach it as demand.
    if (c2_ && s.l2 != Outcome::NotAccessed) c2_->observe(s.line, s.l2 == Outcome::Hit);
    ++position_;
    if (position_ % window_ == 0 || position_ == trace_->size()) {
        const SimulationResult& r = hierarchy_->result();
        TimelinePoint p;
        p.accesses = position_;
        p.l1_hits = r.l1.hits;
        p.l1_misses = r.l1.misses;
        if (r.l2) {
            p.l2_hits = r.l2->hits;
            p.l2_misses = r.l2->misses;
        }
        p.memory_reads = r.memory.reads;
        p.memory_writes = r.memory.writes;
        p.latency_cycles = r.total_latency_cycles;
        timeline_.push_back(p);
    }
}

std::size_t Session::step(std::size_t n, std::vector<AccessEvent>* events) {
    const std::size_t remaining = static_cast<std::size_t>(trace_->size() - position_);
    if (n > remaining) n = remaining;
    if (events == nullptr) {
        for (std::size_t k = 0; k < n; ++k) execute(static_cast<std::size_t>(position_), nullptr);
        return n;
    }
    const std::size_t base = events->size();
    events->resize(base + n);
    for (std::size_t k = 0; k < n; ++k) execute(static_cast<std::size_t>(position_), &(*events)[base + k]);
    return n;
}

StopReason Session::run(std::size_t max_steps, const Breakpoints& bp, AccessEvent* last) {
    AccessEvent scratch;
    AccessEvent* ev = last != nullptr ? last : &scratch;
    if (bp.mask == 0) {
        // No breakpoint can fire (turbo mode, ARCHITECTURE 7.4): run the batch path and record
        // only the final access, which is all `*last` exposes. Same state, ~1.4x faster.
        const std::size_t remaining = static_cast<std::size_t>(trace_->size() - position_);
        const std::size_t n = max_steps < remaining ? max_steps : remaining;
        if (n > 0) {
            for (std::size_t k = 0; k + 1 < n; ++k) execute(static_cast<std::size_t>(position_), nullptr);
            execute(static_cast<std::size_t>(position_), last != nullptr ? last : nullptr);
        }
        return finished() ? StopReason::End : StopReason::Budget;
    }
    for (std::size_t k = 0; k < max_steps; ++k) {
        if (finished()) return StopReason::End;
        execute(static_cast<std::size_t>(position_), ev);
        if (bp.mask == 0) continue;
        // Decide from the event's own action log: no counter snapshots needed.
        std::uint32_t seen = 0;
        if (ev->l1.outcome != Outcome::Hit) seen |= Breakpoints::kL1Miss;
        if (ev->l2.outcome == Outcome::Miss) seen |= Breakpoints::kL2Miss;
        if (ev->line == bp.line) seen |= Breakpoints::kLine;
        for (std::uint8_t a = 0; a < ev->action_count; ++a) {
            const Action& act = ev->actions[a];
            const bool dirty = (act.flags & Action::kDirty) != 0;
            switch (act.kind) {
                case ActionKind::MemoryRead:
                case ActionKind::MemoryWrite: seen |= Breakpoints::kMemoryAccess; break;
                case ActionKind::Evict:
                    seen |= Breakpoints::kEviction;
                    if (dirty) seen |= Breakpoints::kWriteback;
                    break;
                case ActionKind::BackInvalidate:
                    seen |= Breakpoints::kBackInvalidation;
                    if (dirty) seen |= Breakpoints::kWriteback;
                    break;
                default: break;
            }
        }
        if ((seen & bp.mask) != 0) return StopReason::Breakpoint;
    }
    return finished() ? StopReason::End : StopReason::Budget;
}

void Session::seek(std::uint64_t position) {
    if (position > trace_->size()) position = trace_->size();
    if (position < position_) reset();
    (void)step(static_cast<std::size_t>(position - position_), nullptr);
}

std::optional<MissBreakdown> Session::three_c(LevelId level) const {
    if (level == LevelId::L1 && c1_) return c1_->breakdown();
    if (level == LevelId::L2 && c2_) return c2_->breakdown();
    return std::nullopt;
}

std::size_t Session::memory_bytes() const noexcept {
    std::size_t b = hierarchy_->memory_bytes() + timeline_.capacity() * sizeof(TimelinePoint);
    if (c1_) b += c1_->memory_bytes();
    if (c2_) b += c2_->memory_bytes();
    return b;
}

RunReport Session::report(std::string label, std::string trace_source) const {
    RunReport r;
    r.label = std::move(label);
    r.config = hierarchy_->config();
    r.trace = {std::move(trace_source), trace_->size(), trace_->reads(), trace_->writes(), trace_->fingerprint()};
    r.result = hierarchy_->result();
    r.metrics = hierarchy_metrics(r.config, r.result);
    r.levels.push_back(level_metrics(hierarchy_->l1(), r.result.l1, r.result.l1.accesses, false, three_c(LevelId::L1)));
    if (const CacheLevel* l2 = hierarchy_->l2()) {
        r.levels.push_back(level_metrics(*l2, *r.result.l2, r.result.l1.accesses, true, three_c(LevelId::L2)));
    }
    r.timeline = timeline_;
    r.complete = finished();
    return r;
}

RunReport run_batch(std::shared_ptr<const Trace> trace, const HierarchyConfig& config,
                    PolicyFactory factory, const RunOptions& options) {
    Session s(trace, config, factory, options.session);
    s.run_to_end();
    RunReport r = s.report(options.label, options.trace_source);
    if (options.reuse_profile) r.reuse = reuse_profile(*trace, config.l1.line_bytes);
    return r;
}

}  // namespace ccsim
