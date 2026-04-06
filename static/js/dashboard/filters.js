// Pulse Dashboard Filters Module
// Handles sender toggles, dual sliders, and date range logic

import * as State from './state.js';
import { _triggerCompute } from './worker_client.js';

export function renderSenderToggles() {
    const container = document.getElementById('pulse-senders-container');
    if (!container) return;
    container.innerHTML = '';

    // Add "All" toggle
    const allBtn = document.createElement('div');
    allBtn.className = 'pulse-sender-pill active';
    allBtn.id = 'pulse-toggle-all';
    allBtn.innerHTML = `<span>👥 Everyone</span>`;
    allBtn.onclick = () => {
        State.setPulseCurrentSenders(new Set(State.allSendersList.map(s => s.name)));
        updateSenderTogglesUI();
        recomputeAndRender();
    };
    container.appendChild(allBtn);

    const limit = State.showingAllSenders ? State.allSendersList.length : Math.min(5, State.allSendersList.length);
    for (let i = 0; i < limit; i++) {
        const s = State.allSendersList[i];
        const el = document.createElement('div');
        el.className = 'pulse-sender-pill';
        el.innerHTML = `<img src="/avatar/${encodeURIComponent(s.name)}"> <span>${s.name}</span>`;
        el.onclick = () => {
            let current = State.pulseCurrentSenders;
            if (current.size === State.allSendersList.length) {
                current.clear();
            }
            if (current.has(s.name)) {
                current.delete(s.name);
                if (current.size === 0) State.setPulseCurrentSenders(new Set(State.allSendersList.map(sd => sd.name)));
            } else {
                current.add(s.name);
            }
            updateSenderTogglesUI();
            // Debounce rapid clicks so we don't re-compute on every single pill toggle
            clearTimeout(State.senderDebounceTimer);
            State.setSenderDebounceTimer(setTimeout(() => recomputeAndRender(), 150));
        };
        el.dataset.name = s.name;
        container.appendChild(el);
    }

    if (!State.showingAllSenders && State.allSendersList.length > 5) {
        const moreBtn = document.createElement('div');
        moreBtn.className = 'pulse-sender-pill pulse-more-btn';
        moreBtn.innerHTML = `<span>+${State.allSendersList.length - 5} More...</span>`;
        moreBtn.style.opacity = '1';
        moreBtn.onclick = () => {
            State.setShowingAllSenders(true);
            renderSenderToggles();
        };
        container.appendChild(moreBtn);
    } else if (State.showingAllSenders && State.allSendersList.length > 5) {
        const lessBtn = document.createElement('div');
        lessBtn.className = 'pulse-sender-pill pulse-more-btn';
        lessBtn.innerHTML = `<span>Show Less</span>`;
        lessBtn.style.opacity = '1';
        lessBtn.onclick = () => {
            State.setShowingAllSenders(false);
            renderSenderToggles();
        };
        container.appendChild(lessBtn);
    }

    updateSenderTogglesUI();
}

export function updateSenderTogglesUI() {
    const isAll = State.pulseCurrentSenders.size === State.allSendersList.length;
    const toggleAllBtn = document.getElementById('pulse-toggle-all');
    if (toggleAllBtn) {
        toggleAllBtn.classList.toggle('active', isAll);
    }

    document.querySelectorAll('.pulse-sender-pill[data-name]').forEach(el => {
        el.classList.toggle('active', isAll || State.pulseCurrentSenders.has(el.dataset.name));
    });
}

function recomputeAndRender() {
    if (!State.pulseRawMessages) return;
    _triggerCompute();
}

