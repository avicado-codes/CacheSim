// C ABI over ccsim_core. This is the boundary layer (like the CLI): it alone keeps a
// handle registry and the "last error" string; the core stays free of global state.
// Exceptions never cross the ABI: every entry point catches and reports via last_error.

#include "ccsim/wasm/ccsim_api.h"

#include <cstdlib>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "ccsim/compare/compare.hpp"
#include "ccsim/io/trace.hpp"
#include "ccsim/report/json.hpp"
#include "ccsim/session/session.hpp"
#include "ccsim/wasm/api_internal.hpp"

#ifndef CCSIM_VERSION
#define CCSIM_VERSION "unknown"
#endif

namespace {

using namespace ccsim;

struct TraceUpload {
    TraceParser parser;
    std::shared_ptr<Trace> trace = std::make_shared<Trace>();
    std::string source;
    bool done = false;
    TraceUpload(std::string name, std::uint64_t max) : parser(name, max), source(std::move(name)) {}
};

struct State {
    PolicyFactory factory = nullptr;
    std::vector<std::unique_ptr<TraceUpload>> traces;  // handle = index + 1
    std::vector<std::unique_ptr<Session>> sessions;
    std::vector<std::string> session_sources;
    std::vector<std::weak_ptr<const Trace>> session_traces;  // per session, for the reuse cache
    // Last reuse profile computed. It depends only on the trace and the line size, so every
    // session on that trace shares it; a weak_ptr never matches a freed (or reallocated) trace.
    std::weak_ptr<const Trace> reuse_trace;
    std::uint32_t reuse_line_bytes = 0;
    std::optional<ReuseProfile> reuse;
    std::vector<std::uint32_t> events;
    std::vector<AccessEvent> scratch;  // reused by step(record) so a frame does not allocate
    std::string error;
    std::string text;  // last returned string
};

State& state() {
    static State s;
    return s;
}

template <class T>
T* lookup(std::vector<std::unique_ptr<T>>& v, std::int32_t h) {
    if (h <= 0 || static_cast<std::size_t>(h) > v.size() || !v[static_cast<std::size_t>(h) - 1]) {
        throw std::invalid_argument("invalid handle " + std::to_string(h));
    }
    return v[static_cast<std::size_t>(h) - 1].get();
}

// Handles are never reused: a released slot stays empty (8 bytes), so a stale handle held by
// JavaScript fails with "invalid handle" instead of silently reaching a newer object.
template <class T>
std::int32_t store(std::vector<std::unique_ptr<T>>& v, std::unique_ptr<T> p) {
    if (v.size() >= 0x7FFFFFFFU) throw std::length_error("handle space exhausted");
    v.push_back(std::move(p));
    return static_cast<std::int32_t>(v.size());
}

template <class R, class F>
R guarded(R on_error, F&& f) {
    try {
        state().error.clear();
        return f();
    } catch (const std::exception& e) {
        state().error = e.what();
    } catch (...) {
        state().error = "unknown error";
    }
    return on_error;
}

void put64(std::vector<std::uint32_t>& out, std::uint64_t v) {
    out.push_back(static_cast<std::uint32_t>(v));
    out.push_back(static_cast<std::uint32_t>(v >> 32));
}

void encode(const AccessEvent& e, std::vector<std::uint32_t>& out) {
    put64(out, e.seq);
    out.push_back(e.access.type == AccessType::Write ? 1U : 0U);
    put64(out, e.access.address);
    put64(out, e.line);
    out.push_back(e.offset);
    for (const LevelView* v : {&e.l1, &e.l2}) {
        out.push_back(static_cast<std::uint32_t>(v->outcome));
        out.push_back(v->set);
        out.push_back(v->way);
        put64(out, v->tag);
    }
    out.push_back(e.latency_cycles);
    out.push_back(e.action_count);
    for (std::uint8_t i = 0; i < e.action_count; ++i) {
        const Action& a = e.actions[i];
        out.push_back(static_cast<std::uint32_t>(a.kind) | (static_cast<std::uint32_t>(a.level) << 8) |
                      (static_cast<std::uint32_t>(a.flags) << 16));
        out.push_back(a.set);
        out.push_back(a.way);
        put64(out, a.line);
    }
}

std::uint32_t u32(std::uint64_t v, const char* what) {
    if (v > 0xFFFFFFFFULL) throw ConfigError(std::string(what) + ": out of range");
    return static_cast<std::uint32_t>(v);
}

CacheConfig decode_level(const std::uint64_t* w, const char* name) {
    CacheConfig c;
    c.name = name;
    c.size_bytes = w[0];
    c.line_bytes = u32(w[1], "line");
    c.ways = u32(w[2], "ways");
    c.hit_latency_cycles = u32(w[3], "latency");
    if (w[4] >= kPolicyKindCount || w[5] > 1 || w[6] > 1) throw ConfigError(std::string(name) + ": invalid policy enum");
    c.policy = static_cast<PolicyKind>(w[4]);
    c.write_policy = static_cast<WritePolicy>(w[5]);
    c.write_miss_policy = static_cast<WriteMissPolicy>(w[6]);
    return c;
}

// Reuse profile of a session's whole trace, computed once per (trace, line size).
// The session keeps its trace alive, so the weak_ptr taken at creation always locks here.
const ReuseProfile& cached_reuse(std::int32_t session, std::uint32_t line_bytes) {
    State& st = state();
    std::shared_ptr<const Trace> t = st.session_traces[static_cast<std::size_t>(session) - 1].lock();
    if (!t) throw std::logic_error("session trace is gone");
    if (!st.reuse || st.reuse_line_bytes != line_bytes || st.reuse_trace.lock() != t) {
        st.reuse = reuse_profile(*t, line_bytes);
        st.reuse_trace = t;
        st.reuse_line_bytes = line_bytes;
    }
    return *st.reuse;
}

std::vector<RunReport> reports_for(const std::int32_t* sessions, std::uint32_t count, const char* const* labels) {
    std::vector<RunReport> runs;
    for (std::uint32_t i = 0; i < count; ++i) {
        Session* s = lookup(state().sessions, sessions[i]);
        const std::string label = labels != nullptr && labels[i] != nullptr ? labels[i] : "run " + std::to_string(i);
        runs.push_back(s->report(label));
    }
    return runs;
}

}  // namespace

