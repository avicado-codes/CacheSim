// Trace format v1 (TECHNICAL_DESIGN section 7): grammar, errors, chunking, storage.

#include <sstream>
#include <string>

#include "ccsim/io/trace.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

namespace {

std::string error_of(const std::string& text) {
    try {
        (void)trace_from_text(text, "t.trace");
    } catch (const TraceError& e) {
        return e.what();
    }
    return "";
}

}  // namespace

TEST_CASE("io.parses_records_comments_blank_and_crlf") {
    const auto t = trace_from_text(
        "# header\n\nR 0x10\nW\t0xABCDEF   # trailing comment\r\n   R 0x0\nW 0xffffffffffffffff");
    CHECK_EQ(t->size(), std::size_t{4});
    CHECK_EQ(t->reads(), 2u);
    CHECK_EQ(t->writes(), 2u);
    CHECK_EQ(t->address(1), 0xABCDEFu);
    CHECK(t->is_write(1));
    CHECK(!t->is_write(2));
    CHECK_EQ(t->address(3), 0xffffffffffffffffULL);  // unterminated last line, 16 digits
}

TEST_CASE("io.errors_name_source_and_line") {
    CHECK_EQ(error_of("R 0x1\nX 0x2\n"), std::string("t.trace:2: expected operation 'R' or 'W', got 'X'"));
    CHECK_EQ(error_of("r 0x1"), std::string("t.trace:1: expected operation 'R' or 'W', got 'r'"));
    CHECK_EQ(error_of("R"), std::string("t.trace:1: missing address after 'R'"));
    CHECK_EQ(error_of("R 10"), std::string("t.trace:1: address must start with 0x, got '10'"));
    CHECK_EQ(error_of("R 0x"), std::string("t.trace:1: address must start with 0x, got '0x'"));
    CHECK_EQ(error_of("\n\nW 0x12g"), std::string("t.trace:3: invalid hex digit in address '0x12g'"));
    CHECK_EQ(error_of("R 0x11111111111111111"),
             std::string("t.trace:1: address has more than 16 hex digits: '0x11111111111111111'"));
    CHECK_EQ(error_of("R 0x1 4"), std::string("t.trace:1: unexpected text after address: '4'"));
}

TEST_CASE("io.chunk_boundaries_do_not_matter") {
    const std::string text = "R 0x1\nW 0x22\n# c\nR 0x333\r\nW 0x4444\nR 0x55555";
    const auto whole = trace_from_text(text);
    for (std::size_t chunk = 1; chunk <= text.size(); ++chunk) {
        Trace t;
        TraceParser p("chunked");
        for (std::size_t i = 0; i < text.size(); i += chunk) p.feed(std::string_view(text).substr(i, chunk), t);
        p.finish(t);
        CHECK_EQ(t.size(), whole->size());
        CHECK_EQ(t.fingerprint(), whole->fingerprint());
    }
}

TEST_CASE("io.error_line_numbers_survive_chunking") {
    Trace t;
    TraceParser p("c.trace");
    p.feed("R 0x1\nR 0", t);
    p.feed("x2\nR 0x3\nBAD", t);
    std::string msg;
    try {
        p.finish(t);
    } catch (const TraceError& e) {
        msg = e.what();
    }
    CHECK_EQ(msg, std::string("c.trace:4: expected operation 'R' or 'W', got 'BAD'"));
}

TEST_CASE("io.max_accesses_limit") {
    Trace t;
    TraceParser p("big", 2);
    CHECK_THROWS_AS(p.feed("R 0x1\nR 0x2\nR 0x3\n", t), TraceError);
}

TEST_CASE("io.trace_reader_pull_api_matches_push_api") {
    const std::string text = "R 0x1\n# x\nW 0x2\n";
    std::istringstream in(text);
    TraceReader reader(in, "pull");
    const auto a = reader.next();
    const auto b = reader.next();
    CHECK(a && a->address == 1 && a->type == AccessType::Read);
    CHECK(b && b->address == 2 && b->type == AccessType::Write);
    CHECK(!reader.next());
}

TEST_CASE("io.fingerprint_is_order_sensitive_and_stable") {
    const auto a = trace_from_text("R 0x1\nW 0x2\n");
    const auto b = trace_from_text("W 0x2\nR 0x1\n");
    CHECK(a->fingerprint() != b->fingerprint());
    // Pinned value: FNV-1a 64 over ('R', 1 as 8 LE bytes, 'W', 2 as 8 LE bytes).
    // Any platform difference in this value is a portability bug.
    std::uint64_t h = 14695981039346656037ULL;
    auto mix = [&](std::uint64_t byte) { h = (h ^ byte) * 1099511628211ULL; };
    mix('R');
    for (int i = 0; i < 8; ++i) mix(i == 0 ? 1 : 0);
    mix('W');
    for (int i = 0; i < 8; ++i) mix(i == 0 ? 2 : 0);
    CHECK_EQ(a->fingerprint(), h);
}

TEST_CASE("io.write_bits_pack_across_word_boundaries") {
    Trace t;
    for (std::uint64_t i = 0; i < 200; ++i) t.push_back({i % 3 == 0 ? AccessType::Write : AccessType::Read, i});
    for (std::size_t i = 0; i < 200; ++i) CHECK_EQ(t.is_write(i), i % 3 == 0);
    CHECK_EQ(t.writes(), 67u);
}

TEST_CASE("io.line_length_limit") {
    // A comment line of exactly the limit is still accepted (the limit counts the bytes before
    // the line end, comment included).
    const std::string ok_line = "R 0x10 #" + std::string(kMaxTraceLineBytes - 8, 'c');
    CHECK_EQ(ok_line.size(), kMaxTraceLineBytes);
    CHECK_EQ(trace_from_text(ok_line + "\nW 0x20\n")->size(), std::size_t{2});

    // One byte longer, inside a single chunk (parsed in place).
    CHECK(error_of(ok_line + "c\n").find("t.trace:1: line is longer than 4096 bytes") == 0);

    // No line break at all, arriving in small chunks: rejected as soon as the carried-over
    // tail passes the limit, not after the whole input has been buffered.
    Trace t;
    TraceParser p("bin.trace");
    p.feed("R 0x1\n", t);
    const std::string junk(1000, '\x7f');
    std::string msg;
    std::size_t fed = 0;
    try {
        for (; fed < 100; ++fed) p.feed(junk, t);
    } catch (const TraceError& e) {
        msg = e.what();
    }
    CHECK_EQ(msg, std::string("bin.trace:2: line is longer than 4096 bytes"));
    CHECK_EQ(fed, std::size_t{4});              // the fifth 1000-byte chunk crosses 4096
    CHECK_THROWS_AS(p.finish(t), TraceError);   // the parser stays failed

    // The pull reader applies the same limit.
    std::istringstream in("R 0x1\n" + std::string(5000, 'x') + "\n");
    TraceReader r(in, "pull.trace");
    CHECK(r.next().has_value());
    CHECK_THROWS_AS((void)r.next(), TraceError);
}
