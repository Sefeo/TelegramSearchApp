// Chat Pulse Dashboard Logic

let pulseData = null;
let pulseCharts = {};
let pulseCurrentSenders = new Set();
let allSendersList = [];
let showingAllSenders = false;
let pulseMonths = [];
let isProgrammaticDateChange = false;

// Client-side data cache
let pulseRawMessages = null;  // All messages from /api/pulse_raw (fetched once)
let pulseRawMeta = null;      // min_date, max_date from the raw endpoint

// Web Worker for computation (never freezes the UI)
let pulseWorker = null;
let pulseWorkerLoaded = false;  // true once the worker has received the 'load' message
try {
    pulseWorker = new Worker('/static/js/pulse_worker.js?v=2');
    pulseWorker.onmessage = function (e) {
        const { type } = e.data;

        if (type === 'loaded') {
            // Worker confirmed it has the data — now we can compute
            pulseWorkerLoaded = true;
            _triggerCompute();
            return;
        }

        if (type === 'result') {
            pulseData = e.data.stats;
            // Auto-fill date placeholders
            const start = document.getElementById('pulse-start-date')?.value || '';
            const end = document.getElementById('pulse-end-date')?.value || '';
            if (!start && !end && pulseData.years && pulseData.years.length > 0) {
                document.getElementById('pulse-start-date').placeholder = pulseData.years[0] + '-01-01';
                document.getElementById('pulse-end-date').placeholder = pulseData.years[pulseData.years.length - 1] + '-12-31';
            }
            renderCharts();
            hidePulseLoader();
            return;
        }

        if (type === 'custom_words_result') {
            _cwResults = e.data.results;
            _cwLoading = false;
            renderCustomWords();
            return;
        }

        if (type === 'error') {
            console.error('Pulse worker error:', e.data.msg);
            hidePulseLoader();
        }
    };
    pulseWorker.onerror = function (err) {
        console.error('Pulse worker error:', err);
        hidePulseLoader();
    };
} catch (e) {
    console.warn('Web Worker not available', e);
}

// Debounce timer for sender toggles
let senderDebounceTimer = null;

// ============================================================
// IndexedDB cache helpers — no 5MB cap, survives browser close
// ============================================================
const IDB_NAME = 'PulseCache';
const IDB_STORE = 'raw';
const IDB_KEY = 'pulse_raw_v1';

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function idbGet() {
    try {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
            req.onsuccess = e => resolve(e.target.result || null);
            req.onerror = e => reject(e.target.error);
        });
    } catch { return null; }
}

async function idbSet(value) {
    try {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const req = tx.objectStore(IDB_STORE).put(value, IDB_KEY);
            req.onsuccess = () => resolve();
            req.onerror = e => reject(e.target.error);
        });
    } catch { /* ignore write failures */ }
}

// Send only small filter params to the worker — never the full message array
function _triggerCompute(targetCardIds = null) {
    if (!pulseWorker || !pulseWorkerLoaded) return;

    const startDate = document.getElementById('pulse-start-date')?.value || '';
    const endDate = document.getElementById('pulse-end-date')?.value || '';
    const phraseInput = document.getElementById('pulse-phrase-len');
    const maxNGram = phraseInput ? Math.max(1, Math.min(5, parseInt(phraseInput.value) || 1)) : 1;
    const minInput = document.getElementById('pulse-word-min');
    const minUsage = minInput ? parseInt(minInput.value) || 5 : 5;
    const maxInput = document.getElementById('pulse-word-max');
    const maxUsage = maxInput ? parseInt(maxInput.value) || 1000 : 1000;
    const pctInput = document.getElementById('pulse-word-pct');
    const targetPct = pctInput ? parseInt(pctInput.value) / 100.0 : 0.10;

    showPulseLoader(targetCardIds);
    
    // Yield to let the browser paint the loaders before blocking the thread
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            pulseWorker.postMessage({
                type: 'compute',
                senders: Array.from(pulseCurrentSenders),
                allSendersCount: allSendersList.length,
                startDate,
                endDate,
                maxNGram,
                minUsage,
                maxUsage,
                targetPct
            });
        });
    });
}

function showPulseLoader(targetCardIds = null) {
    let cards = [];
    if (targetCardIds && Array.isArray(targetCardIds) && targetCardIds.length > 0) {
        // Clear EVERY loading state first to isolate it
        document.querySelectorAll('.pulse-card.is-loading').forEach(c => c.classList.remove('is-loading'));
        
        targetCardIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) cards.push(el);
        });
    } else {
        cards = document.querySelectorAll('.pulse-card');
    }
    
    cards.forEach(card => {
        let loader = card.querySelector('.pulse-card-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.className = 'pulse-card-loader';
            loader.innerHTML = `
                <div class="pulse-spinner" style="border-top-color: #c084fc; width: 24px; height: 24px; border-width: 2px;"></div>
                <div style="margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500;">Calculating...</div>
            `;
            card.appendChild(loader);
        }
        card.classList.add('is-loading');
    });
}

function hidePulseLoader() {
    document.querySelectorAll('.pulse-card.is-loading').forEach(card => {
        card.classList.remove('is-loading');
    });
}

function togglePulseDashboard() {
    const dash = document.getElementById('pulse-dashboard');
    if (dash.classList.contains('pulse-hidden')) {
        dash.classList.remove('pulse-hidden');
        if (!pulseRawMessages) {
            initPulse();
        }
        initPulseSliders();
        injectExpandButtons();
    } else {
        dash.classList.add('pulse-hidden');
    }
}

function injectExpandButtons() {
    document.querySelectorAll('.pulse-card').forEach(card => {
        if (card.querySelector('.pulse-expand-btn')) return; // already injected
        const btn = document.createElement('button');
        btn.className = 'pulse-expand-btn';
        btn.title = 'Expand card';
        btn.innerHTML = '⛶';
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleCardExpand(card, btn);
        };
        card.appendChild(btn);
    });
}

function toggleCardExpand(card, btn) {
    const expanding = !card.classList.contains('pulse-expanded');
    card.classList.toggle('pulse-expanded');
    btn.innerHTML = expanding ? '⛌' : '⛶';
    btn.title = expanding ? 'Collapse card' : 'Expand card';

    // If expanding, scroll the card into view
    if (expanding) {
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }

    // Resize Chart.js canvases inside the card after transition
    setTimeout(() => {
        card.querySelectorAll('canvas').forEach(c => {
            const chartInstance = Chart.getChart(c);
            if (chartInstance) chartInstance.resize();
        });
    }, 400);
}

async function initPulse() {
    try {
        const res = await fetch('/api/senders');
        allSendersList = await res.json();
    } catch (e) { console.error("Error fetching senders", e); }

    pulseCurrentSenders = new Set(allSendersList.slice(0, 5).map(s => s.name));
    renderSenderToggles();
    initPulseSliders();
    await loadRawDataAndRender();
}

async function loadRawDataAndRender() {
    showPulseLoader();
    
    // Yield so loaders appear instantly
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // 0. Fetch db_sig from standard API to invalidate cache if DB changed
    let serverSig = null;
    try {
        const sigRes = await fetch('/api/db_sig');
        if (sigRes.ok) {
            const sigData = await sigRes.json();
            serverSig = sigData.db_sig;
        }
    } catch (e) {
        console.warn("Could not fetch db_sig", e);
    }

    // 1. Try IndexedDB cache first (no 5MB cap, survives browser close)
    const cached = await idbGet();
    
    let useCache = false;
    if (cached) {
        if (serverSig) {
            if (cached.db_sig === serverSig) useCache = true;
        } else {
            // Fallback if server db_sig endpoint failed purely due to network
            useCache = true;
        }
    }

    if (useCache) {
        pulseRawMessages = cached.messages;
        pulseRawMeta = { min_date: cached.min_date, max_date: cached.max_date };
        if (pulseMonths.length === 0 && pulseRawMeta.min_date && pulseRawMeta.max_date) {
            initSlider(pulseRawMeta.min_date, pulseRawMeta.max_date);
        }
        // Load messages into worker (once), then compute
        if (pulseWorker) {
            pulseWorkerLoaded = false;
            pulseWorker.postMessage({ type: 'load', messages: pulseRawMessages, meta: pulseRawMeta });
            // _triggerCompute() is called when worker responds with type:'loaded'
        }
        return;
    }

    // 2. Fetch from server
    try {
        const res = await fetch('/api/pulse_raw');
        const raw = await res.json();
        pulseRawMessages = raw.messages;
        pulseRawMeta = { min_date: raw.min_date, max_date: raw.max_date };

        // Persist to IndexedDB for instant re-opens (no quota issues)
        idbSet(raw); // fire-and-forget

        // Initialize slider
        if (pulseMonths.length === 0 && pulseRawMeta.min_date && pulseRawMeta.max_date) {
            initSlider(pulseRawMeta.min_date, pulseRawMeta.max_date);
        }

        // Load messages into worker (once), then compute
        if (pulseWorker) {
            pulseWorkerLoaded = false;
            pulseWorker.postMessage({ type: 'load', messages: pulseRawMessages, meta: pulseRawMeta });
            // _triggerCompute() is called when worker responds with type:'loaded'
        }
    } catch (e) {
        console.error("Error fetching raw pulse data", e);
        hidePulseLoader();
    }
}

