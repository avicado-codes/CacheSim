/**
 * app.js - CacheSim Web Frontend Application Controller
 * Role 5: Frontend & Visualization
 * Complete 4-view coordinator (Simulator, Visualizer, Analytics, Comparison)
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initMobileDrawer();
  initSimulatorForm();
  initSamplePresetsAndLoader();

  if (window.CacheSim && window.CacheSim.Visualizer) {
    window.CacheSim.Visualizer.initVisualizerControls();
  }
  if (window.CacheSim && window.CacheSim.Comparison) {
    window.CacheSim.Comparison.initComparisonControls();
  }
});

/**
 * 1. View Navigation (Tabs)
 */
function initNavigation() {
  const tabButtons = document.querySelectorAll('[role="tab"]');
  const tabPanels = document.querySelectorAll('[role="tabpanel"]');
  const breadcrumbCurrent = document.getElementById('breadcrumb-current');

  const viewTitles = {
    'view-simulator': 'Simulator',
    'view-visualizer': 'Cache Visualizer',
    'view-analytics': 'Performance Analytics',
    'view-comparison': 'Experiment Comparison'
  };

  function activateTab(tabBtn) {
    if (!tabBtn) return;
    const targetId = tabBtn.getAttribute('aria-controls');
    const targetPanel = document.getElementById(targetId);

    // Update tabs
    tabButtons.forEach(btn => {
      btn.setAttribute('aria-selected', 'false');
      btn.classList.remove('active');
    });
    tabBtn.setAttribute('aria-selected', 'true');
    tabBtn.classList.add('active');

    // Update panels
    tabPanels.forEach(panel => {
      panel.hidden = true;
      panel.style.display = 'none';
      panel.classList.remove('active');
    });

    if (targetPanel) {
      targetPanel.hidden = false;
      targetPanel.style.display = 'block';
      targetPanel.classList.add('active');
    }

    // Update breadcrumb and document title
    const title = viewTitles[targetId] || 'Simulator';
    if (breadcrumbCurrent) {
      breadcrumbCurrent.textContent = title;
    }
    document.title = `CacheSim · ${title}`;

    // Sync views on activation
    if (targetId === 'view-visualizer' && window.CacheSim && window.CacheSim.Visualizer) {
      const state = window.CacheSimState || {};
      window.CacheSim.Visualizer.renderVisualizer(state.activeEvents || [], state.cursor !== undefined ? state.cursor : -1);
    } else if (targetId === 'view-analytics' && window.CacheSim && window.CacheSim.Analytics) {
      window.CacheSim.Analytics.renderAnalytics(window.CacheSimState ? window.CacheSimState.activeRun : null);
    } else if (targetId === 'view-comparison' && window.CacheSim && window.CacheSim.Comparison) {
      const cmp = window.CacheSimState && window.CacheSimState.comparison ? window.CacheSimState.comparison : {};
      window.CacheSim.Comparison.renderComparison(cmp.runA || null, cmp.runB || null);
    }

    // Close mobile drawer if open
    closeMobileDrawer();
  }

  // Click handler
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn));
  });

  // Keyboard navigation for WAI-ARIA tablist pattern
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const tabs = Array.from(tabButtons);
      const currentIndex = tabs.indexOf(document.activeElement);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = tabs.length - 1;
      }

      if (nextIndex !== currentIndex) {
        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex]);
      }
    });
  }
}

/**
 * 2. Mobile Drawer Navigation
 */
let closeMobileDrawer = () => {};

function initMobileDrawer() {
  const sidebar = document.getElementById('app-sidebar');
  const toggleBtn = document.getElementById('menu-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar || !toggleBtn || !overlay) return;

  function openDrawer() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  closeMobileDrawer = closeDrawer;

  toggleBtn.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  overlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeDrawer();
      toggleBtn.focus();
    }
  });
}

/**
 * 3. Simulator View (Form & Live Address Split Calculations)
 */
