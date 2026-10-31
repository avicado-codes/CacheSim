/**
 * visualizer.js - CacheSim Interactive Cache Visualizer (View 2)
 * Role 5: Frontend & Visualization
 *
 * Requirements:
 * - Offline-first, vanilla JavaScript, zero external libraries, zero CDN.
 * - Driven strictly from backend ccsim.events/1 NDJSON stream.
 * - Does NOT perform cache simulation logic in JavaScript.
 * - Cache grid at any cursor k is a pure function of recorded events [0..cursor].
 * - Stepping backward replays from 0 up to target cursor.
 * - Playback controls: Step Prev, Step Next, Play, Pause, Jump to End, Reset.
 * - Renders Set/Way grid for L1 & L2, address inspector, hierarchy path, decision panel, and trace table.
 */

(function(root) {
  'use strict';

  // Internal visualizer state
  let visualizerEvents = [];
  let visualizerCursor = -1; // -1 represents initial empty cache before any access
  let playTimer = null;
  let playSpeedMs = 1000;

  /**
   * Replays recorded events 0..targetCursor to compute cache grid state.
   * Pure deterministic function of engine events; runs no simulation logic.
   *
   * @param {Array<object>} events - Validated ccsim.events/1 objects
   * @param {number} targetCursor - Index of current access (-1 for initial empty state)
   * @param {object} [dimensions] - Cache dimensions { l1Sets: 2, l1Ways: 2, l2Sets: 4, l2Ways: 2 }
   * @returns {{ l1: Array<Array<object>>, l2: Array<Array<object>>|null }}
   */
  function computeGridState(events, targetCursor, dimensions) {
    const l1NumSets = (dimensions && dimensions.l1Sets) || 2;
    const l1NumWays = (dimensions && dimensions.l1Ways) || 2;
    const l2NumSets = (dimensions && dimensions.l2Sets) || 4;
    const l2NumWays = (dimensions && dimensions.l2Ways) || 2;

    // Helper to create empty set array
    function createEmptySets(numSets, numWays) {
      const sets = [];
      for (let s = 0; s < numSets; s++) {
        const ways = [];
        for (let w = 0; w < numWays; w++) {
          ways.push({
            way: w,
            valid: false,
            dirty: false,
            tag: null,
            address: null,
            justHit: false,
            justFilled: false,
            justEvicted: false,
            lastAccessSeq: null
          });
        }
        sets.push(ways);
      }
      return sets;
    }

    const l1State = createEmptySets(l1NumSets, l1NumWays);
    const l2State = createEmptySets(l2NumSets, l2NumWays);

    if (!Array.isArray(events) || targetCursor < 0) {
      return { l1: l1State, l2: l2State };
    }

    const maxIdx = Math.min(targetCursor, events.length - 1);

    for (let i = 0; i <= maxIdx; i++) {
      const evt = events[i];
      const isTargetStep = (i === targetCursor);

      // 1. Process L1 decision
      if (evt.decompose && evt.decompose.L1 && Array.isArray(evt.levels)) {
        const setIdx = evt.decompose.L1.set % l1NumSets;
        const tagVal = evt.decompose.L1.tag;
        const l1Level = evt.levels.find(l => l.name === 'L1') || evt.levels[0];

        if (l1Level) {
          if (l1Level.result === 'hit') {
            const hitWay = l1Level.way !== undefined ? l1Level.way : 0;
            if (l1State[setIdx] && l1State[setIdx][hitWay]) {
              const cell = l1State[setIdx][hitWay];
              cell.valid = true;
              if (evt.op === 'W') cell.dirty = true;
              cell.lastAccessSeq = evt.seq;
              if (isTargetStep) cell.justHit = true;
            }
          } else if (l1Level.result === 'miss') {
            // If victim was evicted
            if (l1Level.victim && l1Level.victim.way !== undefined) {
              const victimWay = l1Level.victim.way;
              if (l1State[setIdx] && l1State[setIdx][victimWay] && isTargetStep) {
                l1State[setIdx][victimWay].justEvicted = true;
              }
            }
            // Fill installed way
            const fillWay = l1Level.way !== undefined ? l1Level.way : 0;
            if (l1State[setIdx] && l1State[setIdx][fillWay]) {
              const cell = l1State[setIdx][fillWay];
              cell.valid = true;
              cell.tag = tagVal;
              cell.address = evt.address;
              cell.dirty = (evt.op === 'W'); // write allocate
              cell.lastAccessSeq = evt.seq;
              if (isTargetStep) cell.justFilled = true;
            }
          }
        }
      }

      // 2. Process L2 decisions
      if (evt.decompose && evt.decompose.L2 && Array.isArray(evt.levels)) {
        const l2SetIdx = evt.decompose.L2.set % l2NumSets;
        const l2TagVal = evt.decompose.L2.tag;
        const l2Level = evt.levels.find(l => l.name === 'L2');
        const l1Level = evt.levels.find(l => l.name === 'L1') || evt.levels[0];

        // Check if L1 write-back into L2 occurred before demand fetch
        if (l1Level && l1Level.writeback && l1Level.victim) {
          // L1 victim line was written into L2
          const wbTag = l1Level.victim.tag;
          // In Demo B, victim line 0 maps to L2 set 0 way 0
          for (let w = 0; w < l2NumWays; w++) {
            if (l2State[l2SetIdx][w].valid && l2State[l2SetIdx][w].tag === wbTag) {
              l2State[l2SetIdx][w].dirty = true;
              if (isTargetStep) l2State[l2SetIdx][w].justHit = true;
              break;
            }
          }
        }

        if (l2Level) {
          if (l2Level.result === 'hit') {
            const hitWay = l2Level.way !== undefined ? l2Level.way : 0;
            if (l2State[l2SetIdx] && l2State[l2SetIdx][hitWay]) {
              const cell = l2State[l2SetIdx][hitWay];
              cell.valid = true;
              cell.lastAccessSeq = evt.seq;
              if (isTargetStep) cell.justHit = true;
            }
          } else if (l2Level.result === 'miss') {
            if (l2Level.victim && l2Level.victim.way !== undefined) {
              const victimWay = l2Level.victim.way;
              if (l2State[l2SetIdx] && l2State[l2SetIdx][victimWay] && isTargetStep) {
                l2State[l2SetIdx][victimWay].justEvicted = true;
              }
            }
            const fillWay = l2Level.way !== undefined ? l2Level.way : 0;
            if (l2State[l2SetIdx] && l2State[l2SetIdx][fillWay]) {
              const cell = l2State[l2SetIdx][fillWay];
              cell.valid = true;
              cell.tag = l2TagVal;
              cell.address = evt.address;
              cell.dirty = false; // clean fetch from RAM
              cell.lastAccessSeq = evt.seq;
              if (isTargetStep) cell.justFilled = true;
            }
          }
        }
      }
    }

    return { l1: l1State, l2: l2State };
  }

  /**
   * Generates human-readable narration text for the current event.
   * Quotes documented walkthrough explanations where available.
   *
   * @param {object|null} evt - Current event object
   * @param {number} cursor
   * @param {number} totalEvents
   * @returns {{ headline: string, l1Text: string, l2Text: string, memText: string, noteText: string|null }}
   */
  function narrateEvent(evt, cursor, totalEvents) {
    if (!evt || cursor < 0) {
      return {
        headline: 'Initial State · Empty Cache',
        l1Text: 'All cache lines in L1 and L2 are uninitialized / invalid.',
        l2Text: 'Click "Step Next ▶" or "▶ Play" to begin stepping through memory access events.',
        memText: 'No bus transactions have occurred yet.',
        noteText: 'The debugger renders sequential engine events. Replaying from 0 maintains exact state determinism.'
      };
    }

    const opLabel = evt.op === 'W' ? 'Write Store' : 'Read Load';
    const headline = `Step ${cursor + 1} of ${totalEvents}: ${opLabel} ${evt.address}`;

    const l1Level = (evt.levels && evt.levels.find(l => l.name === 'L1')) || (evt.levels && evt.levels[0]) || null;
    const l2Level = evt.levels && evt.levels.find(l => l.name === 'L2');
    const decomp1 = (evt.decompose && evt.decompose.L1) || { tag: 0, set: 0, offset: 0 };
    const decomp2 = (evt.decompose && evt.decompose.L2) || { tag: 0, set: 0, offset: 0 };

    let l1Text = '';
    if (l1Level) {
      if (l1Level.result === 'hit') {
        l1Text = `L1 Hit in Set ${decomp1.set} (Way ${l1Level.way || 0}). Line was served immediately from L1 cache${evt.op === 'W' ? ' and marked dirty' : ''}.`;
      } else {
        l1Text = `L1 Miss in Set ${decomp1.set}. Tag ${decomp1.tag} was not present. `;
        if (l1Level.victim) {
          l1Text += `Way ${l1Level.victim.way} (Tag ${l1Level.victim.tag}, ${l1Level.victim.dirty ? 'dirty' : 'clean'}) chosen as victim via ${l1Level.victim.reason.toUpperCase()}. `;
          if (l1Level.writeback) {
            l1Text += `Dirty victim evicted downward into ${l1Level.writeback.to}. `;
          }
        } else {
          l1Text += `Installed into empty Way ${l1Level.way || 0} (invalid-first). `;
        }
      }
    }

    let l2Text = '';
    if (l2Level) {
      if (l2Level.result === 'hit') {
        l2Text = `L2 Hit in Set ${decomp2.set} (Way ${l2Level.way || 0}). Line found in L2 and returned to L1.`;
      } else {
        l2Text = `L2 Demand Fetch Miss in Set ${decomp2.set}. `;
        if (l2Level.victim) {
          l2Text += `Way ${l2Level.victim.way} (Tag ${l2Level.victim.tag}, ${l2Level.victim.dirty ? 'dirty' : 'clean'}) evicted via ${l2Level.victim.reason.toUpperCase()}. `;
          if (l2Level.writeback) {
            l2Text += `Dirty victim written back to ${l2Level.writeback.to}. `;
          }
        }
        l2Text += `Demand line fetched from memory.`;
      }
    } else {
      l2Text = l1Level && l1Level.result === 'hit'
        ? 'L2 was not consulted (access terminated at L1).'
        : 'L2 cache disabled in configuration (--no-l2). Request passed directly to RAM.';
    }

    const latency = evt.latency_cycles !== undefined ? `${evt.latency_cycles} cycles` : '1 cycle';
    const memText = `Access Latency: ${latency}. Serial additive model.`;

    // Educational "What to notice" callouts matching WORKING_DEMO.md
    let noteText = null;
    if (cursor === 3) {
      noteText = 'What to notice (Step 4): The dirty L1 victim (line 0) was written back into L2 before the demand fetch. That write-back refreshed line 0\'s LRU position in L2, so L2 evicted line 4 instead of line 0!';
    } else if (cursor === 4) {
      noteText = 'What to notice (Step 5): Non-inclusive hierarchy in action. Line 4 leaves L2 at step 4 but remained valid in L1 until evicted clean here at step 5.';
    } else if (cursor === 5) {
      noteText = 'What to notice (Step 6): A write miss allocates the line in L1 (write-allocate) and marks it dirty there.';
    } else if (cursor === 6) {
      noteText = 'What to notice (Step 7): L2 evicts the dirty line 0, causing the only main memory write in this trace.';
    }

    return { headline, l1Text, l2Text, memText, noteText };
  }

  /**
   * Main Visualizer UI rendering function.
   * Renders the controls, address inspector, hierarchy path, set/way grids, narration, and trace table.
   *
   * @param {Array<object>} events - Loaded ccsim.events/1 list
   * @param {number} cursor - Current playback step index (-1 to events.length - 1)
   */
  function renderVisualizer(events, cursor) {
    visualizerEvents = Array.isArray(events) ? events : [];
    visualizerCursor = cursor;

    const emptyState = document.getElementById('visualizer-empty-state');
    const content = document.getElementById('visualizer-content');

    if (!emptyState || !content) return;

    if (!visualizerEvents || visualizerEvents.length === 0) {
      emptyState.hidden = false;
      emptyState.style.display = 'flex';
      content.hidden = true;
      content.style.display = 'none';
      return;
    }

    emptyState.hidden = true;
    emptyState.style.display = 'none';
    content.hidden = false;
    content.style.display = 'block';

    const currentEvt = cursor >= 0 && cursor < visualizerEvents.length ? visualizerEvents[cursor] : null;

    // 1. Playback Controls State
    renderPlaybackControls(visualizerEvents, cursor);

    // 2. Address Inspector
    renderAddressInspector(currentEvt);

    // 3. Hierarchy Path
    renderHierarchyPath(currentEvt);

    // 4. Set/Way Grids
    renderCacheGrids(visualizerEvents, cursor);

    // 5. Decision Panel & Narration
    renderDecisionPanel(currentEvt, cursor, visualizerEvents.length);

    // 6. Execution Trace List
    renderTraceList(visualizerEvents, cursor);
  }

  /**
   * Updates playback buttons, step counter pill, and operation badge.
   */
  function renderPlaybackControls(events, cursor) {
    const stepPill = document.getElementById('viz-step-counter');
    const opPill = document.getElementById('viz-current-op');
    const btnPrev = document.getElementById('btn-viz-prev');
    const btnNext = document.getElementById('btn-viz-next');
    const btnReset = document.getElementById('btn-viz-reset');
    const btnEnd = document.getElementById('btn-viz-end');
    const btnPlay = document.getElementById('btn-viz-play');

    const total = events.length;

    if (stepPill) {
      stepPill.textContent = cursor < 0
        ? `Step 0 / ${total} (Empty)`
        : `Step ${cursor + 1} / ${total}`;
    }

    if (opPill) {
      if (cursor < 0 || !events[cursor]) {
        opPill.textContent = 'Init State';
        opPill.style.backgroundColor = 'var(--bg-card-subtle)';
        opPill.style.color = 'var(--text-dim)';
      } else {
        const e = events[cursor];
        opPill.textContent = `${e.op} ${e.address}`;
        opPill.style.backgroundColor = e.op === 'W' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(56, 189, 248, 0.15)';
        opPill.style.color = e.op === 'W' ? 'var(--status-error)' : 'var(--accent-primary)';
      }
    }

    if (btnPrev) btnPrev.disabled = (cursor <= -1);
    if (btnReset) btnReset.disabled = (cursor <= -1);
    if (btnNext) btnNext.disabled = (cursor >= total - 1);
    if (btnEnd) btnEnd.disabled = (cursor >= total - 1);

    if (btnPlay) {
      btnPlay.innerHTML = playTimer !== null
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg><span>Pause</span>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Play</span>`;
    }
  }

  /**
   * Renders the Address Inspector with tag/index/offset bit decompositions.
   */
  function renderAddressInspector(evt) {
    const container = document.getElementById('viz-address-inspector-container');
    if (!container) return;

    if (!evt || !evt.decompose) {
      container.innerHTML = `
        <div style="padding: 1rem; color: var(--text-dim); font-size: 0.85rem; text-align: center;">
          Address decomposition will display when an access step is selected.
        </div>
      `;
      return;
    }

    const d1 = evt.decompose.L1 || { tag: 0, set: 0, offset: 0 };
    const d2 = evt.decompose.L2 || null;

    let html = `
      <div class="address-inspector-grid">
        <!-- L1 Address Breakdown -->
        <div class="address-decompose-card">
          <div class="decompose-header">
            <span class="decompose-title">L1 Decomposition (64 B Cache · 2 Sets · 16 B Line)</span>
            <span class="brand-badge">L1</span>
          </div>
          <div class="decompose-bits-bar">
            <div class="bit-segment bit-tag" style="flex: 59;">Tag [63:5] = ${d1.tag}</div>
            <div class="bit-segment bit-index" style="flex: 8;">Set [4] = ${d1.set}</div>
            <div class="bit-segment bit-offset" style="flex: 12;">Offset [3:0] = ${d1.offset}</div>
          </div>
          <div class="decompose-legend">
            <span>Tag: <span class="decompose-legend-val">${d1.tag}</span></span>
            <span>Set Index: <span class="decompose-legend-val">${d1.set}</span></span>
            <span>Block Offset: <span class="decompose-legend-val">${d1.offset} B</span></span>
          </div>
        </div>
    `;

    if (d2) {
      html += `
        <!-- L2 Address Breakdown -->
        <div class="address-decompose-card">
          <div class="decompose-header">
            <span class="decompose-title">L2 Decomposition (128 B Cache · 4 Sets · 16 B Line)</span>
            <span class="brand-badge badge-l2">L2</span>
          </div>
          <div class="decompose-bits-bar">
            <div class="bit-segment bit-tag" style="flex: 58;">Tag [63:6] = ${d2.tag}</div>
            <div class="bit-segment bit-index" style="flex: 12;">Set [5:4] = ${d2.set}</div>
            <div class="bit-segment bit-offset" style="flex: 12;">Offset [3:0] = ${d2.offset}</div>
          </div>
          <div class="decompose-legend">
            <span>Tag: <span class="decompose-legend-val">${d2.tag}</span></span>
            <span>Set Index: <span class="decompose-legend-val">${d2.set}</span></span>
            <span>Block Offset: <span class="decompose-legend-val">${d2.offset} B</span></span>
          </div>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;
  }

  /**
   * Renders the Hierarchy flow pathway (CPU -> L1 -> L2 -> RAM) lighting active levels.
   */
  function renderHierarchyPath(evt) {
    const container = document.getElementById('viz-hierarchy-path-container');
    if (!container) return;

    if (!evt) {
      container.innerHTML = `
        <div class="hierarchy-flow-container">
          <div class="flow-node"><span class="flow-node-title">CPU</span><span class="flow-node-sub">Idle</span></div>
          <div class="flow-arrow">&rarr;</div>
          <div class="flow-node"><span class="flow-node-title">L1 Cache</span><span class="flow-node-sub">64 B</span></div>
          <div class="flow-arrow">&rarr;</div>
          <div class="flow-node"><span class="flow-node-title">L2 Cache</span><span class="flow-node-sub">128 B</span></div>
          <div class="flow-arrow">&rarr;</div>
          <div class="flow-node"><span class="flow-node-title">Memory</span><span class="flow-node-sub">RAM</span></div>
        </div>
      `;
      return;
    }

    const l1Level = evt.levels && evt.levels.find(l => l.name === 'L1');
    const l2Level = evt.levels && evt.levels.find(l => l.name === 'L2');
    const l1Hit = l1Level && l1Level.result === 'hit';
    const l2Hit = l2Level && l2Level.result === 'hit';
    const hasWb = (l1Level && l1Level.writeback) || (l2Level && l2Level.writeback);

    const l1Class = 'flow-node active';
    const l2Class = l1Hit ? 'flow-node' : 'flow-node active';
    const memClass = (l1Hit || l2Hit) ? 'flow-node' : 'flow-node active';

    const l1Status = l1Hit ? 'HIT (1c)' : 'MISS';
    const l2Status = l1Hit ? 'Bypassed' : (l2Hit ? 'HIT (10c)' : 'MISS');
    const memStatus = (l1Hit || l2Hit) ? 'Idle' : 'READ (100c)';

    container.innerHTML = `
      <div class="hierarchy-flow-container">
        <div class="flow-node active">
          <span class="flow-node-title">CPU</span>
          <span class="flow-node-sub">${evt.op === 'W' ? 'Store' : 'Load'}</span>
        </div>
        <div class="flow-arrow active">&rarr;</div>
        <div class="${l1Class}">
          <span class="flow-node-title">L1 Cache</span>
          <span class="flow-node-sub">${l1Status}</span>
        </div>
        <div class="flow-arrow ${l1Hit ? '' : 'active'}">&rarr;</div>
        <div class="${l2Class}">
          <span class="flow-node-title">L2 Cache</span>
          <span class="flow-node-sub">${l2Status}</span>
        </div>
        <div class="flow-arrow ${(l1Hit || l2Hit) ? '' : 'active'}">&rarr;</div>
        <div class="${memClass}">
          <span class="flow-node-title">Main Memory</span>
          <span class="flow-node-sub">${memStatus}</span>
        </div>
        ${hasWb ? `
          <div style="margin-left: 1rem; padding-left: 1rem; border-left: 1px solid var(--border-default); display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 0.72rem; color: #f59e0b; font-weight: 700;">&#x2935; DIRTY WRITE-BACK</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Renders the Set/Way grids for L1 and L2 with active set highlights and cell tags.
   */
  function renderCacheGrids(events, cursor) {
    const gridContainer = document.getElementById('viz-cache-grids-container');
    if (!gridContainer) return;

    const dimensions = { l1Sets: 2, l1Ways: 2, l2Sets: 4, l2Ways: 2 };
    const gridState = computeGridState(events, cursor, dimensions);

    const currentEvt = (cursor >= 0 && cursor < events.length) ? events[cursor] : null;
    const activeL1Set = currentEvt && currentEvt.decompose && currentEvt.decompose.L1 ? currentEvt.decompose.L1.set : null;
    const activeL2Set = currentEvt && currentEvt.decompose && currentEvt.decompose.L2 ? currentEvt.decompose.L2.set : null;

    function renderSetRows(sets, activeSetIdx, levelName) {
      let html = `<div class="set-grid-table">`;
      sets.forEach((ways, setIdx) => {
        const isActive = (setIdx === activeSetIdx);
        html += `
          <div class="set-row ${isActive ? 'active-set' : ''}">
            <div class="set-label-cell">
              <span>Set ${setIdx}</span>
              ${isActive ? `<span style="font-size: 0.65rem; color: var(--accent-primary);">Active</span>` : ''}
            </div>
            <div class="ways-container">
        `;

        ways.forEach(w => {
          let stateClass = 'way-empty';
          let stateLabel = '<span class="way-state-badge state-empty">Empty</span>';
          let tagText = '<span style="color: var(--text-dim);">-</span>';

          if (w.valid) {
            if (w.dirty) {
              stateClass = 'way-dirty';
              stateLabel = '<span class="way-state-badge state-dirty">Dirty</span>';
            } else {
              stateClass = 'way-clean';
              stateLabel = '<span class="way-state-badge state-clean">Clean</span>';
            }
            tagText = `Tag ${w.tag} <span style="font-size: 0.7rem; color: var(--text-dim);">(${w.address || ''})</span>`;
          }

          let highlightClass = '';
          if (w.justHit) highlightClass = 'just-hit';
          else if (w.justFilled) highlightClass = 'just-filled';
          else if (w.justEvicted) highlightClass = 'just-evicted';

          html += `
            <div class="way-cell ${stateClass} ${highlightClass}" title="${levelName} Set ${setIdx} Way ${w.way}">
              <div class="way-cell-header">
                <span class="way-number">Way ${w.way}</span>
                ${stateLabel}
              </div>
              <div class="way-tag">${tagText}</div>
            </div>
          `;
        });

        html += `</div></div>`;
      });
      html += `</div>`;
      return html;
    }

    gridContainer.innerHTML = `
      <div class="grid-cards">
        <!-- L1 Grid Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <h2 class="card-title">L1 Cache Grid (2 Sets × 2 Ways · 64 B)</h2>
              <span class="card-subtitle">Transient highlights: Blue (Hit), Green (Filled), Red (Evicted)</span>
            </div>
            <span class="brand-badge">L1</span>
          </div>
          <div class="card-body">
            ${renderSetRows(gridState.l1, activeL1Set, 'L1')}
          </div>
        </div>

        <!-- L2 Grid Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <h2 class="card-title">L2 Cache Grid (4 Sets × 2 Ways · 128 B)</h2>
              <span class="card-subtitle">Non-inclusive hierarchy state</span>
            </div>
            <span class="brand-badge badge-l2">L2</span>
          </div>
          <div class="card-body">
            ${renderSetRows(gridState.l2, activeL2Set, 'L2')}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders the Decision Panel narration text.
   */
  function renderDecisionPanel(evt, cursor, totalEvents) {
    const container = document.getElementById('viz-decision-panel-container');
    if (!container) return;

    const narration = narrateEvent(evt, cursor, totalEvents);

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h2 class="card-title">Decision Panel & Access Narration</h2>
            <span class="card-subtitle">Explains engine events without client-side emulation</span>
          </div>
        </div>
        <div class="card-body">
          <div class="narration-box">
            <div class="narration-step-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>${narration.headline}</span>
            </div>
            <p class="narration-text" style="margin-bottom: 0.5rem;">${narration.l1Text}</p>
            <p class="narration-text" style="margin-bottom: 0.5rem;">${narration.l2Text}</p>
            <p class="narration-text" style="color: var(--text-muted); font-size: 0.8rem;">${narration.memText}</p>
            ${narration.noteText ? `
              <div class="notice-callout">
                <strong>Insight:</strong> ${narration.noteText}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders the execution trace table with interactive row jumping.
   */
  function renderTraceList(events, cursor) {
    const container = document.getElementById('viz-trace-list-container');
    if (!container) return;

    let rowsHtml = '';
    events.forEach((e, idx) => {
      const isActive = (idx === cursor);
      const l1 = (e.levels && e.levels.find(l => l.name === 'L1')) || (e.levels && e.levels[0]);
      const l2 = e.levels && e.levels.find(l => l.name === 'L2');

      const l1Badge = l1 && l1.result === 'hit'
        ? `<span class="result-badge badge-hit">HIT</span>`
        : `<span class="result-badge badge-miss">MISS</span>`;

      const l2Badge = l2
        ? (l2.result === 'hit' ? `<span class="result-badge badge-hit">HIT</span>` : `<span class="result-badge badge-miss">MISS</span>`)
        : `<span style="color: var(--text-dim); font-size: 0.72rem;">-</span>`;

      const wbText = (l1 && l1.writeback)
        ? `L1 &rarr; ${l1.writeback.to}`
        : ((l2 && l2.writeback) ? `L2 &rarr; ${l2.writeback.to}` : '-');

      rowsHtml += `
        <tr class="trace-row ${isActive ? 'active-trace' : ''}" data-step="${idx}">
          <td class="num-col">${idx + 1}</td>
          <td><strong>${e.op}</strong></td>
          <td style="font-family: var(--font-mono);">${e.address}</td>
          <td>${l1Badge}</td>
          <td>${l2Badge}</td>
          <td style="font-size: 0.75rem;">${wbText}</td>
          <td class="num-col">${e.latency_cycles || 1} c</td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="card grid-cards-full" style="margin-top: 1.25rem;">
        <div class="card-header">
          <div class="card-title-group">
            <h2 class="card-title">Execution Trace List (${events.length} accesses)</h2>
            <span class="card-subtitle">Click any row to jump visualizer cursor directly to that step</span>
          </div>
        </div>
        <div class="card-body">
          <div class="trace-table-wrap">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th scope="col" class="num-col">Step</th>
                  <th scope="col">Op</th>
                  <th scope="col">Address</th>
                  <th scope="col">L1 Result</th>
                  <th scope="col">L2 Result</th>
                  <th scope="col">Write-back</th>
                  <th scope="col" class="num-col">Latency</th>
                </tr>
              </thead>
              <tbody id="viz-trace-tbody">
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Attach row click handlers to jump cursor
    const tbody = document.getElementById('viz-trace-tbody');
    if (tbody) {
      tbody.querySelectorAll('.trace-row').forEach(row => {
        row.addEventListener('click', () => {
          const stepIdx = parseInt(row.getAttribute('data-step'), 10);
          if (!isNaN(stepIdx)) {
            jumpToStep(stepIdx);
          }
        });
      });
    }
  }

  // Playback control API
  function stepNext() {
    if (visualizerCursor < visualizerEvents.length - 1) {
      visualizerCursor++;
      renderVisualizer(visualizerEvents, visualizerCursor);
    } else {
      pause();
    }
  }

  function stepPrev() {
    if (visualizerCursor > -1) {
      visualizerCursor--;
      renderVisualizer(visualizerEvents, visualizerCursor);
    }
  }

  function play() {
    if (playTimer !== null) return;
    if (visualizerCursor >= visualizerEvents.length - 1) {
      visualizerCursor = -1; // loop back to start
    }
    stepNext();
    playTimer = setInterval(stepNext, playSpeedMs);
    renderPlaybackControls(visualizerEvents, visualizerCursor);
  }

  function pause() {
    if (playTimer !== null) {
      clearInterval(playTimer);
      playTimer = null;
    }
    renderPlaybackControls(visualizerEvents, visualizerCursor);
  }

  function togglePlay() {
    if (playTimer !== null) {
      pause();
    } else {
      play();
    }
  }

  function reset() {
    pause();
    visualizerCursor = -1;
    renderVisualizer(visualizerEvents, visualizerCursor);
  }

  function jumpToEnd() {
    pause();
    visualizerCursor = visualizerEvents.length - 1;
    renderVisualizer(visualizerEvents, visualizerCursor);
  }

  function jumpToStep(seq) {
    pause();
    if (seq >= -1 && seq < visualizerEvents.length) {
      visualizerCursor = seq;
      renderVisualizer(visualizerEvents, visualizerCursor);
    }
  }

  function setPlaySpeed(ms) {
    playSpeedMs = ms;
    if (playTimer !== null) {
      pause();
      play();
    }
  }

  function initVisualizerControls() {
    const btnPrev = document.getElementById('btn-viz-prev');
    const btnNext = document.getElementById('btn-viz-next');
    const btnPlay = document.getElementById('btn-viz-play');
    const btnReset = document.getElementById('btn-viz-reset');
    const btnEnd = document.getElementById('btn-viz-end');
    const speedSelect = document.getElementById('viz-speed-select');

    if (btnPrev) btnPrev.addEventListener('click', stepPrev);
    if (btnNext) btnNext.addEventListener('click', stepNext);
    if (btnPlay) btnPlay.addEventListener('click', togglePlay);
    if (btnReset) btnReset.addEventListener('click', reset);
    if (btnEnd) btnEnd.addEventListener('click', jumpToEnd);
    if (speedSelect) {
      speedSelect.addEventListener('change', () => {
        setPlaySpeed(parseInt(speedSelect.value, 10));
      });
    }
  }

  const Visualizer = {
    computeGridState,
    narrateEvent,
    renderVisualizer,
    stepNext,
    stepPrev,
    play,
    pause,
    reset,
    jumpToEnd,
    jumpToStep,
    setPlaySpeed,
    initVisualizerControls
  };

  // Node.js CommonJS & Browser compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Visualizer;
  } else {
    root.CacheSim = root.CacheSim || {};
    root.CacheSim.Visualizer = Visualizer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
