/* include/ccsim/wasm/ccsim_api.h
 *
 * C ABI exported by the WebAssembly engine (docs/ARCHITECTURE.md section 8). The same
 * functions build natively, which is how tests/unit/test_compare_api.cpp
 * (wasm_api.*) exercises them; tests/wasm/smoke.mjs checks the Emscripten build in Node.
 *
 * Conventions
 *   - Objects are integer handles (> 0). 0 or a negative return means failure; read the
 *     message with ccsim_last_error().
 *   - Bulk data never crosses as JSON on the hot path: step() writes events into a
 *     reusable uint32 buffer that JavaScript views in place (zero copy), layout below.
 *   - Strings returned (const char*) stay valid until the next call that returns a string.
 *   - 64-bit values cross as BigInt (build with -sWASM_BIGINT).
 *
 * Config array (uint64[CCSIM_CONFIG_WORDS]); enums use the C++ enumerator order:
 *   [0] layout version (=1)
 *   [1..7]  L1: size_bytes, line_bytes, ways, hit_latency, policy, write_policy, write_miss_policy
 *   [8]     has_l2 (0/1)
 *   [9..15] L2: same seven fields
 *   [16] memory_latency  [17] inclusion  [18] seed
 *
 * Event encoding (uint32 words, little-endian halves for 64-bit values):
 *   header (CCSIM_EVENT_HEADER_WORDS = 20):
 *     seq_lo seq_hi op addr_lo addr_hi line_lo line_hi offset
 *     l1_outcome l1_set l1_way l1_tag_lo l1_tag_hi
 *     l2_outcome l2_set l2_way l2_tag_lo l2_tag_hi
 *     latency action_count
 *   then action_count actions (CCSIM_ACTION_WORDS = 5 each):
 *     kind | level << 8 | flags << 16,  set,  way,  line_lo,  line_hi
 */
#ifndef CCSIM_WASM_API_H
#define CCSIM_WASM_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CCSIM_API_VERSION 1u
#define CCSIM_CONFIG_WORDS 19u
#define CCSIM_EVENT_HEADER_WORDS 20u
#define CCSIM_ACTION_WORDS 5u

uint32_t ccsim_api_version(void);
const char* ccsim_last_error(void);

/* Scratch memory JavaScript writes chunks / configs into. */
void* ccsim_alloc(uint32_t bytes);
void ccsim_free(void* ptr);

/* Trace upload: begin, feed chunks in order, end. max_accesses 0 = unlimited. */
int32_t ccsim_trace_begin(const char* source_name, uint64_t max_accesses);
int32_t ccsim_trace_feed(int32_t trace, const char* data, uint32_t length);
int32_t ccsim_trace_end(int32_t trace);
uint64_t ccsim_trace_size(int32_t trace);
uint64_t ccsim_trace_fingerprint(int32_t trace);
void ccsim_trace_release(int32_t trace);

/* Sessions. flags bit 0: disable 3C classification (faster). Fails if the configuration's
 * totals on this trace could pass 2^53 (cycles or memory bytes), which JSON cannot carry
 * exactly into JavaScript. */
int32_t ccsim_session_create(int32_t trace, const uint64_t* config, uint32_t words, uint32_t flags);
void ccsim_session_release(int32_t session);
uint64_t ccsim_session_position(int32_t session);
int32_t ccsim_session_reset(int32_t session);
int32_t ccsim_session_seek(int32_t session, uint64_t position);

/* Executes up to n accesses (record != 0: encode their events). Returns the count. */
int32_t ccsim_session_step(int32_t session, uint32_t n, uint32_t record);
/* Runs to a breakpoint (mask: see Breakpoints in session.hpp). Returns StopReason
 * (0 budget, 1 breakpoint, 2 end); the last executed event is encoded. */
int32_t ccsim_session_run(int32_t session, uint32_t max_steps, uint32_t break_mask, uint64_t line);

/* The event buffer filled by the last step/run. */
const uint32_t* ccsim_event_buffer(void);
uint32_t ccsim_event_buffer_words(void);

/* Grid snapshot of a level (0 = L1, 1 = L2): one byte per slot (bit0 valid, bit1 dirty),
 * slot = set * ways + way; tags as uint64 per slot. NULL if the level does not exist. */
const uint8_t* ccsim_session_slot_states(int32_t session, uint32_t level);
const uint64_t* ccsim_session_slot_tags(int32_t session, uint32_t level);

/* JSON documents (schemas ccsim.simulation/1 and ccsim.comparison/1). The reuse profile
 * (with_reuse != 0) covers the whole trace, so it is included only once the session has run
 * to the end ("complete": true) and is "reuse": null before that; it is computed once per
 * trace and line size and reused by every later report. */
const char* ccsim_session_report_json(int32_t session, const char* label, uint32_t with_reuse);
const char* ccsim_compare_json(const int32_t* sessions, uint32_t count, const char* const* labels);
const char* ccsim_compare_csv(const int32_t* sessions, uint32_t count, const char* const* labels);

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif /* CCSIM_WASM_API_H */
