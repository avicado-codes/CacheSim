# Technical Design

Status labels: **Implemented**, **Partially implemented**, **Planned**, **Deferred**.

> **Read [ARCHITECTURE.md](ARCHITECTURE.md) first.** It is the top-level source of truth: the product is now a deployed website with the engine compiled to WebAssembly, the cache model gains contract extension 1.1 (inclusion and write policies), and hardware monitoring is **Deferred**. This document keeps the exact v1 rules that ARCHITECTURE.md builds on.

Implementation status (2026-10-29): trace reader (section 7), address mapping (4), cache levels and hierarchy (5), statistics and AMAT (6), event stream (12) and analytics are **Implemented** as library code with tests (`tests/`). The production LRU, FIFO and Random policies (configuration track, PR #4) are **Implemented** with tests. The website (`web/`, React + TypeScript on the WebAssembly engine) is **Implemented** with Vitest suites (2026-11-01). `validate()` (configuration track) and the `simulate` CLI options are **Planned**. Monitoring (section 8) is **Deferred**. The contracts in sections 7 and 9-11 are frozen at the end of Milestone 1; after that they change only through the protocol in [CONTRIBUTING.md](../CONTRIBUTING.md#2-shared-interfaces-and-ownership-boundaries).

## 1. Scope

One executable, `ccsim`, with two modes:

- **Cache simulation**: replay a memory trace through a configurable L1 and optional L2 and report hits, misses, evictions, write-backs, memory traffic, and estimated AMAT. Results are deterministic and identical on every OS.
- **Hardware monitoring**: launch a command and sample the CPU counters the platform actually exposes, at a fixed interval. A metric that cannot be measured is reported as unavailable with a reason, never as zero.

Out of scope for v1: multicore and coherence, prefetching, TLB and virtual-memory modelling, instruction-fetch traces, cycle-accurate timing, network services, and GUI toolkits.

## 2. Architecture

The component diagram is in the [README](../README.md#architecture). Module boundaries:

| Module | Location | Track (ARCHITECTURE 12) | Status |
|---|---|---|---|
| CLI shell and exit codes | `include/ccsim/cli.hpp`, `src/cli.cpp`, `src/main.cpp` | Simulation | Partially implemented |
| Core types (shared contract, extension 1.1) | `include/ccsim/sim/types.hpp` | Shared | Implemented (header) |
| Config validation, spec parsing, presets | `include/ccsim/config/`, `src/config/` | Configuration | Planned |
| Replacement policies | `include/ccsim/policy/`, `src/policy/` | Configuration | Implemented: LRU, FIFO, Random (test stand-ins in `tests/support/` remain as an independent check) |
| Trace reader (format v1) | `include/ccsim/io/`, `src/io/` | Simulation | Implemented |
| Geometry, cache levels, hierarchy, statistics, AMAT, events | `include/ccsim/sim/`, `src/sim/` | Simulation | Implemented |
| Analytics: metrics, 3C, reuse distance | `include/ccsim/analytics/`, `src/analytics/` | Simulation | Implemented |
| Live session and batch runner | `include/ccsim/session/`, `src/session/` | Simulation | Implemented |
| JSON results and events | `include/ccsim/report/`, `src/report/` | Simulation | Implemented |
| Sweeps and comparison | `include/ccsim/compare/`, `src/compare/` | Simulation | Implemented |
| WebAssembly C ABI | `include/ccsim/wasm/`, `src/wasm/` | Simulation | Implemented; Emscripten build verified on Linux |
| Website | `web/` | Frontend | Implemented (Vitest suites; Playwright Planned) |
| Test suites, standard dataset, benchmarks | `tests/` | Simulation | Implemented |
| Monitor interface, sampler, backends | `include/ccsim/monitor/`, `src/monitor/` | — | Deferred |

Directories are created by the first PR that adds code to them; the initial commit contains only what builds today.

Design rules:

1. `src/sim/`, `src/policy/` and `src/io/` are ISO C++17 only: no OS headers, threads, clocks, or global mutable state.
2. OS-specific code lives only in `src/monitor/<os>/`. CMake selects those sources with `CMAKE_SYSTEM_NAME`; shared code contains no `#ifdef _WIN32`-style branches.
3. Every capability is a library call first (`ccsim_core`), so it can be tested in-process. The CLI only parses arguments and formats output.
4. Dependencies: standard library by default. A third-party library must be permissively licensed, header-only or trivially buildable, vendored under `third_party/` with a pinned version, and approved by Role 1. No runtime network access, cloud services, or paid APIs.

## 3. Cache configuration

| Parameter | Meaning | Constraint |
|---|---|---|
| `size` | Capacity in bytes; `KiB`/`MiB` suffixes accepted by the CLI | Divisible by `line * ways` |
| `line` | Line (block) size in bytes | Power of two |
| `ways` | Associativity; `1` = direct-mapped, `size/line` = fully associative | At least 1 |
| `policy` | `lru`, `fifo`, or `random` | |
| `latency` | Hit latency in cycles | At least 1 |
| `sets` (derived) | `size / (line * ways)` | Power of two, at least 1 |

Contract extension 1.1 adds `write_policy` (`write_back` | `write_through`) and `write_miss_policy` (`write_allocate` | `no_write_allocate`) per level, and `inclusion` (`non_inclusive` | `inclusive` | `exclusive`) for the hierarchy. The defaults are the v1 behaviour. Full table: [ARCHITECTURE.md section 5.1](ARCHITECTURE.md#51-configuration-surface).

Only the set count must be a power of two, so capacities such as 48 KiB with 12 ways and 64-byte lines (64 sets) are valid. Hierarchy-wide settings: optional L2, memory latency in cycles (at least 1), and a 64-bit seed for the Random policy (default 1). v1 requires the L1 and L2 line sizes to be equal. The worst-case latency of one access, `t1 + t2 + tmem` (`t1 + tmem` without L2), must fit in 32 bits (at most 4,294,967,295 cycles), the width of the per-access latency in events; `Hierarchy::check()` refuses larger values with a `ConfigError` naming `latency`.

CLI defaults when a key is omitted (teaching values, not a model of a specific CPU): L1 `32KiB`, 64-byte lines, 8 ways, LRU, 4 cycles; L2 `256KiB`, 64-byte lines, 8 ways, LRU, 12 cycles; memory 200 cycles.

## 4. Address mapping

Addresses are 64-bit unsigned values used as given (no virtual-to-physical translation).

```text
offset_bits = log2(line)
index_bits  = log2(sets)
line_number = address >> offset_bits
set_index   = line_number & (sets - 1)
tag         = line_number >> index_bits
```

Example: a 64-byte, 2-way cache with 16-byte lines has 2 sets, 4 offset bits and 1 index bit. Address `0x0C4` is line 12, set 0, tag 6.

## 5. Access semantics

### 5.1 Single cache level

1. Look up the tag in the set. On a **hit**, notify the policy (`on_hit`); a write sets the line's dirty bit.
2. On a **miss**, choose a way: the lowest-index invalid way if one exists, otherwise the policy's `select_victim`. The policy is consulted only for full sets.
3. If the chosen way holds a valid line, count an **eviction**; if that line is dirty, also count a **write-back** and send it to the next level.
4. Fetch the line from the next level, install it, and call `on_fill`. Write misses use **write-allocate**: fetch, install, then mark dirty.

Both levels are **write-back** with **write-allocate** by default. Write-through, no-write-allocate, inclusive and exclusive hierarchies are contract extension 1.1; their order of operations is normative in [ARCHITECTURE.md section 5.3](ARCHITECTURE.md#53-order-of-operations). Sections 5.1 to 5.3 here remain exactly true for the defaults.

### 5.2 L1/L2 hierarchy

The hierarchy is **non-inclusive, non-exclusive**: an L2 eviction never invalidates L1, so a line can stay in L1 after it leaves L2. Order of operations on an L1 miss (normative, because it changes L2 replacement state):

1. Choose the L1 way (5.1).
2. If the L1 victim is dirty, write it back into L2 (5.3).
3. Demand-fetch the missing line from L2. On an L2 miss, choose an L2 way (a dirty L2 victim causes one memory write), read the line from memory, and install it clean in L2.
4. Install the line in L1, dirty if the access was a write.

Without an L2, L1 misses read from memory and dirty L1 victims write to memory. Dirty lines still resident when the trace ends are not flushed and not counted.

### 5.3 Write-backs into L2

- **Hit**: mark the L2 line dirty and call `on_hit` (a write-back counts as a use for LRU).
- **Miss**: choose an L2 way (dirty victim causes a memory write) and install the line dirty. No memory read is needed because the full line is supplied.
- Write-backs are counted in `writebacks_received`, `writeback_hits`, and `writeback_misses`. They are not demand accesses and do not affect miss rates or AMAT.

### 5.4 Replacement policies

| Policy | `on_hit` | `on_fill` | Victim |
|---|---|---|---|
| LRU | Mark most recently used | Mark most recently used | Least recently used way |
| FIFO | No change | Record insertion order | Earliest inserted way |
| Random | No change | No change | `rng() % ways` |

Random is reproducible across operating systems by construction:

- Each level owns a `std::mt19937_64` seeded with `seed + level_index` (L1 = 0, L2 = 1). The standard fully specifies this engine's output sequence.
- The raw 64-bit output is reduced with `% ways`. Do **not** use `std::uniform_int_distribution`: its algorithm is implementation-defined and produces different sequences on libstdc++, libc++ and the MSVC STL. The modulo bias is negligible for realistic associativities.
- The generator advances only when a full set needs a victim.

## 6. Statistics and AMAT

Counters are `std::uint64_t` per level:

- All levels: `accesses`, `reads`, `writes`, `hits`, `misses`, `read_misses`, `write_misses`, `evictions`, `writebacks` (dirty evictions sent downward).
- L2 also: `writebacks_received`, `writeback_hits`, `writeback_misses`. L2 `accesses` counts demand fetches only, which are all reads.
- Memory: `reads`, `writes`.

Derived rates: `miss_rate = misses / accesses`; for L2, `local_miss_rate = L2.misses / L2.accesses` and `global_miss_rate = L2.misses / L1.accesses`. A rate with a zero denominator is reported as `null` (JSON) or `n/a` (text, CSV), never `0` or `NaN`.

Invariants (checked by tests; with the 1.1 counters, which are all 0 under the defaults, the general forms are in [ARCHITECTURE.md section 5.4](ARCHITECTURE.md#54-invariants-checked-on-every-run-in-tests)):

- `hits + misses == accesses`, `read_misses + write_misses == misses`, and for L1 `reads + writes == accesses`
- `writebacks <= evictions`, and for L1 `evictions <= misses`
- `L2.accesses == L1.misses` and `L2.writebacks_received == L1.writebacks`
- `memory.reads == L2.misses` and `memory.writes == L2.writebacks` (with no L2: `L1.misses` and `L1.writebacks`)

Latency model (additive, serial lookup): L1 hit costs `t1`; L1 miss with L2 hit costs `t1 + t2`; L2 miss costs `t1 + t2 + tmem`. Write-backs add no latency (assumed buffered).

**AMAT** is reported as `total_latency_cycles / L1.accesses`, where `total_latency_cycles` is an exact `uint64` sum. That is a single correctly rounded division, so the value is bit-identical on every IEEE-754 platform. The textbook form `t1 + m1 * (t2 + m2_local * tmem)` (or `t1 + m1 * tmem` without L2) is mathematically equal but is only a test cross-check with tolerance: evaluated in `double` it gives `67.99999999999999` instead of `68` for [Demo B](WORKING_DEMO.md#demo-b-two-level-walkthrough), and compilers may fuse `a*b+c` into FMA on some targets. AMAT here is an estimate: it ignores memory-level parallelism, write-back cost, queuing, and prefetching.

## 7. Trace format v1

```text
# ccsim trace v1: one access per line
R 0x7ffd1a20
W 0x7ffd1a28   # trailing comments are allowed
```

- Each record is `<op> <address>` separated by spaces or tabs. `op` is `R` (load) or `W` (store), uppercase.
- `address` is `0x`-prefixed hexadecimal with 1 to 16 digits; hex digits are case-insensitive.
- `#` starts a comment. Blank lines are ignored. LF and CRLF line endings are both accepted.
- Anything else is an error reported as `<file>:<line>: <message>` with exit code 1, and no result file is written.
- Access size is not modelled: each record touches only the line that contains `address`.
- File extension: `.trace`. Importers for Valgrind Lackey and Dinero formats are post-v1 candidates.

## 8. Hardware monitoring

> **Deferred** (2026-10-29). The project now focuses on the simulation website. This section is kept unchanged as the design for a later CLI-only `ccsim monitor`; nothing in it is being built.

### 8.1 Principles

- Measure a target process that `ccsim monitor` launches, counting user-mode events where the OS allows it.
- Probe first. Every requested metric gets one availability status: `available`, `unsupported` (OS or CPU does not expose it), `permission_denied`, `not_implemented` (the backend lacks it), or `error`.
- Unavailable values are emitted as `null` or `n/a` with the reason. Values extrapolated after counter multiplexing are flagged `scaled`.
- Never change system settings (sysctl, registry, privileges) automatically; report what is needed and point to [DEVELOPMENT.md](DEVELOPMENT.md#7-monitoring-prerequisites).
- Monitoring numbers are not expected to match the simulator (8.7).

### 8.2 Metric catalogue

| Metric | Meaning |
|---|---|
| `cycles`, `instructions` | Core clock cycles and retired instructions from the PMU |
| `ipc` | Derived `instructions / cycles`, only when both come from the same backend and interval |
| `l1d_loads`, `l1d_load_misses` | L1 data-cache read accesses and misses |
| `l2_accesses`, `l2_misses` | L2 cache; CPU-specific raw events only |
| `llc_loads`, `llc_load_misses` | Last-level cache, which is usually L3 rather than L2 |
| `os_cycle_time` | Windows OS-accounted process cycle time; deliberately not called `cycles` |

### 8.3 Linux

- **Mechanism**: `perf_event_open(2)`. Generic hardware events cover cycles and instructions. `PERF_TYPE_HW_CACHE` defines cache ids L1D, L1I, LL, DTLB, ITLB, BPU and NODE; **there is no generic L2 id**, so L2 needs CPU-specific raw events (planned `--raw-event`, section 10). LL means last-level cache.
- **Permissions**: `kernel.perf_event_paranoid` controls unprivileged use. The upstream default is 2, which allows user-space measurement of your own processes. Distribution kernels may ship stricter values that block unprivileged use entirely (Debian uses 3; Ubuntu 22.04 and later ship 4). `CAP_PERFMON` (Linux 5.8+) or root bypasses the check.
- **Errors to availability**: `EACCES`/`EPERM` map to `permission_denied`; `ENOENT`/`ENODEV`/`EOPNOTSUPP` map to `unsupported`; anything else maps to `error` with the errno text.
- **Multiplexing**: with more events than hardware counters the kernel time-slices them. Read with `PERF_FORMAT_TOTAL_TIME_ENABLED | PERF_FORMAT_TOTAL_TIME_RUNNING`, scale by `enabled / running`, and flag the value `scaled`; `running == 0` means not counted (`null`). Group `cycles` with `instructions` so IPC uses co-scheduled counts.
- **Hybrid CPUs** expose one PMU per core type (for example `cpu_core` and `cpu_atom`), so a generic event may have to be opened per PMU.
- **Virtual machines and containers** often expose no hardware PMU, and container seccomp profiles can block the syscall. Observed in this repository's validation VM: hardware events (cycles, instructions, L1D) failed with `ENOENT` and no `cpu` PMU was listed under `/sys/bus/event_source/devices`, while software events worked. WSL2: Not tested.
- **Launch**: fork, child waits on a pipe, parent opens counters with `pid = child`, `inherit = 1` and `enable_on_exec = 1`, then the child execs. This is the pattern `perf stat` uses.

### 8.4 Windows

- Windows has no user-mode equivalent of `perf_event_open`. PMU events are reached through ETW: `wpr -pmcsources` (or `xperf -pmcsources`) lists the profile sources the HAL exposes, which is only a small CPU-specific subset by default. Since Windows 10 version 1903, non-architectural events can be added through WPR custom profiles or registry configuration using processor-model-specific event codes.
- Counter values are attached to ETW events (such as context switches) or sampled on counter overflow, so they are not a polling API. Recording needs an elevated session, and PMU sources are effectively single-session: WPR fails if another session already uses them.
- **v1 backend (no elevation)**: `QueryProcessCycleTime` provides `os_cycle_time`, the CPU clock cycles charged to the process's threads in user and kernel mode. Cache metrics report `unsupported` with that reason.
- **Feasibility spike (Milestone 2)**: an elevated ETW session for `instructions`, `cycles` and cache events where `-pmcsources` lists them. Role 1 decides at the end of M2 whether it ships in v1.
- Vendor tools such as Intel PCM and AMD uProf install kernel drivers; they are documented manual cross-checks, not dependencies. Behaviour under Hyper-V, virtualization-based security, or inside VMs: Not tested.

### 8.5 macOS

- macOS has no public API for programmable PMU events. Private frameworks (`kperf`, `kpc`) are not used: unsupported, root-only, and liable to break between releases.
- **v1 backend**: `proc_pid_rusage(pid, RUSAGE_INFO_V4, ...)` from `<libproc.h>` returns cumulative per-process `ri_instructions` and `ri_cycles` (XNU `rusage_info_v4`). Whether these fields are populated on every Mac model and OS version is Not tested, so the probe runs a short busy loop and reports `unsupported` if the counters do not advance.
- **Cache events** are available only through Instruments' CPU Counters instrument (full Xcode). The template must be configured once in Instruments.app and saved before `xcrun xctrace record --template '<name>' --launch -- <cmd>` records any events. v1 documents this as a manual workflow ([WORKING_DEMO.md](WORKING_DEMO.md#3-monitoring-workflow-deferred)), so cache metrics are `unsupported` in `ccsim` on macOS.
- `powermetrics` requires root and reports power, frequency and residency, not cache hits or misses. It is outside the v1 metric set.

### 8.6 Sampling semantics

- Backends return cumulative counts. `IntervalSampler` computes per-interval deltas and attaches the measured elapsed time (intervals jitter).
- Default interval 1000 ms; minimum 10 ms. The sampler takes the current time as an argument, so tests drive it without sleeping.
- When the target exits, the last interval is reported and flagged `partial`. `ccsim monitor` reports the target's exit status and returns 0 if monitoring itself succeeded, 1 otherwise.

### 8.7 Simulation versus hardware

Real caches use physical addresses, hashed or sliced set indexing, hardware prefetchers, pseudo-LRU, and inclusion policies, and they are shared with the OS and other processes. Use monitoring for trends, such as the L1D miss ratio rising once the working set exceeds L1 capacity, not for numeric agreement with the simulator.

## 9. Module interfaces

> The headers under `include/ccsim/` are now authoritative. Where a sketch below differs from a header, the header wins. Notable growth: `Hierarchy` also takes a `PolicyFactory` and exposes `step(access, AccessEvent*)`, and `TraceReader` is joined by a chunk-fed `TraceParser`. See ARCHITECTURE.md sections 6 to 8.

Sketches of the v1 contracts. Owners finalize them in Milestone 1 (issues M1-05 to M1-08). Configuration and input errors throw exceptions derived from `std::runtime_error`, which the CLI maps to exit code 1. Monitoring availability is data, not an exception.

```cpp
// include/ccsim/sim/types.hpp (owner: Role 2)
namespace ccsim {

enum class AccessType : std::uint8_t { Read, Write };

struct MemoryAccess {
    AccessType type = AccessType::Read;
    std::uint64_t address = 0;
};

enum class PolicyKind : std::uint8_t { Lru, Fifo, Random };

struct CacheConfig {
    std::string name;  // "L1", "L2"
    std::uint64_t size_bytes = 0;
    std::uint32_t line_bytes = 0;
    std::uint32_t ways = 0;
    std::uint32_t hit_latency_cycles = 0;
    PolicyKind policy = PolicyKind::Lru;
};

struct HierarchyConfig {
    CacheConfig l1;
    std::optional<CacheConfig> l2;  // nullopt: L1 talks to memory directly
    std::uint32_t memory_latency_cycles = 0;
    std::uint64_t seed = 1;  // used by the Random policy only
};

struct LevelStats {
    std::uint64_t accesses = 0, reads = 0, writes = 0;
    std::uint64_t hits = 0, misses = 0, read_misses = 0, write_misses = 0;
    std::uint64_t evictions = 0, writebacks = 0;
    std::uint64_t writebacks_received = 0, writeback_hits = 0, writeback_misses = 0;  // L2 only
};

struct MemoryStats {
    std::uint64_t reads = 0, writes = 0;
};

struct ConfigError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

void validate(const HierarchyConfig& config);  // throws ConfigError naming the offending field

}  // namespace ccsim
```

```cpp
// include/ccsim/policy/replacement_policy.hpp (owner: Role 3)
namespace ccsim {

class ReplacementPolicy {
public:
    virtual ~ReplacementPolicy() = default;
    virtual void on_hit(std::uint32_t set, std::uint32_t way) = 0;
    virtual void on_fill(std::uint32_t set, std::uint32_t way) = 0;
    // Called only when every way in `set` holds a valid line.
    virtual std::uint32_t select_victim(std::uint32_t set) = 0;
};

std::unique_ptr<ReplacementPolicy> make_policy(PolicyKind kind, std::uint32_t sets,
                                               std::uint32_t ways, std::uint64_t seed);

}  // namespace ccsim
```

```cpp
// include/ccsim/sim/hierarchy.hpp (owner: Role 2)
namespace ccsim {

struct SimulationResult {
    LevelStats l1;
    std::optional<LevelStats> l2;
    MemoryStats memory;
    std::uint64_t total_latency_cycles = 0;
    // total_latency_cycles / l1.accesses; nullopt when there were no accesses.
    std::optional<double> amat_cycles() const;
};

class Hierarchy {
public:
    explicit Hierarchy(const HierarchyConfig& config);  // validates; throws ConfigError
    void access(const MemoryAccess& access);
    const SimulationResult& result() const noexcept;
};

}  // namespace ccsim
```

```cpp
// include/ccsim/io/trace_reader.hpp (owner: Role 6)
namespace ccsim {

struct TraceError : std::runtime_error {  // what() is "<source>:<line>: <message>"
    using std::runtime_error::runtime_error;
};

class TraceReader {
public:
    TraceReader(std::istream& in, std::string source_name);
    // Next access, or nullopt at end of input. Throws TraceError on a malformed line.
    std::optional<MemoryAccess> next();
};

}  // namespace ccsim
```

```cpp
// include/ccsim/monitor/backend.hpp (owner: Role 4)
namespace ccsim::monitor {

enum class Metric : std::uint8_t {
    Cycles, Instructions, L1dLoads, L1dLoadMisses,
    L2Accesses, L2Misses, LlcLoads, LlcLoadMisses, OsCycleTime
};

enum class Availability : std::uint8_t {
    Available, Unsupported, PermissionDenied, NotImplemented, Error
};

struct MetricStatus {
    Metric metric;
    Availability availability;
    std::string reason;  // empty only when Available
};

struct CounterReading {
    Metric metric;
    std::optional<std::uint64_t> value;  // cumulative since launch; nullopt = not counted
    bool scaled = false;                 // extrapolated after counter multiplexing
};

class MonitorBackend {
public:
    virtual ~MonitorBackend() = default;
    virtual std::string_view name() const = 0;      // "perf_event_open", "mock", ...
    virtual std::vector<MetricStatus> probe() = 0;  // needs no target process
    // Starts argv[0] with counters attached before it runs (e.g. enable_on_exec).
    virtual void launch(const std::vector<std::string>& argv,
                        const std::vector<Metric>& metrics) = 0;
    virtual std::vector<CounterReading> read() = 0;
    virtual std::optional<int> exit_status() = 0;  // nullopt while the target runs
};

std::unique_ptr<MonitorBackend> make_platform_backend();  // selected at build time
std::unique_ptr<MonitorBackend> make_mock_backend(
    std::vector<MetricStatus> capabilities,
    std::vector<std::vector<CounterReading>> scripted_reads);

}  // namespace ccsim::monitor
```

```cpp
// include/ccsim/monitor/sampler.hpp (owner: Role 4)
namespace ccsim::monitor {

struct IntervalSample {
    std::chrono::nanoseconds elapsed{};  // measured, not nominal
    std::vector<CounterReading> deltas;  // a nullopt value stays nullopt
    bool partial = false;                // final interval cut short by target exit
};

class IntervalSampler {
public:
    explicit IntervalSampler(MonitorBackend& backend);
    // The caller supplies the time, so tests drive sampling without sleeping.
    IntervalSample sample(std::chrono::steady_clock::time_point now, bool partial = false);
};

}  // namespace ccsim::monitor
```

## 10. CLI contract

```text
ccsim --help | --version
ccsim simulate --trace <file> [--l1 <spec>] [--l2 <spec> | --no-l2]
               [--memory-latency <cycles>] [--seed <n>]
               [--format text|json|csv] [--output <file>]
ccsim monitor  --probe [--format text|json]
ccsim monitor  [--interval-ms <n>] [--metrics <name,...>] [--raw-event <metric>=r<hex>]...
               [--format text|json|csv] [--output <file>] -- <command> [args...]
```

- `<spec>` is a comma-separated `key=value` list with keys `size`, `line`, `ways`, `policy`, `latency`, for example `size=32KiB,line=64,ways=8,policy=lru,latency=4`. Omitted keys take the defaults in section 3.
- `--raw-event` is Linux-only and uses the same encoding as `perf stat -e r<hex>`.

| Exit code | Meaning | Status |
|---|---|---|
| 0 | Success | Implemented |
| 1 | Runtime error: I/O, invalid trace or config, monitoring failure | Reserved (emitted only on fatal exceptions today) |
| 2 | Usage error: missing or unknown command or option | Implemented |
| 3 | Command recognised but its feature is still Planned | Implemented (temporary) |

## 11. Output schema v1

Role 6 publishes the full schema and sample files in M1-08. Fixed rules:

- Top-level `"schema"` is `"ccsim.simulation/1"` or `"ccsim.monitor/1"`; a breaking change bumps the number. Consumers ignore unknown fields.
- Counters are JSON integers. Rates and AMAT are numbers or `null`. Text output prints AMAT and rates with 4 decimals.
- CSV: one row per cache level (simulation) or per interval (monitoring), header row first, `n/a` for unavailable values.

```json
{
  "schema": "ccsim.simulation/1",
  "ccsim_version": "0.1.0",
  "levels": [
    { "name": "L1", "accesses": 10, "hits": 3, "misses": 7, "evictions": 4, "writebacks": 1, "miss_rate": 0.7 }
  ],
  "memory": { "reads": 6, "writes": 1 },
  "amat_cycles": 68.0
}
```

```json
{
  "schema": "ccsim.monitor/1",
  "platform": { "os": "linux", "backend": "perf_event_open" },
  "metrics": [
    { "metric": "l2_misses", "availability": "unsupported", "reason": "no generic L2 event; pass --raw-event" }
  ],
  "samples": [
    { "elapsed_ms": 1000.4, "values": { "cycles": 2104339871, "l2_misses": null }, "scaled": [], "partial": false }
  ],
  "target": { "argv": ["./workload"], "exit_status": 0 }
}
```

Both examples are abbreviated. The simulation values are Demo B's expected results; the monitoring values are illustrative.

## 12. Visualization architecture

**Engine side and UI Implemented.** The interactive debugger (the live simulation) is now in v1 scope and is the centrepiece of the website. The engine runs in a Web Worker as WebAssembly and streams events to the UI. The decision and its numbers are in [ARCHITECTURE.md section 4](ARCHITECTURE.md#4-the-api-decision-webassembly-in-a-web-worker-not-fastapi), and the playback model is in [section 7](ARCHITECTURE.md#7-stage-3-the-live-simulation). The rule in 12.1 is unchanged and enforced.

### 12.1 One simulator, not two

The frontend never decides a hit, picks a victim, or decomposes an address. The simulation engine (Role 2) is the single source of truth: as it replays the trace it emits an ordered stream of **structured events** that fully describe each access, and the debugger only renders them. This keeps design rule 3 of section 2 — every capability is a library call first — and guarantees that the picture on screen is exactly the engine's behaviour, not a lookalike reimplemented in JavaScript that can drift from it. The acceptance criterion in [WORKING_DEMO.md section 4](WORKING_DEMO.md#4-interactive-cache-debugger-demo) is literally this equality.

### 12.2 Visualization surfaces

All four are driven from the event stream (12.3); none holds cache logic of its own:

- **Set/way grid** — one row per set, one cell per way, for L1 and (when configured) L2. Each cell shows its line's state (invalid, valid-clean, valid-dirty) plus transient highlights for the line just filled, the line just hit, and the line just evicted. The cell's tag and the access that installed it are shown on hover.
- **Address inspector** — splits the current access address into tag, set index, and block offset using the bit widths from [section 4](#4-address-mapping), and highlights the set the index selects in the grid. Because the widths come from the configuration, the split is correct for any `size`/`line`/`ways`, including non-power-of-two capacities (section 3).
- **Hierarchy path** — the L1 → L2 → RAM path for the current access, lighting only the levels actually consulted: an L1 hit stops at L1; an L1 miss that hits L2 lights L1 then L2; an L2 miss lights the whole path to memory. A dirty write-back is drawn as a separate arrow downward, consistent with the order of operations in [section 5.2](#52-l1l2-hierarchy).
- **Decision panel** — the per-access outcome in words: hit or miss at each level, which way was chosen (invalid-first, else the policy's victim), whether an eviction and write-back occurred, and the policy's reason for the victim (LRU: the least-recently-used way; FIFO: the earliest inserted; Random: the drawn index). This mirrors the "What to notice" narration in [WORKING_DEMO.md Demo B](WORKING_DEMO.md#demo-b-two-level-walkthrough).

### 12.3 Engine event stream

> **Implemented** (`include/ccsim/sim/events.hpp`). The shipped shape differs from the sketch below in one deliberate way: an event carries an **ordered action log** (`lookup`, `evict`, `writeback`, `fill`, `back_invalidate`, `move_out`, `memory_read`, …) instead of nested per-level objects, because one access can evict two L2 lines (write-back plus demand fill) and the UI must animate them in order. In the browser, events travel as a binary `Uint32Array` (ABI layout in `include/ccsim/wasm/ccsim_api.h`); `event_to_json()` produces the NDJSON form for files. See ARCHITECTURE.md section 7.2.

Emission is opt-in (planned `ccsim simulate --emit-events <file>`), so the default batch path and its throughput are unchanged. The stream is newline-delimited JSON — one event per line, in access order, echoing the one-access-per-line trace format (section 7) — and is as deterministic as the run that produced it: the same trace, configuration, and seed give byte-identical events on every OS. The schema id is `ccsim.events/1`, versioned like the results schema (section 11), and consumers ignore unknown fields.

Each access produces one `access` event carrying the full decision for every level it touched; the structural consequences (fill, eviction, write-back) are fields on that event rather than separate records, so a renderer can advance the whole picture from a single line. Sketch (abbreviated; the `levels` array is wrapped here for readability but is one line in the file). The values are step 4 of [Demo B](WORKING_DEMO.md#demo-b-two-level-walkthrough), with `seq` 0-based:

```json
{"schema":"ccsim.events/1","seq":3,"op":"R","address":"0x080",
 "decompose":{"L1":{"tag":4,"set":0,"offset":0},"L2":{"tag":2,"set":0,"offset":0}},
 "levels":[
   {"name":"L1","result":"miss","way":0,
    "victim":{"way":0,"tag":0,"dirty":true,"reason":"lru"},"writeback":{"to":"L2"}},
   {"name":"L2","result":"miss","way":1,
    "victim":{"way":1,"tag":1,"dirty":false,"reason":"lru"},"fill":{"from":"memory"}}],
 "latency_cycles":111}
```

`decompose` feeds the address inspector; `way` and `victim.way` index the exact grid cells to repaint; `result` and `reason` let the decision panel narrate without any policy logic of its own. An L1 hit carries a single `levels` entry with `result":"hit"` and no `victim` or `fill`. Role 2 owns this schema; because it is a cross-module contract it is added through the protocol in [CONTRIBUTING.md section 2](../CONTRIBUTING.md#2-shared-interfaces-and-ownership-boundaries), and whether it ships in v1 is an open decision (section 14).

### 12.4 Playback controls

The debugger holds the event list and a cursor; it does not re-run the engine to move within a loaded stream. **Step** advances the cursor by one event and applies that event's grid updates. **Play** auto-advances at a fixed interval; **Pause** stops. **Replay** resets the cursor and every cell to the initial empty state and plays from `seq` 0. Stepping *backward* is implemented as replay-from-start up to the target `seq`, because cache state is not reversible in general — an eviction discards what the line held. Loading a different trace or changing the configuration or policy re-runs the engine to produce a fresh stream, which is how the debugger compares replacement policies side by side.

## 13. Portability rules

- ISO C++17 without compiler extensions (`CMAKE_CXX_EXTENSIONS OFF`). Code builds warning-free with `/W4 /permissive-` (MSVC) and `-Wall -Wextra -Wpedantic -Wshadow -Wconversion` (GCC, Clang).
- Use `std::uint64_t` for addresses and counters, never `long` (32-bit on Windows).
- No `std::uniform_*_distribution` or other implementation-defined algorithms in anything that affects results (5.4).
- Text input accepts LF and CRLF; output uses `\n`.
- Paths use `std::filesystem::path`. On Windows, `char` arguments use the ANSI code page, so Role 6 chooses a UTF-8 strategy (application manifest or `wmain`) before non-ASCII paths are supported.
- Golden results compare integers exactly and floating-point values with a relative tolerance of 1e-9.
- Checks that must run in Release builds never use `assert()`, which `NDEBUG` removes.

## 14. Open decisions

| Decision | Owner | Due |
|---|---|---|
| Ship the elevated Windows ETW backend in v1 or defer it | Role 1 with Role 4 | End of M2 |
| UTF-8 path strategy on Windows | Role 6 | M1 |
| Different L1 and L2 line sizes | Role 2 | Post-v1 |
| ~~Localhost server for the viewer (`ccsim serve`)~~ | Decided 2026-10-29 | Superseded: the engine runs in the browser as WebAssembly (ARCHITECTURE.md section 4) |
| ~~Event stream schema and the interactive debugger in v1~~ | Decided 2026-10-29 | In v1; engine side Implemented (ARCHITECTURE.md section 7) |
| Belady OPT interface, checkpoints, very large traces | Simulation + configuration tracks | See ARCHITECTURE.md section 17 |
| Lackey and Dinero trace importers | Role 6 | Post-v1 |
| Project license | Role 1 | Before the repository is made public |

## 15. References

- `perf_event_open(2)`: <https://man7.org/linux/man-pages/man2/perf_event_open.2.html>
- Perf events and tool security (`perf_event_paranoid`, `CAP_PERFMON`): <https://www.kernel.org/doc/html/latest/admin-guide/perf-security.html>
- Recording hardware performance (PMU) events with WPR and Xperf: <https://learn.microsoft.com/en-us/windows-hardware/test/wpt/recording-pmu-events>
- `QueryProcessCycleTime`: <https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryprocesscycletime>
- XNU `rusage_info_v4` (`ri_instructions`, `ri_cycles`): <https://opensource.apple.com/source/xnu/xnu-7195.141.2/bsd/sys/resource.h.auto.html>
- Preconfiguring the CPU Counters template for `xctrace` (Apple Developer Forums): <https://developer.apple.com/forums/thread/705565>
