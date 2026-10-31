#include "ccsim/report/json.hpp"

#include <array>
#include <charconv>
#include <cmath>
#include <stdexcept>

namespace ccsim {

// ---- JsonWriter -------------------------------------------------------------------

void JsonWriter::separator() {
    if (after_key_) {
        after_key_ = false;
        return;
    }
    if (!first_.empty()) {
        if (!first_.back()) out_ += ',';
        first_.back() = false;
    }
}

JsonWriter& JsonWriter::begin_object() {
    separator();
    out_ += '{';
    first_.push_back(true);
    return *this;
}
JsonWriter& JsonWriter::end_object() {
    first_.pop_back();
    out_ += '}';
    return *this;
}
JsonWriter& JsonWriter::begin_array() {
    separator();
    out_ += '[';
    first_.push_back(true);
    return *this;
}
JsonWriter& JsonWriter::end_array() {
    first_.pop_back();
    out_ += ']';
    return *this;
}

JsonWriter& JsonWriter::key(std::string_view k) {
    value(k);
    out_ += ':';
    after_key_ = true;
    return *this;
}

JsonWriter& JsonWriter::value(std::string_view s) {
    separator();
    out_ += '"';
    for (const char c : s) {
        switch (c) {
            case '"': out_ += "\\\""; break;
            case '\\': out_ += "\\\\"; break;
            case '\n': out_ += "\\n"; break;
            case '\r': out_ += "\\r"; break;
            case '\t': out_ += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    static constexpr char kHex[] = "0123456789abcdef";
                    out_ += "\\u00";
                    out_ += kHex[(c >> 4) & 0xF];
                    out_ += kHex[c & 0xF];
                } else {
                    out_ += c;
                }
        }
    }
    out_ += '"';
    return *this;
}

JsonWriter& JsonWriter::value(bool b) {
    separator();
    out_ += b ? "true" : "false";
    return *this;
}

JsonWriter& JsonWriter::value(std::uint64_t v) {
    separator();
    out_ += std::to_string(v);
    return *this;
}

JsonWriter& JsonWriter::value(double v) {
    separator();
    if (!std::isfinite(v)) {
        out_ += "null";  // JSON has no NaN/Inf; should not happen with Rate semantics
        return *this;
    }
    std::array<char, 32> buf{};
    const auto res = std::to_chars(buf.data(), buf.data() + buf.size(), v);
    out_.append(buf.data(), res.ptr);
    // Keep integral doubles visibly non-integer for typed consumers ("68.0", not "68").
    bool integral = true;
    for (const char* p = buf.data(); p != res.ptr; ++p) {
        if (*p == '.' || *p == 'e' || *p == 'E' || *p == 'n' || *p == 'i') integral = false;
    }
    if (integral) out_ += ".0";
    return *this;
}

JsonWriter& JsonWriter::value(const std::optional<double>& v) {
    return v ? value(*v) : null();
}

JsonWriter& JsonWriter::null() {
    separator();
    out_ += "null";
    return *this;
}

JsonWriter& JsonWriter::hex(std::uint64_t v) {
    std::array<char, 20> buf{};
    buf[0] = '0';
    buf[1] = 'x';
    const auto res = std::to_chars(buf.data() + 2, buf.data() + buf.size(), v, 16);
    return value(std::string_view(buf.data(), static_cast<std::size_t>(res.ptr - buf.data())));
}

// ---- names ------------------------------------------------------------------------

std::string_view to_string(PolicyKind p) noexcept {
    const auto i = static_cast<std::size_t>(p);
    return i < kPolicyKindCount ? kPolicyKindNames[i] : "unknown";
}
std::string_view to_string(InclusionPolicy p) noexcept {
    switch (p) {
        case InclusionPolicy::NonInclusive: return "non_inclusive";
        case InclusionPolicy::Inclusive: return "inclusive";
        case InclusionPolicy::Exclusive: return "exclusive";
    }
    return "unknown";
}
std::string_view to_string(WritePolicy p) noexcept {
    return p == WritePolicy::WriteBack ? "write_back" : "write_through";
}
std::string_view to_string(WriteMissPolicy p) noexcept {
    return p == WriteMissPolicy::WriteAllocate ? "write_allocate" : "no_write_allocate";
}
std::string_view to_string(Outcome o) noexcept {
    switch (o) {
        case Outcome::NotAccessed: return "none";
        case Outcome::Hit: return "hit";
        case Outcome::Miss: return "miss";
        case Outcome::MissNoAllocate: return "miss_no_allocate";
    }
    return "unknown";
}
std::string_view to_string(ActionKind k) noexcept {
    switch (k) {
        case ActionKind::Lookup: return "lookup";
        case ActionKind::Evict: return "evict";
        case ActionKind::Fill: return "fill";
        case ActionKind::Writeback: return "writeback";
        case ActionKind::WriteThrough: return "write_through";
        case ActionKind::BackInvalidate: return "back_invalidate";
        case ActionKind::MoveOut: return "move_out";
        case ActionKind::VictimInsert: return "victim_insert";
        case ActionKind::MemoryRead: return "memory_read";
        case ActionKind::MemoryWrite: return "memory_write";
    }
    return "unknown";
}

