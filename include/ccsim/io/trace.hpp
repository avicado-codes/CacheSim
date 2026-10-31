// include/ccsim/io/trace.hpp
//
// Trace format v1 input (docs/TECHNICAL_DESIGN.md section 7, docs/ARCHITECTURE.md section 6).
//
// Two ways in, one grammar:
//   * TraceParser: push-based. Feed it arbitrary chunks (a file read in 1 MiB blocks, a
//     browser DecompressionStream, a network body). It never holds the whole text, only
//     the unfinished tail of the current line, so a 60 MB upload costs ~8 bytes/access.
//   * TraceReader: pull-based, one access at a time from a std::istream (contract sketch,
//     TECHNICAL_DESIGN section 9).
//
// Errors are TraceError with what() == "<source>:<line>: <message>".

#pragma once

#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "ccsim/sim/types.hpp"

namespace ccsim {

struct TraceError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

// Longest accepted line, in bytes, before the line end (comments included). A record itself needs
// about 20 bytes, so this only rejects garbage, such as a binary file with no line breaks,
// which would otherwise grow the parser's carried-over tail until the WASM heap runs out.
inline constexpr std::size_t kMaxTraceLineBytes = 4096;

// Parses one line of format v1 (without its '\n'). Returns nullopt for blank and
// comment-only lines. Throws TraceError naming `source` and `line_number`.
std::optional<MemoryAccess> parse_trace_line(std::string_view line, std::string_view source,
                                             std::uint64_t line_number);

// An immutable-after-load trace stored as a struct of arrays: one uint64 address per
// access plus one bit for read/write. 4M accesses = ~32.5 MB instead of 64 MB for a
// std::vector<MemoryAccess> (padding makes MemoryAccess 16 bytes).
class Trace {
public:
    void reserve(std::size_t accesses);
    void push_back(const MemoryAccess& access);

    std::size_t size() const noexcept { return addresses_.size(); }
    bool empty() const noexcept { return addresses_.empty(); }

    std::uint64_t address(std::size_t i) const noexcept { return addresses_[i]; }
    bool is_write(std::size_t i) const noexcept {
        return ((write_bits_[i >> 6] >> (i & 63U)) & 1U) != 0;
    }
    MemoryAccess operator[](std::size_t i) const noexcept {
        return {is_write(i) ? AccessType::Write : AccessType::Read, addresses_[i]};
    }

    std::uint64_t reads() const noexcept { return size() - writes_; }
    std::uint64_t writes() const noexcept { return writes_; }

    // FNV-1a 64 over (op byte, address as 8 little-endian bytes) for every access in order.
    // Identical on every OS and compiler; used to pin standard datasets in tests.
    std::uint64_t fingerprint() const noexcept { return fingerprint_; }

    // Bytes of heap actually reserved, for memory budgeting in the UI.
    std::size_t memory_bytes() const noexcept;

private:
    std::vector<std::uint64_t> addresses_;
    std::vector<std::uint64_t> write_bits_;
    std::uint64_t writes_ = 0;
    std::uint64_t fingerprint_ = 14695981039346656037ULL;  // FNV-1a 64 offset basis
};

class TraceParser {
public:
    // `max_accesses` = 0 means unlimited; otherwise exceeding it throws TraceError
    // (the website uses it to refuse traces that would not fit in the WASM heap).
    explicit TraceParser(std::string source_name, std::uint64_t max_accesses = 0);

    // Parses every complete line in `chunk` into `out`; keeps an unterminated tail.
    // After a TraceError the parser is failed: every later feed/finish rethrows that
    // first error, so a malformed or oversized trace can never be completed silently.
    void feed(std::string_view chunk, Trace& out);
    // Parses the final unterminated line, if any. Call exactly once after the last feed.
    void finish(Trace& out);

    // Lines consumed so far (the number of the last complete line).
    std::uint64_t lines() const noexcept { return line_number_; }

private:
    void feed_lines(std::string_view chunk, Trace& out);
    void consume_line(std::string_view line, Trace& out);
    void keep_tail(std::string_view part);  // appends to tail_, enforcing kMaxTraceLineBytes

    std::string source_;
    std::string tail_;
    std::uint64_t line_number_ = 0;
    std::uint64_t max_accesses_ = 0;
    bool finished_ = false;
    std::string error_;  // first TraceError; non-empty = failed
};

// Reads a whole stream in 1 MiB blocks. Throws TraceError (format) or std::runtime_error (I/O).
Trace read_trace(std::istream& in, const std::string& source_name, std::uint64_t max_accesses = 0);

class TraceReader {
public:
    TraceReader(std::istream& in, std::string source_name);
    // Next access, or nullopt at end of input. Throws TraceError on a malformed line.
    std::optional<MemoryAccess> next();

private:
    std::istream& in_;
    std::string source_;
    std::string line_;
    std::uint64_t line_number_ = 0;
};

}  // namespace ccsim
