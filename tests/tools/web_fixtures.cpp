// tests/tools/web_fixtures.cpp
//
// Generates the engine fixtures the web frontend is tested against (web/test/fixtures/), so
// the UI is built on real engine output rather than hand-written samples (docs/FRONTEND_FIXES.md
// FE-12, FE-13). Every fixture comes from the same C ABI the browser module exports:
//
//   <scenario>.json   config words, the binary event buffer of the whole trace, the same
//                     events as ccsim.events/1 objects (event_to_json, an independent
//                     serialisation used to cross-check the TypeScript decoder), the slot
//                     grid after every access, and the ccsim.simulation/1 report.
//   <name>.compare.json / .compare.csv   ccsim.comparison/1 document and CSV.
//
// These are not goldens for the engine (those stay hand-derived, AGENTS.md section 5); they
// pin the engine -> UI contract. The web tests add hand-derived checks from WORKING_DEMO.md.
//
// Usage: ccsim_web_fixtures --write <dir>   regenerate the fixtures
//        ccsim_web_fixtures --check <dir>   exit 1 if any committed fixture is stale
// Exit 77 (skipped) when the build has no production policies.

#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "ccsim/io/trace.hpp"
#include "ccsim/policy/replacement_policy.hpp"
#include "ccsim/report/json.hpp"
#include "ccsim/session/session.hpp"
#include "ccsim/sim/types.hpp"
#include "ccsim/wasm/api_internal.hpp"
#include "ccsim/wasm/ccsim_api.h"