namespace {

std::string_view level_name(LevelId l) noexcept {
    switch (l) {
        case LevelId::L1: return "L1";
        case LevelId::L2: return "L2";
        case LevelId::Memory: return "memory";
    }
    return "unknown";
}

std::string describe_level(const CacheConfig& c) {
    std::string s = c.name + ' ' + std::to_string(c.size_bytes) + "B/" + std::to_string(c.line_bytes) +
                    "B/" + std::to_string(c.ways) + "w " + std::string(to_string(c.policy)) + ' ';
    s += c.write_policy == WritePolicy::WriteBack ? "wb" : "wt";
    s += c.write_miss_policy == WriteMissPolicy::WriteAllocate ? "+wa " : "+nwa ";
    s += std::to_string(c.hit_latency_cycles) + 'c';
    return s;
}

void write_cache_config(JsonWriter& w, const CacheConfig& c) {
    w.begin_object()
        .field("name", c.name)
        .field("size_bytes", c.size_bytes)
        .field("line_bytes", c.line_bytes)
        .field("ways", c.ways)
        .field("hit_latency_cycles", c.hit_latency_cycles)
        .field("policy", to_string(c.policy))
        .field("write_policy", to_string(c.write_policy))
        .field("write_miss_policy", to_string(c.write_miss_policy))
        .end_object();
}

void write_stats(JsonWriter& w, const LevelStats& s) {
    w.field("accesses", s.accesses).field("reads", s.reads).field("writes", s.writes);
    w.field("hits", s.hits).field("misses", s.misses);
    w.field("read_misses", s.read_misses).field("write_misses", s.write_misses);
    w.field("evictions", s.evictions).field("writebacks", s.writebacks);
    w.field("writebacks_received", s.writebacks_received);
    w.field("writeback_hits", s.writeback_hits).field("writeback_misses", s.writeback_misses);
    w.field("no_allocate_misses", s.no_allocate_misses);
    w.field("write_throughs_sent", s.write_throughs_sent);
    w.field("write_throughs_received", s.write_throughs_received);
    w.field("back_invalidations", s.back_invalidations);
    w.field("victims_received", s.victims_received);
}

void write_u64_array(JsonWriter& w, const std::vector<std::uint64_t>& v) {
    w.begin_array();
    for (const auto x : v) w.value(x);
    w.end_array();
}

}  // namespace

std::string describe(const HierarchyConfig& c) {
    std::string s = describe_level(c.l1);
    if (c.l2) s += " | " + describe_level(*c.l2);
    s += " | mem " + std::to_string(c.memory_latency_cycles) + "c";
    if (c.l2) s += " | " + std::string(to_string(c.inclusion));
    s += " | seed " + std::to_string(c.seed);
    return s;
}

void write_config(JsonWriter& w, const HierarchyConfig& c) {
    w.begin_object();
    w.key("l1");
    write_cache_config(w, c.l1);
    w.key("l2");
    if (c.l2) write_cache_config(w, *c.l2); else w.null();
    w.field("memory_latency_cycles", c.memory_latency_cycles);
    w.field("inclusion", to_string(c.inclusion));
    w.field("seed", c.seed);
    // Exact copy for JavaScript: a uint64 seed above 2^53 does not survive JSON.parse as a number.
    w.key("seed_hex").hex(c.seed);
    w.field("description", describe(c));
    w.end_object();
}

