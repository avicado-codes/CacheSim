#include "ccsim/io/trace.hpp"

#include <istream>
#include <string>

namespace ccsim {
namespace {

constexpr std::uint64_t kFnvPrime = 1099511628211ULL;

[[noreturn]] void fail(std::string_view source, std::uint64_t line, const std::string& message) {
    throw TraceError(std::string(source) + ':' + std::to_string(line) + ": " + message);
}

bool is_blank(char c) noexcept { return c == ' ' || c == '\t'; }

int hex_value(char c) noexcept {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Short, printable excerpt of a bad token for error messages.
std::string excerpt(std::string_view token) {
    constexpr std::size_t kMax = 24;
    std::string out(token.substr(0, kMax));
    if (token.size() > kMax) out += "...";
    return out;
}

}  // namespace

std::optional<MemoryAccess> parse_trace_line(std::string_view line, std::string_view source,
                                             std::uint64_t line_number) {
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);  // CRLF
    if (const std::size_t hash = line.find('#'); hash != std::string_view::npos) {
        line = line.substr(0, hash);
    }

    std::size_t i = 0;
    const std::size_t n = line.size();
    while (i < n && is_blank(line[i])) ++i;
    if (i == n) return std::nullopt;  // blank or comment-only

    // Operation: a single 'R' or 'W' token.
    const std::size_t op_begin = i;
    while (i < n && !is_blank(line[i])) ++i;
    const std::string_view op = line.substr(op_begin, i - op_begin);
    MemoryAccess access;
    if (op == "R") {
        access.type = AccessType::Read;
    } else if (op == "W") {
        access.type = AccessType::Write;
    } else {
        fail(source, line_number, "expected operation 'R' or 'W', got '" + excerpt(op) + "'");
    }

    while (i < n && is_blank(line[i])) ++i;
    if (i == n) fail(source, line_number, "missing address after '" + std::string(op) + "'");

    // Address: 0x followed by 1..16 hex digits.
    const std::size_t addr_begin = i;
    while (i < n && !is_blank(line[i])) ++i;
    const std::string_view addr = line.substr(addr_begin, i - addr_begin);
    if (addr.size() < 3 || addr[0] != '0' || addr[1] != 'x') {
        fail(source, line_number, "address must start with 0x, got '" + excerpt(addr) + "'");
    }
    const std::string_view digits = addr.substr(2);
    if (digits.size() > 16) {
        fail(source, line_number, "address has more than 16 hex digits: '" + excerpt(addr) + "'");
    }
    std::uint64_t value = 0;
    for (const char c : digits) {
        const int v = hex_value(c);
        if (v < 0) fail(source, line_number, "invalid hex digit in address '" + excerpt(addr) + "'");
        value = (value << 4) | static_cast<std::uint64_t>(v);
    }
    access.address = value;

    while (i < n && is_blank(line[i])) ++i;
    if (i != n) {
        fail(source, line_number, "unexpected text after address: '" + excerpt(line.substr(i)) + "'");
    }
    return access;
}

// ---- Trace ------------------------------------------------------------------------

void Trace::reserve(std::size_t accesses) {
    addresses_.reserve(accesses);
    write_bits_.reserve((accesses + 63) / 64);
}

void Trace::push_back(const MemoryAccess& access) {
    const std::size_t i = addresses_.size();
    if ((i & 63U) == 0) write_bits_.push_back(0);
    addresses_.push_back(access.address);
    const bool write = access.type == AccessType::Write;
    if (write) {
        write_bits_.back() |= (std::uint64_t{1} << (i & 63U));
        ++writes_;
    }
    std::uint64_t h = fingerprint_;
    h = (h ^ (write ? 0x57U : 0x52U)) * kFnvPrime;  // 'W' / 'R'
    for (int shift = 0; shift < 64; shift += 8) {
        h = (h ^ ((access.address >> shift) & 0xFFU)) * kFnvPrime;
    }
    fingerprint_ = h;
}

std::size_t Trace::memory_bytes() const noexcept {
    return addresses_.capacity() * sizeof(std::uint64_t) +
           write_bits_.capacity() * sizeof(std::uint64_t);
}

// ---- TraceParser ------------------------------------------------------------------

TraceParser::TraceParser(std::string source_name, std::uint64_t max_accesses)
    : source_(std::move(source_name)), max_accesses_(max_accesses) {}

void TraceParser::consume_line(std::string_view line, Trace& out) {
    ++line_number_;
    if (const auto access = parse_trace_line(line, source_, line_number_)) {
        if (max_accesses_ != 0 && out.size() >= max_accesses_) {
            fail(source_, line_number_,
                 "trace exceeds the limit of " + std::to_string(max_accesses_) + " accesses");
        }
        out.push_back(*access);
    }
}

void TraceParser::feed(std::string_view chunk, Trace& out) {
    if (!error_.empty()) throw TraceError(error_);
    if (finished_) throw std::logic_error("TraceParser::feed called after finish");
    try {
        feed_lines(chunk, out);
    } catch (const TraceError& e) {
        error_ = e.what();  // poisoned: a trace with a bad line must never be completed
        throw;
    }
}

void TraceParser::feed_lines(std::string_view chunk, Trace& out) {
    std::size_t start = 0;
    if (!tail_.empty()) {
        // Complete the line carried over from the previous chunk.
        const std::size_t nl = chunk.find('\n');
        if (nl == std::string_view::npos) {
            tail_.append(chunk.data(), chunk.size());
            return;
        }
        tail_.append(chunk.data(), nl);
        consume_line(tail_, out);
        tail_.clear();
        start = nl + 1;
    }
    // Hot loop: parse lines in place, no copies.
    while (start < chunk.size()) {
        const std::size_t nl = chunk.find('\n', start);
        if (nl == std::string_view::npos) {
            tail_.assign(chunk.data() + start, chunk.size() - start);
            return;
        }
        consume_line(chunk.substr(start, nl - start), out);
        start = nl + 1;
    }
}

void TraceParser::finish(Trace& out) {
    if (!error_.empty()) throw TraceError(error_);
    if (finished_) return;
    if (!tail_.empty()) {
        try {
            consume_line(tail_, out);
        } catch (const TraceError& e) {
            error_ = e.what();
            throw;
        }
        tail_.clear();
    }
    finished_ = true;
}

Trace read_trace(std::istream& in, const std::string& source_name, std::uint64_t max_accesses) {
    constexpr std::size_t kBlock = 1U << 20;
    TraceParser parser(source_name, max_accesses);
    Trace trace;
    std::string buffer(kBlock, '\0');
    while (in) {
        in.read(buffer.data(), static_cast<std::streamsize>(kBlock));
        const std::streamsize got = in.gcount();
        if (got <= 0) break;
        parser.feed(std::string_view(buffer.data(), static_cast<std::size_t>(got)), trace);
    }
    if (in.bad()) throw std::runtime_error(source_name + ": read error");
    parser.finish(trace);
    return trace;
}

// ---- TraceReader ------------------------------------------------------------------

TraceReader::TraceReader(std::istream& in, std::string source_name)
    : in_(in), source_(std::move(source_name)) {}

std::optional<MemoryAccess> TraceReader::next() {
    while (std::getline(in_, line_)) {
        ++line_number_;
        if (auto access = parse_trace_line(line_, source_, line_number_)) return access;
    }
    if (in_.bad()) throw std::runtime_error(source_ + ": read error");
    return std::nullopt;
}

}  // namespace ccsim
