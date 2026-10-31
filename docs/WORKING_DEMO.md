# Working Demo

Section 1 works today. Section 2's results are reproduced exactly by the engine library: they are the golden tests `ctest -L golden` (`tests/golden/test_golden_demos.cpp`, traces in `tests/data/golden/`). The `ccsim simulate` *command* that prints them is still **Planned** and exits with code 3. Section 3 (monitoring) is **Deferred**. On the website these demos run in the browser (ARCHITECTURE.md section 7).

The expected results in section 2 were computed with an independent reference model of the semantics in [TECHNICAL_DESIGN.md sections 5 and 6](TECHNICAL_DESIGN.md#5-access-semantics) and checked by hand. They are the acceptance oracle for the implementation. The engine was tested against them; they were not copied from it.

## 1. What works today

Implemented and Verified on Linux (paths: `./build/ccsim` on Linux and macOS, `.\build\Release\ccsim.exe` on Windows):

```console
$ ./build/ccsim --version
ccsim 0.1.0
$ ./build/ccsim simulate; echo "exit code: $?"
ccsim simulate: not implemented yet (status: Planned). See docs/TECHNICAL_DESIGN.md.
exit code: 3
$ ./build/ccsim; echo "exit code: $?"
Usage: ccsim <command> [options]
...
exit code: 2
```

## 2. Simulation walkthrough (engine: Verified by golden tests; CLI command: Planned)

All demos use 16-byte lines and small latencies (L1 hit 1 cycle, L2 hit 10 cycles, memory 100 cycles) so every number can be checked by hand. The traces use format v1 ([TECHNICAL_DESIGN.md section 7](TECHNICAL_DESIGN.md#7-trace-format-v1)) and are committed under `tests/data/golden/`. The `ccsim simulate` command lines below show the planned CLI syntax.

### Demo A: conflict misses and associativity

`tests/data/demo_a_conflict.trace`:

```text
# Lines 0 and 4 map to the same set of a 64-byte direct-mapped cache
R 0x000
R 0x040
R 0x000
R 0x040
R 0x000
R 0x040
```

```bash
ccsim simulate --trace tests/data/demo_a_conflict.trace --no-l2 --memory-latency 100 \
  --l1 size=64,line=16,ways=1,policy=lru,latency=1
```

| L1 organisation | Sets | Hits | Misses | Evictions | Memory reads | AMAT (cycles) |
|---|---|---|---|---|---|---|
| Direct-mapped (`ways=1`) | 4 | 0 | 6 | 5 | 6 | 101.0 |
| 2-way (`ways=2`) | 2 | 4 | 2 | 0 | 2 | 34.3333 (206/6) |
| Fully associative (`ways=4`) | 1 | 4 | 2 | 0 | 2 | 34.3333 (206/6) |

With 4 sets, lines 0 and 4 both map to set 0 and evict each other on every access after the first (5 evictions). Two ways hold both lines, leaving only the 2 compulsory misses.

### Demo B: two-level walkthrough

L1: 64 bytes, 2-way, LRU (2 sets). L2: 128 bytes, 2-way, LRU (4 sets). Both write-back and write-allocate.

`tests/data/demo_b_two_level.trace`:

```text
# Two-level walkthrough: write-back, non-inclusive L2, dirty evictions
R 0x000
W 0x008
R 0x040
R 0x080
R 0x000
W 0x0C0
R 0x100
R 0x010
R 0x018
R 0x0C4
```

```bash
ccsim simulate --trace tests/data/demo_b_two_level.trace --memory-latency 100 \
  --l1 size=64,line=16,ways=2,policy=lru,latency=1 \
  --l2 size=128,line=16,ways=2,policy=lru,latency=10
```

Per access ("line" is `address >> 4`):

| # | Access | Line (L1 set, L2 set) | L1 | L1 victim | Write-back into L2 | L2 demand fetch | Mem R/W | Latency |
|---|---|---|---|---|---|---|---|---|
| 1 | `R 0x000` | 0 (0, 0) | miss | - | - | miss | 1/0 | 111 |
| 2 | `W 0x008` | 0 (0, 0) | hit | - | - | - | 0/0 | 1 |
| 3 | `R 0x040` | 4 (0, 0) | miss | - | - | miss | 1/0 | 111 |
| 4 | `R 0x080` | 8 (0, 0) | miss | line 0 (dirty) | L2 hit (now dirty) | miss, evict line 4 | 1/0 | 111 |
| 5 | `R 0x000` | 0 (0, 0) | miss | line 4 | - | hit | 0/0 | 11 |
| 6 | `W 0x0C0` | 12 (0, 0) | miss | line 8 | - | miss, evict line 8 | 1/0 | 111 |
| 7 | `R 0x100` | 16 (0, 0) | miss | line 0 | - | miss, evict line 0 (dirty) | 1/1 | 111 |
| 8 | `R 0x010` | 1 (1, 1) | miss | - | - | miss | 1/0 | 111 |
| 9 | `R 0x018` | 1 (1, 1) | hit | - | - | - | 0/0 | 1 |
| 10 | `R 0x0C4` | 12 (0, 0) | hit | - | - | - | 0/0 | 1 |

Final results:

| Level | Accesses | Hits | Misses | Evictions | Write-backs sent | Rates |
|---|---|---|---|---|---|---|
| L1 | 10 (8 R, 2 W) | 3 | 7 (6 R, 1 W) | 4 | 1 | miss rate 0.7 |
| L2 | 7 demand fetches | 1 | 6 | 3 | 1 | local miss rate 6/7 = 0.8571; global 0.6 |
| Memory | | | | | | 6 reads, 1 write |

L2 also received 1 write-back from L1 (a hit, so `writeback_misses` is 0). AMAT = 680 total cycles / 10 accesses = **68.0** cycles, matching `1 + 0.7 * (10 + 6/7 * 100)`.

What to notice:

- **Step 4**: the dirty L1 victim (line 0) is written into L2 *before* the demand fetch, and that write-back refreshes line 0's LRU position, so L2 evicts line 4 instead.
- **Steps 4 and 5**: line 4 leaves L2 at step 4 but stays in L1 until step 5. The hierarchy is non-inclusive.
- **Step 5**: an L1 miss that hits in L2 costs 1 + 10 = 11 cycles.
- **Step 6**: a write miss allocates the line in L1 and marks it dirty there.
- **Step 7**: L2 evicts the dirty line 0, causing the only memory write. L1's own copy of line 0 had been re-fetched clean at step 5.

### Demo C: replacement policies and Belady's anomaly

`tests/data/demo_c_belady.trace` is the reference string 1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5 expressed as 16-byte lines:

```text
# Belady reference string 1,2,3,4,1,2,5,1,2,3,4,5 (16-byte lines)
R 0x10
R 0x20
R 0x30
R 0x40
R 0x10
R 0x20
R 0x50
R 0x10
R 0x20
R 0x30
R 0x40
R 0x50
```

```bash
ccsim simulate --trace tests/data/demo_c_belady.trace --no-l2 --memory-latency 100 \
  --l1 size=48,line=16,ways=3,policy=fifo,latency=1
```

Fully associative L1 only (`ways` = number of lines, `size = 16 * ways`):

| Policy | 3 lines (`size=48,ways=3`) | 4 lines (`size=64,ways=4`) |
|---|---|---|
| FIFO | 3 hits, 9 misses, 6 evictions | 2 hits, 10 misses, 6 evictions |
| LRU | 2 hits, 10 misses, 7 evictions | 4 hits, 8 misses, 4 evictions |

FIFO gets *worse* with more capacity (Belady's anomaly); LRU, a stack algorithm, cannot. The 48-byte case also shows that a non-power-of-two capacity is valid when the set count (1) is a power of two.

### Random policy

Exact Random counts depend on the seed and the generator specified in [TECHNICAL_DESIGN.md section 5.4](TECHNICAL_DESIGN.md#54-replacement-policies), so they are pinned only once the implementation exists:

- The same trace, configuration, and seed give identical results across repeated runs and on all three operating systems (checked by M3-03).
- Every run satisfies the invariants in [TECHNICAL_DESIGN.md section 6](TECHNICAL_DESIGN.md#6-statistics-and-amat).
- Demo A with `ways=2,policy=random` gives 4 hits and 2 misses for **any** seed: invalid ways fill first, so no victim is ever chosen.

## 3. Monitoring workflow (Deferred)

1. **Probe** what this machine exposes: `ccsim monitor --probe`. Every metric is listed with a status and reason. Illustrative output (format not final) mirroring what the validation VM's probe returned:

   ```text
   backend: perf_event_open (linux)
   cycles            unsupported   hardware event not available (ENOENT): no PMU exposed, e.g. a VM
   instructions      unsupported   hardware event not available (ENOENT): no PMU exposed, e.g. a VM
   l1d_load_misses   unsupported   hardware event not available (ENOENT): no PMU exposed, e.g. a VM
   l2_misses         unsupported   no generic L2 event; pass --raw-event
   ```

2. **Run** a command with interval sampling:

   ```bash
   ccsim monitor --interval-ms 500 --format csv --output results/run.csv -- ./your-workload --args
   ```

3. **Read the output**: one row per interval with measured elapsed time and per-interval deltas. Unavailable values are `n/a` with the reason in the header block, values extrapolated after multiplexing are flagged `scaled`, and the final interval is flagged `partial` if the command exited mid-interval.

Expected v1 coverage per OS (all Not tested):

| OS | Metrics expected in v1 | Requirements |
|---|---|---|
| Linux, bare metal | `cycles`, `instructions`, `ipc`; L1D and LLC events if the CPU exposes the generic events; L2 only via `--raw-event` | `perf_event_paranoid` of 2 or lower, or `CAP_PERFMON` |
| Linux VM or container | Often no hardware events at all | PMU passthrough; seccomp must allow `perf_event_open` |
| Windows | `os_cycle_time`; other metrics `unsupported` unless the ETW spike ships | None (ETW path needs Administrator) |
| macOS | `cycles`, `instructions` from `proc_pid_rusage` if the probe sees them advance; cache metrics `unsupported` | None for a child process |

**Sanity experiment (Linux bare metal, once implemented).** Run a working-set sweep (Role 8 benchmark, issue M2-14) under `ccsim monitor`. As the working set grows past the L1D capacity, `l1d_load_misses / l1d_loads` should rise sharply, and past the LLC capacity `llc_load_misses` should rise. The pass criterion is the direction and approximate position of each knee, not exact numbers ([TECHNICAL_DESIGN.md section 8.7](TECHNICAL_DESIGN.md#87-simulation-versus-hardware)).

**Manual cross-checks** for platforms where `ccsim` v1 does not automate cache counters:

- **macOS**: in Instruments.app choose CPU Counters, select events (for example L1D load misses), save via File > Save as Template, then run `xcrun xctrace record --template '<template name>' --launch -- ./your-workload` and open the trace in Instruments or export it with `xcrun xctrace export`.
- **Windows** (elevated): list sources with `wpr -pmcsources`, record with a WPR profile containing a `<HardwareCounter>` element, and inspect the trace in Windows Performance Analyzer.

## 4. Interactive cache debugger demo

**Status:** engine and UI Implemented (the website's Visualize page). AC-11 is checked by `web/test/visualizer.test.ts` against engine-generated fixtures; an end-to-end browser test is Planned.

The debugger is the live-simulation view of the website ([ARCHITECTURE.md section 7](ARCHITECTURE.md#7-stage-3-the-live-simulation)). It runs in the browser against the WebAssembly engine and renders the engine's event stream; it never simulates the cache itself. Step 4 below is already asserted action by action in `golden.demo_b_two_level_every_step`. The walkthrough below uses [Demo B](#demo-b-two-level-walkthrough) because every step there is already derived by hand.

The user's workflow:

1. **Load a trace and configure the hierarchy.** Open `demo_b_two_level.trace` and set L1 to 64 bytes, 2-way, 16-byte lines, LRU and L2 to 128 bytes, 2-way, LRU — the same configuration as Demo B. The engine replays the trace and emits the event stream; the debugger loads it and shows the empty set/way grids for L1 (2 sets) and L2 (4 sets).
2. **Execute one access at a time.** *Step* advances to the next event. At step 4 (`R 0x080`) the address inspector splits the address into L1 `tag 4, set 0, offset 0` and L2 `tag 2, set 0, offset 0`, and highlights set 0 in each grid.
3. **Inspect the decomposition and cache state.** The grid shows set 0 of L1 holding lines 0 and 4 before the access; the decision panel reads the fields of that one event, not a second simulation.
4. **Observe hits, misses, and evictions.** Step 4 shows an L1 miss, the dirty line 0 written back into L2 (a separate downward arrow), line 0 evicted from L1, and — because the write-back refreshed line 0's LRU position in L2 — line 4 chosen as the L2 victim instead. The hierarchy path lights L1 → L2 → RAM. These are exactly the points called out under Demo B.
5. **Play, replay, and compare policies.** *Play* auto-advances to the end; *Replay* clears the grids and runs from the start. Switching the L1 policy to FIFO or Random re-runs the engine and loads a new stream, so the two runs can be stepped side by side — the same comparison Demo C makes numerically for [replacement policies](#demo-c-replacement-policies-and-beladys-anomaly).

**Acceptance.** The debugger is correct only when its visible state equals the simulation engine's results for the same trace and configuration: at every step the grid contents, the inspector's tag/set/offset, and the hit/miss/eviction/write-back shown must match the engine event that produced them, and the final grid and counters must match the aggregate result (the numbers in section 2). Any disagreement is a bug in the frontend, never a second opinion about the cache. This is recorded as **AC-11** in section 6.

## 5. Limitations

Simulation (v1 model):

- Single core: no coherence, no sharing between processes.
- No prefetching, TLB, or virtual-to-physical translation; trace addresses are used as given.
- Additive latency model; write-backs cost nothing; no memory-level parallelism.
- One line per access; access size and line-straddling accesses are not modelled.
- Write-back + write-allocate by default; write-through, no-write-allocate, and inclusive or exclusive L2 are available (contract 1.1, ARCHITECTURE.md section 5.3). Partial stores never allocate below L1, and buffered stores cost no latency.
- Equal L1 and L2 line sizes; no end-of-trace flush.

Monitoring:

- Availability depends on OS, CPU model, privileges, and virtualization. Hosted CI runners and many VMs expose no PMU, so CI covers monitoring logic with the mock backend only.
- Multiplexed values are extrapolations; hybrid CPUs split events across PMUs.
- Windows and macOS cache counters are not automated in v1 (manual cross-checks above).
- Hardware numbers are not comparable one-to-one with simulator numbers.

## 6. Acceptance criteria

The v1 demo is accepted when every criterion has recorded evidence (CI run or linked log):

1. **AC-1** Clean checkout builds and passes all default tests on Linux, Windows, and macOS using the commands in DEVELOPMENT.md.
2. **AC-2** Demos A, B, and C reproduce every integer in section 2 exactly on all three OSes; AMAT matches 101.0, 34.3333 (206/6), and 68.0 within a relative 1e-9.
3. **AC-3** The invariants in TECHNICAL_DESIGN.md section 6 hold for all golden traces and for generated traces of at least 1,000,000 accesses.
4. **AC-4** Random policy results are identical across runs and OSes for a fixed seed, and Demo A 2-way Random gives 4 hits and 2 misses for any seed.
5. **AC-5** A malformed trace yields `<file>:<line>: <message>`, exit code 1, and no output file.
6. **AC-6** `ccsim monitor --probe` lists every catalogue metric with a status and a reason for every non-available status; mock tests cover all five availability values.
7. **AC-7** No unavailable metric is ever emitted as 0; multiplexed values are flagged `scaled`; a cut-short final interval is flagged `partial`; per-interval deltas sum to the final cumulative values (mock tests).
8. **AC-8** On each OS where hardware access exists, a probe and a monitored run are recorded and the README matrix is updated from that evidence; elsewhere the reasons shown match TECHNICAL_DESIGN.md section 8.
9. **AC-9** JSON output carries `"schema"` version 1 and the website renders it. A full run makes no network request after the site has loaded (all compute is in the engine worker).
10. **AC-10** Documentation status labels match reality: nothing is marked Implemented or Verified without merged tests or recorded evidence.
11. **AC-11** The interactive cache debugger (section 4) renders only the engine's event stream: for the golden traces, its per-step grid state, address decomposition, and hit/miss/eviction/write-back display match the corresponding engine events, and its final grid and counters match the section 2 results. It performs no cache simulation of its own.