void write_report(JsonWriter& w, const RunReport& r, std::string_view version) {
    w.begin_object();
    w.field("schema", "ccsim.simulation/1");
    w.field("ccsim_version", version);
    w.field("label", r.label);
    w.field("complete", r.complete);
    w.key("config");
    write_config(w, r.config);

    w.key("trace").begin_object();
    w.field("source", r.trace.source).field("accesses", r.trace.accesses);
    w.field("reads", r.trace.reads).field("writes", r.trace.writes);
    w.key("fingerprint").hex(r.trace.fingerprint);
    w.end_object();

    w.key("levels").begin_array();
    for (const LevelMetrics& m : r.levels) {
        w.begin_object();
        w.field("name", m.name);
        w.field("sets", m.geometry.sets).field("ways", m.geometry.ways).field("line_bytes", m.geometry.line_bytes);
        w.field("offset_bits", m.geometry.offset_bits).field("index_bits", m.geometry.index_bits);
        write_stats(w, m.stats);
        w.field("hit_rate", m.hit_rate).field("miss_rate", m.miss_rate);
        w.field("read_miss_rate", m.read_miss_rate).field("write_miss_rate", m.write_miss_rate);
        w.field("local_miss_rate", m.local_miss_rate).field("global_miss_rate", m.global_miss_rate);
        w.field("misses_per_kilo_access", m.misses_per_kilo_access);
        w.field("eviction_rate", m.eviction_rate).field("dirty_eviction_ratio", m.dirty_eviction_ratio);
        w.key("three_c");
        if (m.three_c) {
            w.begin_object()
                .field("compulsory", m.three_c->compulsory)
                .field("capacity", m.three_c->capacity)
                .field("conflict", m.three_c->conflict)
                .field("shadow_only_misses", m.three_c->shadow_only_misses)
                .end_object();
        } else {
            w.null();
        }
        w.key("set_heatmap").begin_object();
        w.field("sets", m.heatmap.sets).field("bin_size", m.heatmap.bin_size);
        w.field("untouched_sets", m.heatmap.untouched_sets);
        w.field("access_cv", m.heatmap.access_cv).field("max_to_mean_access", m.heatmap.max_to_mean_access);
        w.key("accesses");
        write_u64_array(w, m.heatmap.accesses);
        w.key("misses");
        write_u64_array(w, m.heatmap.misses);
        w.end_object();
        w.end_object();
    }
    w.end_array();

    w.key("memory").begin_object();
    w.field("reads", r.result.memory.reads).field("writes", r.result.memory.writes);
    w.field("read_bytes", r.metrics.memory_read_bytes).field("write_bytes", r.metrics.memory_write_bytes);
    w.field("bytes_per_access", r.metrics.memory_bytes_per_access);
    w.field("accesses_per_kilo_access", r.metrics.memory_accesses_per_kilo_access);
    w.end_object();

    w.field("total_latency_cycles", r.result.total_latency_cycles);
    w.field("amat_cycles", r.metrics.amat_cycles);
    w.field("amat_textbook_cycles", r.metrics.amat_textbook_cycles);
    w.field("speedup_vs_memory", r.metrics.speedup_vs_memory);
    w.key("latency_breakdown").begin_object();
    w.field("l1_cycles", r.metrics.latency.l1_cycles);
    w.field("l2_cycles", r.metrics.latency.l2_cycles);
    w.field("memory_cycles", r.metrics.latency.memory_cycles);
    w.end_object();

    w.key("timeline").begin_object();
    w.key("columns").begin_array();
    for (const char* c : {"accesses", "l1_hits", "l1_misses", "l2_hits", "l2_misses", "memory_reads",
                          "memory_writes", "latency_cycles"}) {
        w.value(c);
    }
    w.end_array();
    w.key("rows").begin_array();  // columnar rows: ~8x smaller than an array of objects
    for (const TimelinePoint& p : r.timeline) {
        w.begin_array().value(p.accesses).value(p.l1_hits).value(p.l1_misses).value(p.l2_hits)
            .value(p.l2_misses).value(p.memory_reads).value(p.memory_writes).value(p.latency_cycles).end_array();
    }
    w.end_array();
    w.end_object();

    w.key("reuse");
    if (r.reuse) {
        w.begin_object();
        w.field("line_bytes", r.reuse->line_bytes).field("cold", r.reuse->cold);
        w.field("footprint_bytes", r.reuse->footprint_bytes());
        w.key("histogram");
        write_u64_array(w, r.reuse->histogram);
        w.key("fa_lru_miss_ratio").begin_array();  // index k: capacity 2^k lines
        for (std::uint32_t k = 0; k < 32; ++k) {
            // No accesses = zero denominator: null, never 0 (TECHNICAL_DESIGN 6).
            if (r.reuse->accesses == 0) w.null(); else w.value(r.reuse->fa_lru_miss_ratio_pow2(k));
        }
        w.end_array();
        w.end_object();
    } else {
        w.null();
    }
    w.end_object();
}

std::string report_to_json(const RunReport& r, std::string_view version) {
    JsonWriter w;
    write_report(w, r, version);
    return w.take();
}

std::string event_to_json(const AccessEvent& e) {
    JsonWriter w;
    w.begin_object();
    w.field("schema", "ccsim.events/1");
    w.field("seq", e.seq);
    w.field("op", e.access.type == AccessType::Write ? "W" : "R");
    w.key("address").hex(e.access.address);
    w.key("line").hex(e.line);
    w.field("offset", e.offset);
    auto level = [&](const char* name, const LevelView& v) {
        w.key(name).begin_object();
        w.field("result", to_string(v.outcome)).field("set", v.set);
        w.key("tag").hex(v.tag);
        w.field("way", v.way).end_object();
    };
    level("l1", e.l1);
    level("l2", e.l2);
    w.key("actions").begin_array();
    for (std::uint8_t i = 0; i < e.action_count; ++i) {
        const Action& a = e.actions[i];
        w.begin_object().field("kind", to_string(a.kind)).field("level", level_name(a.level));
        w.field("hit", (a.flags & Action::kHit) != 0).field("dirty", (a.flags & Action::kDirty) != 0);
        w.field("from_policy", (a.flags & Action::kFromPolicy) != 0);
        w.field("set", a.set).field("way", a.way);
        w.key("line").hex(a.line);
        w.end_object();
    }
    w.end_array();
    w.field("latency_cycles", e.latency_cycles);
    w.end_object();
    return w.take();
}

}  // namespace ccsim
