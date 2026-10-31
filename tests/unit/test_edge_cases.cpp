// Edge cases and misuse, written from the spec (TECHNICAL_DESIGN 3, 4, 7; ARCHITECTURE 8),
// not from the implementation: each CHECK states what the document requires. Covers the
// trace grammar's corners, chunk-boundary independence, configuration rejection, address
// extremes, empty runs ("n/a", never 0), determinism, and C ABI misuse.

#include <cstring>
#include <string>
#include <vector>

#include "ccsim/compare/compare.hpp"
#include "ccsim/io/trace.hpp"
#include "ccsim/report/json.hpp"
#include "ccsim/session/session.hpp"
#include "ccsim/wasm/api_internal.hpp"
#include "ccsim/wasm/ccsim_api.h"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace ccsim;
using namespace ccsim::testing;

namespace {

std::optional<MemoryAccess> line(std::string_view s) { return parse_trace_line(s, "t.trace", 7); }

std::string error_of(std::string_view s) {
    try {
        (void)line(s);
    } catch (const TraceError& e) {
        return e.what();
    }
    return {};
}

Trace parse_chunked(const std::string& text, std::size_t chunk) {
    Trace t;
    TraceParser p("c.trace");
    for (std::size_t i = 0; i < text.size(); i += chunk) p.feed(std::string_view(text).substr(i, chunk), t);
    p.finish(t);
    return t;
}

}  // namespace

TEST_CASE("edge.trace_grammar_accepts_what_the_spec_allows") {
    CHECK(line("R 0x0").has_value());
    CHECK(line("W 0xabcDEF")->address == 0xABCDEFu);              // hex digits case-insensitive
    CHECK(line("R\t0x10")->address == 0x10u);                     // tab separator
    CHECK(line("R  \t 0x10")->address == 0x10u);                  // runs of blanks
    CHECK(line("R 0xFFFFFFFFFFFFFFFF")->address == ~0ULL);         // 16 digits = max address
    CHECK(line("R 0x0000000000000001")->address == 1u);            // 16 digits with leading zeros
    CHECK(line("W 0x10   # trailing comment")->type == AccessType::Write);
    CHECK(!line("").has_value());
    CHECK(!line("   \t ").has_value());                            // whitespace-only is blank
    CHECK(!line("# comment only").has_value());
    CHECK(line("R 0x10\r")->address == 0x10u);                    // CRLF: the \r is not part of the address
}

TEST_CASE("edge.trace_grammar_rejects_everything_else_with_file_and_line") {
    const char* bad[] = {"r 0x10",     "w 0x10",   "X 0x10",          "RW 0x10",   "R",       "R 0x",
                         "R 10",       "R 0x1g",   "R -0x1",          "R 0x10 0x20", "R 0x10 W",
                         "R 0x1FFFFFFFFFFFFFFFF" /* 17 digits */,    "0x10 R",    "R0x10"};
    for (const char* b : bad) {
        const std::string e = error_of(b);
        CHECK(!e.empty());
        if (e.empty()) std::printf("  accepted but should reject: '%s'\n", b);
        CHECK(e.rfind("t.trace:7: ", 0) == 0);
    }
    const std::string nul("R 0x1\0", 6);
    CHECK(!error_of(nul).empty());
}

TEST_CASE("edge.trace_chunk_boundaries_never_change_the_result") {
    std::string text = "# header\r\n\r\nR 0x10\r\nW 0x20 # c\n\n   \nR 0xFFFFFFFFFFFFFFFF\r\n";
    for (int i = 0; i < 300; ++i) text += (i % 3 ? "R 0x" : "W 0x") + std::to_string(1000 + i * 64) + (i % 2 ? "\r\n" : "\n");
    text += "W 0x0";  // no final newline
    const Trace whole = parse_chunked(text, text.size());
    CHECK_EQ(whole.size(), 304u);
    for (std::size_t chunk : {1u, 2u, 3u, 7u, 64u, 4095u}) {  // 1-byte chunks split every \r\n
        const Trace t = parse_chunked(text, chunk);
        CHECK_EQ(t.size(), whole.size());
        CHECK_EQ(t.fingerprint(), whole.fingerprint());
    }
}