namespace {

using ccsim::JsonWriter;

struct Level {
    std::uint64_t size;
    std::uint32_t line, ways, latency, policy = 0, write_policy = 0, write_miss = 0;
};

struct Scenario {
    std::string name;
    std::string trace;  // file under tests/data/golden/
    Level l1;
    bool has_l2;
    Level l2;
    std::uint32_t memory_latency;
    std::uint32_t inclusion = 0;
};

std::vector<std::uint64_t> config_words(const Scenario& s) {
    const Level& b = s.l2;
    return {1,
            s.l1.size, s.l1.line, s.l1.ways, s.l1.latency, s.l1.policy, s.l1.write_policy, s.l1.write_miss,
            s.has_l2 ? 1U : 0U,
            b.size, b.line, b.ways, b.latency, b.policy, b.write_policy, b.write_miss,
            s.memory_latency, s.inclusion, 1};
}

ccsim::CacheConfig cache_config(const char* name, const Level& l) {
    ccsim::CacheConfig c;
    c.name = name;
    c.size_bytes = l.size;
    c.line_bytes = l.line;
    c.ways = l.ways;
    c.hit_latency_cycles = l.latency;
    c.policy = static_cast<ccsim::PolicyKind>(l.policy);
    c.write_policy = static_cast<ccsim::WritePolicy>(l.write_policy);
    c.write_miss_policy = static_cast<ccsim::WriteMissPolicy>(l.write_miss);
    return c;
}

ccsim::HierarchyConfig hierarchy_config(const Scenario& s) {
    ccsim::HierarchyConfig h;
    h.l1 = cache_config("L1", s.l1);
    if (s.has_l2) h.l2 = cache_config("L2", s.l2);
    h.memory_latency_cycles = s.memory_latency;
    h.inclusion = static_cast<ccsim::InclusionPolicy>(s.inclusion);
    h.seed = 1;
    return h;
}

std::string read_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot read " + path);
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

[[noreturn]] void fail(const std::string& what) {
    throw std::runtime_error(what + ": " + ccsim_last_error());
}

std::int32_t load_trace(const std::string& name, const std::string& text) {
    const std::int32_t t = ccsim_trace_begin(name.c_str(), 0);
    if (t <= 0) fail("trace_begin");
    if (ccsim_trace_feed(t, text.data(), static_cast<std::uint32_t>(text.size())) != 0) fail("trace_feed");
    if (ccsim_trace_end(t) != 0) fail("trace_end");
    return t;
}

std::int32_t make_session(std::int32_t trace, const Scenario& s) {
    const std::vector<std::uint64_t> words = config_words(s);
    const std::int32_t id = ccsim_session_create(trace, words.data(), static_cast<std::uint32_t>(words.size()), 0);
    if (id <= 0) fail("session_create " + s.name);
    return id;
}

void write_grid(JsonWriter& w, std::int32_t session, std::uint32_t level, std::uint64_t slots) {
    const std::uint8_t* states = ccsim_session_slot_states(session, level);
    const std::uint64_t* tags = ccsim_session_slot_tags(session, level);
    if (states == nullptr || tags == nullptr) {
        w.null();
        return;
    }
    w.begin_object();
    w.key("states").begin_array();
    for (std::uint64_t i = 0; i < slots; ++i) w.value(static_cast<std::uint32_t>(states[i]));
    w.end_array();
    w.key("tags").begin_array();
    for (std::uint64_t i = 0; i < slots; ++i) w.hex(tags[i]);
    w.end_array();
    w.end_object();
}

std::string grids_json(std::int32_t trace, const Scenario& s, std::uint64_t n) {
    const std::uint64_t l1_slots = s.l1.size / s.l1.line;
    const std::uint64_t l2_slots = s.has_l2 ? s.l2.size / s.l2.line : 0;
    const std::int32_t session = make_session(trace, s);
    JsonWriter w;
    w.begin_array();
    for (std::uint64_t k = 0; k <= n; ++k) {
        if (k > 0 && ccsim_session_step(session, 1, 0) != 1) fail("step " + s.name);
        w.begin_object();
        w.key("l1");
        write_grid(w, session, 0, l1_slots);
        w.key("l2");
        write_grid(w, session, 1, l2_slots);
        w.end_object();
    }
    w.end_array();
    ccsim_session_release(session);
    return w.take();
}

// Assembles one fixture from independently serialised parts: the ABI's binary events and
// report, the slot grids, and event_to_json() from a native Session on the same trace.
std::string scenario_json(const Scenario& s, const std::string& data_dir) {
    const std::string text = read_file(data_dir + "/golden/" + s.trace);
    const std::int32_t trace = load_trace(s.trace, text);
    const std::uint64_t n = ccsim_trace_size(trace);

    const std::int32_t session = make_session(trace, s);
    if (ccsim_session_step(session, static_cast<std::uint32_t>(n), 1) != static_cast<std::int32_t>(n)) {
        fail("session_step " + s.name);
    }
    JsonWriter words;
    words.begin_array();
    const std::uint32_t* buf = ccsim_event_buffer();
    for (std::uint32_t i = 0, count = ccsim_event_buffer_words(); i < count; ++i) words.value(buf[i]);
    words.end_array();
    const std::string report = ccsim_session_report_json(session, s.name.c_str(), 1);
    ccsim_session_release(session);

    const std::string grids = grids_json(trace, s, n);
    ccsim_trace_release(trace);

    std::istringstream in(text);
    auto native = std::make_shared<const ccsim::Trace>(ccsim::read_trace(in, s.trace));
    ccsim::Session ns(native, hierarchy_config(s), &ccsim::make_policy);
    std::vector<ccsim::AccessEvent> events;
    ns.step(static_cast<std::size_t>(n), &events);
    std::string events_json = "[";
    for (std::size_t i = 0; i < events.size(); ++i) {
        if (i > 0) events_json += ',';
        events_json += ccsim::event_to_json(events[i]);
    }
    events_json += ']';

    JsonWriter key;  // quoted scalar fields, reusing the writer's escaping
    key.begin_object().field("scenario", s.name).field("trace", s.trace).field("accesses", n);
    std::string out = key.take();  // object still open: "{...fields"
    JsonWriter cfg;
    cfg.begin_array();
    for (std::uint64_t v : config_words(s)) cfg.value(v);
    cfg.end_array();
    out += ",\"config_words\":" + cfg.take();
    out += ",\"event_words\":" + words.take();
    out += ",\"events_json\":" + events_json;
    out += ",\"grids\":" + grids;
    out += ",\"report\":" + report + "}\n";
    return out;
}

struct Compare {
    std::string name;
    std::vector<std::pair<std::string, Scenario>> runs;
};

std::pair<std::string, std::string> compare_docs(const Compare& c, const std::string& data_dir) {
    const std::string text = read_file(data_dir + "/golden/" + c.runs.front().second.trace);
    const std::int32_t trace = load_trace(c.runs.front().second.trace, text);
    std::vector<std::int32_t> ids;
    std::vector<const char*> labels;
    for (const auto& [label, s] : c.runs) {
        const std::int32_t id = make_session(trace, s);
        if (ccsim_session_run(id, 0xffffffffU, 0, 0) != 2) fail("run " + label);
        ids.push_back(id);
        labels.push_back(label.c_str());
    }
    const auto count = static_cast<std::uint32_t>(ids.size());
    const char* json = ccsim_compare_json(ids.data(), count, labels.data());
    if (json == nullptr) fail("compare_json");
    std::string j = std::string(json) + "\n";
    const char* csv = ccsim_compare_csv(ids.data(), count, labels.data());
    if (csv == nullptr) fail("compare_csv");
    std::string v = csv;
    for (std::int32_t id : ids) ccsim_session_release(id);
    ccsim_trace_release(trace);
    return {j, v};
}

std::vector<Scenario> scenarios() {
    // Configurations from docs/WORKING_DEMO.md section 2, plus contract 1.1 variants of Demo B
    // so the decoder sees every action kind.
    const Level a1{64, 16, 1, 1}, a2{64, 16, 2, 1};
    const Level b1{64, 16, 2, 1}, b2{128, 16, 2, 10};
    Level c3{48, 16, 3, 1, 1}, c4{64, 16, 4, 1, 1};
    Level wt1 = b1, wt2 = b2, nwa1 = b1;
    wt1.write_policy = 1;
    wt2.write_policy = 1;
    nwa1.write_miss = 1;
    return {
        {"demo_a_direct", "demo_a_conflict.trace", a1, false, {}, 100},
        {"demo_a_2way", "demo_a_conflict.trace", a2, false, {}, 100},
        {"demo_b", "demo_b_two_level.trace", b1, true, b2, 100},
        {"demo_b_write_through", "demo_b_two_level.trace", wt1, true, wt2, 100},
        {"demo_b_no_write_allocate", "demo_b_two_level.trace", nwa1, true, b2, 100},
        {"demo_b_inclusive", "demo_b_two_level.trace", b1, true, b2, 100, 1},
        {"demo_b_exclusive", "demo_b_two_level.trace", b1, true, b2, 100, 2},
        {"demo_c_fifo3", "demo_c_belady.trace", c3, false, {}, 100},
        {"demo_c_fifo4", "demo_c_belady.trace", c4, false, {}, 100},
    };
}

std::vector<Compare> comparisons() {
    const auto all = scenarios();
    auto find = [&](const char* n) {
        for (const auto& s : all) if (s.name == n) return s;
        throw std::logic_error(n);
    };
    return {
        {"demo_a", {{"direct-mapped", find("demo_a_direct")}, {"2-way", find("demo_a_2way")}}},
        {"demo_c", {{"FIFO 3 lines", find("demo_c_fifo3")}, {"FIFO 4 lines", find("demo_c_fifo4")}}},
    };
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 3 || (std::string(argv[1]) != "--write" && std::string(argv[1]) != "--check")) {
        std::cerr << "usage: ccsim_web_fixtures --write|--check <dir>\n";
        return 2;
    }
#ifndef CCSIM_HAS_PRODUCTION_POLICIES
    std::cout << "SKIPPED: no production policies linked into this build\n";
    return 77;
#else
    ccsim::api::set_policy_factory(&ccsim::make_policy);
    const bool write = std::string(argv[1]) == "--write";
    const std::string dir = argv[2];
    try {
        std::vector<std::pair<std::string, std::string>> files;
        for (const Scenario& s : scenarios()) files.emplace_back(s.name + ".json", scenario_json(s, CCSIM_TEST_DATA_DIR));
        for (const Compare& c : comparisons()) {
            auto [json, csv] = compare_docs(c, CCSIM_TEST_DATA_DIR);
            files.emplace_back(c.name + ".compare.json", json);
            files.emplace_back(c.name + ".compare.csv", csv);
        }
        int stale = 0;
        for (const auto& [name, content] : files) {
            const std::string path = dir + "/" + name;
            if (write) {
                std::ofstream out(path, std::ios::binary);
                out << content;
                if (!out) throw std::runtime_error("cannot write " + path);
            } else {
                std::ifstream in(path, std::ios::binary);
                std::ostringstream ss;
                if (in) ss << in.rdbuf();
                if (!in || ss.str() != content) {
                    std::cerr << "stale: " << path << '\n';
                    ++stale;
                }
            }
        }
        if (stale > 0) {
            std::cerr << stale << " web fixture(s) out of date; run: ccsim_web_fixtures --write " << dir << '\n';
            return 1;
        }
        std::cout << (write ? "wrote " : "checked ") << files.size() << " web fixtures in " << dir << '\n';
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << '\n';
        return 1;
    }
#endif
}