function recomputeAndRender() {
    if (!pulseRawMessages) return;
    // By default, full re-render uses all cards
    _triggerCompute();
}

function recomputeSignatureWords() {
    if (!pulseRawMessages) return;
    // Force strict isolation: only wordsCard gets the loader
    _triggerCompute(['wordsCard']);
}

// filterMessages and computePulseStats are now in pulse_worker.js (Web Worker)

function initSlider(minDate, maxDate) {
    const firstYear = parseInt(minDate.substring(0, 4));
    const firstMonth = parseInt(minDate.substring(5, 7));
    const lastYear = parseInt(maxDate.substring(0, 4));
    const lastMonth = parseInt(maxDate.substring(5, 7));

    pulseMonths = [];
    for (let y = firstYear; y <= lastYear; y++) {
        const startM = (y === firstYear) ? firstMonth : 1;
        const endM = (y === lastYear) ? lastMonth : 12;
        for (let m = startM; m <= endM; m++) {
            const monthStr = m.toString().padStart(2, '0');
            const lastDay = new Date(y, m, 0).getDate();
            pulseMonths.push({
                label: `${y}-${monthStr}`,
                val: `${y}-${monthStr}`,
                start: `${y}-${monthStr}-01`,
                end: `${y}-${monthStr}-${lastDay}`
            });
        }
    }

    const startSlider = document.getElementById('pulse-month-start');
    const endSlider = document.getElementById('pulse-month-end');

    if (startSlider && endSlider) {
        const maxIdx = pulseMonths.length - 1;
        startSlider.max = maxIdx;
        endSlider.max = maxIdx;
        startSlider.value = 0;
        endSlider.value = maxIdx;

        updateDualSliderUI();

        // Debounced recompute for slider dragging
        let sliderDebounce = null;
        const onInput = () => {
            updateDualSliderUI();
            if (isProgrammaticDateChange) return;

            const vS = parseInt(startSlider.value);
            const vE = parseInt(endSlider.value);

            isProgrammaticDateChange = true;
            document.getElementById('pulse-start-date').value = pulseMonths[vS].start;
            document.getElementById('pulse-end-date').value = pulseMonths[vE].end;
            isProgrammaticDateChange = false;

            // Debounce the recompute to avoid recalculating on every pixel drag
            clearTimeout(sliderDebounce);
            sliderDebounce = setTimeout(() => recomputeAndRender(), 150);
        };

        startSlider.addEventListener('input', onInput);
        endSlider.addEventListener('input', onInput);
    }
}

function renderSenderToggles() {
    const container = document.getElementById('pulse-senders-container');
    container.innerHTML = '';

    // Add "All" toggle
    const allBtn = document.createElement('div');
    allBtn.className = 'pulse-sender-pill active';
    allBtn.id = 'pulse-toggle-all';
    allBtn.innerHTML = `<span>👥 Everyone</span>`;
    allBtn.onclick = () => {
        pulseCurrentSenders = new Set(allSendersList.map(s => s.name));
        updateSenderTogglesUI();
        recomputeAndRender();
    };
    container.appendChild(allBtn);

    const limit = showingAllSenders ? allSendersList.length : Math.min(5, allSendersList.length);
    for (let i = 0; i < limit; i++) {
        const s = allSendersList[i];
        const el = document.createElement('div');
        el.className = 'pulse-sender-pill';
        el.innerHTML = `<img src="/avatar/${encodeURIComponent(s.name)}"> <span>${s.name}</span>`;
        el.onclick = () => {
            if (pulseCurrentSenders.size === allSendersList.length) {
                pulseCurrentSenders.clear();
            }
            if (pulseCurrentSenders.has(s.name)) {
                pulseCurrentSenders.delete(s.name);
                if (pulseCurrentSenders.size === 0) pulseCurrentSenders = new Set(allSendersList.map(sd => sd.name));
            } else {
                pulseCurrentSenders.add(s.name);
            }
            updateSenderTogglesUI();
            // Debounce rapid clicks so we don't re-compute on every single pill toggle
            clearTimeout(senderDebounceTimer);
            senderDebounceTimer = setTimeout(() => recomputeAndRender(), 150);
        };
        el.dataset.name = s.name;
        container.appendChild(el);
    }

    if (!showingAllSenders && allSendersList.length > 5) {
        const moreBtn = document.createElement('div');
        moreBtn.className = 'pulse-sender-pill pulse-more-btn';
        moreBtn.innerHTML = `<span>+${allSendersList.length - 5} More...</span>`;
        moreBtn.style.opacity = '1';
        moreBtn.onclick = () => {
            showingAllSenders = true;
            renderSenderToggles();
        };
        container.appendChild(moreBtn);
    } else if (showingAllSenders && allSendersList.length > 5) {
        const lessBtn = document.createElement('div');
        lessBtn.className = 'pulse-sender-pill pulse-more-btn';
        lessBtn.innerHTML = `<span>Show Less</span>`;
        lessBtn.style.opacity = '1';
        lessBtn.onclick = () => {
            showingAllSenders = false;
            renderSenderToggles();
        };
        container.appendChild(lessBtn);
    }

    updateSenderTogglesUI();
}

function updateSenderTogglesUI() {
    const isAll = pulseCurrentSenders.size === allSendersList.length;
    const toggleAllBtn = document.getElementById('pulse-toggle-all');
    if (toggleAllBtn) {
        toggleAllBtn.classList.toggle('active', isAll);
    }

    document.querySelectorAll('.pulse-sender-pill[data-name]').forEach(el => {
        el.classList.toggle('active', isAll || pulseCurrentSenders.has(el.dataset.name));
    });
}

function applyPulseDateFilter(fromSlider = false) {
    const start = document.getElementById('pulse-start-date').value;
    const end = document.getElementById('pulse-end-date').value;

    // Sync slider if user typed in precise date
    if (!fromSlider && pulseMonths.length > 0 && start && end) {
        const startMonth = start.substring(0, 7);
        const endMonth = end.substring(0, 7);

        let matchStartIdx = pulseMonths.findIndex(m => m.val === startMonth);
        let matchEndIdx = pulseMonths.findIndex(m => m.val === endMonth);

        isProgrammaticDateChange = true;
        if (matchStartIdx >= 0) document.getElementById('pulse-month-start').value = matchStartIdx;
        if (matchEndIdx >= 0) document.getElementById('pulse-month-end').value = matchEndIdx;
        isProgrammaticDateChange = false;
        updateDualSliderUI();
    }
    recomputeAndRender();
}

function resetPulseDateFilter() {
    isProgrammaticDateChange = true;
    document.getElementById('pulse-start-date').value = '';
    document.getElementById('pulse-end-date').value = '';
    const startSlider = document.getElementById('pulse-month-start');
    const endSlider = document.getElementById('pulse-month-end');
    if (startSlider && endSlider) {
        startSlider.value = 0;
        endSlider.value = endSlider.max;
    }
    isProgrammaticDateChange = false;
    updateDualSliderUI();
    recomputeAndRender();
}

function updateDualSliderUI() {
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

    if (pulseMonths.length > 0) {
        if (lblStart) lblStart.textContent = pulseMonths[valStart].label;
        if (lblEnd) lblEnd.textContent = pulseMonths[valEnd].label;
    }
}

function formatTooltip(sendersObj, itemName) {
    if (!sendersObj) return "";
    let html = itemName ? `<b>${itemName}</b><br><hr style="border-color: #333; margin: 4px 0;">` : '';
    const total = Object.values(sendersObj).reduce((sum, val) => sum + val, 0);
    const details = Object.entries(sendersObj)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => {
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
            return `<span>${name}: ${count} (${pct}%)</span>`;
        })
        .join('<br>');
    return html + details;
}

// Global Tooltip Logic
let pulseGlobalTooltip = null;

document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.pulse-tooltip');
    if (target) {
        if (!pulseGlobalTooltip) {
            pulseGlobalTooltip = document.createElement('div');
            pulseGlobalTooltip.className = 'pulse-global-tooltip';
            pulseGlobalTooltip.style.position = 'fixed';
            pulseGlobalTooltip.style.backgroundColor = '#000';
            pulseGlobalTooltip.style.color = '#fff';
            pulseGlobalTooltip.style.padding = '8px 12px';
            pulseGlobalTooltip.style.borderRadius = '6px';
            pulseGlobalTooltip.style.fontSize = '12px';
            pulseGlobalTooltip.style.zIndex = '999999';
            pulseGlobalTooltip.style.pointerEvents = 'none';
            pulseGlobalTooltip.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
            pulseGlobalTooltip.style.width = 'max-content';
            pulseGlobalTooltip.style.maxWidth = '300px';
            pulseGlobalTooltip.style.wordWrap = 'break-word';
            document.body.appendChild(pulseGlobalTooltip);
        }
        
        const localTooltip = target.querySelector('.pulse-tooltip-text');
        if (localTooltip) {
            pulseGlobalTooltip.innerHTML = localTooltip.innerHTML;
            pulseGlobalTooltip.style.display = 'block';
        }
    }
});