TEST_CASE("edge.trace_error_line_numbers_count_blank_comment_and_crlf_lines") {
    Trace t;
    TraceParser p("u.trace");
    try {
        p.feed("# c\r\n\r\nR 0x1\r\n   \nW 0x2\nbad\n", t);
        p.finish(t);
        CHECK(false && "malformed line accepted");
    } catch (const TraceError& e) {
        CHECK(std::string(e.what()).rfind("u.trace:6: ", 0) == 0);
    }
}

TEST_CASE("edge.trace_max_accesses_is_enforced_exactly") {
    Trace ok;
    TraceParser p("m.trace", 3);
    p.feed("R 0x1\nR 0x2\nR 0x3\n", ok);
    p.finish(ok);
    CHECK_EQ(ok.size(), 3u);
    Trace over;
    TraceParser q("m.trace", 3);
    CHECK_THROWS_AS((q.feed("R 0x1\nR 0x2\nR 0x3\nR 0x4\n", over), q.finish(over)), TraceError);
}

TEST_CASE("edge.config_rejections_match_section_3") {
    auto rejects = [](const HierarchyConfig& c, const char* why) {
        bool threw = false;
        try {
            Hierarchy h(c, kRef);
        } catch (const ConfigError&) {
            threw = true;
        }
        CHECK(threw);
        if (!threw) std::printf("  accepted invalid config: %s\n", why);
    };
    auto accepts = [](const HierarchyConfig& c, const char* why) {
        try {
            Hierarchy h(c, kRef);
        } catch (const std::exception& e) {
            CHECK(false && "valid config rejected");
            std::printf("  rejected valid config (%s): %s\n", why, e.what());
        }
    };
    const HierarchyConfig base = default_hierarchy();
    HierarchyConfig c = base;
    c.l1.line_bytes = 48;                          rejects(c, "line not a power of two");
    c = base; c.l1.line_bytes = 0;                  rejects(c, "line 0");
    c = base; c.l1.ways = 0;                        rejects(c, "ways 0");
    c = base; c.l1.size_bytes = 0;                  rejects(c, "size 0");
    c = base; c.l1.size_bytes = 48 * 1024;          rejects(c, "96 sets: not a power of two");
    c = base; c.l1.size_bytes = 1000;               rejects(c, "size not divisible by line*ways");
    c = base; c.l1.size_bytes = 1024; c.l1.ways = 32; rejects(c, "more ways than lines");
    c = base; c.l1.hit_latency_cycles = 0;          rejects(c, "L1 latency 0");
    c = base; c.l2->hit_latency_cycles = 0;         rejects(c, "L2 latency 0");
    c = base; c.memory_latency_cycles = 0;          rejects(c, "memory latency 0");
    c = base; c.l2->line_bytes = 128;               rejects(c, "L2 line != L1 line");

    c = base; c.l1.size_bytes = 48 * 1024; c.l1.ways = 12; accepts(c, "48 KiB 12-way, 64 sets");
    c = base; c.l1.size_bytes = 4096; c.l1.ways = 64;      accepts(c, "fully associative");
    c = base; c.l1.line_bytes = c.l2->line_bytes = 1; c.l1.size_bytes = 64; c.l1.ways = 1; accepts(c, "1-byte lines");
    c = base; c.l2.reset();                                accepts(c, "no L2");
    c = base; c.seed = 0;                                  accepts(c, "seed 0");
    c = base; c.inclusion = InclusionPolicy::Inclusive; c.l2->size_bytes = 16 * 1024; accepts(c, "inclusive L2 smaller than L1");
}

TEST_CASE("edge.address_extremes_map_to_distinct_lines") {
    // Addresses differing only in the top bits must not alias (full 64-bit tags).
    const auto t = trace_from_text("R 0x0\nR 0x8000000000000000\nR 0x0\nR 0xFFFFFFFFFFFFFFC0\nR 0x8000000000000000\n");
    HierarchyConfig c = l1_only(128, 64, 2, PolicyKind::Lru, 1, 100);  // 1 set, 2 ways
    const SimulationResult r = simulate(*t, c);
    CHECK_EQ(r.l1.misses, 4u);  // 0 M, 8.. M, 0 H, FF.. M (evicts 8..), 8.. M
    CHECK_EQ(r.l1.hits, 1u);
    check_invariants(r, c, "address extremes");
}

