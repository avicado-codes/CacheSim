#include "ccsim/compare/compare.hpp"

#include <cmath>
#include <cstdio>
#include <functional>
#include <stdexcept>

#include "ccsim/sim/hierarchy.hpp"

namespace ccsim {
namespace {

template <class E>
E as_enum(std::uint64_t v, std::uint64_t count, const char* what) {
    if (v >= count) throw ConfigError(std::string("sweep: invalid ") + what + " value " + std::to_string(v));
    return static_cast<E>(v);
}

std::uint32_t as_u32(std::uint64_t v, const char* what) {
    if (v > 0xFFFFFFFFULL) throw ConfigError(std::string("sweep: ") + what + " out of range");
    return static_cast<std::uint32_t>(v);
}

CacheConfig& need_l2(HierarchyConfig& c) {
    if (!c.l2) throw ConfigError("sweep: an L2 field was swept but the base config has no L2");
    return *c.l2;
}

void apply(HierarchyConfig& c, SweepField f, std::uint64_t v) {
    switch (f) {
        case SweepField::L1Size: c.l1.size_bytes = v; break;
        case SweepField::L1Ways: c.l1.ways = as_u32(v, "L1 ways"); break;
        case SweepField::L1Policy: c.l1.policy = as_enum<PolicyKind>(v, kPolicyKindCount, "policy"); break;
        case SweepField::L1WritePolicy: c.l1.write_policy = as_enum<WritePolicy>(v, 2, "write policy"); break;
        case SweepField::L1WriteMissPolicy: c.l1.write_miss_policy = as_enum<WriteMissPolicy>(v, 2, "write-miss policy"); break;
        case SweepField::L1Latency: c.l1.hit_latency_cycles = as_u32(v, "L1 latency"); break;
        case SweepField::L2Size: need_l2(c).size_bytes = v; break;
        case SweepField::L2Ways: need_l2(c).ways = as_u32(v, "L2 ways"); break;
        case SweepField::L2Policy: need_l2(c).policy = as_enum<PolicyKind>(v, kPolicyKindCount, "policy"); break;
        case SweepField::L2WritePolicy: need_l2(c).write_policy = as_enum<WritePolicy>(v, 2, "write policy"); break;
        case SweepField::L2Latency: need_l2(c).hit_latency_cycles = as_u32(v, "L2 latency"); break;
        case SweepField::LineBytes:
            c.l1.line_bytes = as_u32(v, "line");
            if (c.l2) c.l2->line_bytes = c.l1.line_bytes;
            break;
        case SweepField::Inclusion: c.inclusion = as_enum<InclusionPolicy>(v, 3, "inclusion"); break;
        case SweepField::MemoryLatency: c.memory_latency_cycles = as_u32(v, "memory latency"); break;
        case SweepField::Seed: c.seed = v; break;
    }
}

// RFC 4180 field: wrapped in quotes, embedded quotes doubled. Labels are user text.
std::string csv_quote(const std::string& v) {
    std::string out = "\"";
    for (const char ch : v) {
        if (ch == '"') out += '"';
        out += ch;
    }
    return out + '"';
}

std::string fmt(const Rate& r) {
    if (!r) return "n/a";
    char buf[48];
    std::snprintf(buf, sizeof buf, "%.6g", *r);
    return buf;
}

struct MetricDef {
    const char* key;
    const char* label;
    const char* unit;
    Better better;
    std::function<Rate(const RunReport&)> get;
};

const LevelMetrics* level(const RunReport& r, std::size_t i) {
    return i < r.levels.size() ? &r.levels[i] : nullptr;
}

Rate count(std::uint64_t v) { return static_cast<double>(v); }

std::vector<MetricDef> metric_defs() {
    using R = const RunReport&;
    auto l1 = [](R r) { return level(r, 0); };
    auto l2 = [](R r) { return level(r, 1); };
    auto three_c = [](const LevelMetrics* m, int which) -> Rate {
        if (m == nullptr || !m->three_c) return std::nullopt;
        const MissBreakdown& b = *m->three_c;
        return count(which == 0 ? b.compulsory : which == 1 ? b.capacity : b.conflict);
    };
    return {
        {"amat_cycles", "AMAT", "cycles", Better::Lower, [](R r) { return r.metrics.amat_cycles; }},
        {"speedup_vs_memory", "Speed-up vs. no cache", "x", Better::Higher, [](R r) { return r.metrics.speedup_vs_memory; }},
        {"total_latency_cycles", "Total latency", "cycles", Better::Lower, [](R r) { return count(r.result.total_latency_cycles); }},
        {"l1.miss_rate", "L1 miss rate", "ratio", Better::Lower, [=](R r) { return l1(r)->miss_rate; }},
        {"l1.read_miss_rate", "L1 read miss rate", "ratio", Better::Lower, [=](R r) { return l1(r)->read_miss_rate; }},
        {"l1.write_miss_rate", "L1 write miss rate", "ratio", Better::Lower, [=](R r) { return l1(r)->write_miss_rate; }},
        {"l1.mpka", "L1 misses / 1000 accesses", "count", Better::Lower, [=](R r) { return l1(r)->misses_per_kilo_access; }},
        {"l1.compulsory", "L1 compulsory misses", "count", Better::Lower, [=](R r) { return three_c(l1(r), 0); }},
        {"l1.capacity", "L1 capacity misses", "count", Better::Lower, [=](R r) { return three_c(l1(r), 1); }},
        {"l1.conflict", "L1 conflict misses", "count", Better::Lower, [=](R r) { return three_c(l1(r), 2); }},
        {"l1.evictions", "L1 evictions", "count", Better::Lower, [=](R r) { return count(l1(r)->stats.evictions); }},
        {"l1.writebacks", "L1 write-backs", "count", Better::Lower, [=](R r) { return count(l1(r)->stats.writebacks); }},
        {"l1.back_invalidations", "L1 back-invalidations", "count", Better::Lower, [=](R r) { return count(l1(r)->stats.back_invalidations); }},
        {"l2.local_miss_rate", "L2 local miss rate", "ratio", Better::Lower, [=](R r) { return l2(r) ? l2(r)->local_miss_rate : Rate{}; }},
        {"l2.global_miss_rate", "L2 global miss rate", "ratio", Better::Lower, [=](R r) { return l2(r) ? l2(r)->global_miss_rate : Rate{}; }},
        {"l2.conflict", "L2 conflict misses", "count", Better::Lower, [=](R r) { return three_c(l2(r), 2); }},
        {"memory.reads", "Memory reads", "count", Better::Lower, [](R r) { return count(r.result.memory.reads); }},
        {"memory.writes", "Memory writes", "count", Better::Lower, [](R r) { return count(r.result.memory.writes); }},
        {"memory.bytes_per_access", "Memory traffic / access", "bytes", Better::Lower, [](R r) { return r.metrics.memory_bytes_per_access; }},
    };
}

void diff_level(const CacheConfig& a, const CacheConfig& b, const std::string& run, std::vector<std::string>& out) {
    auto add = [&](const std::string& f, const std::string& x, const std::string& y) {
        if (x != y) out.push_back(a.name + '.' + f + ": " + x + " -> " + y + " (" + run + ')');
    };
    add("size", std::to_string(a.size_bytes), std::to_string(b.size_bytes));
    add("line", std::to_string(a.line_bytes), std::to_string(b.line_bytes));
    add("ways", std::to_string(a.ways), std::to_string(b.ways));
    add("policy", std::string(to_string(a.policy)), std::string(to_string(b.policy)));
    add("latency", std::to_string(a.hit_latency_cycles), std::to_string(b.hit_latency_cycles));
    add("write_policy", std::string(to_string(a.write_policy)), std::string(to_string(b.write_policy)));
    add("write_miss_policy", std::string(to_string(a.write_miss_policy)), std::string(to_string(b.write_miss_policy)));
}

}  // namespace

SweepResult expand_sweep(const HierarchyConfig& base, const std::vector<SweepAxis>& axes, std::size_t max_configs) {
    std::size_t total = 1;
    for (const SweepAxis& a : axes) {
        if (a.values.empty()) throw ConfigError("sweep: an axis has no values");
        total *= a.values.size();
        if (total > max_configs) {
            throw ConfigError("sweep: " + std::to_string(total) + "+ combinations exceed the limit of " +
                              std::to_string(max_configs));
        }
    }
    SweepResult out;
    std::vector<std::size_t> idx(axes.size(), 0);
    for (std::size_t n = 0; n < total; ++n) {
        HierarchyConfig c = base;
        for (std::size_t a = 0; a < axes.size(); ++a) apply(c, axes[a].field, axes[a].values[idx[a]]);
        try {
            Hierarchy::check(c);  // everything a run would refuse, so no accepted config fails later
            out.configs.push_back(c);
        } catch (const ConfigError& e) {
            out.rejected.push_back(describe(c) + ": " + e.what());
        }
        for (std::size_t a = axes.size(); a-- > 0;) {  // odometer, last axis fastest
            if (++idx[a] < axes[a].values.size()) break;
            idx[a] = 0;
        }
    }
    return out;
}

Comparison compare_runs(const std::vector<RunReport>& runs) {
    if (runs.empty()) throw std::invalid_argument("compare_runs: no runs");
    Comparison c;
    for (std::size_t i = 0; i < runs.size(); ++i) {
        c.labels.push_back(runs[i].label.empty() ? "run " + std::to_string(i) : runs[i].label);
        c.descriptions.push_back(describe(runs[i].config));
        if (runs[i].trace.fingerprint != runs[0].trace.fingerprint ||
            runs[i].trace.accesses != runs[0].trace.accesses) {
            c.same_trace = false;
        }
    }
    const HierarchyConfig& b = runs[0].config;
    for (std::size_t i = 1; i < runs.size(); ++i) {
        const HierarchyConfig& x = runs[i].config;
        diff_level(b.l1, x.l1, c.labels[i], c.differences);
        if (b.l2 && x.l2) diff_level(*b.l2, *x.l2, c.labels[i], c.differences);
        else if (b.l2.has_value() != x.l2.has_value())
            c.differences.push_back(std::string("L2: ") + (b.l2 ? "present" : "absent") + " -> " +
                                    (x.l2 ? "present" : "absent") + " (" + c.labels[i] + ')');
        if (b.inclusion != x.inclusion)
            c.differences.push_back(std::string("inclusion: ") + std::string(to_string(b.inclusion)) + " -> " +
                                    std::string(to_string(x.inclusion)) + " (" + c.labels[i] + ')');
        if (b.memory_latency_cycles != x.memory_latency_cycles)
            c.differences.push_back("memory_latency: " + std::to_string(b.memory_latency_cycles) + " -> " +
                                    std::to_string(x.memory_latency_cycles) + " (" + c.labels[i] + ')');
        if (b.seed != x.seed)
            c.differences.push_back("seed: " + std::to_string(b.seed) + " -> " + std::to_string(x.seed) + " (" + c.labels[i] + ')');
    }

    for (const MetricDef& d : metric_defs()) {
        ComparisonRow row{d.key, d.label, d.unit, d.better, {}, {}, {}, std::nullopt};
        bool any = false;
        for (const RunReport& r : runs) {
            row.values.push_back(d.get(r));
            any = any || row.values.back().has_value();
        }
        if (!any) continue;  // e.g. L2 rows when no run has an L2
        const Rate base = row.values[0];
        for (std::size_t i = 0; i < runs.size(); ++i) {
            const Rate v = row.values[i];
            row.delta_abs.push_back(v && base ? Rate(*v - *base) : Rate{});
            row.delta_rel.push_back(v && base && *base != 0.0 ? Rate((*v - *base) / *base) : Rate{});
            if (v && (!row.best || (d.better == Better::Lower ? *v < *row.values[*row.best]
                                                               : d.better == Better::Higher && *v > *row.values[*row.best]))) {
                row.best = i;
            }
        }
        // Equal best values name no winner: exports must not crown the baseline by position.
        if (row.best && d.better != Better::Neither) {
            const double top = *row.values[*row.best];
            std::size_t sharing = 0;
            for (const Rate& v : row.values) sharing += v && *v == top ? 1 : 0;
            if (sharing > 1) {
                row.tie = true;
                row.best.reset();
            }
        }
        c.rows.push_back(std::move(row));
    }
    return c;
}

std::string comparison_csv(const Comparison& c) {
    std::string s = "metric,unit,better";
    for (const auto& l : c.labels) s += ',' + csv_quote(l);
    for (std::size_t i = 1; i < c.labels.size(); ++i) s += ',' + csv_quote("delta_rel " + c.labels[i]);
    s += ",best\n";
    for (const ComparisonRow& r : c.rows) {
        s += r.key + ',' + r.unit + ',' + (r.better == Better::Lower ? "lower" : r.better == Better::Higher ? "higher" : "n/a");
        for (const Rate& v : r.values) s += ',' + fmt(v);
        for (std::size_t i = 1; i < r.delta_rel.size(); ++i) s += ',' + fmt(r.delta_rel[i]);
        s += ',' + (r.best ? csv_quote(c.labels[*r.best]) : std::string(r.tie ? "tie" : "n/a")) + '\n';
    }
    return s;
}

std::string comparison_log(const Comparison& c) {
    std::string s = "ccsim benchmark comparison\n";
    s += c.same_trace ? "trace: identical for all runs\n" : "WARNING: runs used different traces; deltas are not a fair comparison\n";
    for (std::size_t i = 0; i < c.labels.size(); ++i) {
        s += "  [" + std::to_string(i) + "] " + c.labels[i] + (i == 0 ? " (baseline)" : "") + ": " + c.descriptions[i] + '\n';
    }
    s += "differences from baseline:\n";
    if (c.differences.empty()) s += "  (none)\n";
    for (const auto& d : c.differences) s += "  " + d + '\n';
    s += "metrics:\n";
    for (const ComparisonRow& r : c.rows) {
        s += "  " + r.label + " [" + r.unit + "]:";
        for (std::size_t i = 0; i < r.values.size(); ++i) {
            s += "  " + c.labels[i] + '=' + fmt(r.values[i]);
            if (i > 0 && r.delta_rel[i]) {
                char buf[32];
                std::snprintf(buf, sizeof buf, " (%+.2f%%)", 100.0 * *r.delta_rel[i]);
                s += buf;
            }
        }
        if (r.best) s += "  -> best: " + c.labels[*r.best];
        else if (r.tie) s += "  -> tie";
        s += '\n';
    }
    return s;
}

void write_comparison(JsonWriter& w, const Comparison& c) {
    w.begin_object();
    w.field("schema", "ccsim.comparison/1");
    w.field("same_trace", c.same_trace);
    w.key("runs").begin_array();
    for (std::size_t i = 0; i < c.labels.size(); ++i) {
        w.begin_object().field("label", c.labels[i]).field("description", c.descriptions[i]).end_object();
    }
    w.end_array();
    w.key("differences").begin_array();
    for (const auto& d : c.differences) w.value(d);
    w.end_array();
    w.key("metrics").begin_array();
    for (const ComparisonRow& r : c.rows) {
        w.begin_object().field("key", r.key).field("label", r.label).field("unit", r.unit);
        w.field("better", r.better == Better::Lower ? "lower" : r.better == Better::Higher ? "higher" : "neither");
        w.key("values").begin_array();
        for (const Rate& v : r.values) w.value(v);
        w.end_array();
        w.key("delta_abs").begin_array();
        for (const Rate& v : r.delta_abs) w.value(v);
        w.end_array();
        w.key("delta_rel").begin_array();
        for (const Rate& v : r.delta_rel) w.value(v);
        w.end_array();
        w.key("best");
        if (r.best) w.value(static_cast<std::uint64_t>(*r.best)); else w.null();
        w.field("tie", r.tie);
        w.end_object();
    }
    w.end_array();
    w.end_object();
}

}  // namespace ccsim
