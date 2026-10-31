/**
 * analytics.js - CacheSim Performance Analytics Renderer (View 3)
 * Role 5: Frontend & Visualization
 *
 * Requirements:
 * - Offline-first, vanilla JavaScript, zero external libraries, zero CDN.
 * - Reads validated simulation data from window.CacheSimState.activeRun (ccsim.simulation/1).
 * - Exact values from simulation result; does not hardcode numbers.
 * - Displays unavailable metrics as 'n/a' with clear explanation, never as zero.
 * - Inline SVG charts with accessible labels and full data tables.
 * - Clearly identifies sample data vs. real output.
 */

(function(root) {
  'use strict';

  /**
   * Helper: Formats a rate (0.0 to 1.0) as percentage string, or 'n/a'.
   * @param {number|null|undefined} rate
   * @param {number} [decimals=2]
   * @returns {string}
   */
  function formatPercent(rate, decimals = 2) {
    if (rate === null || rate === undefined || typeof rate !== 'number' || isNaN(rate)) {
      return 'n/a';
    }
    return (rate * 100).toFixed(decimals) + '%';
  }

  /**
   * Computes display models for all KPI stat tiles from a validated simulation result.
   * Handles single-level (no L2), multi-level, and missing metric cases honestly.
   *
   * @param {object|null} runData
   * @returns {object}
   */
  function calculateKpis(runData) {
    if (!runData || typeof runData !== 'object' || !Array.isArray(runData.levels)) {
      return null;
    }

    const levels = runData.levels;
    const l1 = levels.find(l => l.name === 'L1') || levels[0] || null;
    const l2 = levels.find(l => l.name === 'L2') || null;

    // --- 1. L1 Miss Rate ---
    let l1Value = 'n/a';
    let l1Sub = 'No L1 cache configured';
    let l1IsNa = true;

    if (l1) {
      if (l1.accesses === 0) {
        l1Value = 'n/a';
        l1Sub = '0 L1 accesses recorded (zero-length trace)';
        l1IsNa = true;
      } else if (l1.miss_rate !== null && l1.miss_rate !== undefined) {
        l1Value = formatPercent(l1.miss_rate, 2);
        l1Sub = `${l1.misses.toLocaleString()} misses / ${l1.accesses.toLocaleString()} accesses`;
        l1IsNa = false;
      } else {
        l1Value = 'n/a';
        l1Sub = 'Miss rate not reported in payload';
        l1IsNa = true;
      }
    }

    // --- 2. L2 Miss Rate (Local & Global) ---
    let l2Value = 'n/a';
    let l2Sub = 'L2 cache disabled in configuration (--no-l2)';
    let l2IsNa = true;

    if (!l2) {
      l2Value = 'n/a';
      l2Sub = 'L2 disabled in configuration (--no-l2)';
      l2IsNa = true;
    } else if (l2.accesses === 0) {
      l2Value = 'n/a';
      l2Sub = '0 demand fetches reached L2 (100% L1 hits)';
      l2IsNa = true;
    } else {
      const localRate = l2.local_miss_rate !== undefined && l2.local_miss_rate !== null
        ? formatPercent(l2.local_miss_rate, 2)
        : (l2.miss_rate !== undefined && l2.miss_rate !== null ? formatPercent(l2.miss_rate, 2) : 'n/a');

      const globalRate = l2.global_miss_rate !== undefined && l2.global_miss_rate !== null
        ? formatPercent(l2.global_miss_rate, 2)
        : 'n/a';

      l2Value = `${localRate} local`;
      l2Sub = `Global: ${globalRate} · ${l2.misses.toLocaleString()} misses / ${l2.accesses.toLocaleString()} fetches`;
      l2IsNa = false;
    }

    // --- 3. AMAT (Average Memory Access Time) ---
    let amatValue = 'n/a';
    let amatSub = 'AMAT unavailable (latencies not configured or 0 accesses)';
    let amatIsNa = true;

    if (runData.amat_cycles !== null && runData.amat_cycles !== undefined && typeof runData.amat_cycles === 'number') {
      amatValue = `${Number(runData.amat_cycles).toFixed(2)} cycles`;
      amatSub = 'Additive serial latency model per access';
      amatIsNa = false;
    }

    // --- 4. Total Memory Traffic ---
    let memValue = 'n/a';
    let memSub = 'No memory traffic reported in payload';
    let memIsNa = true;

    if (runData.memory && typeof runData.memory === 'object') {
      const reads = typeof runData.memory.reads === 'number' ? runData.memory.reads : 0;
      const writes = typeof runData.memory.writes === 'number' ? runData.memory.writes : 0;
      const totalOps = reads + writes;

      memValue = `${totalOps.toLocaleString()} ops`;
      memSub = `${reads.toLocaleString()} reads · ${writes.toLocaleString()} writes`;
      memIsNa = false;
    }

    return {
      l1: { value: l1Value, sub: l1Sub, isNa: l1IsNa },
      l2: { value: l2Value, sub: l2Sub, isNa: l2IsNa },
      amat: { value: amatValue, sub: amatSub, isNa: amatIsNa },
      memory: { value: memValue, sub: memSub, isNa: memIsNa }
    };
  }

  /**
   * Generates inline SVG string for Cache Hierarchy Access Breakdown.
   * Renders grouped bars (Hits vs Misses) per cache level with axes, direct labels, and accessible tooltips.
   *
   * @param {Array<object>} levels
   * @returns {string} SVG markup
   */
  function generateHierarchySvg(levels) {
    if (!Array.isArray(levels) || levels.length === 0) {
      return '<div class="stat-na" style="padding: 2rem;">No cache levels available for visualization.</div>';
    }

    const svgWidth = 620;
    const svgHeight = 230;
    const padding = { top: 25, right: 30, bottom: 45, left: 55 };
    const chartWidth = svgWidth - padding.left - padding.right;
    const chartHeight = svgHeight - padding.top - padding.bottom;

    // Find maximum count for scaling
    let maxVal = 1;
    levels.forEach(lvl => {
      maxVal = Math.max(maxVal, lvl.hits || 0, lvl.misses || 0);
    });

    // Round maxVal up to nice tick
    const yMax = Math.ceil(maxVal * 1.15) || 1;

    // Generate horizontal grid lines
    const numYTicks = 4;
    let gridLinesSvg = '';
    for (let i = 0; i <= numYTicks; i++) {
      const val = Math.round((yMax / numYTicks) * i);
      const y = padding.top + chartHeight - (val / yMax) * chartHeight;
      gridLinesSvg += `
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}" stroke="#1f2c42" stroke-dasharray="3 3" />
        <text x="${padding.left - 8}" y="${y + 4}" fill="#64748b" font-size="11" text-anchor="end" font-family="ui-monospace, monospace">${val}</text>
      `;
    }

    // Generate grouped bars
    const groupWidth = chartWidth / levels.length;
    const barWidth = Math.min(36, groupWidth * 0.28);
    const barGap = 6;

    let barsSvg = '';
    levels.forEach((lvl, idx) => {
      const groupCenter = padding.left + groupWidth * idx + groupWidth / 2;
      const hitsX = groupCenter - barWidth - barGap / 2;
      const missesX = groupCenter + barGap / 2;

      const hitsVal = lvl.hits || 0;
      const missesVal = lvl.misses || 0;
      const hitsH = (hitsVal / yMax) * chartHeight;
      const missesH = (missesVal / yMax) * chartHeight;
      const hitsY = padding.top + chartHeight - hitsH;
      const missesY = padding.top + chartHeight - missesH;

      const hitRateStr = lvl.accesses ? ((hitsVal / lvl.accesses) * 100).toFixed(1) + '%' : '0%';
      const missRateStr = lvl.accesses ? ((missesVal / lvl.accesses) * 100).toFixed(1) + '%' : '0%';

      // Hits Bar
      barsSvg += `
        <g class="bar-group" tabindex="0">
          <rect x="${hitsX}" y="${hitsY}" width="${barWidth}" height="${Math.max(hitsH, 2)}" rx="3" fill="#38bdf8">
            <title>${lvl.name} Hits: ${hitsVal.toLocaleString()} (${hitRateStr})</title>
          </rect>
          <text x="${hitsX + barWidth / 2}" y="${hitsY - 5}" fill="#38bdf8" font-size="11" font-weight="600" text-anchor="middle" font-family="ui-monospace, monospace">${hitsVal}</text>
        </g>
      `;

      // Misses Bar
      barsSvg += `
        <g class="bar-group" tabindex="0">
          <rect x="${missesX}" y="${missesY}" width="${barWidth}" height="${Math.max(missesH, 2)}" rx="3" fill="#f59e0b">
            <title>${lvl.name} Misses: ${missesVal.toLocaleString()} (${missRateStr})</title>
          </rect>
          <text x="${missesX + barWidth / 2}" y="${missesY - 5}" fill="#f59e0b" font-size="11" font-weight="600" text-anchor="middle" font-family="ui-monospace, monospace">${missesVal}</text>
        </g>
      `;

      // Group Label on X-axis
      barsSvg += `
        <text x="${groupCenter}" y="${padding.top + chartHeight + 20}" fill="#f8fafc" font-size="12" font-weight="600" text-anchor="middle">${lvl.name} Cache</text>
        <text x="${groupCenter}" y="${padding.top + chartHeight + 35}" fill="#64748b" font-size="10" text-anchor="middle">${(lvl.accesses || 0).toLocaleString()} accesses</text>
      `;
    });

    return `
      <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cache Hierarchy Hits vs Misses Chart">
        <!-- Axes and Grid -->
        ${gridLinesSvg}
        <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="#334155" stroke-width="1.5" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#334155" stroke-width="1.5" />
        <!-- Data Bars -->
        ${barsSvg}
      </svg>
    `;
  }

  /**
   * Generates inline SVG string for Memory Traffic & Dirty Write-backs.
   *
   * @param {object} memory
   * @param {Array<object>} levels
   * @returns {string} SVG markup
   */
  function generateMemorySvg(memory, levels) {
    if (!memory || typeof memory !== 'object') {
      return '<div class="stat-na" style="padding: 2rem;">No memory metrics available for visualization.</div>';
    }

    const l1 = levels.find(l => l.name === 'L1') || levels[0] || null;
    const l2 = levels.find(l => l.name === 'L2') || null;

    const dataItems = [
      { name: 'Mem Reads', value: memory.reads || 0, color: '#38bdf8', desc: 'Main memory reads' },
      { name: 'Mem Writes', value: memory.writes || 0, color: '#f43f5e', desc: 'Main memory writes' },
      { name: 'L1 Evictions', value: l1 ? l1.evictions || 0 : 0, color: '#a855f7', desc: 'L1 total line evictions' }
    ];

    if (l2) {
      dataItems.push({
        name: 'L2 Evictions',
        value: l2.evictions || 0,
        color: '#ec4899',
        desc: 'L2 total line evictions'
      });
    }

    const svgWidth = 480;
    const svgHeight = 210;
    const padding = { top: 25, right: 25, bottom: 40, left: 50 };
    const chartWidth = svgWidth - padding.left - padding.right;
    const chartHeight = svgHeight - padding.top - padding.bottom;

    const maxVal = Math.max(...dataItems.map(d => d.value), 1);
    const yMax = Math.ceil(maxVal * 1.15) || 1;

    // Gridlines
    const numYTicks = 3;
    let gridLinesSvg = '';
    for (let i = 0; i <= numYTicks; i++) {
      const val = Math.round((yMax / numYTicks) * i);
      const y = padding.top + chartHeight - (val / yMax) * chartHeight;
      gridLinesSvg += `
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}" stroke="#1f2c42" stroke-dasharray="3 3" />
        <text x="${padding.left - 8}" y="${y + 4}" fill="#64748b" font-size="10" text-anchor="end" font-family="ui-monospace, monospace">${val}</text>
      `;
    }

    // Bars
    const colWidth = chartWidth / dataItems.length;
    const barWidth = Math.min(38, colWidth * 0.55);

    let barsSvg = '';
    dataItems.forEach((d, idx) => {
      const centerX = padding.left + colWidth * idx + colWidth / 2;
      const barX = centerX - barWidth / 2;
      const barH = (d.value / yMax) * chartHeight;
      const barY = padding.top + chartHeight - barH;

      barsSvg += `
        <g class="bar-group" tabindex="0">
          <rect x="${barX}" y="${barY}" width="${barWidth}" height="${Math.max(barH, 2)}" rx="3" fill="${d.color}">
            <title>${d.desc}: ${d.value.toLocaleString()}</title>
          </rect>
          <text x="${centerX}" y="${barY - 5}" fill="${d.color}" font-size="11" font-weight="600" text-anchor="middle" font-family="ui-monospace, monospace">${d.value}</text>
          <text x="${centerX}" y="${padding.top + chartHeight + 18}" fill="#94a3b8" font-size="11" font-weight="500" text-anchor="middle">${d.name}</text>
        </g>
      `;
    });

    return `
      <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Memory Traffic and Evictions Chart">
        ${gridLinesSvg}
        <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="#334155" stroke-width="1.5" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#334155" stroke-width="1.5" />
        ${barsSvg}
      </svg>
    `;
  }

  /**
   * Main rendering entry point for View 3: Performance Analytics.
   * Populates KPI stat tiles, inline SVGs, data tables, and invariant checks.
   *
   * @param {object|null} runData - Validated ccsim.simulation/1 payload from window.CacheSimState.activeRun.
   */
  function renderAnalytics(runData) {
    const emptyState = document.getElementById('analytics-empty-state');
    const content = document.getElementById('analytics-content');
    const sampleBanner = document.getElementById('analytics-sample-banner');

    if (!emptyState || !content) return;

    if (!runData || typeof runData !== 'object' || !Array.isArray(runData.levels)) {
      emptyState.hidden = false;
      emptyState.style.display = 'flex';
      content.hidden = true;
      content.style.display = 'none';
      if (sampleBanner) {
        sampleBanner.hidden = true;
        sampleBanner.style.display = 'none';
      }
      return;
    }

    // Hide empty state and show active analytics content
    emptyState.hidden = true;
    emptyState.style.display = 'none';
    content.hidden = false;
    content.style.display = 'block';

    // Check sample data provenance
    const isSample = runData._is_sample_data === true ||
      (typeof runData._comment === 'string' && runData._comment.toLowerCase().includes('sample'));

    if (sampleBanner) {
      sampleBanner.hidden = !isSample;
      sampleBanner.style.display = isSample ? 'flex' : 'none';
    }

    // --- 1. Populate KPI Stat Tiles ---
    const kpis = calculateKpis(runData);
    if (kpis) {
      // Tile 1: L1
      const l1ValEl = document.getElementById('kpi-l1-miss-rate');
      const l1SubEl = document.getElementById('kpi-l1-miss-sub');
      if (l1ValEl) {
        l1ValEl.innerHTML = kpis.l1.isNa ? `<span class="stat-na">n/a</span>` : kpis.l1.value;
      }
      if (l1SubEl) l1SubEl.textContent = kpis.l1.sub;

      // Tile 2: L2
      const l2ValEl = document.getElementById('kpi-l2-miss-rate');
      const l2SubEl = document.getElementById('kpi-l2-miss-sub');
      if (l2ValEl) {
        l2ValEl.innerHTML = kpis.l2.isNa ? `<span class="stat-na">n/a</span>` : kpis.l2.value;
      }
      if (l2SubEl) l2SubEl.textContent = kpis.l2.sub;

      // Tile 3: AMAT
      const amatValEl = document.getElementById('kpi-amat');
      const amatSubEl = document.getElementById('kpi-amat-sub');
      if (amatValEl) {
        amatValEl.innerHTML = kpis.amat.isNa ? `<span class="stat-na">n/a</span>` : kpis.amat.value;
      }
      if (amatSubEl) amatSubEl.textContent = kpis.amat.sub;

      // Tile 4: Memory Traffic
      const memValEl = document.getElementById('kpi-memory-traffic');
      const memSubEl = document.getElementById('kpi-memory-traffic-sub');
      if (memValEl) {
        memValEl.innerHTML = kpis.memory.isNa ? `<span class="stat-na">n/a</span>` : kpis.memory.value;
      }
      if (memSubEl) memSubEl.textContent = kpis.memory.sub;
    }

    // --- 2. Render SVG Charts ---
    const hierarchySvgWrap = document.getElementById('chart-hierarchy-svg');
    if (hierarchySvgWrap) {
      hierarchySvgWrap.innerHTML = generateHierarchySvg(runData.levels);
    }

    const memorySvgWrap = document.getElementById('chart-memory-svg');
    if (memorySvgWrap) {
      memorySvgWrap.innerHTML = generateMemorySvg(runData.memory, runData.levels);
    }

    // --- 3. Render Data Tables ---
    renderHierarchyTable(runData.levels);
    renderMemoryTable(runData.memory, runData.levels);

    // --- 4. Render AMAT & Invariants ---
    renderAmatAndInvariants(runData);
  }

  /**
   * Renders the accessible tabular data view for cache hierarchy levels.
   * @param {Array<object>} levels
   */
  function renderHierarchyTable(levels) {
    const tbody = document.getElementById('table-hierarchy-body');
    if (!tbody || !Array.isArray(levels)) return;

    let rowsHtml = '';
    const hasL2 = levels.some(l => l.name === 'L2');

    levels.forEach(lvl => {
      const accesses = lvl.accesses !== undefined ? lvl.accesses.toLocaleString() : 'n/a';
      const hits = lvl.hits !== undefined ? lvl.hits.toLocaleString() : 'n/a';
      const hitRate = lvl.accesses ? ((lvl.hits / lvl.accesses) * 100).toFixed(2) + '%' : 'n/a';
      const misses = lvl.misses !== undefined ? lvl.misses.toLocaleString() : 'n/a';
      const missRate = lvl.miss_rate !== null && lvl.miss_rate !== undefined
        ? (lvl.miss_rate * 100).toFixed(2) + '%'
        : 'n/a';
      const evictions = lvl.evictions !== undefined ? lvl.evictions.toLocaleString() : 'n/a';
      const writebacks = lvl.writebacks !== undefined ? lvl.writebacks.toLocaleString() : 'n/a';

      rowsHtml += `
        <tr>
          <th scope="row" class="row-name">${lvl.name} Cache</th>
          <td class="num-col">${accesses}</td>
          <td class="num-col">${hits}</td>
          <td class="num-col">${hitRate}</td>
          <td class="num-col">${misses}</td>
          <td class="num-col">${missRate}</td>
          <td class="num-col">${evictions}</td>
          <td class="num-col">${writebacks}</td>
        </tr>
      `;
    });

    if (!hasL2) {
      rowsHtml += `
        <tr>
          <th scope="row" class="row-name" style="color: var(--text-dim);">L2 Cache (Optional)</th>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
          <td class="num-col" style="color: var(--text-dim);">n/a</td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;
  }

  /**
   * Renders the accessible tabular data view for main memory and dirty traffic.
   * @param {object} memory
   * @param {Array<object>} levels
   */
  function renderMemoryTable(memory, levels) {
    const tbody = document.getElementById('table-memory-body');
    if (!tbody || !memory) return;

    const reads = memory.reads || 0;
    const writes = memory.writes || 0;
    const totalOps = Math.max(reads + writes, 1);

    const l1 = levels.find(l => l.name === 'L1') || levels[0] || null;
    const l2 = levels.find(l => l.name === 'L2') || null;

    let rowsHtml = `
      <tr>
        <th scope="row" class="row-name">Memory Reads</th>
        <td class="num-col">${reads.toLocaleString()}</td>
        <td class="num-col">${((reads / totalOps) * 100).toFixed(1)}%</td>
        <td>Demand cache line fetches from main DRAM</td>
      </tr>
      <tr>
        <th scope="row" class="row-name">Memory Writes</th>
        <td class="num-col">${writes.toLocaleString()}</td>
        <td class="num-col">${((writes / totalOps) * 100).toFixed(1)}%</td>
        <td>Dirty victim line write-backs committed to DRAM</td>
      </tr>
    `;

    if (l1 && l1.writebacks !== undefined) {
      rowsHtml += `
        <tr>
          <th scope="row" class="row-name">L1 Dirty Evictions</th>
          <td class="num-col">${l1.writebacks.toLocaleString()}</td>
          <td class="num-col">-</td>
          <td>Dirty victim lines sent downward from L1 cache</td>
        </tr>
      `;
    }

    if (l2 && l2.writebacks !== undefined) {
      rowsHtml += `
        <tr>
          <th scope="row" class="row-name">L2 Dirty Evictions</th>
          <td class="num-col">${l2.writebacks.toLocaleString()}</td>
          <td class="num-col">-</td>
          <td>Dirty victim lines evicted from L2 cache to memory</td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;
  }

  /**
   * Renders the AMAT decomposition and Technical Design §6 invariants verification checklist.
   * @param {object} runData
   */
  function renderAmatAndInvariants(runData) {
    const amatContainer = document.getElementById('amat-breakdown-container');
    const invariantsList = document.getElementById('invariants-checklist');

    if (amatContainer) {
      const amatVal = runData.amat_cycles !== null && runData.amat_cycles !== undefined
        ? Number(runData.amat_cycles).toFixed(2)
        : 'n/a';

      amatContainer.innerHTML = `
        <div style="margin-bottom: 0.75rem;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">Estimated AMAT Result</span>
            <span style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 700; color: #38bdf8;">${amatVal} ${amatVal !== 'n/a' ? 'cycles' : ''}</span>
          </div>
          <p style="font-size: 0.78rem; color: var(--text-dim); margin-top: 0.25rem; line-height: 1.4;">
            Calculated as exact uint64 sum <code>total_latency_cycles / L1.accesses</code> per TECHNICAL_DESIGN.md §6.
          </p>
        </div>
      `;
    }

    if (invariantsList) {
      const levels = runData.levels || [];
      const l1 = levels.find(l => l.name === 'L1') || levels[0] || null;
      const l2 = levels.find(l => l.name === 'L2') || null;
      const bottom = levels[levels.length - 1] || null;
      const memory = runData.memory || null;

      const invariantChecks = [];

      // Invariant 1: hits + misses == accesses
      if (l1) {
        const pass1 = l1.hits + l1.misses === l1.accesses;
        invariantChecks.push({
          label: `L1 Conservation: hits (${l1.hits}) + misses (${l1.misses}) == accesses (${l1.accesses})`,
          pass: pass1
        });
      }

      // Invariant 2: writebacks <= evictions <= misses (for L1)
      if (l1) {
        const pass2 = l1.writebacks <= l1.evictions && l1.evictions <= l1.misses;
        invariantChecks.push({
          label: `L1 Eviction Bound: writebacks (${l1.writebacks}) ≤ evictions (${l1.evictions}) ≤ misses (${l1.misses})`,
          pass: pass2
        });
      }

      // Invariant 3: L2.accesses == L1.misses (if L2 present)
      if (l1 && l2) {
        const pass3 = l2.accesses === l1.misses;
        invariantChecks.push({
          label: `Hierarchy Flow: L2.accesses (${l2.accesses}) == L1.misses (${l1.misses})`,
          pass: pass3
        });
      }

      // Invariant 4: Memory reads == bottom level misses
      if (bottom && memory) {
        const pass4 = memory.reads === bottom.misses;
        invariantChecks.push({
          label: `Memory Reads: memory.reads (${memory.reads}) == ${bottom.name}.misses (${bottom.misses})`,
          pass: pass4
        });
      }

      // Invariant 5: Memory writes == bottom level writebacks
      if (bottom && memory) {
        const pass5 = memory.writes === bottom.writebacks;
        invariantChecks.push({
          label: `Memory Writes: memory.writes (${memory.writes}) == ${bottom.name}.writebacks (${bottom.writebacks})`,
          pass: pass5
        });
      }

      let checklistHtml = '';
      invariantChecks.forEach(inv => {
        checklistHtml += `
          <li class="invariant-item">
            <span>${inv.label}</span>
            <span class="${inv.pass ? 'invariant-badge-pass' : 'invariant-badge-fail'}">
              ${inv.pass ? '✓ Verified' : '✗ Violation'}
            </span>
          </li>
        `;
      });

      invariantsList.innerHTML = checklistHtml;
    }
  }

  const Analytics = {
    calculateKpis,
    generateHierarchySvg,
    generateMemorySvg,
    renderAnalytics
  };

  // Node.js CommonJS & Browser compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Analytics;
  } else {
    root.CacheSim = root.CacheSim || {};
    root.CacheSim.Analytics = Analytics;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
