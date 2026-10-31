# Development Guide

Each command block is labelled **Verified** (executed, output matched) or **Not tested**. So far only the Linux paths have been executed; the README [platform matrix](../README.md#platform-validation-matrix) is the summary. Architecture and ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Agent and contributor rules: [AGENTS.md](../AGENTS.md).

Latest Linux verification (2026-10-29): Kali rolling, GCC 16.2 and Clang, CMake 4.4 + Ninja from pip; Release, Debug + ASan + UBSan, and Clang Release, all with `-DCCSIM_WARNINGS_AS_ERRORS=ON`.

## 1. Toolchains

| OS | Compiler | Build tools | Tested with | Expected minimum (not tested) |
|---|---|---|---|---|
| Linux | GCC or Clang | CMake 3.20+, Make or Ninja | GCC 13.3, Clang 18.1, CMake 3.20.5 and 3.28.3 | GCC 9, Clang 9 |
| Windows | MSVC (Visual Studio 2022) | CMake 3.20+, PowerShell | none | Visual Studio 2022 |
| macOS | Apple Clang (Xcode Command Line Tools) | CMake 3.20+ | none | macOS 10.15 SDK (for `std::filesystem`) |

CMake 3.20 is a hard minimum (`cmake_minimum_required`); it is also the first version whose `ctest` supports `--test-dir`.

## 2. Prerequisites

### Linux

```bash
# Debian / Ubuntu (zlib1g-dev lets the dataset suite read the gzip standard dataset)
sudo apt update && sudo apt install -y build-essential cmake git zlib1g-dev
# Fedora
sudo dnf install -y gcc-c++ cmake make git
# Arch
sudo pacman -S --needed base-devel cmake git
# Optional: Clang and Ninja (Debian / Ubuntu)
sudo apt install -y clang ninja-build
```

Check `cmake --version`. If your distribution ships CMake older than 3.20 (or none at all), install a current one with `python3 -m pip install --user cmake ninja`. Make sure `~/.local/bin` comes first on `PATH`; on distributions that block user installs, use a virtual environment: `python3 -m venv ~/.venvs/cmake && ~/.venvs/cmake/bin/pip install cmake ninja`. That last route is Verified.

### Windows

Run in PowerShell. Not tested.

```powershell
# C++ build tools (or install Visual Studio 2022 Community with "Desktop development with C++")
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
# CMake and Git
winget install --id Kitware.CMake -e
winget install --id Git.Git -e
```

Open a new PowerShell window so `PATH` changes apply, then check `cmake --version`. Visual Studio also ships CMake inside "Developer PowerShell for VS 2022".

### macOS

Not tested.

```bash
xcode-select --install   # Apple Clang, SDK, make
brew install cmake       # or install CMake.app from cmake.org and add its CLI to PATH
```

Full Xcode is needed only for the Instruments workflow in section 7.

## 3. Get the source

```bash
git clone <repository-url> cpu-cache-simulator
cd cpu-cache-simulator
git switch dev 2>/dev/null || git switch main   # dev is the integration branch once created (CONTRIBUTING.md section 6)
```

## 4. Build and test

Always build out of source; `build*/` directories are git-ignored.

### Linux (GCC): Verified

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
./build/ccsim --version
```

Expected test result (Ninja shown; Make prints the same):

```text
1/6 Test #1: smoke.cli_contract ...............   Passed    0.00 sec
2/6 Test #2: smoke.executable_version .........   Passed    0.00 sec
3/6 Test #3: unit.ccsim_unit_tests ............   Passed    0.61 sec
4/6 Test #4: golden.ccsim_golden_tests ........   Passed    0.00 sec
5/6 Test #5: stress.ccsim_stress_tests ........   Passed    2.94 sec
6/6 Test #6: dataset.ccsim_dataset_tests ......   Passed    1.42 sec

100% tests passed out of 6
```

Without zlib headers the dataset suite shows as **skipped**, not passed.

### Linux (Clang): Verified

```bash
cmake -S . -B build-clang -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=clang++
cmake --build build-clang
ctest --test-dir build-clang --output-on-failure
```

### macOS (Apple Clang): Not tested

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
./build/ccsim --version
```

### Windows (MSVC, PowerShell): Not tested

```powershell
cmake -S . -B build
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
.\build\Release\ccsim.exe --version
```

Visual Studio generators are multi-configuration: pick the configuration when building and testing (`--config`, `-C`), not with `CMAKE_BUILD_TYPE`. If several Visual Studio versions are installed, select one with `-G "Visual Studio 17 2022"`. The same multi-configuration flow is Verified on Linux with `-G "Ninja Multi-Config"`, and the sources cross-compile for Windows with MinGW-w64; MSVC itself has not been run.

### Build options

| Option | Default | Effect |
|---|---|---|
| `CMAKE_BUILD_TYPE` | `Release` (single-configuration generators only) | `Debug`, `Release`, `RelWithDebInfo`, `MinSizeRel` |
| `CCSIM_BUILD_TESTS` | `ON` | Build tests and register them with CTest |
| `CCSIM_WARNINGS_AS_ERRORS` | `OFF` | Adds `-Werror` or `/WX`; CI turns it on |
| `CCSIM_BUILD_BENCHMARKS` | `OFF` | Registers the `bench` suite (Release only); writes `tests/results/benchmark_report.md` |

### WebAssembly (browser engine): Not tested

Needs the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (`./emsdk install 4.0.10 && ./emsdk activate 4.0.10 && source ./emsdk_env.sh`). 4.0.10 is the version CI pins.

```bash
emcmake cmake -S . -B build-wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build-wasm --target ccsim_wasm   # -> build-wasm/src/wasm/ccsim.mjs + ccsim.wasm
node tests/wasm/smoke.mjs build-wasm/src/wasm/ccsim.mjs   # 0 pass, 1 fail (77 = session checks skipped)
```

Tests are not built under Emscripten. The same C ABI (`src/wasm/ccsim_api.cpp`) is exercised natively by `unit.ccsim_unit_tests` (`wasm_api.*`). The browser module installs the production policies from `src/policy/` at start-up. A build without them (only possible before PR #4) loads but refuses to create sessions with the message "no replacement policies are linked", and `tests/wasm/smoke.mjs` then exits 77 (session checks skipped). CI (`.github/workflows/ci.yml`) runs this on every push and pull request and nightly at 02:30 UTC, next to the dataset checksum and the GCC, Clang and ASan + UBSan native jobs. Push/PR runs skip only the `stress` label under ASan (15+ minutes there); nightly and manual (`workflow_dispatch`) runs execute everything plus the `bench` report. With production policies merged, a skipped (77) smoke test is a failure.

Add `--parallel <jobs>` to `cmake --build` for faster builds and `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` (Make and Ninja generators) for clangd.

## 5. Running tests

```bash
ctest --test-dir build --output-on-failure      # everything
ctest --test-dir build -L smoke                 # by label
ctest --test-dir build -R cli_contract -V       # by name pattern, verbose
ctest --test-dir build -LE hardware             # skip tests that need real counters (label planned)
```

On Windows and other multi-configuration generators, add `-C Release` (or the configuration you built). Labels: `smoke` (CLI contract), `unit` (module tests), `golden` (WORKING_DEMO Demos A–C), `stress` (invariants over a 72-configuration matrix at 1M accesses), `dataset` (standard dataset integrity, regression baselines, fitness report), and `bench` (opt-in, Release only). Filter inside a suite by test-name substring: `./build/tests/ccsim_unit_tests session.`. The layout is in [ARCHITECTURE.md section 14](ARCHITECTURE.md#14-testing-and-quality).

## 6. Debugging

Debug build (Verified on Linux, including the `gdb` line; macOS not tested):

```bash
cmake -S . -B build-debug -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug
gdb --args ./build-debug/ccsim --help    # Linux
lldb -- ./build-debug/ccsim --help       # macOS (not tested)
```

Windows (not tested): run `cmake --build build --config Debug`, open `build\cpu_cache_simulator.sln` in Visual Studio, set `ccsim` as the startup project, and enter arguments under Properties > Debugging. Alternatively open the source folder directly; Visual Studio reads `CMakeLists.txt`.

Sanitizers (Verified on Linux; macOS not tested):

```bash
cmake -S . -B build-asan -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer"
cmake --build build-asan
ctest --test-dir build-asan --output-on-failure
```

An MSVC AddressSanitizer option is planned (issue M2-15).

## 7. Monitoring prerequisites

> **Deferred** (2026-10-29): the project is focusing on the simulation website. These notes are kept for later.

`ccsim monitor` is not implemented yet. These checks show what a machine exposes so Roles 4 and 7 can plan and record evidence. None has been run on real hardware: the validation VM has no PMU.

### Linux

```bash
# Install perf
sudo apt install -y linux-tools-common linux-tools-$(uname -r)   # Ubuntu
sudo apt install -y linux-perf                                   # Debian
sudo dnf install -y perf                                         # Fedora

cat /proc/sys/kernel/perf_event_paranoid
perf list hw cache
perf stat -e cycles,instructions,L1-dcache-loads,L1-dcache-load-misses,LLC-loads,LLC-load-misses -- ls > /dev/null
```

In `perf stat` output, `<not supported>` means the CPU or kernel does not expose the event (typical in VMs); `<not counted>` means the event never got a hardware counter. If `perf_event_paranoid` is above 2, either lower it until the next reboot on a machine you control (`sudo sysctl -w kernel.perf_event_paranoid=2`) or grant `CAP_PERFMON` (Linux 5.8+). Do not make permanent changes on shared machines.

### Windows

Run in an elevated PowerShell (recording PMU data requires Administrator rights):

```powershell
wpr -pmcsources
```

The output lists the PMU profile sources this CPU and Windows build expose; names are CPU-specific. Results inside VMs or with Hyper-V or virtualization-based security enabled are Not tested.

### macOS

```bash
sudo powermetrics --samplers cpu_power -i 1000 -n 1   # power and frequency only, no cache counters
xcrun xctrace list templates                          # needs full Xcode; look for "CPU Counters"
```

Recording cache events requires a preconfigured template; see [WORKING_DEMO.md section 3](WORKING_DEMO.md#3-monitoring-workflow-deferred).

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `CMake 3.20 or higher is required.  You are running version 3.16.8` | Distribution CMake too old | Install a newer CMake (section 2) |
| `ctest --test-dir build` prints `No tests were found!!!` | `ctest` older than 3.20 silently ignores `--test-dir` (often an old CTest earlier on `PATH`) | Check `ctest --version`, fix `PATH`, or run `cd build && ctest` |
| `Test not available without configuration.  (Missing "-C <config>"?)` | Multi-configuration generator (Visual Studio, Xcode, Ninja Multi-Config) | Add `-C Release`, or whichever configuration you built |
| `Error: generator : Ninja` / `Does not match the generator used previously` | Reusing a build directory with a different generator | Delete that build directory or use a new `-B` path |
| `No CMAKE_CXX_COMPILER could be found` | No C++ compiler installed or visible | Install per section 2; on Windows use Developer PowerShell or install the C++ workload |
| `cmake` is not recognized (PowerShell) | `PATH` not refreshed after install | Open a new terminal or use Developer PowerShell for VS 2022 |
| `xcrun: error: invalid active developer path` (macOS) | Command Line Tools missing, often after an OS upgrade | `xcode-select --install` |
| `perf` missing or reports no tools for the running kernel | `perf` must match the kernel | Install the kernel-specific package (section 7) |
| `perf` permission errors | `perf_event_paranoid` too strict | Section 7: lower it temporarily or grant `CAP_PERFMON` |
| Hardware events show `<not supported>` | VM or container without a virtualized PMU, or event absent on this CPU | Use bare metal or a VM with PMU passthrough; `ccsim` reports such metrics as `unsupported` |
| A test fails in Debug but passes in Release | The check uses `assert()`, which `NDEBUG` removes in Release | Use the test framework's checks (CONTRIBUTING.md section 8) |
| `dataset.ccsim_dataset_tests` reports *skipped* | zlib headers were missing at configure time | Install `zlib1g-dev` (or your distribution's zlib development package) and reconfigure |
| `dataset.regression_baseline` fails after an engine change | Engine behaviour changed on the standard dataset | Expected only if the change was intended: explain it in the PR, then update the pinned numbers and `tests/data/standard/README.md` |
| `cmake` not found and `pip install --user` refused ("externally managed environment") | PEP 668 distributions | Use a venv (section 2) |
