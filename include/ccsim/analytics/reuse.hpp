// include/ccsim/analytics/reuse.hpp
//
// Exact LRU stack (reuse) distance profile of a trace (Mattson et al., 1970).
//
// The reuse distance of an access is the number of DISTINCT lines touched since the
// previous access to the same line (infinite for a first touch). One pass yields the
// miss count of a fully associative LRU cache of EVERY capacity at once:
//   misses(C lines) = cold + #accesses with distance >= C
// which is the "miss-ratio curve" the analytics view plots, and the cleanest test of
// whether a trace can discriminate between cache sizes (tests/bench/standard_dataset).
//
// Cost: O(N log U) time, O(U) memory (U = unique lines). A Fenwick tree over access
// timestamps marks each line's latest use; when timestamps run out the live lines are
// renumbered (compaction), so memory never grows with trace length.

#pragma once

#include <cstdint>
#include <vector>

#include "ccsim/io/trace.hpp"

namespace ccsim {

struct ReuseProfile {
    std::uint32_t line_bytes = 0;
    std::uint64_t accesses = 0;
    std::uint64_t cold = 0;  // first touches == unique lines (footprint)
    // histogram[0]: distance 0 (immediate re-touch of the same line).
    // histogram[b], b >= 1: distance in [2^(b-1), 2^b - 1].
    std::vector<std::uint64_t> histogram;

    std::uint64_t footprint_bytes() const noexcept { return cold * line_bytes; }

    // Exact misses of a fully associative LRU cache holding 2^k lines.
    std::uint64_t fa_lru_misses_pow2(std::uint32_t k) const noexcept;
    // Miss ratio for 2^k lines. Returns 0 for an empty trace; callers that publish the value
    // (the JSON report) must check `accesses` and emit null instead.
    double fa_lru_miss_ratio_pow2(std::uint32_t k) const noexcept;
    // Median reuse distance bucket upper bound over re-references (0 if none).
    std::uint64_t median_distance_upper_bound() const noexcept;
};

ReuseProfile reuse_profile(const Trace& trace, std::uint32_t line_bytes);

}  // namespace ccsim