namespace ccsim::api {

void set_policy_factory(PolicyFactory factory) noexcept { state().factory = factory; }

void check_js_safe_totals(const HierarchyConfig& c, std::uint64_t accesses) {
    constexpr std::uint64_t kJsSafe = (std::uint64_t{1} << 53) - 1;
    // Per access: at most one memory read and three memory writes (a write-back or dirty
    // victim, a dirty L2 eviction, a forwarded store), each a whole line.
    constexpr std::uint64_t kMaxLineTransfers = 4;
    if (accesses == 0) return;
    std::uint64_t worst = std::uint64_t{c.l1.hit_latency_cycles} + c.memory_latency_cycles;
    if (c.l2) worst += c.l2->hit_latency_cycles;
    if (worst > kJsSafe / accesses) {
        throw ConfigError("latency: " + std::to_string(accesses) + " accesses at up to " + std::to_string(worst) +
                          " cycles each could total more than 2^53 cycles, which JavaScript cannot "
                          "represent exactly; lower the latencies");
    }
    if (c.l1.line_bytes > kJsSafe / (kMaxLineTransfers * accesses)) {
        throw ConfigError("line: " + std::to_string(accesses) + " accesses with " + std::to_string(c.l1.line_bytes) +
                          "-byte lines could move more than 2^53 bytes to and from memory, which JavaScript "
                          "cannot represent exactly; use a smaller line");
    }
}

HierarchyConfig decode_config(const std::uint64_t* w, std::uint32_t count) {
    if (w == nullptr || count < CCSIM_CONFIG_WORDS) throw ConfigError("config: expected 19 words");
    if (w[0] != 1) throw ConfigError("config: unsupported layout version " + std::to_string(w[0]));
    HierarchyConfig c;
    c.l1 = decode_level(w + 1, "L1");
    if (w[8] != 0) c.l2 = decode_level(w + 9, "L2");
    c.memory_latency_cycles = u32(w[16], "memory_latency");
    if (w[17] > 2) throw ConfigError("inclusion: invalid enum");
    c.inclusion = static_cast<InclusionPolicy>(w[17]);
    c.seed = w[18];
    return c;
}

}  // namespace ccsim::api

