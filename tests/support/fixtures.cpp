#include "fixtures.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>

#include "harness.hpp"

#ifdef CCSIM_TESTS_HAVE_ZLIB
#include <zlib.h>
#endif

namespace ccsim::testing {
namespace {

std::uint64_t splitmix(std::uint64_t& s) {
    std::uint64_t z = (s += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

bool ends_with(const std::string& s, const std::string& suffix) {
    return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace

CacheConfig level(const char* name, std::uint64_t size, std::uint32_t line, std::uint32_t ways,
                  PolicyKind policy, std::uint32_t latency) {
    CacheConfig c;
    c.name = name;
    c.size_bytes = size;
    c.line_bytes = line;
    c.ways = ways;
    c.policy = policy;
    c.hit_latency_cycles = latency;
    return c;
}

HierarchyConfig l1_only(std::uint64_t size, std::uint32_t line, std::uint32_t ways, PolicyKind policy,
                        std::uint32_t l1_latency, std::uint32_t memory_latency) {
    HierarchyConfig h;
    h.l1 = level("L1", size, line, ways, policy, l1_latency);
    h.memory_latency_cycles = memory_latency;
    return h;
}

HierarchyConfig default_hierarchy() {
    HierarchyConfig h;
    h.l1 = level("L1", 32 * 1024, 64, 8, PolicyKind::Lru, 4);
    h.l2 = level("L2", 256 * 1024, 64, 8, PolicyKind::Lru, 12);
    h.memory_latency_cycles = 200;
    return h;
}

std::shared_ptr<Trace> trace_from_text(const std::string& text, const std::string& name) {
    std::istringstream in(text);
    return std::make_shared<Trace>(read_trace(in, name));
}

bool gzip_supported() noexcept {
#ifdef CCSIM_TESTS_HAVE_ZLIB
    return true;
#else
    return false;
#endif
}

std::shared_ptr<Trace> load_trace_file(const std::string& path) {
    if (!ends_with(path, ".gz")) {
        std::ifstream in(path, std::ios::binary);
        if (!in) throw std::runtime_error("cannot open " + path);
        return std::make_shared<Trace>(read_trace(in, path));
    }
#ifdef CCSIM_TESTS_HAVE_ZLIB
    gzFile f = gzopen(path.c_str(), "rb");
    if (f == nullptr) throw std::runtime_error("cannot open " + path);
    gzbuffer(f, 1U << 17);
    auto trace = std::make_shared<Trace>();
    TraceParser parser(path);
    std::string buf(1U << 20, '\0');
    for (;;) {
        const int got = gzread(f, buf.data(), static_cast<unsigned>(buf.size()));
        if (got < 0) {
            gzclose(f);
            throw std::runtime_error(path + ": gzip read error");
        }
        if (got == 0) break;
        parser.feed(std::string_view(buf.data(), static_cast<std::size_t>(got)), *trace);
    }
    gzclose(f);
    parser.finish(*trace);
    return trace;
#else
    throw SkipTest{"zlib not found at configure time; cannot read " + path};
#endif
}

std::shared_ptr<Trace> synthetic_random(std::size_t n, std::uint64_t footprint, double write_ratio, std::uint64_t seed) {
    auto t = std::make_shared<Trace>();
    t->reserve(n);
    std::uint64_t s = seed;
    const auto threshold = static_cast<std::uint64_t>(write_ratio * 1e6);
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint64_t addr = 0x10000000ULL + (splitmix(s) % footprint);
        const bool write = (splitmix(s) % 1000000ULL) < threshold;
        t->push_back({write ? AccessType::Write : AccessType::Read, addr});
    }
    return t;
}

std::shared_ptr<Trace> synthetic_stride(std::size_t n, std::uint64_t stride, std::uint64_t footprint) {
    auto t = std::make_shared<Trace>();
    t->reserve(n);
    for (std::size_t i = 0; i < n; ++i) t->push_back({AccessType::Read, 0x20000000ULL + (i * stride) % footprint});
    return t;
}

std::shared_ptr<Trace> synthetic_mixed(std::size_t n, std::uint64_t seed) {
    auto t = std::make_shared<Trace>();
    t->reserve(n);
    std::uint64_t s = seed;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint64_t r = splitmix(s);
        std::uint64_t addr;
        switch ((i / 4096) % 4) {
            case 0: addr = 0x1000000ULL + (i * 8) % (1U << 20); break;                       // sequential 1 MiB sweep
            case 1: addr = 0x2000000ULL + (r % 4096);  break;                                // hot 4 KiB
            case 2: addr = 0x3000000ULL + ((r % 64) * 8192); break;                          // 8 KiB stride: conflicts
            default: addr = 0x4000000ULL + (r % (8U << 20)); break;                          // random 8 MiB
        }
        t->push_back({(r >> 60) < 4 ? AccessType::Write : AccessType::Read, addr});
    }
    return t;
}

SimulationResult simulate(const Trace& trace, const HierarchyConfig& config, PolicyFactory factory) {
    Hierarchy h(config, factory);
    for (std::size_t i = 0; i < trace.size(); ++i) h.access(trace[i]);
    return h.result();
}

void check_invariants(const SimulationResult& r, const HierarchyConfig& c, const std::string& ctx) {
    auto fail_if = [&](bool bad, const std::string& what) {
        if (bad) report_failure(__FILE__, __LINE__, ctx + ": invariant violated: " + what);
    };
    const LevelStats& a = r.l1;
    fail_if(a.hits + a.misses != a.accesses, "L1 hits + misses == accesses");
    fail_if(a.reads + a.writes != a.accesses, "L1 reads + writes == accesses");
    fail_if(a.read_misses + a.write_misses != a.misses, "L1 read_misses + write_misses == misses");
    fail_if(a.no_allocate_misses > a.write_misses, "L1 no_allocate_misses <= write_misses");
    fail_if(a.evictions > a.misses - a.no_allocate_misses, "L1 evictions <= allocating misses");
    fail_if(a.writebacks > a.evictions, "L1 writebacks <= evictions");
    const std::uint64_t allocating = a.misses - a.no_allocate_misses;

    if (!r.l2) {
        fail_if(r.memory.reads != allocating, "memory.reads == L1 allocating misses (no L2)");
        fail_if(r.memory.writes != a.writebacks + a.write_throughs_sent, "memory.writes == L1 writebacks + write-throughs");
        fail_if(r.total_latency_cycles != std::uint64_t{c.l1.hit_latency_cycles} * a.accesses +
                                              std::uint64_t{c.memory_latency_cycles} * r.memory.reads,
                "latency decomposition (no L2)");
        return;
    }
    const LevelStats& b = *r.l2;
    fail_if(b.hits + b.misses != b.accesses, "L2 hits + misses == accesses");
    fail_if(b.reads != b.accesses || b.writes != 0, "L2 demand accesses are all reads");
    fail_if(b.accesses != allocating, "L2.accesses == L1 allocating misses");
    fail_if(b.writebacks > b.evictions, "L2 writebacks <= evictions");
    fail_if(b.write_throughs_received != a.write_throughs_sent, "L2 write_throughs_received == L1 write_throughs_sent");
    fail_if(b.writebacks_received != a.writebacks, "L2 writebacks_received == L1 writebacks");
    fail_if(b.writeback_hits + b.writeback_misses != b.writebacks_received, "L2 writeback hits + misses == received");
    fail_if(r.memory.reads != b.misses, "memory.reads == L2.misses");
    fail_if(r.memory.writes != b.writebacks + b.write_throughs_sent, "memory.writes == L2 writebacks + write-throughs sent");
    fail_if(r.total_latency_cycles != std::uint64_t{c.l1.hit_latency_cycles} * a.accesses +
                                          std::uint64_t{c.l2->hit_latency_cycles} * b.accesses +
                                          std::uint64_t{c.memory_latency_cycles} * b.misses,
            "latency decomposition");
    switch (c.inclusion) {
        case InclusionPolicy::NonInclusive:
            fail_if(a.back_invalidations != 0 || b.victims_received != 0, "NINE: no back-invalidations / victim inserts");
            break;
        case InclusionPolicy::Inclusive:
            fail_if(b.victims_received != 0, "inclusive: no victim inserts");
            // ARCHITECTURE 5.4, unconditional: inclusion holds whatever L2's write policy is.
            fail_if(b.writeback_misses != 0, "inclusive: L1 write-backs always hit L2");
            break;
        case InclusionPolicy::Exclusive:
            fail_if(a.back_invalidations != 0, "exclusive: no back-invalidations");
            fail_if(b.victims_received != a.evictions, "exclusive: every L1 victim moves to L2");
            fail_if(b.writeback_hits != 0, "exclusive: L2 never already holds an L1 victim");
            break;
    }
}

std::string data_dir() { return CCSIM_TEST_DATA_DIR; }

std::string results_dir() {
    const std::string dir = CCSIM_TEST_RESULTS_DIR;
    std::filesystem::create_directories(dir);
    return dir;
}

void write_text_file(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary);
    out << text;
    if (!out) throw std::runtime_error("cannot write " + path);
}

}  // namespace ccsim::testing