export function initSlider(minDate, maxDate) {
    const firstYear = parseInt(minDate.substring(0, 4));
    const firstMonth = parseInt(minDate.substring(5, 7));
    const lastYear = parseInt(maxDate.substring(0, 4));
    const lastMonth = parseInt(maxDate.substring(5, 7));

    const months = [];
    for (let y = firstYear; y <= lastYear; y++) {
        const startM = (y === firstYear) ? firstMonth : 1;
        const endM = (y === lastYear) ? lastMonth : 12;
        for (let m = startM; m <= endM; m++) {
            const monthStr = m.toString().padStart(2, '0');
            const lastDay = new Date(y, m, 0).getDate();
            months.push({
                label: `${y}-${monthStr}`,
                val: `${y}-${monthStr}`,
                start: `${y}-${monthStr}-01`,
                end: `${y}-${monthStr}-${lastDay}`
            });
        }
    }
    State.setPulseMonths(months);

    const startSlider = document.getElementById('pulse-month-start');
    const endSlider = document.getElementById('pulse-month-end');

    if (startSlider && endSlider) {
        const maxIdx = months.length - 1;
        startSlider.max = maxIdx;
        endSlider.max = maxIdx;
        startSlider.value = 0;
        endSlider.value = maxIdx;

        updateDualSliderUI();

        const onInput = () => {
            updateDualSliderUI();
            if (State.isProgrammaticDateChange) return;

            const vS = parseInt(startSlider.value);
            const vE = parseInt(endSlider.value);

            State.setIsProgrammaticDateChange(true);
            const startDateEl = document.getElementById('pulse-start-date');
            const endDateEl = document.getElementById('pulse-end-date');
            if (startDateEl) startDateEl.value = months[vS].start;
            if (endDateEl) endDateEl.value = months[vE].end;
            State.setIsProgrammaticDateChange(false);

            syncPulseDateDisplay();
        };

        startSlider.addEventListener('input', onInput);
        endSlider.addEventListener('input', onInput);
    }
}

export function updateDualSliderUI() {
    const sStart = document.getElementById('pulse-month-start');
    const sEnd = document.getElementById('pulse-month-end');
    const fill = document.getElementById('pulse-slider-range-fill');
    const lblStart = document.getElementById('pulse-slider-label-start');
    const lblEnd = document.getElementById('pulse-slider-label-end');

    if (!sStart || !sEnd) return;

    let valStart = parseInt(sStart.value);
    let valEnd = parseInt(sEnd.value);

    // Prevent crossing
    if (valStart > valEnd) {
        if (document.activeElement === sStart) {
            sStart.value = valEnd;
            valStart = valEnd;
        } else {
            sEnd.value = valStart;
            valEnd = valStart;
        }
    }

    const max = parseInt(sStart.max);
    if (max > 0) {
        const pctStart = (valStart / max) * 100;
        const pctEnd = (valEnd / max) * 100;
        if (fill) {
            fill.style.left = `${pctStart}%`;
            fill.style.width = `${pctEnd - pctStart}%`;
        }
    }

    if (State.pulseMonths.length > 0) {
        if (lblStart) lblStart.textContent = State.pulseMonths[valStart].label;
        if (lblEnd) lblEnd.textContent = State.pulseMonths[valEnd].label;
    }
}

export function applyPulseDateFilter(fromSlider = false) {
    const startInput = document.getElementById('pulse-start-date');
    const endInput = document.getElementById('pulse-end-date');
    const start = startInput ? startInput.value : '';
    const end = endInput ? endInput.value : '';

    // Sync slider if user typed in precise date
    if (!fromSlider && State.pulseMonths.length > 0 && start && end) {
        const startMonth = start.substring(0, 7);
        const endMonth = end.substring(0, 7);

        let matchStartIdx = State.pulseMonths.findIndex(m => m.val === startMonth);
        let matchEndIdx = State.pulseMonths.findIndex(m => m.val === endMonth);

        State.setIsProgrammaticDateChange(true);
        const startS = document.getElementById('pulse-month-start');
        const endS = document.getElementById('pulse-month-end');
        if (matchStartIdx >= 0 && startS) startS.value = matchStartIdx;
        if (matchEndIdx >= 0 && endS) endS.value = matchEndIdx;
        State.setIsProgrammaticDateChange(false);
        updateDualSliderUI();
    }
    syncPulseDateDisplay();
    recomputeAndRender();
}

export function resetPulseDateFilter() {
    State.setIsProgrammaticDateChange(true);
    const startInput = document.getElementById('pulse-start-date');
    const endInput = document.getElementById('pulse-end-date');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    
    const startSlider = document.getElementById('pulse-month-start');
    const endSlider = document.getElementById('pulse-month-end');
    if (startSlider && endSlider) {
        startSlider.value = 0;
        endSlider.value = endSlider.max;
    }
    State.setIsProgrammaticDateChange(false);
    updateDualSliderUI();
    syncPulseDateDisplay();
    recomputeAndRender();
}

export function syncPulseDateDisplay() {
    const sVal = document.getElementById('pulse-start-date')?.value;
    const eVal = document.getElementById('pulse-end-date')?.value;
    const sDisp = document.getElementById('pulse-start-date-disp');
    const eDisp = document.getElementById('pulse-end-date-disp');
    
    if (sDisp) sDisp.textContent = sVal || 'Not set';
    if (eDisp) eDisp.textContent = eVal || 'Not set';
}