TEST_CASE("edge.empty_trace_reports_na_not_zero") {
    const auto t = trace_from_text("# nothing\n\n");
    CHECK_EQ(t->size(), 0u);
    RunOptions o;
    o.reuse_profile = true;
    const RunReport rep = run_batch(t, default_hierarchy(), kRef, o);
    const std::string json = report_to_json(rep, "test");
    CHECK(json.find("\"amat_cycles\":null") != std::string::npos);
    CHECK(json.find("\"miss_rate\":null") != std::string::npos);
    CHECK(json.find("nan") == std::string::npos && json.find("inf") == std::string::npos);
    Session s(t, default_hierarchy(), kRef);
    CHECK_EQ(s.step(10), 0u);
    s.run_to_end();
    CHECK_EQ(s.position(), 0u);
}

TEST_CASE("edge.session_controls_at_the_boundaries") {
    const auto t = synthetic_mixed(1000, 5);
    Session s(t, default_hierarchy(), kRef);
    CHECK_EQ(s.step(0), 0u);
    CHECK_EQ(s.step(5000), 1000u);           // clamps at the end
    CHECK_EQ(s.step(1), 0u);                 // nothing past the end
    Breakpoints none;
    CHECK(s.run(10, none) == StopReason::End);
    s.reset();
    CHECK(s.run(0, none) == StopReason::Budget);
    CHECK_EQ(s.position(), 0u);
    s.seek(1000);                            // seek to exactly the end is allowed
    CHECK_EQ(s.position(), 1000u);
    bool threw = false;
    try {
        s.seek(1001);
    } catch (const std::exception&) {
        threw = true;
    }
    CHECK(threw || s.position() == 1000u);   // past the end: error or clamp, never beyond
    CHECK(s.position() <= 1000u);
}

