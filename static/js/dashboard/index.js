// Pulse Dashboard Entry Point Module
// Orchestrates initialization and connects all sub-modules

import * as State from './state.js';
import * as API from './api.js';
import * as WorkerClient from './worker_client.js';
import * as UIManager from './ui_manager.js';
import * as Filters from './filters.js';
import * as Tooltips from './tooltips.js';
import * as Charts from './charts_renderer.js';
import * as Words from './words_renderer.js';

export async function initPulse() {
    await API.fetchSenders();
    State.setPulseCurrentSenders(new Set(State.allSendersList.slice(0, 5).map(s => s.name)));
    Filters.renderSenderToggles();
    initPulseSliders();
    await loadRawDataAndRender();
}

export async function loadRawDataAndRender() {
    UIManager.showPulseLoader();
    
    // Yield so loaders appear instantly
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // 0. Fetch db_sig from standard API to invalidate cache if DB changed
    const serverSig = await API.fetchDbSig();

    // 1. Try IndexedDB cache first
    const cached = await API.idbGet();
    
    let useCache = false;
    if (cached) {
        if (serverSig) {
            if (cached.db_sig === serverSig) useCache = true;
        } else {
            useCache = true;
        }
    }

    if (useCache) {
        State.setPulseRawMessages(cached.messages);
        State.setPulseRawMeta({ min_date: cached.min_date, max_date: cached.max_date });
        if (State.pulseMonths.length === 0 && State.pulseRawMeta.min_date && State.pulseRawMeta.max_date) {
            Filters.initSlider(State.pulseRawMeta.min_date, State.pulseRawMeta.max_date);
        }
        Filters.syncPulseDateDisplay();
        WorkerClient.loadDataIntoWorker(State.pulseRawMessages, State.pulseRawMeta);
        return;
    }

    // 2. Fetch from server
    try {
        const raw = await API.fetchRawPulseData();
        State.setPulseRawMessages(raw.messages);
        State.setPulseRawMeta({ min_date: raw.min_date, max_date: raw.max_date });

        if (State.pulseMonths.length === 0 && State.pulseRawMeta.min_date && State.pulseRawMeta.max_date) {
            Filters.initSlider(State.pulseRawMeta.min_date, State.pulseRawMeta.max_date);
        }
        Filters.syncPulseDateDisplay();
        WorkerClient.loadDataIntoWorker(State.pulseRawMessages, State.pulseRawMeta);
    } catch (e) {
        console.error("Error fetching raw pulse data", e);
        UIManager.hidePulseLoader();
    }
}

export function initPulseSliders() {
    const sliders = [
        { id: 'pulse-word-pct', label: 'pulse-word-pct-val', unit: '%' },
        { id: 'pulse-ice-gap', label: 'pulse-ice-val', unit: 'h' },
        { id: 'pulse-ghs-gap', label: 'pulse-ghs-val', unit: 'h' }
    ];
    
    sliders.forEach(config => {
        const slider = document.getElementById(config.id);
        if (slider) {
            syncPulseSlider(config.id, config.label, config.unit);
            slider.addEventListener('input', (e) => {
                e.stopPropagation();
                syncPulseSlider(config.id, config.label, config.unit);
            });
        }
    });
}

function syncPulseSlider(sliderId, labelId = null, unit = '') {
    const slider = document.getElementById(sliderId);
    if (!slider) return;
    if (labelId) {
        const label = document.getElementById(labelId);
        if (label) label.textContent = slider.value + unit;
    }
    const min = slider.min || 0;
    const max = slider.max || 100;
    const val = ((slider.value - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${val}%, rgba(255,255,255,0.1) ${val}%, rgba(255,255,255,0.1) 100%)`;
}

export function recomputeAndRender() {
    if (!State.pulseRawMessages) return;
    WorkerClient._triggerCompute();
}

export function recomputeSignatureWords() {
    if (!State.pulseRawMessages) return;
    WorkerClient._triggerCompute(['wordsCard']);
}

export function sharePulseDashboard() {
    const area = document.getElementById('pulse-dashboard');
    if (typeof html2canvas === 'function') {
        html2canvas(area, {
            backgroundColor: '#0f172a',
            scale: 2
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = 'ChatPulse_Wrapped.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        });
    }
}

export function openPulseDatePicker(anchor, type) {
    const inputId = type === 'start' ? 'pulse-start-date' : 'pulse-end-date';
    const input = document.getElementById(inputId);
    if (!input) return;

    if (typeof DatePicker !== 'undefined') {
        DatePicker.open({
            anchorEl: anchor,
            value: input.value,
            confirmLabel: 'Apply',
            showClear: true,
            onConfirm: (val) => {
                input.value = val || '';
                Filters.syncPulseDateDisplay();
            }
        });
    }
}

// Global initialization call
export function initializeDashboard() {
    WorkerClient.initWorker();
    Tooltips.initGlobalTooltips();
    Words.initCwInput();
}