function initSimulatorForm() {
  // L1 inputs
  const l1CapacitySelect = document.getElementById('l1-capacity');
  const l1LineSelect = document.getElementById('l1-line');
  const l1WaysSelect = document.getElementById('l1-ways');
  const l1PolicySelect = document.getElementById('l1-policy');
  const l1LatencyInput = document.getElementById('l1-latency');

  // L2 inputs
  const l2Toggle = document.getElementById('l2-toggle');
  const l2Inputs = document.querySelectorAll('.l2-input');
  const l2CapacitySelect = document.getElementById('l2-capacity');
  const l2WaysSelect = document.getElementById('l2-ways');
  const l2PolicySelect = document.getElementById('l2-policy');
  const l2LatencyInput = document.getElementById('l2-latency');

  // Hierarchy inputs
  const memLatencyInput = document.getElementById('mem-latency');
  const seedInput = document.getElementById('rand-seed');

  // Preview elements
  const l1SetsVal = document.getElementById('l1-sets-val');
  const tagBitsVal = document.getElementById('tag-bits-val');
  const indexBitsVal = document.getElementById('index-bits-val');
  const offsetBitsVal = document.getElementById('offset-bits-val');

  const barTag = document.getElementById('bar-tag');
  const barIndex = document.getElementById('bar-index');
  const barOffset = document.getElementById('bar-offset');

  // CLI command preview & copy button
  const cliCommandEl = document.getElementById('cli-command-preview');
  const copyCliBtn = document.getElementById('btn-copy-cli');
  const runSimBtn = document.getElementById('btn-run-simulation');
  const offlineNotice = document.getElementById('offline-modal-notice');

  // L2 toggle behavior
  if (l2Toggle) {
    l2Toggle.addEventListener('change', () => {
      const enabled = l2Toggle.checked;
      l2Inputs.forEach(input => {
        input.disabled = !enabled;
      });
      updateCalculations();
    });
  }

  // Update calculations when config changes
  const watchedInputs = [
    l1CapacitySelect, l1LineSelect, l1WaysSelect, l1PolicySelect, l1LatencyInput,
    l2Toggle, l2CapacitySelect, l2WaysSelect, l2PolicySelect, l2LatencyInput,
    memLatencyInput, seedInput
  ];

  watchedInputs.forEach(input => {
    if (input) {
      input.addEventListener('change', updateCalculations);
      input.addEventListener('input', updateCalculations);
    }
  });

  function updateCalculations() {
    if (!l1CapacitySelect || !l1LineSelect || !l1WaysSelect) return;

    const sizeBytes = parseInt(l1CapacitySelect.value, 10);
    const lineBytes = parseInt(l1LineSelect.value, 10);
    const ways = parseInt(l1WaysSelect.value, 10);

    // Derived values per TECHNICAL_DESIGN.md section 4
    const sets = sizeBytes / (lineBytes * ways);
    const offsetBits = Math.round(Math.log2(lineBytes));
    const indexBits = Math.round(Math.log2(sets));
    const tagBits = 64 - indexBits - offsetBits;

    if (l1SetsVal) l1SetsVal.textContent = sets.toLocaleString();
    if (tagBitsVal) tagBitsVal.textContent = `${tagBits} bits`;
    if (indexBitsVal) indexBitsVal.textContent = `${indexBits} bits`;
    if (offsetBitsVal) offsetBitsVal.textContent = `${offsetBits} bits`;

    // Update breakdown bar widths and text
    if (barTag && barIndex && barOffset) {
      barTag.style.flex = tagBits;
      barTag.textContent = `Tag [63:${indexBits + offsetBits}] (${tagBits}b)`;

      barIndex.style.flex = Math.max(indexBits, 4); // minimum width for legibility
      barIndex.textContent = `Index [${indexBits + offsetBits - 1}:${offsetBits}] (${indexBits}b)`;

      barOffset.style.flex = Math.max(offsetBits, 4);
      barOffset.textContent = `Offset [${offsetBits - 1}:0] (${offsetBits}b)`;
    }

    // Update CLI command preview string
    updateCliCommand();
  }

  function updateCliCommand() {
    if (!cliCommandEl) return;

    const l1SizeKiB = parseInt(l1CapacitySelect.value, 10) / 1024;
    const l1Line = l1LineSelect.value;
    const l1Ways = l1WaysSelect.value;
    const l1Policy = l1PolicySelect.value;
    const l1Latency = l1LatencyInput.value;

    let cmd = `ccsim simulate --trace <file.trace> --l1 size=${l1SizeKiB}KiB,line=${l1Line},ways=${l1Ways},policy=${l1Policy},latency=${l1Latency}`;

    if (l2Toggle && l2Toggle.checked) {
      const l2SizeKiB = parseInt(l2CapacitySelect.value, 10) / 1024;
      const l2Line = l1Line; // equal line size in v1
      const l2Ways = l2WaysSelect.value;
      const l2Policy = l2PolicySelect.value;
      const l2Latency = l2LatencyInput.value;
      cmd += ` --l2 size=${l2SizeKiB}KiB,line=${l2Line},ways=${l2Ways},policy=${l2Policy},latency=${l2Latency}`;
    } else {
      cmd += ` --no-l2`;
    }

    const memLatency = memLatencyInput ? memLatencyInput.value : 200;
    cmd += ` --memory-latency ${memLatency} --format json --output run.json`;

    cliCommandEl.textContent = cmd;
  }

  // Copy CLI command to clipboard
  if (copyCliBtn && cliCommandEl) {
    copyCliBtn.addEventListener('click', async () => {
      const textToCopy = cliCommandEl.textContent;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for older browsers / file:// protocol restrictions
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        const originalText = copyCliBtn.innerHTML;
        copyCliBtn.innerHTML = `<span>Copied!</span>`;
        setTimeout(() => {
          copyCliBtn.innerHTML = originalText;
        }, 1800);
      } catch (err) {
        console.warn('Clipboard copy failed:', err);
      }
    });
  }

  // Simulate button click alert for offline static mode
  if (runSimBtn && offlineNotice) {
    runSimBtn.addEventListener('click', () => {
      offlineNotice.hidden = false;
      offlineNotice.style.display = 'flex';
      offlineNotice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Initial calculation
  updateCalculations();
}

/**
 * 4. Sample Preset Selector & Offline File Loader
 * Validates sample fixtures and uploaded files against the documented schema.
 */
function initSamplePresetsAndLoader() {
  const presetSelect = document.getElementById('sample-preset-select');
  const activeRunPill = document.querySelector('.active-run-pill');
  const runDot = activeRunPill ? activeRunPill.querySelector('.run-dot') : null;
  const runText = activeRunPill ? activeRunPill.querySelector('span:not(.run-dot)') : null;
  const dropzone = document.getElementById('trace-dropzone');

  // Application state store for active simulation run and comparison
  window.CacheSimState = window.CacheSimState || {
    activeRun: null,
    activeEvents: [],
    cursor: -1,
    comparison: {
      runA: null,
      runB: null
    }
  };

  function setActiveRun(name, amatCycles, isSample = false) {
    if (!runText) return;
    const label = amatCycles !== undefined && amatCycles !== null
      ? `${name} (${isSample ? 'Sample · ' : ''}${amatCycles.toFixed(1)} AMAT)`
      : `${name} (${isSample ? 'Sample' : 'Loaded'})`;

    runText.textContent = label;
    if (runDot) {
      runDot.style.background = 'var(--color-primary-400, #38bdf8)';
      runDot.style.boxShadow = '0 0 8px rgba(56, 189, 248, 0.6)';
    }
  }

  function clearActiveRun() {
    window.CacheSimState.activeRun = null;
    window.CacheSimState.activeEvents = [];
    window.CacheSimState.cursor = -1;
    if (runText) runText.textContent = 'No active run';
    if (runDot) {
      runDot.style.background = '';
      runDot.style.boxShadow = '';
    }
  }

  function loadDemoB() {
    const fixtures = window.CacheSimFixtures;
    if (!fixtures || !fixtures.demoB) {
      console.error('[CacheSim] Fixtures module not loaded');
      return;
    }

    const parser = window.CacheSim && window.CacheSim.Parser;
    if (!parser) {
      console.error('[CacheSim] Parser module not loaded');
      return;
    }

    const validation = parser.validateSimulation(fixtures.demoB.simulation);
    if (validation.valid) {
      window.CacheSimState.activeRun = validation.data;
      window.CacheSimState.activeEvents = fixtures.demoB.events || [];
      window.CacheSimState.cursor = -1;

      setActiveRun('Demo B', validation.data.amat_cycles, true);

      // Render Analytics
      if (window.CacheSim && window.CacheSim.Analytics) {
        window.CacheSim.Analytics.renderAnalytics(validation.data);
      }

      // Render Visualizer
      if (window.CacheSim && window.CacheSim.Visualizer) {
        window.CacheSim.Visualizer.renderVisualizer(window.CacheSimState.activeEvents, -1);
      }

      console.log('[CacheSim] Loaded Demo B simulation and 10 events.');
    } else {
      console.error('[CacheSim] Demo B validation failed:', validation.errors);
    }
  }

  // Handle Preset Dropdown
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const selected = presetSelect.value;
      const fixtures = window.CacheSimFixtures;

      if (selected === 'demo_b') {
        loadDemoB();
      } else if (selected === 'demo_a' && fixtures && fixtures.demoA_twoway) {
        const parser = window.CacheSim && window.CacheSim.Parser;
        const validation = parser.validateSimulation(fixtures.demoA_twoway.simulation);
        if (validation.valid) {
          window.CacheSimState.activeRun = validation.data;
          window.CacheSimState.activeEvents = [];
          window.CacheSimState.cursor = -1;
          setActiveRun('Demo A (2-Way)', validation.data.amat_cycles, true);
          if (window.CacheSim && window.CacheSim.Analytics) {
            window.CacheSim.Analytics.renderAnalytics(validation.data);
          }
          if (window.CacheSim && window.CacheSim.Visualizer) {
            window.CacheSim.Visualizer.renderVisualizer([], -1);
          }
        }
      } else if (selected === 'demo_c' && fixtures && fixtures.demoC_fifo4) {
        const parser = window.CacheSim && window.CacheSim.Parser;
        const validation = parser.validateSimulation(fixtures.demoC_fifo4.simulation);
        if (validation.valid) {
          window.CacheSimState.activeRun = validation.data;
          window.CacheSimState.activeEvents = [];
          window.CacheSimState.cursor = -1;
          setActiveRun('Demo C (FIFO 4)', validation.data.amat_cycles, true);
          if (window.CacheSim && window.CacheSim.Analytics) {
            window.CacheSim.Analytics.renderAnalytics(validation.data);
          }
          if (window.CacheSim && window.CacheSim.Visualizer) {
            window.CacheSim.Visualizer.renderVisualizer([], -1);
          }
        }
      } else if (selected === 'none') {
        clearActiveRun();
        if (window.CacheSim && window.CacheSim.Analytics) {
          window.CacheSim.Analytics.renderAnalytics(null);
        }
        if (window.CacheSim && window.CacheSim.Visualizer) {
          window.CacheSim.Visualizer.renderVisualizer([], -1);
        }
      }
    });
  }

  // Handle Offline File Dropzone
  if (dropzone) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.ndjson,.trace';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });

    async function handleFile(file) {
      const parser = window.CacheSim && window.CacheSim.Parser;
      if (!parser) return;

      try {
        const content = await parser.readTextFile(file);
        const fileName = file.name || 'uploaded_run';

        // Check if JSON simulation
        if (fileName.endsWith('.json') || content.trim().startsWith('{')) {
          const simRes = parser.validateSimulation(content);
          if (simRes.valid) {
            window.CacheSimState.activeRun = simRes.data;
            setActiveRun(fileName, simRes.data.amat_cycles, false);
            if (window.CacheSim && window.CacheSim.Analytics) {
              window.CacheSim.Analytics.renderAnalytics(simRes.data);
            }
            console.log(`[CacheSim] Successfully parsed and validated ${fileName}:`, simRes.data);
            return;
          } else {
            console.warn(`[CacheSim] File ${fileName} is not a valid ccsim.simulation/1 document:`, simRes.errors);
          }
        }

        // Check if NDJSON event stream
        if (fileName.endsWith('.ndjson') || fileName.includes('events')) {
          const evtRes = parser.parseEventStream(content);
          if (evtRes.valid) {
            window.CacheSimState.activeEvents = evtRes.events;
            window.CacheSimState.cursor = -1;
            if (window.CacheSim && window.CacheSim.Visualizer) {
              window.CacheSim.Visualizer.renderVisualizer(evtRes.events, -1);
            }
            console.log(`[CacheSim] Successfully parsed ${evtRes.events.length} events from ${fileName}`);
            return;
          } else {
            console.warn(`[CacheSim] Event stream validation errors in ${fileName}:`, evtRes.errors);
          }
        }
      } catch (err) {
        console.error('[CacheSim] Failed to read offline file:', err);
      }
    }
  }

  // Handle Load Demo B button from View 3 Analytics Empty State
  const loadDemoBAnalyticsBtn = document.getElementById('btn-load-demo-b-analytics');
  if (loadDemoBAnalyticsBtn) {
    loadDemoBAnalyticsBtn.addEventListener('click', () => {
      if (presetSelect) {
        presetSelect.value = 'demo_b';
      }
      loadDemoB();
    });
  }

  // Handle Load Demo B button from View 2 Visualizer Empty State
  const loadDemoBEventsBtn = document.getElementById('btn-load-demo-b-events');
  if (loadDemoBEventsBtn) {
    loadDemoBEventsBtn.addEventListener('click', () => {
      if (presetSelect) {
        presetSelect.value = 'demo_b';
      }
      loadDemoB();
    });
  }

  // Initial sync of View 3 state with activeRun
  if (presetSelect && presetSelect.value === 'demo_b' && !window.CacheSimState.activeRun) {
    loadDemoB();
  } else if (window.CacheSim && window.CacheSim.Analytics) {
    window.CacheSim.Analytics.renderAnalytics(window.CacheSimState ? window.CacheSimState.activeRun : null);
  }
}