TEST_CASE("edge.determinism_and_seed_sensitivity") {
    const auto t = synthetic_random(200'000, 1ULL << 20, 0.25, 3);
    HierarchyConfig c = default_hierarchy();
    c.l1.policy = c.l2->policy = PolicyKind::Random;
    const std::string a = report_to_json(run_batch(t, c, kRef, {}), "t");
    CHECK_EQ(report_to_json(run_batch(t, c, kRef, {}), "t"), a);  // same input, same bytes
    c.seed = 2;
    CHECK(report_to_json(run_batch(t, c, kRef, {}), "t") != a);    // the seed is actually used
}

TEST_CASE("edge.event_json_keeps_64bit_addresses_exact") {
    // JavaScript numbers lose precision above 2^53; such values must cross as hex strings.
    const auto t = trace_from_text("W 0xFFFFFFFFFFFFFFF8\n");
    Session s(t, default_hierarchy(), kRef);
    std::vector<AccessEvent> ev;
    s.step(1, &ev);
    const std::string j = event_to_json(ev.at(0));
    CHECK(j.find("0xfffffffffffffff8") != std::string::npos || j.find("0xFFFFFFFFFFFFFFF8") != std::string::npos);
    CHECK(j.find("18446744073709551608") == std::string::npos);
}

TEST_CASE("edge.c_abi_misuse_never_crashes") {
    api::set_policy_factory(kRef);
    const std::int32_t tr = ccsim_trace_begin("abi.trace", 0);
    std::uint64_t cfg[CCSIM_CONFIG_WORDS] = {1, 1024, 64, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 1};
    CHECK_EQ(ccsim_session_create(tr, cfg, CCSIM_CONFIG_WORDS, 0), 0);  // before trace_end
    CHECK(std::strlen(ccsim_last_error()) > 0);
    CHECK_EQ(ccsim_trace_feed(tr, "R 0x40\n", 7), 0);
    CHECK_EQ(ccsim_trace_end(tr), 0);
    CHECK(ccsim_trace_feed(tr, "R 0x40\n", 7) != 0);                    // feed after end
    CHECK_EQ(ccsim_trace_end(tr), 0);                                     // end twice: idempotent
    CHECK_EQ(ccsim_trace_size(tr), 1u);
    CHECK_EQ(ccsim_session_create(tr, cfg, 5, 0), 0);                     // short config
    std::uint64_t badenum[CCSIM_CONFIG_WORDS];
    std::memcpy(badenum, cfg, sizeof cfg);
    badenum[5] = 99;
    CHECK_EQ(ccsim_session_create(tr, badenum, CCSIM_CONFIG_WORDS, 0), 0);  // unknown policy
    std::memcpy(badenum, cfg, sizeof cfg);
    badenum[1] = 1000;
    CHECK_EQ(ccsim_session_create(tr, badenum, CCSIM_CONFIG_WORDS, 0), 0);  // invalid geometry
    CHECK(std::string(ccsim_last_error()).find("size") != std::string::npos);
    const std::int32_t s = ccsim_session_create(tr, cfg, CCSIM_CONFIG_WORDS, 0);
    CHECK(s > 0);
    CHECK(ccsim_session_slot_states(s, 1) == nullptr);                    // no L2 configured
    CHECK(ccsim_session_seek(s, 99) != 0 || ccsim_session_position(s) <= 1u);
    CHECK_EQ(ccsim_compare_json(nullptr, 0, nullptr), nullptr);           // nothing to compare
    ccsim_session_release(s);
    ccsim_session_release(s);                                             // double release
    ccsim_session_release(0);
    ccsim_session_release(-5);
    CHECK_EQ(ccsim_session_step(s, 1, 0), -1);                            // use after release
    ccsim_trace_release(tr);
    ccsim_trace_release(tr);
    CHECK_EQ(ccsim_trace_size(tr), 0u);
    ccsim_free(nullptr);
    api::set_policy_factory(nullptr);
}

TEST_CASE("edge.parser_is_failed_after_the_first_error") {
    // Regression: the parser used to keep accepting input after a bad line, so an upload
    // could be completed with lines silently dropped and later line numbers shifted.
    Trace t;
    TraceParser p("f.trace");
    CHECK_THROWS_AS(p.feed("R 0x1\nR 0x2\nBAD\nR 0x3\n", t), TraceError);
    try {
        p.feed("R 0x4\n", t);
        CHECK(false && "feed accepted after an error");
    } catch (const TraceError& e) {
        CHECK(std::string(e.what()).rfind("f.trace:3: ", 0) == 0);  // the original error, again
    }
    CHECK_THROWS_AS(p.finish(t), TraceError);

    Trace u;
    TraceParser q("g.trace");
    q.feed("R 0x1\nR 0x", u);
    CHECK_THROWS_AS(q.finish(u), TraceError);  // bad unterminated last line
    CHECK_THROWS_AS(q.finish(u), TraceError);  // and it stays failed
}

TEST_CASE("edge.c_abi_refuses_to_complete_a_failed_upload") {
    api::set_policy_factory(kRef);
    std::uint64_t cfg[CCSIM_CONFIG_WORDS] = {1, 1024, 64, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 1};
    const std::int32_t bad = ccsim_trace_begin("bad.trace", 0);
    CHECK(ccsim_trace_feed(bad, "R 0x1\nBAD\nR 0x3\n", 16) != 0);
    CHECK(ccsim_trace_feed(bad, "R 0x4\n", 6) != 0);
    CHECK(ccsim_trace_end(bad) != 0);
    CHECK(std::string(ccsim_last_error()).rfind("bad.trace:2: ", 0) == 0);
    CHECK_EQ(ccsim_session_create(bad, cfg, CCSIM_CONFIG_WORDS, 0), 0);
    ccsim_trace_release(bad);

    const std::int32_t big = ccsim_trace_begin("big.trace", 2);  // over max_accesses
    CHECK(ccsim_trace_feed(big, "R 0x1\nR 0x2\nR 0x3\n", 18) != 0);
    CHECK(ccsim_trace_end(big) != 0);
    CHECK_EQ(ccsim_session_create(big, cfg, CCSIM_CONFIG_WORDS, 0), 0);
    ccsim_trace_release(big);
    api::set_policy_factory(nullptr);
}
