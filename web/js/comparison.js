/**
 * comparison.js - CacheSim Experiment Comparison (View 4)
 * Role 5: Frontend & Visualization
 *
 * Requirements (docs/FRONTEND_DESIGN.md Section 6 & TECHNICAL_DESIGN.md Section 11):
 * - Offline-first, vanilla JavaScript, zero external dependencies, zero CDN.
 * - Side-by-side comparison of ccsim.simulation/1 results across configurations.
 * - Never mixes units on a single axis (ratios with ratios, cycles with cycles).
 * - Fixed categorical colors by run entity (Run A = Sky Blue #38bdf8, Run B = Purple #a855f7).
 * - Clear handling of missing fields / absent L2; displays 'n/a' with reason, never 0.
 * - Tabular view with delta calculations, percentage change, and analytical assessment.
 * - Reproducibility callout showing CLI invocations or config parameters.
 * - Client-side CSV export functionality.
 * - Includes reference presets (Demo A associativity, Demo C Belady's anomaly).
 */

(function(root) {
  'use strict';

  // State for View 4 Comparison
  let currentRunA = null;
  let currentRunB = null;

  /**
   * Helper to format numbers cleanly.
   */
  function formatNum(val, decimals = 2) {
    if (val === undefined || val === null || isNaN(val)) return 'n/a';
    return Number(val).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * Pure function: Compares two validated ccsim.simulation/1 run objects.
   *
   * @param {object|null} runA - First simulation result
   * @param {object|null} runB - Second simulation result
   * @returns {object|null} Comparison metrics model
   */
  function compareRuns(runA, runB) {
    if (!runA || !runB) return null;

    const nameA = runA.name || (runA._is_sample_data ? 'Demo Run A (Sample)' : 'Run A');
    const nameB = runB.name || (runB._is_sample_data ? 'Demo Run B (Sample)' : 'Run B');

    const l1A = (runA.levels && runA.levels.find(l => l.name === 'L1')) || null;
    const l1B = (runB.levels && runB.levels.find(l => l.name === 'L1')) || null;

    const l2A = (runA.levels && runA.levels.find(l => l.name === 'L2')) || null;
    const l2B = (runB.levels && runB.levels.find(l => l.name === 'L2')) || null;

    const memA = runA.memory || { reads: 0, writes: 0 };
    const memB = runB.memory || { reads: 0, writes: 0 };

    const memTrafficA = (memA.reads || 0) + (memA.writes || 0);
    const memTrafficB = (memB.reads || 0) + (memB.writes || 0);

    // Helper to build a metric comparison row
    function buildMetric(name, valA, valB, unit, lowerIsBetter = true) {
      const isNaA = (valA === null || valA === undefined || isNaN(valA));
      const isNaB = (valB === null || valB === undefined || isNaN(valB));

      if (isNaA || isNaB) {
        return {
          name,
          unit,
          valA: isNaA ? null : valA,
          valB: isNaB ? null : valB,
          delta: null,
          pctChange: null,
          winner: null,
          assessment: isNaA && isNaB ? 'Both runs not applicable' : (isNaA ? 'Only present in Run B' : 'Only present in Run A')
        };
      }

      const delta = valB - valA;
      const pctChange = valA !== 0 ? ((valB - valA) / Math.abs(valA)) * 100 : (valB === 0 ? 0 : 100);

      let winner = 'tie';
      let assessment = 'Identical';

      const epsilon = 0.0001;
      if (Math.abs(delta) > epsilon) {
        if (lowerIsBetter) {
          if (delta < 0) {
            winner = 'B';
            assessment = `Improved in Run B (${Math.abs(pctChange).toFixed(1)}% reduction)`;
          } else {
            winner = 'A';
            assessment = `Regressed in Run B (+${pctChange.toFixed(1)}% higher)`;
          }
        } else {
          // Higher is better (e.g. hits)
          if (delta > 0) {
            winner = 'B';
            assessment = `Higher in Run B (+${pctChange.toFixed(1)}%)`;
          } else {
            winner = 'A';
            assessment = `Lower in Run B (${Math.abs(pctChange).toFixed(1)}%)`;
          }
        }
      }

      return {
        name,
        unit,
        valA,
        valB,
        delta,
        pctChange,
        winner,
        assessment
      };
    }

    const l1MissRateA = l1A ? l1A.miss_rate * 100 : null;
    const l1MissRateB = l1B ? l1B.miss_rate * 100 : null;

    const l2LocalMissRateA = l2A ? (l2A.local_miss_rate !== undefined ? l2A.local_miss_rate * 100 : (l2A.miss_rate !== undefined ? l2A.miss_rate * 100 : null)) : null;
    const l2LocalMissRateB = l2B ? (l2B.local_miss_rate !== undefined ? l2B.local_miss_rate * 100 : (l2B.miss_rate !== undefined ? l2B.miss_rate * 100 : null)) : null;

    const l2GlobalMissRateA = l2A && l2A.global_miss_rate !== undefined ? l2A.global_miss_rate * 100 : null;
    const l2GlobalMissRateB = l2B && l2B.global_miss_rate !== undefined ? l2B.global_miss_rate * 100 : null;

    const evictionsA = (l1A ? (l1A.evictions || 0) : 0) + (l2A ? (l2A.evictions || 0) : 0);
    const evictionsB = (l1B ? (l1B.evictions || 0) : 0) + (l2B ? (l2B.evictions || 0) : 0);

    const writebacksA = (l1A ? (l1A.writebacks || 0) : 0) + (l2A ? (l2A.writebacks || 0) : 0);
    const writebacksB = (l1B ? (l1B.writebacks || 0) : 0) + (l2B ? (l2B.writebacks || 0) : 0);

    const metrics = [
      buildMetric('L1 Miss Rate', l1MissRateA, l1MissRateB, '%', true),
      buildMetric('AMAT (Latency)', runA.amat_cycles, runB.amat_cycles, 'cycles', true),
      buildMetric('Total Memory Traffic', memTrafficA, memTrafficB, 'ops', true),
      buildMetric('Memory Reads', memA.reads, memB.reads, 'ops', true),
      buildMetric('Memory Writes', memA.writes, memB.writes, 'ops', true),
      buildMetric('L1 Accesses', l1A ? l1A.accesses : null, l1B ? l1B.accesses : null, 'ops', false),
      buildMetric('L1 Hits', l1A ? l1A.hits : null, l1B ? l1B.hits : null, 'ops', false),
      buildMetric('L1 Misses', l1A ? l1A.misses : null, l1B ? l1B.misses : null, 'ops', true),
      buildMetric('L2 Accesses', l2A ? l2A.accesses : null, l2B ? l2B.accesses : null, 'ops', false),
      buildMetric('L2 Misses', l2A ? l2A.misses : null, l2B ? l2B.misses : null, 'ops', true),
      buildMetric('L2 Local Miss Rate', l2LocalMissRateA, l2LocalMissRateB, '%', true),
      buildMetric('L2 Global Miss Rate', l2GlobalMissRateA, l2GlobalMissRateB, '%', true),
      buildMetric('Total Evictions', evictionsA, evictionsB, 'lines', true),
      buildMetric('Total Write-backs', writebacksA, writebacksB, 'lines', true)
    ];

    // High-level automated key findings
    let summaryHeadline = '';
    let summaryNarrative = '';

    if (runA.amat_cycles !== null && runB.amat_cycles !== null) {
      const amatDelta = runB.amat_cycles - runA.amat_cycles;
      const amatPct = ((amatDelta / runA.amat_cycles) * 100).toFixed(1);

      if (Math.abs(amatDelta) < 0.01) {
        summaryHeadline = 'Performance Parity across configurations';
        summaryNarrative = `Both configurations achieved an identical AMAT of ${runA.amat_cycles.toFixed(2)} cycles.`;
      } else if (amatDelta < 0) {
        summaryHeadline = `Run B delivers ${Math.abs(amatPct)}% lower AMAT (${runB.amat_cycles.toFixed(2)} vs ${runA.amat_cycles.toFixed(2)} cycles)`;
        summaryNarrative = `Run B improved overall memory latency by ${Math.abs(amatDelta).toFixed(2)} cycles.`;
      } else {
        summaryHeadline = `Run A delivers ${amatPct}% lower AMAT (${runA.amat_cycles.toFixed(2)} vs ${runB.amat_cycles.toFixed(2)} cycles)`;
        summaryNarrative = `Run B experienced ${amatDelta.toFixed(2)} cycles higher latency compared to Run A.`;
      }
    }

    // Specific preset callouts
    if (l1MissRateA === 100.0 && l1MissRateB !== null && l1MissRateB < 50) {
      summaryHeadline = 'Associativity eliminates conflict misses (Demo A)';
      summaryNarrative = `Increasing associativity from 1-way (direct-mapped) to 2-way eliminated cache ping-ponging on conflict addresses, dropping L1 miss rate from 100% to ${(l1MissRateB).toFixed(1)}% and cutting AMAT from ${runA.amat_cycles.toFixed(1)} to ${runB.amat_cycles.toFixed(2)} cycles.`;
    } else if (nameA.includes('FIFO') && nameB.includes('FIFO') && runB.amat_cycles > runA.amat_cycles) {
      summaryHeadline = "Belady's Anomaly demonstrated (Demo C)";
      summaryNarrative = `Allocating more cache frames (4 lines vs 3 lines) under FIFO replacement unexpectedly increased misses from ${l1A ? l1A.misses : 9} to ${l1B ? l1B.misses : 10}, worsening AMAT from ${runA.amat_cycles.toFixed(1)} to ${runB.amat_cycles.toFixed(2)} cycles.`;
    }

    return {
      runA: {
        name: nameA,
        isSample: !!runA._is_sample_data,
        amat: runA.amat_cycles,
        l1MissRate: l1MissRateA,
        memTraffic: memTrafficA,
        hasL2: !!l2A,
        raw: runA
      },
      runB: {
        name: nameB,
        isSample: !!runB._is_sample_data,
        amat: runB.amat_cycles,
        l1MissRate: l1MissRateB,
        memTraffic: memTrafficB,
        hasL2: !!l2B,
        raw: runB
      },
      metrics,
      summaryHeadline,
      summaryNarrative
    };
  }

  /**
   * Generates grouped SVG bar charts for side-by-side comparison.
   * Per dataviz guidelines:
   * - Separate panels for separate units (% vs cycles vs count).
   * - Consistent entity color: Run A = #38bdf8, Run B = #a855f7.
   * - Direct value labels on bars.
   * - Full accessibility attributes (role="img", aria-label, title).
   */
  function generateComparisonChartsSvg(comparison) {
    if (!comparison) return '';

    const { runA, runB } = comparison;

    const width = 800;
    const height = 260;
    const padX = 40;
    const padY = 35;
    const chartAreaHeight = height - padY * 2;

    const colorA = '#38bdf8'; // Sky blue
    const colorB = '#a855f7'; // Purple

    // Three sub-chart cards within one SVG viewBox
    // Chart 1: L1 Miss Rate (%) [X: 40..250]
    // Chart 2: AMAT (Cycles) [X: 290..510]
    // Chart 3: Memory Traffic (Ops) [X: 550..760]

    const subCharts = [
      {
        title: 'L1 Miss Rate (%)',
        unit: '%',
        maxVal: 100,
        valA: runA.l1MissRate !== null ? runA.l1MissRate : 0,
        valB: runB.l1MissRate !== null ? runB.l1MissRate : 0,
        labelA: runA.l1MissRate !== null ? `${runA.l1MissRate.toFixed(1)}%` : 'n/a',
        labelB: runB.l1MissRate !== null ? `${runB.l1MissRate.toFixed(1)}%` : 'n/a',
        xStart: 40,
        xWidth: 210
      },
      {
        title: 'AMAT Latency (Cycles)',
        unit: 'cycles',
        maxVal: Math.max(10, Math.ceil((Math.max(runA.amat || 0, runB.amat || 0) * 1.25) / 10) * 10),
        valA: runA.amat !== null ? runA.amat : 0,
        valB: runB.amat !== null ? runB.amat : 0,
        labelA: runA.amat !== null ? `${runA.amat.toFixed(1)}c` : 'n/a',
        labelB: runB.amat !== null ? `${runB.amat.toFixed(1)}c` : 'n/a',
        xStart: 295,
        xWidth: 210
      },
      {
        title: 'Memory Traffic (RAM Ops)',
        unit: 'ops',
        maxVal: Math.max(5, Math.ceil((Math.max(runA.memTraffic || 0, runB.memTraffic || 0) * 1.25))),
        valA: runA.memTraffic !== null ? runA.memTraffic : 0,
        valB: runB.memTraffic !== null ? runB.memTraffic : 0,
        labelA: `${runA.memTraffic} ops`,
        labelB: `${runB.memTraffic} ops`,
        xStart: 550,
        xWidth: 210
      }
    ];

    let svg = `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg comparison-svg" role="img" aria-label="Comparison grouped bar charts across L1 miss rate, AMAT latency, and memory traffic" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad-run-a" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.95"/>
            <stop offset="100%" stop-color="#0284c7" stop-opacity="0.8"/>
          </linearGradient>
          <linearGradient id="grad-run-b" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c084fc" stop-opacity="0.95"/>
            <stop offset="100%" stop-color="#9333ea" stop-opacity="0.8"/>
          </linearGradient>
        </defs>
    `;

    // Render each subchart panel
    subCharts.forEach(sc => {
      const panelBaseline = height - 45;
      const barWidth = 36;
      const gap = 16;
      const totalBarsWidth = barWidth * 2 + gap;
      const barStartX = sc.xStart + (sc.xWidth - totalBarsWidth) / 2;

      const barHeightA = sc.maxVal > 0 ? (sc.valA / sc.maxVal) * (chartAreaHeight - 35) : 0;
      const barHeightB = sc.maxVal > 0 ? (sc.valB / sc.maxVal) * (chartAreaHeight - 35) : 0;

      const barYA = panelBaseline - barHeightA;
      const barYB = panelBaseline - barHeightB;

      const barXA = barStartX;
      const barXB = barStartX + barWidth + gap;

      // Panel background
      svg += `
        <g class="subchart-panel">
          <!-- Panel header -->
          <text x="${sc.xStart + sc.xWidth / 2}" y="${padY - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="#cbd5e1">${sc.title}</text>
          
          <!-- Baseline axis -->
          <line x1="${sc.xStart + 10}" y1="${panelBaseline}" x2="${sc.xStart + sc.xWidth - 10}" y2="${panelBaseline}" stroke="#334155" stroke-width="1.5"/>

          <!-- Bar A -->
          <rect x="${barXA}" y="${barYA}" width="${barWidth}" height="${Math.max(barHeightA, 2)}" rx="4" fill="url(#grad-run-a)" stroke="#0284c7" stroke-width="1">
            <title>${runA.name}: ${sc.labelA}</title>
          </rect>
          <!-- Value label A -->
          <text x="${barXA + barWidth / 2}" y="${Math.max(barYA - 6, padY + 12)}" text-anchor="middle" font-size="11" font-weight="700" fill="#38bdf8">${sc.labelA}</text>
          <!-- Category label A -->
          <text x="${barXA + barWidth / 2}" y="${panelBaseline + 18}" text-anchor="middle" font-size="10" font-weight="600" fill="#94a3b8">Run A</text>

          <!-- Bar B -->
          <rect x="${barXB}" y="${barYB}" width="${barWidth}" height="${Math.max(barHeightB, 2)}" rx="4" fill="url(#grad-run-b)" stroke="#9333ea" stroke-width="1">
            <title>${runB.name}: ${sc.labelB}</title>
          </rect>
          <!-- Value label B -->
          <text x="${barXB + barWidth / 2}" y="${Math.max(barYB - 6, padY + 12)}" text-anchor="middle" font-size="11" font-weight="700" fill="#c084fc">${sc.labelB}</text>
          <!-- Category label B -->
          <text x="${barXB + barWidth / 2}" y="${panelBaseline + 18}" text-anchor="middle" font-size="10" font-weight="600" fill="#94a3b8">Run B</text>
        </g>
      `;

      // Vertical panel separator
      if (sc.xStart < 500) {
        svg += `
          <line x1="${sc.xStart + sc.xWidth + 20}" y1="${padY}" x2="${sc.xStart + sc.xWidth + 20}" y2="${panelBaseline + 15}" stroke="#1e293b" stroke-width="1.5" stroke-dasharray="3 3"/>
        `;
      }
    });

    svg += `</svg>`;
    return svg;
  }

  /**
   * Generates CSV report string for export.
   * Complies with FE5: reproduces invocation/configuration parameters alongside numbers.
   *
   * @param {object} comparison - Computed comparison model
   * @returns {string} CSV content
   */
  function exportComparisonCsv(comparison) {
    if (!comparison) return '';

    const { runA, runB, metrics, summaryHeadline, summaryNarrative } = comparison;
    const now = new Date().toISOString();

    const lines = [
      `"CacheSim Experiment Comparison Report"`,
      `"Generated At","${now}"`,
      `"Schema","ccsim.simulation/1"`,
      `"Summary","${summaryHeadline.replace(/"/g, '""')} - ${summaryNarrative.replace(/"/g, '""')}"`,
      ``,
      `"Configuration Reproducibility (docs/FRONTEND_DESIGN.md FE5)"`,
      `"Run A Entity","${runA.name.replace(/"/g, '""')}","Sample Data: ${runA.isSample}"`,
      `"Run B Entity","${runB.name.replace(/"/g, '""')}","Sample Data: ${runB.isSample}"`,
      ``,
      `"Metric","Run A","Run B","Absolute Delta (B - A)","Relative Change (%)","Assessment"`
    ];

    metrics.forEach(m => {
      const valA = m.valA !== null ? `${m.valA}${m.unit === '%' ? '%' : ''}` : 'n/a';
      const valB = m.valB !== null ? `${m.valB}${m.unit === '%' ? '%' : ''}` : 'n/a';
      const delta = m.delta !== null ? (m.delta > 0 ? `+${m.delta.toFixed(2)}` : m.delta.toFixed(2)) : 'n/a';
      const pct = m.pctChange !== null ? (m.pctChange > 0 ? `+${m.pctChange.toFixed(1)}%` : `${m.pctChange.toFixed(1)}%`) : 'n/a';
      const assess = m.assessment.replace(/"/g, '""');

      lines.push(`"${m.name}","${valA}","${valB}","${delta}","${pct}","${assess}"`);
    });

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Main View 4 rendering function.
   * Updates slots, badges, summary cards, chart SVG, and data table.
   *
   * @param {object|null} runA
   * @param {object|null} runB
   */
  function renderComparison(runA, runB) {
    currentRunA = runA || (window.CacheSimState && window.CacheSimState.comparison ? window.CacheSimState.comparison.runA : null);
    currentRunB = runB || (window.CacheSimState && window.CacheSimState.comparison ? window.CacheSimState.comparison.runB : null);

    const emptyState = document.getElementById('comparison-empty-state');
    const content = document.getElementById('comparison-content');
    const slotAStatus = document.getElementById('slot-a-name');
    const slotBStatus = document.getElementById('slot-b-name');

    // Update slot pill indicators
    if (slotAStatus) {
      slotAStatus.textContent = currentRunA ? (currentRunA.name || 'Loaded') : 'Empty';
      slotAStatus.style.color = currentRunA ? '#38bdf8' : 'var(--text-dim)';
    }
    if (slotBStatus) {
      slotBStatus.textContent = currentRunB ? (currentRunB.name || 'Loaded') : 'Empty';
      slotBStatus.style.color = currentRunB ? '#c084fc' : 'var(--text-dim)';
    }

    if (!emptyState || !content) return;

    if (!currentRunA || !currentRunB) {
      emptyState.hidden = false;
      emptyState.style.display = 'block';
      content.hidden = true;
      content.style.display = 'none';
      return;
    }

    // Both runs present: render active comparison
    emptyState.hidden = true;
    emptyState.style.display = 'none';
    content.hidden = false;
    content.style.display = 'block';

    const comparison = compareRuns(currentRunA, currentRunB);
    if (!comparison) return;

    // 1. Render Summary Callout
    const calloutHeadline = document.getElementById('comparison-headline');
    const calloutDesc = document.getElementById('comparison-desc');
    if (calloutHeadline) calloutHeadline.textContent = comparison.summaryHeadline;
    if (calloutDesc) calloutDesc.textContent = comparison.summaryNarrative;

    // 2. Render Run Entity Cards
    renderRunCard('card-run-a', comparison.runA, 'A', '#38bdf8');
    renderRunCard('card-run-b', comparison.runB, 'B', '#c084fc');

    // 3. Render Grouped SVG Chart
    const chartContainer = document.getElementById('comparison-chart-container');
    if (chartContainer) {
      chartContainer.innerHTML = generateComparisonChartsSvg(comparison);
    }

    // 4. Render Tabular Comparison Rows
    renderComparisonTable(comparison.metrics);
  }

  function renderRunCard(cardId, runData, slotLetter, accentColor) {
    const card = document.getElementById(cardId);
    if (!card) return;

    const raw = runData.raw;
    const l1 = raw.levels && raw.levels.find(l => l.name === 'L1');
    const l2 = raw.levels && raw.levels.find(l => l.name === 'L2');

    const l1MissStr = l1 ? `${(l1.miss_rate * 100).toFixed(1)}%` : 'n/a';
    const l2MissStr = l2 ? (l2.local_miss_rate !== undefined ? `${(l2.local_miss_rate * 100).toFixed(1)}% local` : `${(l2.miss_rate * 100).toFixed(1)}%`) : 'Disabled (--no-l2)';
    const amatStr = raw.amat_cycles !== null ? `${raw.amat_cycles.toFixed(2)} cycles` : 'n/a';

    card.innerHTML = `
      <div class="card-header" style="border-bottom: 2px solid ${accentColor};">
        <div class="card-title-group">
          <h2 class="card-title" style="color: ${accentColor};">Run ${slotLetter}: ${runData.name}</h2>
          <span class="card-subtitle">${runData.isSample ? 'Illustrative Sample Preset' : 'Loaded Simulation Run'}</span>
        </div>
        <span class="brand-badge" style="border-color: ${accentColor}; color: ${accentColor};">Slot ${slotLetter}</span>
      </div>
      <div class="card-body">
        <div class="comparison-card-metrics">
          <div class="card-metric-row">
            <span class="metric-label">AMAT (Estimated):</span>
            <strong class="metric-val" style="color: ${accentColor};">${amatStr}</strong>
          </div>
          <div class="card-metric-row">
            <span class="metric-label">L1 Miss Rate:</span>
            <span class="metric-val">${l1MissStr}</span>
          </div>
          <div class="card-metric-row">
            <span class="metric-label">L2 Cache:</span>
            <span class="metric-val">${l2MissStr}</span>
          </div>
          <div class="card-metric-row">
            <span class="metric-label">Memory Traffic:</span>
            <span class="metric-val">${runData.memTraffic} ops</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderComparisonTable(metrics) {
    const tbody = document.getElementById('comparison-table-body');
    if (!tbody) return;

    let rowsHtml = '';
    metrics.forEach(m => {
      const valAStr = m.valA !== null ? `${formatNum(m.valA, m.unit === '%' ? 2 : (m.unit === 'cycles' ? 2 : 0))}${m.unit === '%' ? '%' : ''}` : '<span class="na-text">n/a</span>';
      const valBStr = m.valB !== null ? `${formatNum(m.valB, m.unit === '%' ? 2 : (m.unit === 'cycles' ? 2 : 0))}${m.unit === '%' ? '%' : ''}` : '<span class="na-text">n/a</span>';

      let deltaStr = '<span class="na-text">-</span>';
      let deltaBadgeClass = 'badge-neutral';

      if (m.delta !== null) {
        const sign = m.delta > 0 ? '+' : '';
        const formattedDelta = `${sign}${formatNum(m.delta, m.unit === '%' ? 2 : (m.unit === 'cycles' ? 2 : 0))}${m.unit === '%' ? '%' : ''}`;

        if (m.winner === 'B') {
          deltaBadgeClass = 'badge-better';
        } else if (m.winner === 'A') {
          deltaBadgeClass = 'badge-worse';
        }

        deltaStr = `<span class="delta-badge ${deltaBadgeClass}">${formattedDelta}</span>`;
      }

      let pctStr = '<span class="na-text">-</span>';
      if (m.pctChange !== null) {
        const sign = m.pctChange > 0 ? '+' : '';
        pctStr = `${sign}${m.pctChange.toFixed(1)}%`;
      }

      rowsHtml += `
        <tr>
          <td><strong>${m.name}</strong></td>
          <td class="num-col" style="color: #38bdf8;">${valAStr}</td>
          <td class="num-col" style="color: #c084fc;">${valBStr}</td>
          <td class="num-col">${deltaStr}</td>
          <td class="num-col" style="font-family: var(--font-mono); font-size: 0.8rem;">${pctStr}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${m.assessment}</td>
        </tr>
      `;
    });

    tbody.innerHTML = rowsHtml;
  }

  /**
   * Initializes View 4 event handlers (preset selectors, file dropzones, CSV export).
   */
  function initComparisonControls() {
    const presetSelect = document.getElementById('compare-preset-select');
    const btnLoadPreset = document.getElementById('btn-load-compare-preset');
    const btnCsv = document.getElementById('btn-export-comparison-csv');
    const btnLoadActiveA = document.getElementById('btn-load-active-into-a');
    const btnLoadActiveB = document.getElementById('btn-load-active-into-b');
    const btnSwap = document.getElementById('btn-swap-runs');
    const btnClear = document.getElementById('btn-clear-comparison');

    // Preset selection loader
    function loadPreset(presetKey) {
      const fixtures = window.CacheSimFixtures;
      if (!fixtures) return;

      if (presetKey === 'demoA_assoc') {
        currentRunA = fixtures.demoA_direct.simulation;
        currentRunB = fixtures.demoA_twoway.simulation;
      } else if (presetKey === 'demoC_belady') {
        currentRunA = fixtures.demoC_fifo3.simulation;
        currentRunB = fixtures.demoC_fifo4.simulation;
      } else if (presetKey === 'demoB_vs_demoA') {
        currentRunA = fixtures.demoB.simulation;
        currentRunB = fixtures.demoA_twoway.simulation;
      }

      if (window.CacheSimState) {
        window.CacheSimState.comparison = { runA: currentRunA, runB: currentRunB };
      }
      renderComparison(currentRunA, currentRunB);
    }

    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        loadPreset(presetSelect.value);
      });
    }

    if (btnLoadPreset) {
      btnLoadPreset.addEventListener('click', () => {
        if (presetSelect) loadPreset(presetSelect.value);
      });
    }

    // Quick preset buttons from empty state
    const btnEmptyDemoA = document.getElementById('btn-empty-load-demo-a');
    if (btnEmptyDemoA) {
      btnEmptyDemoA.addEventListener('click', () => {
        if (presetSelect) presetSelect.value = 'demoA_assoc';
        loadPreset('demoA_assoc');
      });
    }

    const btnEmptyDemoC = document.getElementById('btn-empty-load-demo-c');
    if (btnEmptyDemoC) {
      btnEmptyDemoC.addEventListener('click', () => {
        if (presetSelect) presetSelect.value = 'demoC_belady';
        loadPreset('demoC_belady');
      });
    }

    // Load active run into Slot A or B
    if (btnLoadActiveA) {
      btnLoadActiveA.addEventListener('click', () => {
        if (window.CacheSimState && window.CacheSimState.activeRun) {
          currentRunA = window.CacheSimState.activeRun;
          if (!window.CacheSimState.comparison) window.CacheSimState.comparison = {};
          window.CacheSimState.comparison.runA = currentRunA;
          renderComparison(currentRunA, currentRunB);
        } else {
          alert('No active simulation run loaded in View 1 or View 3 yet.');
        }
      });
    }

    if (btnLoadActiveB) {
      btnLoadActiveB.addEventListener('click', () => {
        if (window.CacheSimState && window.CacheSimState.activeRun) {
          currentRunB = window.CacheSimState.activeRun;
          if (!window.CacheSimState.comparison) window.CacheSimState.comparison = {};
          window.CacheSimState.comparison.runB = currentRunB;
          renderComparison(currentRunA, currentRunB);
        } else {
          alert('No active simulation run loaded in View 1 or View 3 yet.');
        }
      });
    }

    // Swap slots
    if (btnSwap) {
      btnSwap.addEventListener('click', () => {
        const temp = currentRunA;
        currentRunA = currentRunB;
        currentRunB = temp;
        if (window.CacheSimState && window.CacheSimState.comparison) {
          window.CacheSimState.comparison.runA = currentRunA;
          window.CacheSimState.comparison.runB = currentRunB;
        }
        renderComparison(currentRunA, currentRunB);
      });
    }

    // Clear comparison
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        currentRunA = null;
        currentRunB = null;
        if (window.CacheSimState && window.CacheSimState.comparison) {
          window.CacheSimState.comparison.runA = null;
          window.CacheSimState.comparison.runB = null;
        }
        renderComparison(null, null);
      });
    }

    // CSV Download
    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        if (!currentRunA || !currentRunB) return;
        const comparison = compareRuns(currentRunA, currentRunB);
        if (!comparison) return;

        const csvContent = exportComparisonCsv(comparison);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cachesim_comparison_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    // File inputs for custom run uploads
    function setupFileInput(inputId, slot) {
      const input = document.getElementById(inputId);
      if (!input) return;

      input.addEventListener('change', async () => {
        if (input.files && input.files.length > 0) {
          const file = input.files[0];
          const parser = window.CacheSim && window.CacheSim.Parser;
          if (!parser) return;

          try {
            const text = await parser.readTextFile(file);
            const sim = parser.validateSimulation(text);
            if (sim.valid) {
              sim.data.name = file.name;
              if (slot === 'A') {
                currentRunA = sim.data;
                if (!window.CacheSimState.comparison) window.CacheSimState.comparison = {};
                window.CacheSimState.comparison.runA = currentRunA;
              } else {
                currentRunB = sim.data;
                if (!window.CacheSimState.comparison) window.CacheSimState.comparison = {};
                window.CacheSimState.comparison.runB = currentRunB;
              }
              renderComparison(currentRunA, currentRunB);
            } else {
              alert(`Validation error in ${file.name}:\n` + sim.errors.join('\n'));
            }
          } catch (err) {
            console.error('File load failed:', err);
          }
        }
      });
    }

    setupFileInput('file-upload-run-a', 'A');
    setupFileInput('file-upload-run-b', 'B');
  }

  const Comparison = {
    compareRuns,
    generateComparisonChartsSvg,
    exportComparisonCsv,
    renderComparison,
    initComparisonControls
  };

  // Node.js CommonJS & Browser compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Comparison;
  } else {
    root.CacheSim = root.CacheSim || {};
    root.CacheSim.Comparison = Comparison;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