extern "C" {

uint32_t ccsim_api_version(void) { return CCSIM_API_VERSION; }
const char* ccsim_last_error(void) { return state().error.c_str(); }

void* ccsim_alloc(uint32_t bytes) { return std::malloc(bytes == 0 ? 1 : bytes); }
void ccsim_free(void* ptr) { std::free(ptr); }

int32_t ccsim_trace_begin(const char* source_name, uint64_t max_accesses) {
    return guarded<std::int32_t>(0, [&] {
        return store(state().traces, std::make_unique<TraceUpload>(source_name ? source_name : "trace", max_accesses));
    });
}

int32_t ccsim_trace_feed(int32_t trace, const char* data, uint32_t length) {
    return guarded(-1, [&] {
        TraceUpload* t = lookup(state().traces, trace);
        if (t->done) throw std::logic_error("trace already finished");
        t->parser.feed(std::string_view(data, length), *t->trace);
        return 0;
    });
}

int32_t ccsim_trace_end(int32_t trace) {
    return guarded(-1, [&] {
        TraceUpload* t = lookup(state().traces, trace);
        t->parser.finish(*t->trace);
        t->done = true;
        return 0;
    });
}

uint64_t ccsim_trace_size(int32_t trace) {
    return guarded<std::uint64_t>(0, [&] { return static_cast<std::uint64_t>(lookup(state().traces, trace)->trace->size()); });
}

uint64_t ccsim_trace_fingerprint(int32_t trace) {
    return guarded<std::uint64_t>(0, [&] { return lookup(state().traces, trace)->trace->fingerprint(); });
}

void ccsim_trace_release(int32_t trace) {
    if (trace > 0 && static_cast<std::size_t>(trace) <= state().traces.size()) {
        state().traces[static_cast<std::size_t>(trace) - 1].reset();  // sessions keep their shared_ptr
    }
}

int32_t ccsim_session_create(int32_t trace, const uint64_t* config, uint32_t words, uint32_t flags) {
    return guarded<std::int32_t>(0, [&] {
        TraceUpload* t = lookup(state().traces, trace);
        if (!t->done) throw std::logic_error("call ccsim_trace_end before creating a session");
        if (state().factory == nullptr) {
            throw std::logic_error("no replacement policies are linked into this build (built without src/policy/)");
        }
        SessionOptions opt;
        opt.classify_misses = (flags & 1U) == 0;
        const HierarchyConfig cfg = api::decode_config(config, words);
        Hierarchy::check(cfg);  // the engine's own message first, then the browser's limit
        api::check_js_safe_totals(cfg, t->trace->size());
        auto s = std::make_unique<Session>(t->trace, cfg, state().factory, opt);
        const std::int32_t h = store(state().sessions, std::move(s));
        const auto n = static_cast<std::size_t>(h);
        if (state().session_sources.size() < n) state().session_sources.resize(n);
        if (state().session_traces.size() < n) state().session_traces.resize(n);
        state().session_sources[n - 1] = t->source;
        state().session_traces[n - 1] = t->trace;
        return h;
    });
}

void ccsim_session_release(int32_t session) {
    if (session > 0 && static_cast<std::size_t>(session) <= state().sessions.size()) {
        state().sessions[static_cast<std::size_t>(session) - 1].reset();
    }
}

uint64_t ccsim_session_position(int32_t session) {
    return guarded<std::uint64_t>(0, [&] { return lookup(state().sessions, session)->position(); });
}

int32_t ccsim_session_reset(int32_t session) {
    return guarded(-1, [&] {
        lookup(state().sessions, session)->reset();
        return 0;
    });
}

int32_t ccsim_session_seek(int32_t session, uint64_t position) {
    return guarded(-1, [&] {
        lookup(state().sessions, session)->seek(position);
        return 0;
    });
}

int32_t ccsim_session_step(int32_t session, uint32_t n, uint32_t record) {
    return guarded(-1, [&] {
        Session* s = lookup(state().sessions, session);
        auto& out = state().events;
        out.clear();
        if (record == 0) return static_cast<std::int32_t>(s->step(n, nullptr));
        // Events are recorded in slices so the AccessEvent scratch stays O(slice); the encoded
        // output is O(n) words (20 + 5 per action each), so callers step in frame-sized batches.
        constexpr std::uint32_t kSlice = 4096;
        std::vector<AccessEvent>& events = state().scratch;
        std::size_t done = 0;
        while (done < n) {
            events.clear();
            const std::size_t k = s->step(std::min<std::size_t>(kSlice, n - done), &events);
            for (const AccessEvent& e : events) encode(e, out);
            done += k;
            if (k == 0) break;
        }
        return static_cast<std::int32_t>(done);
    });
}

int32_t ccsim_session_run(int32_t session, uint32_t max_steps, uint32_t break_mask, uint64_t line) {
    return guarded(-1, [&] {
        Session* s = lookup(state().sessions, session);
        Breakpoints bp;
        bp.mask = break_mask;
        bp.line = line;
        AccessEvent last;
        const std::uint64_t before = s->position();
        const StopReason r = s->run(max_steps, bp, &last);
        state().events.clear();
        if (s->position() != before) encode(last, state().events);
        return static_cast<std::int32_t>(r);
    });
}

const uint32_t* ccsim_event_buffer(void) { return state().events.data(); }
uint32_t ccsim_event_buffer_words(void) { return static_cast<uint32_t>(state().events.size()); }

const uint8_t* ccsim_session_slot_states(int32_t session, uint32_t level) {
    return guarded<const std::uint8_t*>(nullptr, [&]() -> const std::uint8_t* {
        const Hierarchy& h = lookup(state().sessions, session)->hierarchy();
        const CacheLevel* c = level == 0 ? &h.l1() : level == 1 ? h.l2() : nullptr;
        return c ? c->slot_states().data() : nullptr;
    });
}

const uint64_t* ccsim_session_slot_tags(int32_t session, uint32_t level) {
    return guarded<const std::uint64_t*>(nullptr, [&]() -> const std::uint64_t* {
        const Hierarchy& h = lookup(state().sessions, session)->hierarchy();
        const CacheLevel* c = level == 0 ? &h.l1() : level == 1 ? h.l2() : nullptr;
        return c ? c->slot_tags().data() : nullptr;
    });
}

const char* ccsim_session_report_json(int32_t session, const char* label, uint32_t with_reuse) {
    return guarded<const char*>(nullptr, [&] {
        Session* s = lookup(state().sessions, session);
        RunReport r = s->report(label ? label : "run", state().session_sources[static_cast<std::size_t>(session) - 1]);
        // The reuse profile describes the whole trace, so it belongs only in a complete report:
        // next to mid-run counters it would describe accesses that have not executed yet.
        if (with_reuse != 0 && r.complete) r.reuse = cached_reuse(session, r.config.l1.line_bytes);
        state().text = report_to_json(r, CCSIM_VERSION);
        return state().text.c_str();
    });
}

const char* ccsim_compare_json(const int32_t* sessions, uint32_t count, const char* const* labels) {
    return guarded<const char*>(nullptr, [&] {
        JsonWriter w;
        write_comparison(w, compare_runs(reports_for(sessions, count, labels)));
        state().text = w.take();
        return state().text.c_str();
    });
}

const char* ccsim_compare_csv(const int32_t* sessions, uint32_t count, const char* const* labels) {
    return guarded<const char*>(nullptr, [&] {
        state().text = comparison_csv(compare_runs(reports_for(sessions, count, labels)));
        return state().text.c_str();
    });
}

}  // extern "C"
