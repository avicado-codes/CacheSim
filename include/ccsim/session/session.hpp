// include/ccsim/session/session.hpp
//
// The controllable simulation the live visualiser drives (docs/ARCHITECTURE.md section 7).
//
// A Session owns one Hierarchy plus its online analytics, and a cursor into a shared,
// immutable Trace. The UI never simulates: Play is "step(k) once per animation frame",
// Pause is "stop calling", Step is step(1), Reset is reset(), dragging the scrubber is
// seek(n). The engine itself has no clock, so playback speed lives entirely in the caller.
//
// Seeking backwards replays from 0 without recording events: cache state is not
// reversible, and replay runs at full engine speed (tens of millions of accesses per
// second natively), so no snapshot memory is spent on checkpoints.

#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <vector>

#include "ccsim/analytics/metrics.hpp"
#include "ccsim/analytics/miss_classifier.hpp"
#include "ccsim/io/trace.hpp"
#include "ccsim/sim/events.hpp"
#include "ccsim/sim/hierarchy.hpp"

namespace ccsim {

struct SessionOptions {
    bool classify_misses = true;          // 3C classification per level
    std::uint32_t timeline_points = 512;  // target resolution of the miss-rate-over-time series
};

// Conditions that stop run(). Several may be combined.
struct Breakpoints {
    static constexpr std::uint32_t kL1Miss = 1U << 0;
    static constexpr std::uint32_t kL2Miss = 1U << 1;
    static constexpr std::uint32_t kMemoryAccess = 1U << 2;  // any memory read or write
    static constexpr std::uint32_t kEviction = 1U << 3;      // at any level
    static constexpr std::uint32_t kWriteback = 1U << 4;     // dirty line sent down
    static constexpr std::uint32_t kBackInvalidation = 1U << 5;
    static constexpr std::uint32_t kLine = 1U << 6;  // access to cache line `line`

    std::uint32_t mask = 0;
    std::uint64_t line = 0;
};

enum class StopReason : std::uint8_t { Budget, Breakpoint, End };

class Session {
public:
    Session(std::shared_ptr<const Trace> trace, const HierarchyConfig& config, PolicyFactory factory,
            SessionOptions options = {});

    std::uint64_t position() const noexcept { return position_; }
    std::uint64_t size() const noexcept { return trace_->size(); }
    bool finished() const noexcept { return position_ >= trace_->size(); }

    // Executes up to `n` accesses; appends one event per access to `events` when non-null.
    // Returns the number executed.
    std::size_t step(std::size_t n, std::vector<AccessEvent>* events = nullptr);

    // Runs until a breakpoint fires (the access that fired it HAS executed and is in
    // `*last`), `max_steps` accesses ran, or the trace ended.
    StopReason run(std::size_t max_steps, const Breakpoints& breakpoints, AccessEvent* last = nullptr);

    void run_to_end() { (void)step(static_cast<std::size_t>(size() - position_), nullptr); }
    void reset();
    void seek(std::uint64_t position);

    const Hierarchy& hierarchy() const noexcept { return *hierarchy_; }
    const SimulationResult& result() const noexcept { return hierarchy_->result(); }
    const std::vector<TimelinePoint>& timeline() const noexcept { return timeline_; }
    // 3C counts; nullopt when classification is off, and always for an exclusive L2.
    std::optional<MissBreakdown> three_c(LevelId level) const;
    const Trace& trace() const noexcept { return *trace_; }

    // Full analytics snapshot (works mid-run; `complete` tells which).
    RunReport report(std::string label, std::string trace_source = {}) const;

    std::size_t memory_bytes() const noexcept;

private:
    void execute(std::size_t i, AccessEvent* event);

    std::shared_ptr<const Trace> trace_;
    HierarchyConfig config_;
    PolicyFactory factory_;
    SessionOptions options_;
    std::unique_ptr<Hierarchy> hierarchy_;
    std::optional<MissClassifier> c1_, c2_;
    std::vector<TimelinePoint> timeline_;
    std::uint64_t window_ = 1;
    std::uint64_t position_ = 0;
};

// Batch path: run a whole trace with no event recording; optionally add a reuse profile.
struct RunOptions {
    SessionOptions session;
    bool reuse_profile = false;
    std::string label;
    std::string trace_source;
};
RunReport run_batch(std::shared_ptr<const Trace> trace, const HierarchyConfig& config,
                    PolicyFactory factory, const RunOptions& options = {});

}  // namespace ccsim
