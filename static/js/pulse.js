/**
 * Pulse Dashboard - Proxy Entry Point
 * This file serves as a documentation-rich map for the Pulse Dashboard.
 * It uses ES Modules to load specialized logic from the 'dashboard' directory.
 * 
 * --- MODULE MAP ---
 * - index.js: Core orchestration and initialization.
 * - state.js: Global dashboard state (data, charts, filters).
 * - api.js: Network requests and IndexedDB caching.
 * - ui_manager.js: Visibility, loaders, and card expansion.
 * - worker_client.js: Web Worker communication.
 * - filters.js: Sender toggles, dual sliders, and date filtering.
 * - tooltips.js: Global tooltip management.
 * - charts_renderer.js: Chart.js rendering for various metrics.
 * - dynamics_renderer.js: Chat Dynamics (Ghosting, Burst Ratio, etc.).
 * - consistency_renderer.js: Consistency Grid (Matrix & Stream).
 * - words_renderer.js: Signature and Custom Words analysis.
 */

import * as Dashboard from './dashboard/index.js';
import * as UIManager from './dashboard/ui_manager.js';
import * as Filters from './dashboard/filters.js';
import * as Dynamics from './dashboard/dynamics_renderer.js';
import * as Consistency from './dashboard/consistency_renderer.js';
import * as Words from './dashboard/words_renderer.js';

// --- Global Initialization ---
Dashboard.initializeDashboard();

// --- Explicit Window Exports for HTML Compatibility ---
// Dashboard Toggles & Basic Operations
window.togglePulseDashboard = UIManager.togglePulseDashboard;
window.sharePulseDashboard = Dashboard.sharePulseDashboard;

// Filters & Sliders
window.applyPulseDateFilter = Filters.applyPulseDateFilter;
window.resetPulseDateFilter = Filters.resetPulseDateFilter;
window.openPulseDatePicker = Dashboard.openPulseDatePicker;

// Search & Recompute
window.recomputeAndRender = Dashboard.recomputeAndRender;
window.recomputeSignatureWords = Dashboard.recomputeSignatureWords;

// Tab Switching & View Modes
window.switchDynamicsTab = Dynamics.switchDynamicsTab;
window.applyAndFetchDynamics = Dynamics.applyAndFetchDynamics;
window.switchCircadianTab = (tabId) => {
    const hourlyBtn = document.getElementById('circ-tab-hourly');
    const weeklyBtn = document.getElementById('circ-tab-weekly');
    const hourlyPanel = document.getElementById('circ-panel-hourly');
    const weeklyPanel = document.getElementById('circ-panel-weekly');

    if (hourlyBtn) hourlyBtn.classList.toggle('active', tabId === 'hourly');
    if (weeklyBtn) weeklyBtn.classList.toggle('active', tabId === 'weekly');
    
    if (hourlyPanel) hourlyPanel.style.display = tabId === 'hourly' ? 'block' : 'none';
    if (weeklyPanel) weeklyPanel.style.display = tabId === 'weekly' ? 'block' : 'none';
    
    // Trigger resize on charts
    import('./dashboard/state.js').then(State => {
        if (State.pulseCharts.circadian) State.pulseCharts.circadian.resize();
        if (State.pulseCharts.weekly) State.pulseCharts.weekly.resize();
    });
};

window.switchCgMode = Consistency.switchCgMode;
window.switchSigWordsTab = Words.switchSigWordsTab;
window.switchCwView = Words.switchCwView;
