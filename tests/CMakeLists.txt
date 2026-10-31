# Test tree (docs/ARCHITECTURE.md section 11). Labels:
#   smoke   CLI contract                       always
#   unit    module tests                       always
#   golden  WORKING_DEMO hand-derived results  always
#   stress  invariants over >= 1M accesses     always
#   dataset standard dataset validation        always (skipped without zlib)
#   bench   throughput, Release only           opt-in: -DCCSIM_BUILD_BENCHMARKS=ON
option(CCSIM_BUILD_BENCHMARKS "Build and register the throughput benchmarks" OFF)

find_package(ZLIB QUIET)

add_library(ccsim_test_support STATIC
  support/harness_main.cpp
  support/reference_policies.cpp
  support/fixtures.cpp)
target_include_directories(ccsim_test_support PUBLIC support)
target_link_libraries(ccsim_test_support PUBLIC ccsim_core)
target_compile_definitions(ccsim_test_support PUBLIC
  CCSIM_TEST_DATA_DIR="${CMAKE_CURRENT_SOURCE_DIR}/data"
  CCSIM_TEST_RESULTS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/results"
  CCSIM_VERSION_STRING="${PROJECT_VERSION}")
if(ZLIB_FOUND)
  target_link_libraries(ccsim_test_support PUBLIC ZLIB::ZLIB)
  target_compile_definitions(ccsim_test_support PUBLIC CCSIM_TESTS_HAVE_ZLIB=1)
endif()
if(CCSIM_HAS_PRODUCTION_POLICIES)
  target_compile_definitions(ccsim_test_support PUBLIC CCSIM_HAS_PRODUCTION_POLICIES=1)
endif()
ccsim_set_warnings(ccsim_test_support)

# ccsim_add_suite(<name> <label> <sources...>): one executable per suite.
function(ccsim_add_suite name label)
  add_executable(${name} ${ARGN})
  target_link_libraries(${name} PRIVATE ccsim_test_support ccsim_api)
  ccsim_set_warnings(${name})
  add_test(NAME ${label}.${name} COMMAND ${name})
  set_tests_properties(${label}.${name} PROPERTIES LABELS ${label} SKIP_RETURN_CODE 77)
endfunction()

# Smoke: framework-free by design (unchanged contract test).
add_executable(ccsim_smoke_test smoke/smoke_test.cpp)
target_link_libraries(ccsim_smoke_test PRIVATE ccsim_core)
target_compile_definitions(ccsim_smoke_test PRIVATE CCSIM_EXPECTED_VERSION="${PROJECT_VERSION}")
ccsim_set_warnings(ccsim_smoke_test)
add_test(NAME smoke.cli_contract COMMAND ccsim_smoke_test)
add_test(NAME smoke.executable_version COMMAND ccsim --version)
set_tests_properties(smoke.executable_version PROPERTIES
  PASS_REGULAR_EXPRESSION "^ccsim ${PROJECT_VERSION}")
set_tests_properties(smoke.cli_contract smoke.executable_version PROPERTIES LABELS smoke)

file(GLOB CCSIM_UNIT_SOURCES CONFIGURE_DEPENDS unit/*.cpp)
ccsim_add_suite(ccsim_unit_tests unit ${CCSIM_UNIT_SOURCES})
file(GLOB CCSIM_GOLDEN_SOURCES CONFIGURE_DEPENDS golden/*.cpp)
ccsim_add_suite(ccsim_golden_tests golden ${CCSIM_GOLDEN_SOURCES})
file(GLOB CCSIM_STRESS_SOURCES CONFIGURE_DEPENDS stress/*.cpp)
ccsim_add_suite(ccsim_stress_tests stress ${CCSIM_STRESS_SOURCES})
file(GLOB CCSIM_DATASET_SOURCES CONFIGURE_DEPENDS dataset/*.cpp)
ccsim_add_suite(ccsim_dataset_tests dataset ${CCSIM_DATASET_SOURCES})
set_tests_properties(dataset.ccsim_dataset_tests PROPERTIES TIMEOUT 600)

# Engine fixtures for the web frontend (web/test/fixtures/). The unit test fails when the
# committed fixtures no longer match the engine; regenerate with
#   ./build/tests/ccsim_web_fixtures --write web/test/fixtures
add_executable(ccsim_web_fixtures tools/web_fixtures.cpp)
target_link_libraries(ccsim_web_fixtures PRIVATE ccsim_test_support ccsim_api)
ccsim_set_warnings(ccsim_web_fixtures)
add_test(NAME unit.web_fixtures_current
  COMMAND ccsim_web_fixtures --check ${PROJECT_SOURCE_DIR}/web/test/fixtures)
set_tests_properties(unit.web_fixtures_current PROPERTIES LABELS unit SKIP_RETURN_CODE 77)

if(CCSIM_BUILD_BENCHMARKS)
  file(GLOB CCSIM_BENCH_SOURCES CONFIGURE_DEPENDS bench/*.cpp)
  ccsim_add_suite(ccsim_bench bench ${CCSIM_BENCH_SOURCES})
  set_tests_properties(bench.ccsim_bench PROPERTIES TIMEOUT 1800 RUN_SERIAL TRUE)
endif()
