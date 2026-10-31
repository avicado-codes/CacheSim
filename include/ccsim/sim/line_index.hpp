// include/ccsim/sim/line_index.hpp
//
// Flat open-addressing hash map from a cache-line number (uint64) to a uint32 slot.
// Used where a linear scan would be too slow: highly associative sets (ways > 16) and the
// analytics shadows (fully associative LRU, "seen" sets, reuse-distance last-use table).
//
// Why not std::unordered_map: it allocates one node per insert, and the engine inserts on
// every miss. This table is two flat arrays, linear probing, and backward-shift deletion
// (no tombstones), so lookups stay short even after millions of evictions.
//
// Keys are stored as line + 1 so that 0 can mark an empty bucket. Line 2^64 - 1 (reachable
// with 1-byte lines and address 0xFFFF'FFFF'FFFF'FFFF) would wrap to 0, so it lives in a
// dedicated slot outside the table instead.

#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace ccsim {

class LineIndex {
public:
    static constexpr std::uint32_t kAbsent = 0xFFFFFFFFU;

    explicit LineIndex(std::size_t expected = 16) { rehash(capacity_for(expected)); }

    std::size_t size() const noexcept { return size_ + (has_top_ ? 1 : 0); }

    std::uint32_t find(std::uint64_t line) const noexcept {
        if (line == kTopLine) return has_top_ ? top_value_ : kAbsent;
        const std::uint64_t key = line + 1;  // 0 marks an empty bucket
        for (std::size_t i = bucket(key);; i = (i + 1) & mask_) {
            if (keys_[i] == key) return values_[i];
            if (keys_[i] == 0) return kAbsent;
        }
    }

    // Inserts or overwrites.
    void put(std::uint64_t line, std::uint32_t value) {
        if (line == kTopLine) {
            top_value_ = value;
            has_top_ = true;
            return;
        }
        if ((size_ + 1) * 4 > keys_.size() * 3) rehash(keys_.size() * 2);  // load <= 0.75
        const std::uint64_t key = line + 1;
        for (std::size_t i = bucket(key);; i = (i + 1) & mask_) {
            if (keys_[i] == key) {
                values_[i] = value;
                return;
            }
            if (keys_[i] == 0) {
                keys_[i] = key;
                values_[i] = value;
                ++size_;
                return;
            }
        }
    }

    // Removes `line` if present.
    void erase(std::uint64_t line) noexcept {
        if (line == kTopLine) {
            has_top_ = false;
            return;
        }
        const std::uint64_t key = line + 1;
        std::size_t i = bucket(key);
        while (keys_[i] != key) {
            if (keys_[i] == 0) return;
            i = (i + 1) & mask_;
        }
        // Backward-shift deletion keeps every probe chain contiguous.
        std::size_t hole = i;
        for (std::size_t j = (i + 1) & mask_; keys_[j] != 0; j = (j + 1) & mask_) {
            const std::size_t home = bucket(keys_[j]);
            // Move j into the hole if its home is not in (hole, j] cyclically.
            const bool home_between = hole <= j ? (hole < home && home <= j)
                                                : (hole < home || home <= j);
            if (!home_between) {
                keys_[hole] = keys_[j];
                values_[hole] = values_[j];
                hole = j;
            }
        }
        keys_[hole] = 0;
        --size_;
    }

    void clear() noexcept {
        for (auto& k : keys_) k = 0;
        size_ = 0;
        has_top_ = false;
    }

    // Visits every (line, value) pair in unspecified order.
    template <class F>
    void for_each(F&& f) const {
        for (std::size_t i = 0; i < keys_.size(); ++i) {
            if (keys_[i] != 0) f(keys_[i] - 1, values_[i]);
        }
        if (has_top_) f(kTopLine, top_value_);
    }

    std::size_t memory_bytes() const noexcept {
        return keys_.capacity() * sizeof(std::uint64_t) + values_.capacity() * sizeof(std::uint32_t);
    }

private:
    static constexpr std::uint64_t kTopLine = ~std::uint64_t{0};  // key would wrap to 0

    static std::size_t capacity_for(std::size_t expected) {
        std::size_t cap = 16;
        while (cap * 3 < expected * 4 + 4) cap <<= 1;
        return cap;
    }

    std::size_t bucket(std::uint64_t key) const noexcept {
        // splitmix64 finaliser: cache-line numbers are highly regular (strides), so a
        // strong mix is needed to keep linear probing chains short.
        key ^= key >> 30;
        key *= 0xbf58476d1ce4e5b9ULL;
        key ^= key >> 27;
        key *= 0x94d049bb133111ebULL;
        key ^= key >> 31;
        return static_cast<std::size_t>(key) & mask_;
    }

    void rehash(std::size_t capacity) {
        std::vector<std::uint64_t> old_keys(capacity, 0);
        std::vector<std::uint32_t> old_values(capacity, 0);
        old_keys.swap(keys_);
        old_values.swap(values_);
        mask_ = capacity - 1;
        size_ = 0;
        for (std::size_t i = 0; i < old_keys.size(); ++i) {
            if (old_keys[i] != 0) put(old_keys[i] - 1, old_values[i]);
        }
    }

    std::vector<std::uint64_t> keys_;
    std::vector<std::uint32_t> values_;
    std::size_t mask_ = 0;
    std::size_t size_ = 0;     // entries in the table (excludes the top slot)
    bool has_top_ = false;     // line 2^64 - 1 is present
    std::uint32_t top_value_ = 0;
};

}  // namespace ccsim
