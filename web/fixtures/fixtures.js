/**
 * fixtures.js - Illustrative sample data fixtures for CacheSim
 *
 * NOTE: Sourced strictly from docs/WORKING_DEMO.md (Section 2, Demo B) and
 * docs/TECHNICAL_DESIGN.md (Section 11 & Section 12.3).
 *
 * Clearly labeled as illustrative sample data only; NOT output from the real C++ engine.
 */
(function(root) {
  'use strict';

  // Demo B: Two-level hierarchy walkthrough (Planned)
  // Expected values from docs/WORKING_DEMO.md lines 80-103 and docs/TECHNICAL_DESIGN.md lines 411-420.
  const demoBSimulation = {
    "_comment": "Illustrative sample data for Demo B (Planned) from docs/WORKING_DEMO.md and docs/TECHNICAL_DESIGN.md. Not output from real C++ engine.",
    "_is_sample_data": true,
    "schema": "ccsim.simulation/1",
    "ccsim_version": "0.1.0",
    "levels": [
      {
        "name": "L1",
        "accesses": 10,
        "reads": 8,
        "writes": 2,
        "hits": 3,
        "misses": 7,
        "read_misses": 6,
        "write_misses": 1,
        "evictions": 4,
        "writebacks": 1,
        "miss_rate": 0.7
      },
      {
        "name": "L2",
        "accesses": 7,
        "reads": 7,
        "writes": 0,
        "hits": 1,
        "misses": 6,
        "read_misses": 6,
        "write_misses": 0,
        "evictions": 3,
        "writebacks": 1,
        "writebacks_received": 1,
        "writeback_hits": 1,
        "writeback_misses": 0,
        "local_miss_rate": 0.8571,
        "global_miss_rate": 0.6
      }
    ],
    "memory": {
      "reads": 6,
      "writes": 1
    },
    "amat_cycles": 68.0
  };

  // Step 4 of Demo B documented in docs/TECHNICAL_DESIGN.md section 12.3 (lines 463-470)
  const demoBEventsExcerpt = [
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data: Step 4 excerpt from docs/TECHNICAL_DESIGN.md section 12.3. Not output from real C++ engine.",
      "_is_sample_data": true,
      "seq": 3,
      "op": "R",
      "address": "0x080",
      "decompose": {
        "L1": { "tag": 4, "set": 0, "offset": 0 },
        "L2": { "tag": 2, "set": 0, "offset": 0 }
      },
      "levels": [
        {
          "name": "L1",
          "result": "miss",
          "way": 0,
          "victim": { "way": 0, "tag": 0, "dirty": true, "reason": "lru" },
          "writeback": { "to": "L2" }
        },
        {
          "name": "L2",
          "result": "miss",
          "way": 1,
          "victim": { "way": 1, "tag": 1, "dirty": false, "reason": "lru" },
          "fill": { "from": "memory" }
        }
      ],
      "latency_cycles": 111
    }
  ];

  // Full 10-step reference stream for Demo B derived directly from docs/WORKING_DEMO.md lines 80-112
  const demoBFullEvents = [
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 1 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 0,
      "op": "R",
      "address": "0x000",
      "decompose": {
        "L1": { "tag": 0, "set": 0, "offset": 0 },
        "L2": { "tag": 0, "set": 0, "offset": 0 }
      },
      "levels": [
        { "name": "L1", "result": "miss", "way": 0 },
        { "name": "L2", "result": "miss", "way": 0, "fill": { "from": "memory" } }
      ],
      "latency_cycles": 111
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 2 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 1,
      "op": "W",
      "address": "0x008",
      "decompose": {
        "L1": { "tag": 0, "set": 0, "offset": 8 },
        "L2": { "tag": 0, "set": 0, "offset": 8 }
      },
      "levels": [
        { "name": "L1", "result": "hit", "way": 0 }
      ],
      "latency_cycles": 1
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 3 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 2,
      "op": "R",
      "address": "0x040",
      "decompose": {
        "L1": { "tag": 2, "set": 0, "offset": 0 },
        "L2": { "tag": 1, "set": 0, "offset": 0 }
      },
      "levels": [
        { "name": "L1", "result": "miss", "way": 1 },
        { "name": "L2", "result": "miss", "way": 1, "fill": { "from": "memory" } }
      ],
      "latency_cycles": 111
    },
    demoBEventsExcerpt[0],
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 5 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 4,
      "op": "R",
      "address": "0x000",
      "decompose": {
        "L1": { "tag": 0, "set": 0, "offset": 0 },
        "L2": { "tag": 0, "set": 0, "offset": 0 }
      },
      "levels": [
        { "name": "L1", "result": "miss", "way": 1, "victim": { "way": 1, "tag": 2, "dirty": false, "reason": "lru" } },
        { "name": "L2", "result": "hit", "way": 0 }
      ],
      "latency_cycles": 11
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 6 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 5,
      "op": "W",
      "address": "0x0C0",
      "decompose": {
        "L1": { "tag": 6, "set": 0, "offset": 0 },
        "L2": { "tag": 3, "set": 0, "offset": 0 }
      },
      "levels": [
        { "name": "L1", "result": "miss", "way": 0, "victim": { "way": 0, "tag": 4, "dirty": false, "reason": "lru" } },
        { "name": "L2", "result": "miss", "way": 1, "victim": { "way": 1, "tag": 2, "dirty": false, "reason": "lru" }, "fill": { "from": "memory" } }
      ],
      "latency_cycles": 111
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 7 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 6,
      "op": "R",
      "address": "0x100",
      "decompose": {
        "L1": { "tag": 8, "set": 0, "offset": 0 },
        "L2": { "tag": 4, "set": 0, "offset": 0 }
      },
      "levels": [
        { "name": "L1", "result": "miss", "way": 1, "victim": { "way": 1, "tag": 0, "dirty": false, "reason": "lru" } },
        { "name": "L2", "result": "miss", "way": 0, "victim": { "way": 0, "tag": 0, "dirty": true, "reason": "lru" }, "writeback": { "to": "memory" }, "fill": { "from": "memory" } }
      ],
      "latency_cycles": 111
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 8 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 7,
      "op": "R",
      "address": "0x010",
      "decompose": {
        "L1": { "tag": 0, "set": 1, "offset": 0 },
        "L2": { "tag": 0, "set": 1, "offset": 0 }
      },
      "levels": [
        { "name": "L1", "result": "miss", "way": 0 },
        { "name": "L2", "result": "miss", "way": 0, "fill": { "from": "memory" } }
      ],
      "latency_cycles": 111
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 9 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 8,
      "op": "R",
      "address": "0x018",
      "decompose": {
        "L1": { "tag": 0, "set": 1, "offset": 8 },
        "L2": { "tag": 0, "set": 1, "offset": 8 }
      },
      "levels": [
        { "name": "L1", "result": "hit", "way": 0 }
      ],
      "latency_cycles": 1
    },
    {
      "schema": "ccsim.events/1",
      "_comment": "Illustrative sample data for Demo B Step 10 (docs/WORKING_DEMO.md). Not real output from C++ engine.",
      "_is_sample_data": true,
      "seq": 9,
      "op": "R",
      "address": "0x0C4",
      "decompose": {
        "L1": { "tag": 6, "set": 0, "offset": 4 },
        "L2": { "tag": 3, "set": 0, "offset": 4 }
      },
      "levels": [
        { "name": "L1", "result": "hit", "way": 0 }
      ],
      "latency_cycles": 1
    }
  ];

  const demoADirectSimulation = {
    "_comment": "Illustrative sample data for Demo A (Direct-Mapped) from docs/WORKING_DEMO.md. Not output from real C++ engine.",
    "_is_sample_data": true,
    "name": "Demo A: Direct-Mapped (1-Way)",
    "trace": "tests/data/demo_a_conflict.trace",
    "schema": "ccsim.simulation/1",
    "ccsim_version": "0.1.0",
    "levels": [
      { "name": "L1", "accesses": 6, "hits": 0, "misses": 6, "evictions": 5, "writebacks": 0, "miss_rate": 1.0 }
    ],
    "memory": { "reads": 6, "writes": 0 },
    "amat_cycles": 101.0
  };

  const demoATwoWaySimulation = {
    "_comment": "Illustrative sample data for Demo A (2-Way) from docs/WORKING_DEMO.md. Not output from real C++ engine.",
    "_is_sample_data": true,
    "name": "Demo A: 2-Way Set Associative",
    "trace": "tests/data/demo_a_conflict.trace",
    "schema": "ccsim.simulation/1",
    "ccsim_version": "0.1.0",
    "levels": [
      { "name": "L1", "accesses": 6, "hits": 4, "misses": 2, "evictions": 0, "writebacks": 0, "miss_rate": 0.3333 }
    ],
    "memory": { "reads": 2, "writes": 0 },
    "amat_cycles": 34.3333
  };

  const demoCFifo3Simulation = {
    "_comment": "Illustrative sample data for Demo C (FIFO 3-Line) from docs/WORKING_DEMO.md. Not output from real C++ engine.",
    "_is_sample_data": true,
    "name": "Demo C: FIFO (3 Lines)",
    "trace": "tests/data/demo_c_belady.trace",
    "schema": "ccsim.simulation/1",
    "ccsim_version": "0.1.0",
    "levels": [
      { "name": "L1", "accesses": 12, "hits": 3, "misses": 9, "evictions": 6, "writebacks": 0, "miss_rate": 0.75 }
    ],
    "memory": { "reads": 9, "writes": 0 },
    "amat_cycles": 76.0
  };

  const demoCFifo4Simulation = {
    "_comment": "Illustrative sample data for Demo C (FIFO 4-Line, Belady anomaly) from docs/WORKING_DEMO.md. Not output from real C++ engine.",
    "_is_sample_data": true,
    "name": "Demo C: FIFO (4 Lines · Belady)",
    "trace": "tests/data/demo_c_belady.trace",
    "schema": "ccsim.simulation/1",
    "ccsim_version": "0.1.0",
    "levels": [
      { "name": "L1", "accesses": 12, "hits": 2, "misses": 10, "evictions": 6, "writebacks": 0, "miss_rate": 0.8333 }
    ],
    "memory": { "reads": 10, "writes": 0 },
    "amat_cycles": 84.3333
  };

  const Fixtures = {
    demoB: {
      name: "Demo B: Two-Level Hierarchy Walkthrough",
      trace: "tests/data/demo_b_two_level.trace",
      simulation: demoBSimulation,
      simulationJson: JSON.stringify(demoBSimulation, null, 2),
      events: demoBFullEvents,
      eventsExcerpt: demoBEventsExcerpt,
      eventsNdjson: demoBFullEvents.map(e => JSON.stringify(e)).join('\n') + '\n'
    },
    demoA_direct: {
      name: "Demo A: Direct-Mapped (1-Way)",
      trace: "tests/data/demo_a_conflict.trace",
      simulation: demoADirectSimulation,
      simulationJson: JSON.stringify(demoADirectSimulation, null, 2)
    },
    demoA_twoway: {
      name: "Demo A: 2-Way Set Associative",
      trace: "tests/data/demo_a_conflict.trace",
      simulation: demoATwoWaySimulation,
      simulationJson: JSON.stringify(demoATwoWaySimulation, null, 2)
    },
    demoC_fifo3: {
      name: "Demo C: FIFO (3 Lines)",
      trace: "tests/data/demo_c_belady.trace",
      simulation: demoCFifo3Simulation,
      simulationJson: JSON.stringify(demoCFifo3Simulation, null, 2)
    },
    demoC_fifo4: {
      name: "Demo C: FIFO (4 Lines · Belady)",
      trace: "tests/data/demo_c_belady.trace",
      simulation: demoCFifo4Simulation,
      simulationJson: JSON.stringify(demoCFifo4Simulation, null, 2)
    }
  };

  // Node.js CommonJS & Browser compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Fixtures;
  } else {
    root.CacheSimFixtures = Fixtures;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
