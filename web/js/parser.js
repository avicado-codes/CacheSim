/**
 * parser.js - CacheSim Schema Parser & Validator
 * Role 5: Frontend & Visualization
 *
 * Implements strict offline-first validation for CacheSim data against:
 * - docs/TECHNICAL_DESIGN.md Section 11 (Output schema v1: ccsim.simulation/1)
 * - docs/TECHNICAL_DESIGN.md Section 6 (Invariants and rate formulas)
 * - docs/TECHNICAL_DESIGN.md Section 12.3 (Engine event stream: ccsim.events/1)
 *
 * Requirements:
 * - Zero external libraries, zero CDN, zero network requests.
 * - Conforms strictly to documented schemas.
 * - Consumers ignore unknown fields (TECHNICAL_DESIGN.md Section 11).
 */

(function(root) {
  'use strict';

  /**
   * Helper: checks if value is an integer >= 0.
   * @param {*} val
   * @returns {boolean}
   */
  function isNonNegativeInteger(val) {
    return typeof val === 'number' && Number.isInteger(val) && val >= 0;
  }

  /**
   * Helper: checks if value is null or a finite number >= 0.
   * @param {*} val
   * @returns {boolean}
   */
  function isNullableNonNegativeNumber(val) {
    if (val === null) return true;
    return typeof val === 'number' && Number.isFinite(val) && val >= 0;
  }

  /**
   * Validates a Simulation Result object against "ccsim.simulation/1".
   * Documented in docs/TECHNICAL_DESIGN.md sections 6 and 11.
   *
   * @param {object|string} input - Parsed object or raw JSON string.
   * @returns {{ valid: boolean, errors: string[], data: object|null }}
   */
  function validateSimulation(input) {
    const errors = [];
    let data = input;

    // 1. JSON parse if input is a string
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch (err) {
        return {
          valid: false,
          errors: [`JSON syntax error: ${err.message}`],
          data: null
        };
      }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        valid: false,
        errors: ['Simulation payload must be a non-null JSON object'],
        data: null
      };
    }

    // 2. Schema identity
    if (data.schema !== 'ccsim.simulation/1') {
      errors.push(`Invalid schema: expected "ccsim.simulation/1", got ${JSON.stringify(data.schema)}`);
    }

    // 3. Engine version
    if (typeof data.ccsim_version !== 'string' || data.ccsim_version.trim() === '') {
      errors.push('Missing or invalid "ccsim_version": expected non-empty string');
    }

    // 4. Cache Levels
    if (!Array.isArray(data.levels) || data.levels.length === 0) {
      errors.push('Missing or invalid "levels": expected non-empty array of level statistics');
    } else {
      let l1Stats = null;
      let l2Stats = null;

      data.levels.forEach((lvl, idx) => {
        const prefix = `levels[${idx}] (${lvl.name || 'unnamed'})`;

        if (typeof lvl.name !== 'string' || lvl.name.trim() === '') {
          errors.push(`${prefix}: "name" must be a non-empty string (e.g. "L1", "L2")`);
        } else {
          if (lvl.name === 'L1') l1Stats = lvl;
          if (lvl.name === 'L2') l2Stats = lvl;
        }

        // Required counters
        const requiredCounters = ['accesses', 'hits', 'misses', 'evictions', 'writebacks'];
        requiredCounters.forEach(c => {
          if (!isNonNegativeInteger(lvl[c])) {
            errors.push(`${prefix}: "${c}" must be an integer >= 0`);
          }
        });

        // Rates per level (TECHNICAL_DESIGN.md section 6)
        if (lvl.name === 'L2') {
          if (lvl.miss_rate !== undefined && !isNullableNonNegativeNumber(lvl.miss_rate)) {
            errors.push(`${prefix}: "miss_rate" must be a non-negative number or null`);
          } else if (lvl.miss_rate !== undefined && lvl.miss_rate !== null && (lvl.miss_rate < 0 || lvl.miss_rate > 1.0001)) {
            errors.push(`${prefix}: "miss_rate" must be between 0 and 1, got ${lvl.miss_rate}`);
          }
          if (lvl.local_miss_rate !== undefined && !isNullableNonNegativeNumber(lvl.local_miss_rate)) {
            errors.push(`${prefix}: "local_miss_rate" must be a non-negative number or null`);
          } else if (lvl.local_miss_rate !== undefined && lvl.local_miss_rate !== null && (lvl.local_miss_rate < 0 || lvl.local_miss_rate > 1.0001)) {
            errors.push(`${prefix}: "local_miss_rate" must be between 0 and 1, got ${lvl.local_miss_rate}`);
          }
          if (lvl.global_miss_rate !== undefined && !isNullableNonNegativeNumber(lvl.global_miss_rate)) {
            errors.push(`${prefix}: "global_miss_rate" must be a non-negative number or null`);
          } else if (lvl.global_miss_rate !== undefined && lvl.global_miss_rate !== null && (lvl.global_miss_rate < 0 || lvl.global_miss_rate > 1.0001)) {
            errors.push(`${prefix}: "global_miss_rate" must be between 0 and 1, got ${lvl.global_miss_rate}`);
          }
        } else {
          // Non-L2 levels require miss_rate
          if (!isNullableNonNegativeNumber(lvl.miss_rate)) {
            errors.push(`${prefix}: "miss_rate" must be a non-negative number or null`);
          } else if (lvl.miss_rate !== null && (lvl.miss_rate < 0 || lvl.miss_rate > 1.0001)) {
            errors.push(`${prefix}: "miss_rate" must be between 0 and 1, got ${lvl.miss_rate}`);
          }
        }

        // Optional extended counters (TECHNICAL_DESIGN.md section 6)
        if (lvl.reads !== undefined && !isNonNegativeInteger(lvl.reads)) {
          errors.push(`${prefix}: "reads" must be an integer >= 0`);
        }
        if (lvl.writes !== undefined && !isNonNegativeInteger(lvl.writes)) {
          errors.push(`${prefix}: "writes" must be an integer >= 0`);
        }
        if (lvl.read_misses !== undefined && !isNonNegativeInteger(lvl.read_misses)) {
          errors.push(`${prefix}: "read_misses" must be an integer >= 0`);
        }
        if (lvl.write_misses !== undefined && !isNonNegativeInteger(lvl.write_misses)) {
          errors.push(`${prefix}: "write_misses" must be an integer >= 0`);
        }

        // L2-specific fields
        if (lvl.name === 'L2') {
          if (lvl.writebacks_received !== undefined && !isNonNegativeInteger(lvl.writebacks_received)) {
            errors.push(`${prefix}: "writebacks_received" must be an integer >= 0`);
          }
          if (lvl.writeback_hits !== undefined && !isNonNegativeInteger(lvl.writeback_hits)) {
            errors.push(`${prefix}: "writeback_hits" must be an integer >= 0`);
          }
          if (lvl.writeback_misses !== undefined && !isNonNegativeInteger(lvl.writeback_misses)) {
            errors.push(`${prefix}: "writeback_misses" must be an integer >= 0`);
          }
          if (lvl.local_miss_rate !== undefined && !isNullableNonNegativeNumber(lvl.local_miss_rate)) {
            errors.push(`${prefix}: "local_miss_rate" must be a non-negative number or null`);
          }
          if (lvl.global_miss_rate !== undefined && !isNullableNonNegativeNumber(lvl.global_miss_rate)) {
            errors.push(`${prefix}: "global_miss_rate" must be a non-negative number or null`);
          }
        }

        // Intra-level invariants (TECHNICAL_DESIGN.md section 6)
        if (isNonNegativeInteger(lvl.hits) && isNonNegativeInteger(lvl.misses) && isNonNegativeInteger(lvl.accesses)) {
          if (lvl.hits + lvl.misses !== lvl.accesses) {
            errors.push(`${prefix} invariant violation: hits (${lvl.hits}) + misses (${lvl.misses}) != accesses (${lvl.accesses})`);
          }
        }

        if (isNonNegativeInteger(lvl.writebacks) && isNonNegativeInteger(lvl.evictions)) {
          if (lvl.writebacks > lvl.evictions) {
            errors.push(`${prefix} invariant violation: writebacks (${lvl.writebacks}) > evictions (${lvl.evictions})`);
          }
        }

        if (lvl.name === 'L1' && isNonNegativeInteger(lvl.evictions) && isNonNegativeInteger(lvl.misses)) {
          if (lvl.evictions > lvl.misses) {
            errors.push(`${prefix} invariant violation: L1 evictions (${lvl.evictions}) > misses (${lvl.misses})`);
          }
        }

        if (lvl.name === 'L1' && isNonNegativeInteger(lvl.reads) && isNonNegativeInteger(lvl.writes) && isNonNegativeInteger(lvl.accesses)) {
          if (lvl.reads + lvl.writes !== lvl.accesses) {
            errors.push(`${prefix} invariant violation: L1 reads (${lvl.reads}) + writes (${lvl.writes}) != accesses (${lvl.accesses})`);
          }
        }

        if (isNonNegativeInteger(lvl.read_misses) && isNonNegativeInteger(lvl.write_misses) && isNonNegativeInteger(lvl.misses)) {
          if (lvl.read_misses + lvl.write_misses !== lvl.misses) {
            errors.push(`${prefix} invariant violation: read_misses (${lvl.read_misses}) + write_misses (${lvl.write_misses}) != misses (${lvl.misses})`);
          }
        }
      });

      // Hierarchy invariants (between L1 and L2)
      if (l1Stats && l2Stats) {
        if (l2Stats.accesses !== l1Stats.misses) {
          errors.push(`Hierarchy invariant violation: L2.accesses (${l2Stats.accesses}) != L1.misses (${l1Stats.misses})`);
        }
        if (l2Stats.writebacks_received !== undefined && l2Stats.writebacks_received !== l1Stats.writebacks) {
          errors.push(`Hierarchy invariant violation: L2.writebacks_received (${l2Stats.writebacks_received}) != L1.writebacks (${l1Stats.writebacks})`);
        }
      }
    }

    // 5. Memory traffic
    if (!data.memory || typeof data.memory !== 'object' || Array.isArray(data.memory)) {
      errors.push('Missing or invalid "memory": expected object with "reads" and "writes" counters');
    } else {
      if (!isNonNegativeInteger(data.memory.reads)) {
        errors.push('memory: "reads" must be an integer >= 0');
      }
      if (!isNonNegativeInteger(data.memory.writes)) {
        errors.push('memory: "writes" must be an integer >= 0');
      }

      // Memory invariant checks against bottom cache level
      if (Array.isArray(data.levels) && data.levels.length > 0) {
        const bottomLevel = data.levels[data.levels.length - 1];
        if (isNonNegativeInteger(data.memory.reads) && isNonNegativeInteger(bottomLevel.misses)) {
          if (data.memory.reads !== bottomLevel.misses) {
            errors.push(`Memory invariant violation: memory.reads (${data.memory.reads}) != bottom level ${bottomLevel.name} misses (${bottomLevel.misses})`);
          }
        }
        if (isNonNegativeInteger(data.memory.writes) && isNonNegativeInteger(bottomLevel.writebacks)) {
          if (data.memory.writes !== bottomLevel.writebacks) {
            errors.push(`Memory invariant violation: memory.writes (${data.memory.writes}) != bottom level ${bottomLevel.name} writebacks (${bottomLevel.writebacks})`);
          }
        }
      }
    }

    // 6. AMAT
    if (!isNullableNonNegativeNumber(data.amat_cycles)) {
      errors.push('Missing or invalid "amat_cycles": expected non-negative number or null');
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      data: errors.length === 0 ? data : null
    };
  }

  /**
   * Validates a single event record against "ccsim.events/1".
   * Documented in docs/TECHNICAL_DESIGN.md section 12.3.
   *
   * @param {object|string} input - Parsed event or single-line JSON string.
   * @returns {{ valid: boolean, errors: string[], data: object|null }}
   */
  function validateEvent(input) {
    const errors = [];
    let data = input;

    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch (err) {
        return {
          valid: false,
          errors: [`Event JSON syntax error: ${err.message}`],
          data: null
        };
      }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        valid: false,
        errors: ['Event must be a non-null JSON object'],
        data: null
      };
    }

    if (data.schema !== 'ccsim.events/1') {
      errors.push(`Invalid schema: expected "ccsim.events/1", got ${JSON.stringify(data.schema)}`);
    }

    if (!isNonNegativeInteger(data.seq)) {
      errors.push('Missing or invalid "seq": expected integer >= 0 (0-based access index)');
    }

    if (data.op !== 'R' && data.op !== 'W') {
      errors.push(`Invalid "op": expected "R" or "W", got ${JSON.stringify(data.op)}`);
    }

    if (typeof data.address !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(data.address)) {
      errors.push(`Invalid "address": expected 0x-prefixed hex string (1-16 digits), got ${JSON.stringify(data.address)}`);
    }

    // Address decomposition
    if (!data.decompose || typeof data.decompose !== 'object' || Array.isArray(data.decompose)) {
      errors.push('Missing or invalid "decompose": expected object mapping level names to tag/set/offset');
    } else {
      for (const [lvlName, decomp] of Object.entries(data.decompose)) {
        if (!decomp || typeof decomp !== 'object') {
          errors.push(`decompose.${lvlName}: expected decomposition object`);
        } else {
          if (!isNonNegativeInteger(decomp.tag)) errors.push(`decompose.${lvlName}.tag: expected integer >= 0`);
          if (!isNonNegativeInteger(decomp.set)) errors.push(`decompose.${lvlName}.set: expected integer >= 0`);
          if (!isNonNegativeInteger(decomp.offset)) errors.push(`decompose.${lvlName}.offset: expected integer >= 0`);
        }
      }
    }

    // Level outcomes
    if (!Array.isArray(data.levels) || data.levels.length === 0) {
      errors.push('Missing or invalid "levels": expected array with at least one level decision');
    } else {
      data.levels.forEach((lvl, idx) => {
        const prefix = `event levels[${idx}]`;
        if (typeof lvl.name !== 'string' || !lvl.name) {
          errors.push(`${prefix}: "name" must be a non-empty string`);
        }
        if (lvl.result !== 'hit' && lvl.result !== 'miss') {
          errors.push(`${prefix}: "result" must be "hit" or "miss", got ${JSON.stringify(lvl.result)}`);
        }
        if (lvl.way !== undefined && !isNonNegativeInteger(lvl.way)) {
          errors.push(`${prefix}: "way" must be an integer >= 0`);
        }
        if (lvl.victim !== undefined) {
          if (!lvl.victim || typeof lvl.victim !== 'object') {
            errors.push(`${prefix}.victim: expected object`);
          } else {
            if (!isNonNegativeInteger(lvl.victim.way)) errors.push(`${prefix}.victim.way: expected integer >= 0`);
            if (!isNonNegativeInteger(lvl.victim.tag)) errors.push(`${prefix}.victim.tag: expected integer >= 0`);
            if (typeof lvl.victim.dirty !== 'boolean') errors.push(`${prefix}.victim.dirty: expected boolean`);
            if (typeof lvl.victim.reason !== 'string') errors.push(`${prefix}.victim.reason: expected string`);
          }
        }
        if (lvl.writeback !== undefined) {
          if (!lvl.writeback || typeof lvl.writeback !== 'object' || typeof lvl.writeback.to !== 'string') {
            errors.push(`${prefix}.writeback: expected object with "to" string`);
          }
        }
        if (lvl.fill !== undefined) {
          if (!lvl.fill || typeof lvl.fill !== 'object' || typeof lvl.fill.from !== 'string') {
            errors.push(`${prefix}.fill: expected object with "from" string`);
          }
        }
      });
    }

    if (!isNonNegativeInteger(data.latency_cycles)) {
      errors.push('Missing or invalid "latency_cycles": expected integer >= 0');
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      data: errors.length === 0 ? data : null
    };
  }

  /**
   * Parses and validates a newline-delimited JSON (NDJSON) event stream.
   *
   * @param {string} ndjsonText
   * @returns {{ valid: boolean, errors: string[], events: object[] }}
   */
  function parseEventStream(ndjsonText) {
    if (typeof ndjsonText !== 'string') {
      return {
        valid: false,
        errors: ['Event stream text must be a string'],
        events: []
      };
    }

    const lines = ndjsonText.split(/\r?\n/);
    const events = [];
    const errors = [];

    lines.forEach((line, lineIdx) => {
      const trimmed = line.trim();
      // Skip empty lines and comment lines starting with #
      if (!trimmed || trimmed.startsWith('#')) return;

      const res = validateEvent(trimmed);
      if (!res.valid) {
        res.errors.forEach(err => errors.push(`Line ${lineIdx + 1}: ${err}`));
      } else {
        events.push(res.data);
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors,
      events: events
    };
  }

  /**
   * Reads a local File object using vanilla FileReader API (offline-first).
   * @param {File} file
   * @returns {Promise<string>}
   */
  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file provided'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('File read failed'));
      reader.readAsText(file);
    });
  }

  const Parser = {
    validateSimulation,
    validateEvent,
    parseEventStream,
    readTextFile
  };

  // Node.js CommonJS & Browser compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Parser;
  } else {
    root.CacheSim = root.CacheSim || {};
    root.CacheSim.Parser = Parser;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