document.addEventListener('mousemove', (e) => {
    if (pulseGlobalTooltip && pulseGlobalTooltip.style.display === 'block') {
        let x = e.clientX + 15;
        let y = e.clientY + 15;
        
        // Prevent tooltip from going off-screen
        const rect = pulseGlobalTooltip.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 10;
        if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 10;
        
        pulseGlobalTooltip.style.left = x + 'px';
        pulseGlobalTooltip.style.top = y + 'px';
    }
});

document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('.pulse-tooltip');
    if (target && pulseGlobalTooltip) {
        pulseGlobalTooltip.style.display = 'none';
    }
});

function renderCharts() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

    // 1. Circadian Rhythm (Radar)
    const circCanvas = document.getElementById('circadianChart');
    if (circCanvas) {
        const cD = pulseData.circadian;
        const circData = Array.from({ length: 24 }, (_, i) => {
            let obj = cD[i.toString().padStart(2, '0')];
            return obj ? obj.total : 0;
        });

        if (pulseCharts.circadian) {
            // Update existing chart — much faster than destroy+recreate
            pulseCharts.circadian.data.datasets[0].data = circData;
            // Update tooltip closure reference
            pulseCharts.circadian.options.plugins.tooltip.callbacks.label = function (context) {
                let hourKey = context.dataIndex.toString().padStart(2, '0');
                let hourObj = cD[hourKey];
                if (!hourObj || !hourObj.total) return `Total: 0`;
                let lines = [`Total: ${hourObj.total}`];
                let sorted = Object.entries(hourObj.senders).sort((a, b) => b[1] - a[1]);
                sorted.forEach(([sName, sCount]) => {
                    let pct = ((sCount / hourObj.total) * 100).toFixed(1);
                    lines.push(`${sName}: ${sCount} (${pct}%)`);
                });
                return lines;
            };
            pulseCharts.circadian.update('none');
        } else {
            const circCtx = circCanvas.getContext('2d');
            pulseCharts.circadian = new Chart(circCtx, {
                type: 'radar',
                data: {
                    labels: Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00'),
                    datasets: [{
                        label: 'Activity',
                        data: circData,
                        backgroundColor: 'rgba(192, 132, 252, 0.2)',
                        borderColor: '#c084fc',
                        pointBackgroundColor: '#c084fc',
                        borderWidth: 2
                    }]
                },
                options: {
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        r: {
                            angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            pointLabels: { color: '#e2e8f0', font: { size: 10 } },
                            ticks: { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    let hourKey = context.dataIndex.toString().padStart(2, '0');
                                    let hourObj = cD[hourKey];
                                    if (!hourObj || !hourObj.total) return `Total: 0`;
                                    let lines = [`Total: ${hourObj.total}`];
                                    let sorted = Object.entries(hourObj.senders).sort((a, b) => b[1] - a[1]);
                                    sorted.forEach(([sName, sCount]) => {
                                        let pct = ((sCount / hourObj.total) * 100).toFixed(1);
                                        lines.push(`${sName}: ${sCount} (${pct}%)`);
                                    });
                                    return lines;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // 1b. Weekly Activity (PolarArea)
    const weekCanvas = document.getElementById('weeklyChart');
    if (weekCanvas && pulseData.weekly) {
        const DOW_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const DOW_COLORS = ['#3b82f6','#06b6d4','#10b981','#84cc16','#f59e0b','#f43f5e','#8b5cf6'];
        const wd = pulseData.weekly;
        const weekData = DOW_ORDER.map(d => wd[d] ? wd[d].total : 0);

        if (pulseCharts.weekly) {
            pulseCharts.weekly.data.datasets[0].data = weekData;
            pulseCharts.weekly.options.plugins.tooltip.callbacks.label = function(context) {
                const dayName = context.label;
                const dayObj = wd[dayName];
                if (!dayObj || !dayObj.total) return `Total: 0`;
                const lines = [`${dayName}: ${dayObj.total} msgs`];
                Object.entries(dayObj.senders).sort((a,b) => b[1]-a[1]).slice(0,3).forEach(([sName, sCount]) => {
                    lines.push(`  ${sName}: ${sCount} (${((sCount/dayObj.total)*100).toFixed(1)}%)`);
                });
                return lines;
            };
            pulseCharts.weekly.update('none');
        } else {
            const weekCtx = weekCanvas.getContext('2d');
            pulseCharts.weekly = new Chart(weekCtx, {
                type: 'polarArea',
                data: {
                    labels: DOW_ORDER,
                    datasets: [{
                        data: weekData,
                        backgroundColor: DOW_COLORS.map(c => c + 'aa'),
                        borderColor: DOW_COLORS,
                        borderWidth: 2
                    }]
                },
                options: {
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { r: { ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.08)' } } },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const dayName = context.label;
                                    const dayObj = wd[dayName];
                                    if (!dayObj || !dayObj.total) return `Total: 0`;
                                    const lines = [`${dayName}: ${dayObj.total} msgs`];
                                    Object.entries(dayObj.senders).sort((a,b) => b[1]-a[1]).slice(0,3).forEach(([sName, sCount]) => {
                                        lines.push(`  ${sName}: ${sCount} (${((sCount/dayObj.total)*100).toFixed(1)}%)`);
                                    });
                                    return lines;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // 2. Consistency Grid — Dual Mode
    renderConsistencyGrid();

    // 3. Media DNA (Doughnut)
    const mediaCanvas = document.getElementById('mediaDnaChart');
    if (mediaCanvas) {
        const mD = pulseData.media_dna;
        const mediaData = [
            mD.text?.total || 0,
            mD.photo?.total || 0,
            (mD.voice?.total || 0) + (mD.round_video?.total || 0),
            (mD.sticker?.total || 0) + (mD.gif?.total || 0),
            (mD.file?.total || 0) + (mD.location?.total || 0) + (mD.poll?.total || 0)
        ];
        const mediaTooltipFn = function (context) {
            let label = context.label;
            let keys = [];
            if (label === 'Text') keys = ['text'];
            else if (label === 'Photos') keys = ['photo'];
            else if (label === 'Voice/Video') keys = ['voice', 'round_video'];
            else if (label === 'Stickers/GIFs') keys = ['sticker', 'gif'];
            else keys = ['file', 'location', 'poll'];

            let total = 0;
            let senders = {};
            keys.forEach(k => {
                if (mD[k] && mD[k].total) {
                    total += mD[k].total;
                    Object.entries(mD[k].senders).forEach(([s, c]) => {
                        senders[s] = (senders[s] || 0) + c;
                    });
                }
            });

            if (total === 0) return `Total: 0`;
            let lines = [`Total: ${total}`];
            let sorted = Object.entries(senders).sort((a, b) => b[1] - a[1]);
            sorted.forEach(([sName, sCount]) => {
                let pct = ((sCount / total) * 100).toFixed(1);
                lines.push(`${sName}: ${sCount} (${pct}%)`);
            });
            return lines;
        };

        if (pulseCharts.mediaDna) {
            pulseCharts.mediaDna.data.datasets[0].data = mediaData;
            pulseCharts.mediaDna.options.plugins.tooltip.callbacks.label = mediaTooltipFn;
            pulseCharts.mediaDna.update('none');
        } else {
            const mediaCtx = mediaCanvas.getContext('2d');
            pulseCharts.mediaDna = new Chart(mediaCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Text', 'Photos', 'Voice/Video', 'Stickers/GIFs', 'Other'],
                    datasets: [{
                        data: mediaData,
                        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { color: '#e2e8f0' } },
                        tooltip: {
                            callbacks: { label: mediaTooltipFn }
                        }
                    },
                    cutout: '70%'
                }
            });
        }
    }

    // 4. Chat Dynamics (Replaces Sender Battle)
    // We do NOT render it instantly from local pulseData.
    // Instead, we just trigger the API fetch here if the card is visible.
    const dynamicsCard = document.getElementById('chatDynamicsCard');
    if (dynamicsCard) {
        // Only fetch if it hasn't been fetched for THIS filter configuration yet,
        // or just let a debounced function handle it gracefully.
        fetchAndRenderChatDynamics();
    }

    // 5. Emoji Fingerprint
    const emojiCont = document.getElementById('emojiFingerprint');
    if (emojiCont && pulseData.emojis) {
        emojiCont.innerHTML = '';
        const maxEmojiVal = pulseData.emojis.length ? pulseData.emojis[0].count : 1;
        pulseData.emojis.forEach((e, i) => {
            const pct = (e.count / maxEmojiVal) * 100;
            const tooltipContent = formatTooltip(e.senders);
            const zIndex = 100 - i;
            emojiCont.innerHTML += `
                <div class="pulse-emoji-item pulse-tooltip" style="z-index: ${zIndex}">
                    <div class="pulse-tooltip-text">${tooltipContent}</div>
                    <div class="pulse-emoji-icon">${e.emoji}</div>
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
                            <span>Count: ${e.count}</span>
                        </div>
                        <div class="pulse-emoji-bar-container">
                            <div class="pulse-emoji-bar" style="width: ${pct}%"></div>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    // 5b. Sticker Fingerprint
    const stickerCont = document.getElementById('stickerFingerprint');
    if (stickerCont && pulseData.stickers) {
        stickerCont.innerHTML = '';
        const maxStickerVal = pulseData.stickers.length ? pulseData.stickers[0].count : 1;
        pulseData.stickers.forEach((s, i) => {
            const pct = (s.count / maxStickerVal) * 100;
            const tooltipContent = formatTooltip(s.senders, s.name);
            const zIndex = 100 - i;
            stickerCont.innerHTML += `
                <div class="pulse-emoji-item pulse-tooltip" style="z-index: ${zIndex}">
                    <div class="pulse-tooltip-text">${tooltipContent}</div>
                    <div class="pulse-emoji-icon"><img src="${s.path}" alt="sticker"></div>
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
                            <span>Count: ${s.count}</span>
                        </div>
                        <div class="pulse-emoji-bar-container">
                            <div class="pulse-emoji-bar" style="width: ${pct}%"></div>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    // 5c. GIF Fingerprint
    const gifCont = document.getElementById('gifFingerprint');
    if (gifCont && pulseData.gifs) {
        gifCont.innerHTML = '';
        const maxGifVal = pulseData.gifs.length ? pulseData.gifs[0].count : 1;
        pulseData.gifs.forEach((g, i) => {
            const pct = (g.count / maxGifVal) * 100;
            const tooltipContent = formatTooltip(g.senders, g.name);
            const zIndex = 100 - i;
            gifCont.innerHTML += `
                <div class="pulse-emoji-item pulse-tooltip" style="z-index: ${zIndex}">
                    <div class="pulse-tooltip-text">${tooltipContent}</div>
                    <div class="pulse-emoji-icon">
                        <video src="${g.path}" style="object-fit:cover; width: 100%; height: 100%;" loop autoplay muted playsinline></video>
                    </div>
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
                            <span>Count: ${g.count}</span>
                        </div>
                        <div class="pulse-emoji-bar-container">
                            <div class="pulse-emoji-bar" style="width: ${pct}%"></div>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    // 6. Signature Words
    const wordCont = document.getElementById('signatureWords');
    if (wordCont && pulseData.words) {
        wordCont.innerHTML = '';
        const maxWordVal = pulseData.words.length ? pulseData.words[0].count : 1;
        pulseData.words.forEach((w, i) => {
            const fontSize = 14 + (w.count / maxWordVal) * 20; // 14px to 34px
            const zIndex = 100 - i;
            const el = document.createElement('div');
            el.className = 'pulse-word pulse-tooltip';
            el.style.fontSize = `${fontSize}px`;
            el.style.zIndex = zIndex;
            el.textContent = w.word;

            const tooltip = document.createElement('div');
            tooltip.className = 'pulse-tooltip-text';
            tooltip.innerHTML = formatTooltip(w.senders, w.word);
            el.appendChild(tooltip);

            wordCont.appendChild(el);
        });
    }
}

function sharePulseDashboard() {
    const area = document.getElementById('pulse-dashboard');
    html2canvas(area, {
        backgroundColor: '#0f172a', /* Fallback dark bg */
        scale: 2 // High res
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = 'ChatPulse_Wrapped.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
}

// --- Chat Dynamics Logic ---

let currentDynamicsTab = 'messages';
let lastDynamicsFetchParams = null;
let dynamicsData = null;

function switchDynamicsTab(tabId) {
    currentDynamicsTab = tabId;
    
    // Update tab styling
    document.querySelectorAll('.pulse-dyn-tab').forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
            btn.style.background = 'var(--pulse-bg)';
            btn.style.color = 'var(--pulse-text)';
            btn.style.borderColor = 'var(--pulse-border)';
        } else {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.color = 'var(--pulse-text-muted)';
            btn.style.borderColor = 'transparent';
        }
    });

    // Toggle content visibility
    ['messages', 'icebreaker', 'ghosting', 'length', 'burst'].forEach(id => {
        const el = document.getElementById('dyn-content-' + id);
        if (el) el.style.display = (id === tabId) ? 'block' : 'none';
    });

    // Render data if we already have it
    if (dynamicsData) {
        renderCurrentDynamicsTab();
    }
}

function switchCircadianTab(tabId) {
    const hourlyBtn = document.getElementById('circ-tab-hourly');
    const weeklyBtn = document.getElementById('circ-tab-weekly');
    const hourlyPanel = document.getElementById('circ-panel-hourly');
    const weeklyPanel = document.getElementById('circ-panel-weekly');

    if (tabId === 'hourly') {
        hourlyBtn.style.background = 'var(--pulse-bg)';
        hourlyBtn.style.color = 'var(--pulse-text)';
        hourlyBtn.style.borderColor = 'var(--pulse-border)';
        weeklyBtn.style.background = 'transparent';
        weeklyBtn.style.color = 'var(--pulse-text-muted)';
        weeklyBtn.style.borderColor = 'transparent';
        hourlyPanel.style.display = 'block';
        weeklyPanel.style.display = 'none';
    } else {
        weeklyBtn.style.background = 'var(--pulse-bg)';
        weeklyBtn.style.color = 'var(--pulse-text)';
        weeklyBtn.style.borderColor = 'var(--pulse-border)';
        hourlyBtn.style.background = 'transparent';
        hourlyBtn.style.color = 'var(--pulse-text-muted)';
        hourlyBtn.style.borderColor = 'transparent';
        weeklyPanel.style.display = 'block';
        hourlyPanel.style.display = 'none';
    }
    
    // Resize charts to fit new visibility state
    if (pulseCharts.circadian) pulseCharts.circadian.resize();
    if (pulseCharts.weekly) pulseCharts.weekly.resize();
}

async function fetchAndRenderChatDynamics() {
    const dynamicsCard = document.getElementById('chatDynamicsCard');
    if (!dynamicsCard || dynamicsCard.style.display === 'none') return;
    
    const isAllSenders = pulseCurrentSenders.size === allSendersList.length;
    const sendersQuery = isAllSenders ? 'all' : Array.from(pulseCurrentSenders).join(',');
    const startDate = document.getElementById('pulse-start-date')?.value || '';
    const endDate = document.getElementById('pulse-end-date')?.value || '';
    const iceGap = parseInt(document.getElementById('pulse-ice-gap')?.value) || 8;
    const ghsGap = parseInt(document.getElementById('pulse-ghs-gap')?.value) || 4;

    const currentParams = `${startDate}|${endDate}|${sendersQuery}|${iceGap}|${ghsGap}`;
    
    // Check if we need to refetch
    if (lastDynamicsFetchParams === currentParams && dynamicsData) {
        renderCurrentDynamicsTab();
        return;
    }
    
    lastDynamicsFetchParams = currentParams;
    
    const card = document.getElementById('chatDynamicsCard');
    if (card) {
        let loader = card.querySelector('.pulse-card-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.className = 'pulse-card-loader';
            loader.innerHTML = `
                <div class="pulse-spinner" style="border-top-color: #c084fc; width: 24px; height: 24px; border-width: 2px;"></div>
                <div style="margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500;">Calculating...</div>
            `;
            card.appendChild(loader);
        }
        card.classList.add('is-loading');
    }
    
    // Hide all containers safely via iteration
    ['messages', 'icebreaker', 'ghosting', 'length', 'burst'].forEach(id => {
        const c = document.getElementById('dyn-content-' + id);
        if (c) c.style.display = 'none';
    });

    try {
        const url = new URL('/api/chat_dynamics', window.location.origin);
        if (startDate) url.searchParams.append('start_date', startDate);
        if (endDate) url.searchParams.append('end_date', endDate);
        if (sendersQuery !== 'all') url.searchParams.append('senders', sendersQuery);
        url.searchParams.append('icebreaker_gap', iceGap);
        url.searchParams.append('ghosting_gap', ghsGap);

        const res = await fetch(url);
        dynamicsData = await res.json();
    } catch (e) {
        console.error("Error fetching chat dynamics", e);
        lastDynamicsFetchParams = null; // Reset so next attempt can retry
        if (card) {
            let loader = card.querySelector('.pulse-card-loader');
            if (loader) {
                loader.innerHTML = `<div style="color:red; font-size:12px; margin-top:10px;">Failed to load data.</div>`;
            }
        }
        return;
    } finally {
        // Always remove loading regardless of outcome
        if (card) {
            card.classList.remove('is-loading');
            let loader = card.querySelector('.pulse-card-loader');
            if (loader) {
                loader.innerHTML = `
                <div class="pulse-spinner" style="border-top-color: #c084fc; width: 24px; height: 24px; border-width: 2px;"></div>
                <div style="margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500;">Calculating...</div>`;
            }
        }
    }

    // Unhide the active container
    const activeCont = document.getElementById('dyn-content-' + currentDynamicsTab);
    if (activeCont) activeCont.style.display = 'block';

    renderCurrentDynamicsTab();
}

// Called by the "Apply & Fetch" button — busts the JS cache so slider changes always trigger a fresh network request
async function applyAndFetchDynamics() {
    lastDynamicsFetchParams = null;
    await fetchAndRenderChatDynamics();
}

function renderCurrentDynamicsTab() {
    if (!dynamicsData || dynamicsData.error) return;
    
    // Convert object to array and sort to maintain top 10 logic everywhere
    const dataArr = Object.entries(dynamicsData)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.msgs - a.msgs);
        
    const top10 = dataArr.slice(0, 10);

    if (currentDynamicsTab === 'messages') renderDynamicsMessages(top10, dataArr.length);
    else if (currentDynamicsTab === 'icebreaker') renderDynamicsIcebreaker(top10);
    else if (currentDynamicsTab === 'ghosting') renderDynamicsGhosting(top10);
    else if (currentDynamicsTab === 'length') renderDynamicsLength(top10);
    else if (currentDynamicsTab === 'burst') renderDynamicsBurst(top10);
}

function renderDynamicsMessages(top10, totalSendersCount) {
    const sb = document.getElementById('dyn-content-messages');
    sb.innerHTML = '';
    const totalMsgs = top10.reduce((acc, curr) => acc + curr.msgs, 0);
    
    top10.forEach(sender => {
        const pct = totalMsgs ? ((sender.msgs / totalMsgs) * 100).toFixed(1) : 0;
        sb.innerHTML += `
            <div class="pulse-sb-row">
                <div style="display:flex; align-items:center; gap:10px;">
                    <img src="/avatar/${encodeURIComponent(sender.name)}" style="width:30px; height:30px; border-radius:50%;">
                    <span>${sender.name}</span>
                </div>
                <b>${sender.msgs.toLocaleString()} (${pct}%)</b>
            </div>
        `;
    });
    if (totalSendersCount > 10) {
        sb.innerHTML += `<div style="text-align: center; color: var(--pulse-text-muted); font-size: 12px; margin-top: 10px;">+${totalSendersCount - 10} more hidden</div>`;
    }
}

function renderDynamicsIcebreaker(top10) {
    const canvas = document.getElementById('icebreakerChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (pulseCharts.icebreaker) pulseCharts.icebreaker.destroy();
    
    // Sort array uniquely for this view (highest icebreakers first)
    const sorted = [...top10].sort((a,b) => b.icebreakers - a.icebreakers);
    const labels = sorted.map(s => s.name);
    const data = sorted.map(s => s.icebreakers);
    
    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#64748b', '#d946ef'];

    pulseCharts.icebreaker = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, sorted.length),
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#e2e8f0' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.label;
                            let val = context.raw;
                            let total = context.dataset.data.reduce((a,b) => a+b, 0);
                            let pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                            return `${label}: ${val} starts (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

function renderDynamicsGhosting(top10) {
    const el = document.getElementById('dyn-content-ghosting');
    el.innerHTML = '';

    // Read the user-selected threshold to update legend dynamically
    const gapThresholdHours = document.getElementById('pulse-ghs-gap') ? parseInt(document.getElementById('pulse-ghs-gap').value) || 1 : 1;
    
    const ghostThreshold = gapThresholdHours;
    const CATEGORIES = [
        { key: 'insta',   label: 'Inter',   color: '#10b981', desc: '< 30s' },
        { key: 'active',  label: 'Active',  color: '#3b82f6', desc: '30s – 5m'  },
        { key: 'delayed', label: 'Delayed', color: '#f59e0b', desc: '5m – 1h'   }
    ];
    
    // Logic must perfectly sync with run_ui.py (v7)
    if (ghostThreshold > 1) {
        CATEGORIES.push({ key: 'ghosted', label: 'Ghosted', color: '#ef4444', desc: `1h – ${ghostThreshold}h` });
        CATEGORIES.push({ key: 'extended', label: 'Extended', color: '#7f1d1d', desc: `≥ ${ghostThreshold}h` });
    } else {
        CATEGORIES.push({ key: 'ghosted', label: 'Ghosted', color: '#ef4444', desc: '≥ 1h' });
    }

    const valid = top10.filter(s => s.ghost_stats);
    if (valid.length === 0) {
        el.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--pulse-text-muted);">No reply data.</div>`;
        return;
    }
    
    // Legend
    el.innerHTML = `<div style="display:flex; gap:10px; margin-bottom:10px; flex-wrap: wrap;">${
        CATEGORIES.map(c => `<span style="display:flex; align-items:center; gap:4px; font-size:11px; color:var(--pulse-text-muted);">
            <span style="width:10px; height:10px; border-radius:2px; background:${c.color}; display:inline-block;"></span>${c.label} <em style="color:#555;">(${c.desc})</em>
        </span>`).join('')
    }</div>`;

    valid.forEach(sender => {
        const gs = sender.ghost_stats;
        let totalRecords = 0;
        for (const k in gs) {
             if (gs[k] && gs[k].count) totalRecords += gs[k].count;
        }
        if (totalRecords === 0) return;

        // Build stacked bar segments HTML
        const segments = CATEGORIES.map(c => {
            const bucket = gs[c.key];
            if (!bucket || bucket.count === 0) return '';
            const pct = bucket.pct;
            const tooltipHtml = `<b>${c.label}</b> (${c.desc})<hr style="border-color:#333; margin:3px 0;">Count: ${bucket.count} of ${totalRecords}<br>Share: ${pct}%`;
            // Use a min-width of 2px for any category with count > 0 to ensure visibility
            return `<div class="pulse-tooltip" style="display:inline-flex; align-items:center; justify-content:center; width:${pct}%; height:100%; background:${c.color}; position:relative; min-width: 2px;">
                <div class="pulse-tooltip-text">${tooltipHtml}</div>
            </div>`;
        }).join('');

        el.innerHTML += `
            <div style="margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <img src="/avatar/${encodeURIComponent(sender.name)}" style="width:20px; height:20px; border-radius:50%;">
                        <span>${sender.name}</span>
                    </div>
                    <span style="color: var(--pulse-text-muted); font-size:11px;">${totalRecords} tracked replies</span>
                </div>
                <div style="height:10px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:visible; display:flex;">
                    ${segments}
                </div>
            </div>
        `;
    });
}

function renderDynamicsLength(top10) {
    const el = document.getElementById('dyn-content-length');
    el.innerHTML = '';
    
    const sorted = [...top10].sort((a, b) => b.avg_length - a.avg_length); // Longest first
    const maxLen = sorted.length ? sorted[0].avg_length : 1;
    
    sorted.forEach((sender, i) => {
        const pct = (sender.avg_length / maxLen) * 100;
        
        let tooltipContent = '';
        if (sender.max_msg) {
            tooltipContent = `<b>Longest Message</b><hr style="border-color:#333; margin:4px 0;">Record: ${sender.max_msg.len} chars<br>Date: ${sender.max_msg.date}<br><i>"${sender.max_msg.text}"</i>`;
        }
        
        el.innerHTML += `
            <div class="pulse-tooltip" style="margin-bottom: 12px; position: relative; z-index: ${100-i}; text-align: left;">
                ${tooltipContent ? `<div class="pulse-tooltip-text" style="width: 250px; text-align: left; left: 0; transform: translateY(5px); bottom: auto;">${tooltipContent}</div>` : ''}
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px; font-size: 12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <img src="/avatar/${encodeURIComponent(sender.name)}" style="width:20px; height:20px; border-radius:50%;">
                        <span>${sender.name}</span>
                    </div>
                    <span>Avg: ${sender.avg_length} chars</span>
                </div>
                <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: #3b82f6; border-radius: 3px;"></div>
                </div>
            </div>
        `;
    });
}

function renderDynamicsBurst(top10) {
    const el = document.getElementById('dyn-content-burst');
    el.innerHTML = '';
    
    const sorted = [...top10].sort((a, b) => b.burst_ratio - a.burst_ratio);
    
    let html = '';
    sorted.forEach((sender, i) => {
        const linePct = sender.burst_ratio;
        const tooltipContent = sender.burst_record ? 
            `<b>Consecutive Texts Record</b><hr style="border-color:#333; margin:4px 0;">Sequence: ${sender.burst_record.len} msgs in a row<br>Started: ${sender.burst_record.date}<br>Average Sequence: ${sender.avg_burst} msgs` : '';
        
        let stackGraphHtml = '';
        if (sender.burst_freq) {
            let totalBursts = Object.values(sender.burst_freq).reduce((a, b) => a + b, 0);
            if (totalBursts > 0) {
                const colors = [
                    '#c084fc', // 1
                    '#a855f7', // 2
                    '#8b5cf6', // 3
                    '#6366f1', // 4
                    '#3b82f6', // 5
                    '#10b981', // 6
                    '#f59e0b', // 7
                    '#f97316', // 8
                    '#ef4444', // 9
                    '#881337'  // 10+
                ];
                const burstKeys = Object.keys(sender.burst_freq).map(Number).sort((a,b) => a-b);
                
                const barsHtml = burstKeys.map((len, idx) => {
                    const count = sender.burst_freq[len];
                    if (count === 0) return '';
                    const cPct = (count / totalBursts) * 100;
                    const color = colors[Math.min(idx, colors.length - 1)];
                    const label = (len === 10) ? '10+' : len;
                    const localTooltip = `<b>${label} msgs in a row</b><br>Count: ${count}<br>Share: ${cPct.toFixed(1)}%`;
                    
                    return `<div class="pulse-tooltip" style="width: ${cPct}%; height: 100%; background: ${color}; min-width: ${cPct > 0 ? '4px' : '0'}; display: flex; align-items: center; justify-content: center; font-size: 9px; color: white;">
                        ${cPct > 10 ? label : ''}
                        <div class="pulse-tooltip-text" style="bottom: 120%;">${localTooltip}</div>
                    </div>`;
                }).join('');
                
                stackGraphHtml = `
                    <div class="burst-breakdown" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <div style="font-size: 11px; margin-bottom: 6px; color: var(--pulse-text-muted);">Consecutive Response Breakdown:</div>
                        <div style="height: 14px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; overflow: hidden;">
                            ${barsHtml}
                        </div>
                    </div>
                `;
            }
        }
        
        const rowId = `burst-row-${i}`;
        html += `
            <div id="${rowId}" class="pulse-burst-row" style="margin-bottom: 12px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; position: relative; z-index: ${100-i};" onclick="toggleBurstBreakdown('${rowId}')">
                <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 10px; font-size: 13px; pointer-events: none;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <img src="/avatar/${encodeURIComponent(sender.name)}" style="width:24px; height:24px; border-radius:50%;">
                        <span style="font-weight: 500;">${sender.name}</span>
                    </div>
                    <div class="pulse-tooltip" style="position: relative; pointer-events: auto;">
                        <span style="color: #a78bfa; font-weight: 600;">Ratio: ${sender.burst_ratio}%</span>
                        ${tooltipContent ? `<div class="pulse-tooltip-text" style="width: 250px; text-align: left; right: 0; bottom: 120%;">${tooltipContent}</div>` : ''}
                    </div>
                </div>
                <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; width: 100%; pointer-events: none;">
                    <div style="height: 100%; width: ${linePct}%; background: linear-gradient(90deg, #8b5cf6, #d946ef); border-radius: 3px;"></div>
                </div>
                ${stackGraphHtml}
            </div>
        `;
    });
    el.innerHTML = html;
}

// Global helper to toggle the breakdown inside the custom row
window.toggleBurstBreakdown = function(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const bd = row.querySelector('.burst-breakdown');
    if (!bd) return;
    const isHidden = bd.style.display === 'none';
    bd.style.display = isHidden ? 'block' : 'none';
    row.style.background = isHidden ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
};

// ===============================================================
// ============= CONSISTENCY GRID — DUAL MODE RENDERER ===========
// ===============================================================

let _cgMode = 'matrix'; // 'matrix' or 'stream'

function switchCgMode(mode) {
    _cgMode = mode;
    document.querySelectorAll('[data-cgmode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cgmode === mode);
    });
    const tmEl = document.getElementById('cg-time-matrix');
    const psEl = document.getElementById('cg-pulse-stream');
    if (tmEl) tmEl.style.display = mode === 'matrix' ? 'block' : 'none';
    if (psEl) psEl.style.display = mode === 'stream' ? 'flex' : 'none';
    
    // Hide dynamic month label in Time Matrix mode
    const hoverLbl = document.getElementById('ps-hover-month');
    if (hoverLbl && mode === 'matrix') hoverLbl.style.display = 'none';

    renderConsistencyGrid();
}

function renderConsistencyGrid() {
    if (!pulseData || !pulseData.consistency) return;
    const consistency = pulseData.consistency;
    const metrics = computeCgMetrics(consistency);

    if (_cgMode === 'matrix') renderTimeMatrix(consistency, metrics);
    else renderPulseStream(consistency, metrics);
}

function computeCgMetrics(consistency) {
    const counts = Object.values(consistency).map(d => d.total);
    const maxVal = Math.max(...counts, 1);

    // Top 1% threshold for supernova
    const sorted = [...counts].sort((a, b) => a - b);
    const p99idx = Math.floor(sorted.length * 0.99);
    const top1pct = sorted[p99idx] || maxVal;

    // Compute streaks: map dateStr → streak length
    const allDates = Object.keys(consistency).sort();
    const dateSet = new Set(allDates);
    const streaks = {};

    if (allDates.length > 0) {
        let streakStart = allDates[0];
        let streakLen = 1;

        const nextDay = (ds) => {
            const d = new Date(ds + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + 1);
            return d.toISOString().substring(0, 10);
        };

        for (let i = 1; i < allDates.length; i++) {
            if (allDates[i] === nextDay(allDates[i - 1])) {
                streakLen++;
            } else {
                // Finalize previous streak
                if (streakLen > 1) {
                    let cur = streakStart;
                    for (let j = 0; j < streakLen; j++) {
                        streaks[cur] = streakLen;
                        cur = nextDay(cur);
                    }
                }
                streakStart = allDates[i];
                streakLen = 1;
            }
        }
        // Finalize last streak
        if (streakLen > 1) {
            let cur = streakStart;
            for (let j = 0; j < streakLen; j++) {
                streaks[cur] = streakLen;
                cur = nextDay(cur);
            }
        }
    }

    return { maxVal, top1pct, streaks, dateSet };
}

// --- Time Matrix (GitHub-style) ---
function renderTimeMatrix(consistency, metrics) {
    const el = document.getElementById('cg-time-matrix');
    if (!el) return;
    el.innerHTML = '';

    const allDates = Object.keys(consistency).sort();
    if (allDates.length === 0) return;

    const minYear = parseInt(allDates[0].substring(0, 4));
    const maxYear = parseInt(allDates[allDates.length - 1].substring(0, 4));
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DOW_LABELS = ['Mon','','Wed','','Fri','','Sun'];

    // Render newest year on top
    for (let year = maxYear; year >= minYear; year--) {
        const block = document.createElement('div');
        block.className = 'tm-year-block';

        const label = document.createElement('div');
        label.className = 'tm-year-label';
        label.textContent = String(year);
        block.appendChild(label);

        const wrapper = document.createElement('div');
        wrapper.className = 'tm-wrapper';

        // DOW labels column
        const dowCol = document.createElement('div');
        dowCol.className = 'tm-dow-labels';
        for (let i = 0; i < 7; i++) {
            const lbl = document.createElement('div');
            lbl.className = 'tm-dow-label';
            lbl.textContent = DOW_LABELS[i];
            dowCol.appendChild(lbl);
        }
        wrapper.appendChild(dowCol);

        // Main area (month labels + grid)
        const main = document.createElement('div');
        main.className = 'tm-main';

        // Build weeks for this year
        // Start from Jan 1, end at Dec 31 (using strict UTC to avoid local timezone offset shifts)
        const jan1 = new Date(Date.UTC(year, 0, 1));
        const dec31 = new Date(Date.UTC(year, 11, 31));
        // Monday-based DOW: 0=Mon, 6=Sun
        const jan1Dow = (jan1.getUTCDay() + 6) % 7; // Convert JS Sunday=0 to Monday=0

        // Build week columns
        const weeks = [];
        let currentDate = new Date(jan1);
        // Align to start of the week (previous Monday if Jan 1 isn't Monday)
        currentDate.setUTCDate(currentDate.getUTCDate() - jan1Dow);

        while (currentDate <= dec31 || weeks.length === 0) {
            const week = [];
            for (let d = 0; d < 7; d++) {
                const dateStr = currentDate.toISOString().substring(0, 10);
                const inYear = currentDate.getUTCFullYear() === year;
                week.push({ date: dateStr, inYear, month: currentDate.getUTCMonth(), day: currentDate.getUTCDate() });
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
            weeks.push(week);
            if (currentDate > dec31 && currentDate.getUTCFullYear() > year) break;
        }

        // Month labels row
        const monthRow = document.createElement('div');
        monthRow.className = 'tm-month-row';
        let lastMonth = -1;
        weeks.forEach(week => {
            const lbl = document.createElement('div');
            lbl.className = 'tm-month-label';
            // Show month label at the start of a new month
            const firstInYear = week.find(d => d.inYear);
            if (firstInYear && firstInYear.month !== lastMonth) {
                lbl.textContent = MONTHS[firstInYear.month];
                lastMonth = firstInYear.month;
            }
            monthRow.appendChild(lbl);
        });
        main.appendChild(monthRow);

        // Grid: each week is a column of 7 squares
        const grid = document.createElement('div');
        grid.className = 'tm-grid';
        weeks.forEach(week => {
            const col = document.createElement('div');
            col.className = 'tm-week-col';
            week.forEach(day => {
                if (!day.inYear) {
                    // Padding square (outside this year)
                    const empty = document.createElement('div');
                    empty.className = 'cg-sq';
                    empty.style.visibility = 'hidden';
                    col.appendChild(empty);
                } else {
                    const data = consistency[day.date];
                    const sq = makeCgSquare(day.date, data, metrics);
                    col.appendChild(sq);
                }
            });
            grid.appendChild(col);
        });
        main.appendChild(grid);
        wrapper.appendChild(main);
        block.appendChild(wrapper);
        el.appendChild(block);
    }
}

// --- Pulse Stream (Dense continuous) ---
function renderPulseStream(consistency, metrics) {
    const el = document.getElementById('cg-pulse-stream');
    if (!el) return;
    el.innerHTML = '';

    const sortedDates = Object.keys(consistency).sort();
    if (sortedDates.length === 0) return;

    let lastMonth = '';
    sortedDates.forEach((d, i) => {
        const curMonth = d.substring(0, 7);
        if (curMonth !== lastMonth && lastMonth !== '' && el.lastElementChild) {
            // Month boundary: just add a margin gap instead of a neon divider line
            el.lastElementChild.style.marginRight = '8px';
        }
        lastMonth = curMonth;

        const data = consistency[d];
        const sq = makeCgSquare(d, data, metrics);
        el.appendChild(sq);
    });
}

// --- Shared: Make a day square ---
function makeCgSquare(dateStr, data, metrics) {
    const sq = document.createElement('div');
    sq.className = 'cg-sq';

    if (data && data.total > 0) {
        const intensity = data.total / metrics.maxVal;
        if (intensity > 0) sq.classList.add('cg-l1');
        if (intensity > 0.125) sq.classList.add('cg-l2');
        if (intensity > 0.25) sq.classList.add('cg-l3');
        if (intensity > 0.375) sq.classList.add('cg-l4');
        if (intensity > 0.5) sq.classList.add('cg-l5');
        if (intensity > 0.625) sq.classList.add('cg-l6');
        if (intensity > 0.75) sq.classList.add('cg-l7');
        if (intensity > 0.875) sq.classList.add('cg-l8');

        // Supernova
        if (data.total >= metrics.top1pct && metrics.top1pct > 5) {
            sq.classList.add('cg-supernova');
        }

        // Streak connector (for Pulse Stream horizontal flow)
        const streakLen = metrics.streaks[dateStr];
        if (streakLen && streakLen > 1) {
            const nextDay = (ds) => {
                const dd = new Date(ds + 'T00:00:00Z');
                dd.setUTCDate(dd.getUTCDate() + 1);
                return dd.toISOString().substring(0, 10);
            };
            const prevDay = (ds) => {
                const dd = new Date(ds + 'T00:00:00Z');
                dd.setUTCDate(dd.getUTCDate() - 1);
                return dd.toISOString().substring(0, 10);
            };
            const hasPrev = metrics.dateSet.has(prevDay(dateStr));
            const hasNext = metrics.dateSet.has(nextDay(dateStr));

            if (hasPrev && hasNext) sq.classList.add('cg-streak-mid');
            else if (!hasPrev && hasNext) sq.classList.add('cg-streak-start');
            else if (hasPrev && !hasNext) sq.classList.add('cg-streak-end');
            else sq.classList.add('cg-streak-solo');
        }
    }
    // Ghost day: no data — stays with default very dim background

    // Click to open date
    sq.onclick = () => window.open('/?date=' + dateStr, '_blank');

    // Rich tooltip
    sq.addEventListener('mouseenter', (e) => showCgTooltip(e, dateStr, data, metrics));
    sq.addEventListener('mouseleave', hideCgTooltip);
    sq.addEventListener('mousemove', (e) => moveCgTooltip(e));

    return sq;
}

// --- Rich Tooltip ---
function showCgTooltip(e, dateStr, data, metrics) {
    const tip = document.getElementById('cg-tooltip');
    if (!tip) return;

    // Update dynamic month header in Pulse Stream mode
    if (_cgMode === 'stream') {
        const hoverLbl = document.getElementById('ps-hover-month');
        if (hoverLbl) {
            const [y, m] = dateStr.substring(0, 7).split('-');
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            hoverLbl.textContent = `Viewing: ${monthNames[parseInt(m)-1]} ${y}`;
            hoverLbl.style.display = 'flex';
        }
    }

    const niceDateStr = (() => {
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' });
        } catch(e) { return dateStr; }
    })();

    let html = `<div class="cg-tt-date">📅 ${niceDateStr}</div>`;

    if (!data || data.total === 0) {
        html += `<div class="cg-tt-total">✉️ No messages</div>`;
    } else {
        html += `<div class="cg-tt-total">✉️ ${data.total.toLocaleString()} messages</div>`;

        // Per-sender breakdown
        const senders = Object.entries(data.senders).sort((a, b) => b[1] - a[1]);
        html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 2px;">';
        senders.forEach(([name, count]) => {
            const pct = ((count / data.total) * 100).toFixed(0);
            html += `<div class="cg-tt-sender"><span style="color:${getColor(name)}">🗣️ ${name}</span><span>${count} (${pct}%)</span></div>`;
        });
        html += '</div>';

        // Streak
        const streakLen = metrics.streaks[dateStr];
        if (streakLen && streakLen > 1) {
            html += `<div class="cg-tt-streak">🔥 Part of a ${streakLen}-day streak!</div>`;
        }
    }

    tip.innerHTML = html;
    tip.style.display = 'block';
    moveCgTooltip(e);
}

function moveCgTooltip(e) {
    const tip = document.getElementById('cg-tooltip');
    if (!tip) return;
    
    // Move slightly off cursor
    let left = e.clientX + 12;
    let top = e.clientY - 10;
    
    // Ensure tooltip is measured properly by keeping it in body (bypasses card backdrop-filter transforms)
    if (tip.parentElement !== document.body) {
        document.body.appendChild(tip);
    }
    
    // Keep on screen horizontally
    if (left + tip.offsetWidth > window.innerWidth - 10) {
        left = e.clientX - tip.offsetWidth - 12;
    }
    
    // Keep on screen vertically
    if (top + tip.offsetHeight > window.innerHeight - 10) {
        top = window.innerHeight - tip.offsetHeight - 10;
    }
    if (top < 10) top = 10;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
}

function hideCgTooltip() {
    const tip = document.getElementById('cg-tooltip');
    if (tip) tip.style.display = 'none';
}

// ===============================================================
// ==================== CUSTOM SIGNATURE WORDS ===================
// ===============================================================

let _cwWords = [];          // User's custom words list
let _cwResults = null;      // Latest worker results
let _cwViewMode = 'tug';    // 'tug' or 'matrix'
let _cwLoading = false;
let _cwDebounce = null;

// --- Subtab Switching ---
function switchSigWordsTab(tabId) {
    document.querySelectorAll('.sigwords-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    const pctPanel = document.getElementById('sigwords-panel-pct');
    const customPanel = document.getElementById('sigwords-panel-custom');
    if (pctPanel) pctPanel.style.display = tabId === 'pct' ? 'flex' : 'none';
    if (customPanel) customPanel.style.display = tabId === 'custom' ? 'flex' : 'none';

    // Auto-set view mode based on participant count when switching to custom
    if (tabId === 'custom' && _cwWords.length === 0) {
        const participantCount = pulseCurrentSenders ? pulseCurrentSenders.size : 0;
        if (participantCount > 3) {
            switchCwView('matrix');
        }
    }
}

// --- View Mode Toggle ---
function switchCwView(mode) {
    _cwViewMode = mode;
    document.querySelectorAll('.cw-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (_cwResults) renderCustomWords();
}

// --- Input & Tags ---
(function initCwInput() {
    // Defer to ensure DOM is ready
    setTimeout(() => {
        const input = document.getElementById('cw-input');
        if (!input) return;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const word = input.value.trim().toLowerCase();
                if (!word || _cwWords.includes(word)) { input.value = ''; return; }
                _cwWords.push(word);
                input.value = '';
                renderCwTags();
                debouncedComputeCustomWords();
            }
        });
    }, 500);
})();

function renderCwTags() {
    const container = document.getElementById('cw-tags');
    if (!container) return;
    container.innerHTML = '';
    _cwWords.forEach(w => {
        const tag = document.createElement('span');
        tag.className = 'cw-tag';
        tag.innerHTML = `${escapeHtml(w)} <span class="cw-tag-x" onclick="removeCwTag('${escapeHtml(w)}', this)">✖</span>`;
        container.appendChild(tag);
    });
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function removeCwTag(word, el) {
    const tagEl = el.parentElement;
    tagEl.classList.add('removing');
    setTimeout(() => {
        _cwWords = _cwWords.filter(w => w !== word);
        renderCwTags();
        if (_cwWords.length === 0) {
            _cwResults = null;
            const viz = document.getElementById('cw-viz');
            if (viz) viz.innerHTML = '<div class="cw-empty">Type a word above to see who uses it most ✨</div>';
        } else {
            debouncedComputeCustomWords();
        }
    }, 250);
}

// --- Worker Communication ---
function debouncedComputeCustomWords() {
    clearTimeout(_cwDebounce);
    _cwDebounce = setTimeout(() => computeCustomWords(), 300);
}

function computeCustomWords() {
    if (!pulseWorker || !pulseWorkerLoaded || _cwWords.length === 0) return;
    _cwLoading = true;

    const viz = document.getElementById('cw-viz');
    if (viz) viz.innerHTML = '<div class="cw-loading"><div class="pulse-spinner"></div>Searching messages...</div>';

    const startDate = document.getElementById('pulse-start-date')?.value || '';
    const endDate = document.getElementById('pulse-end-date')?.value || '';

    pulseWorker.postMessage({
        type: 'custom_words',
        words: _cwWords,
        senders: Array.from(pulseCurrentSenders),
        allSendersCount: allSendersList.length,
        startDate,
        endDate
    });
}

// --- Rendering Dispatcher ---
function renderCustomWords() {
    if (!_cwResults) return;
    if (_cwViewMode === 'tug') renderCwTugOfWar();
    else renderCwMatrix();
}

// --- Tug of War Rendering ---
function renderCwTugOfWar() {
    const viz = document.getElementById('cw-viz');
    if (!viz || !_cwResults) return;
    viz.innerHTML = '';

    if (_cwResults.every(r => r.total === 0)) {
        viz.innerHTML = '<div class="cw-empty">No matches found for these words 🔍</div>';
        return;
    }

    _cwResults.forEach(result => {
        if (result.total === 0) {
            const row = document.createElement('div');
            row.className = 'tow-row';
            row.innerHTML = `
                <div class="tow-word-label">
                    <span>"${escapeHtml(result.word)}"</span>
                    <span class="tow-word-total">0 uses</span>
                </div>
                <div class="tow-bar" style="opacity: 0.3;"><div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(255,255,255,0.3);">No matches</div></div>`;
            row.onclick = () => deepLinkSearch(result.word);
            viz.appendChild(row);
            return;
        }

        // Sort senders by count descending
        const sortedSenders = Object.entries(result.senders)
            .sort((a, b) => b[1].count - a[1].count);

        const row = document.createElement('div');
        row.className = 'tow-row';

        // Label
        const label = document.createElement('div');
        label.className = 'tow-word-label';
        label.innerHTML = `<span>"${escapeHtml(result.word)}"</span><span class="tow-word-total">${result.total.toLocaleString()} uses</span>`;
        row.appendChild(label);

        // Bar
        const bar = document.createElement('div');
        bar.className = 'tow-bar';

        sortedSenders.forEach(([name, data]) => {
            const pct = (data.count / result.total) * 100;
            const color = getColor(name);
            const seg = document.createElement('div');
            seg.className = 'tow-segment pulse-tooltip';
            seg.style.width = pct + '%';
            seg.style.background = color;
            seg.style.boxShadow = `inset 0 0 12px rgba(0,0,0,0.2), 0 0 8px ${color}66`;

            // Show avatar + count in segments wide enough
            if (pct > 15) {
                seg.innerHTML = `<img src="/avatar/${encodeURIComponent(name)}"><span class="tow-segment-label">${data.count} (${pct.toFixed(0)}%)</span>`;
            } else if (pct > 8) {
                seg.innerHTML = `<span class="tow-segment-label">${data.count}</span>`;
            }

            // Tooltip
            const tip = document.createElement('div');
            tip.className = 'pulse-tooltip-text';
            tip.innerHTML = `<b>${escapeHtml(result.word)}</b><hr style="border-color:#333;margin:3px 0;"><b>${escapeHtml(name)}</b><br>Count: ${data.count} (${pct.toFixed(1)}%)`
                + (data.first_date ? `<br><span style="color:#94a3b8;">First used: ${data.first_date}</span>` : '');
            seg.appendChild(tip);

            seg.onclick = (e) => { e.stopPropagation(); deepLinkSearch(result.word); };
            bar.appendChild(seg);
        });

        row.appendChild(bar);
        row.onclick = () => deepLinkSearch(result.word);
        viz.appendChild(row);
    });
}

// --- Matrix Rendering ---
function renderCwMatrix() {
    const viz = document.getElementById('cw-viz');
    if (!viz || !_cwResults) return;
    viz.innerHTML = '';

    if (_cwResults.every(r => r.total === 0)) {
        viz.innerHTML = '<div class="cw-empty">No matches found for these words 🔍</div>';
        return;
    }

    // Collect all senders that appear in any result
    const senderSet = new Set();
    _cwResults.forEach(r => Object.keys(r.senders).forEach(s => senderSet.add(s)));
    const senders = Array.from(senderSet);

    if (senders.length === 0) {
        viz.innerHTML = '<div class="cw-empty">No matches found 🔍</div>';
        return;
    }

    // Find global max for scaling
    let globalMax = 1;
    _cwResults.forEach(r => {
        Object.values(r.senders).forEach(d => {
            if (d.count > globalMax) globalMax = d.count;
        });
    });

    const container = document.createElement('div');
    container.className = 'matrix-container';

    const grid = document.createElement('div');
    grid.className = 'matrix-grid';
    grid.style.gridTemplateColumns = `auto repeat(${senders.length}, 1fr)`;

    // Header row: empty corner + sender avatars
    grid.innerHTML += '<div></div>';
    senders.forEach(s => {
        grid.innerHTML += `<div class="matrix-header-cell">
            <img src="/avatar/${encodeURIComponent(s)}">
            <span>${escapeHtml(s)}</span>
        </div>`;
    });

    // Data rows
    _cwResults.forEach((result, rowIdx) => {
        // Row label
        const labelEl = document.createElement('div');
        labelEl.className = 'matrix-row-label';
        labelEl.textContent = '"' + result.word + '"';
        labelEl.onclick = () => deepLinkSearch(result.word);
        grid.appendChild(labelEl);

        // Orbs for each sender
        senders.forEach(s => {
            const cell = document.createElement('div');
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.setAttribute('data-row', rowIdx);

            const data = result.senders[s];
            if (data && data.count > 0) {
                const ratio = data.count / globalMax;
                const scale = 0.3 + ratio * 0.7;  // min scale 0.3, max 1.0
                const opacity = 0.3 + ratio * 0.7;
                const color = getColor(s);

                const orb = document.createElement('div');
                orb.className = 'matrix-orb pulse-tooltip';
                orb.style.background = color;
                orb.style.transform = `scale(${scale.toFixed(2)})`;
                orb.style.opacity = opacity.toFixed(2);
                orb.style.boxShadow = `0 0 ${Math.round(ratio * 15)}px ${color}88`;
                orb.textContent = data.count;

                // Tooltip
                const pct = result.total > 0 ? ((data.count / result.total) * 100).toFixed(1) : 0;
                const tip = document.createElement('div');
                tip.className = 'pulse-tooltip-text';
                tip.innerHTML = `<b>${escapeHtml(result.word)}</b><hr style="border-color:#333;margin:3px 0;"><b>${escapeHtml(s)}</b><br>Count: ${data.count} (${pct}%)`
                    + (data.first_date ? `<br><span style="color:#94a3b8;">First used: ${data.first_date}</span>` : '');
                orb.appendChild(tip);

                orb.onclick = (e) => { e.stopPropagation(); deepLinkSearch(result.word); };
                cell.appendChild(orb);
            } else {
                // Empty dot
                const dot = document.createElement('div');
                dot.style.width = '6px';
                dot.style.height = '6px';
                dot.style.borderRadius = '50%';
                dot.style.background = 'rgba(255,255,255,0.08)';
                cell.appendChild(dot);
            }
            grid.appendChild(cell);
        });
    });

    container.appendChild(grid);
    viz.appendChild(container);

    // Row hover highlight
    grid.addEventListener('mouseover', e => {
        const cell = e.target.closest('[data-row]');
        if (cell) {
            const rowIdx = cell.getAttribute('data-row');
            grid.querySelectorAll('[data-row]').forEach(c => {
                c.classList.toggle('matrix-row-highlight', c.getAttribute('data-row') === rowIdx);
            });
        }
    });
    grid.addEventListener('mouseout', () => {
        grid.querySelectorAll('.matrix-row-highlight').forEach(c => c.classList.remove('matrix-row-highlight'));
    });
}

// --- Deep Link: Close dashboard, open search, pre-fill ---
function deepLinkSearch(word) {
    // Close pulse dashboard
    const dash = document.getElementById('pulse-dashboard');
    if (dash) dash.classList.add('pulse-hidden');

    // Open search sidebar and pre-fill
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.style.display !== 'block') {
        if (typeof toggleSearch === 'function') toggleSearch();
    }
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = word;
        if (typeof executeSearch === 'function') executeSearch();
    }
}
// --- Dashboard UI Helpers for Sliders ---

function syncPulseSlider(sliderId, labelId = null, unit = '') {
    const slider = document.getElementById(sliderId);
    if (!slider) return;
    
    // Update label if it exists
    if (labelId) {
        const label = document.getElementById(labelId);
        if (label) label.textContent = slider.value + unit;
    }
    
    // Update the visual "fill bar" for Chrome/Webkit browsers via linear-gradient
    const min = slider.min || 0;
    const max = slider.max || 100;
    const val = ((slider.value - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${val}%, rgba(255,255,255,0.1) ${val}%, rgba(255,255,255,0.1) 100%)`;
}

function initPulseSliders() {
    const sliders = [
        { id: 'pulse-word-pct', label: 'pulse-word-pct-val', unit: '%' },
        { id: 'pulse-ice-gap', label: 'pulse-ice-val', unit: 'h' },
        { id: 'pulse-ghs-gap', label: 'pulse-ghs-val', unit: 'h' }
    ];
    
    sliders.forEach(config => {
        const slider = document.getElementById(config.id);
        if (slider) {
            // Initial sync
            syncPulseSlider(config.id, config.label, config.unit);
            
            // On input sync
            slider.addEventListener('input', (e) => {
                e.stopPropagation(); // Stop bubbling to prevent accidental dashboard-wide refreshes
                syncPulseSlider(config.id, config.label, config.unit);
            });
        }
    });
}
