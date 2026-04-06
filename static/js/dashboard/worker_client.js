import * as State from './state.js';

let pulseWorker = null;
let pulseWorkerLoaded = false;

export function initWorker() {
    try {
        pulseWorker = new Worker('/static/js/pulse_worker.js?v=2');
        pulseWorker.onmessage = async function (e) {
            const { type } = e.data;

            if (type === 'loaded') {
                pulseWorkerLoaded = true;
                _triggerCompute();
                return;
            }

            if (type === 'result') {
                // Dynamically import to break top-level circles
                const { renderCharts } = await import('./charts_renderer.js');
                const { hidePulseLoader } = await import('./ui_manager.js');

                State.setPulseData(e.data.stats);
                const pulseData = e.data.stats;
                // Auto-fill date placeholders
                const start = document.getElementById('pulse-start-date')?.value || '';
                const end = document.getElementById('pulse-end-date')?.value || '';
                if (!start && !end && pulseData.years && pulseData.years.length > 0) {
                    const startEl = document.getElementById('pulse-start-date');
                    const endEl = document.getElementById('pulse-end-date');
                    if (startEl) startEl.placeholder = pulseData.years[0] + '-01-01';
                    if (endEl) endEl.placeholder = pulseData.years[pulseData.years.length - 1] + '-12-31';
                }
                renderCharts();
                hidePulseLoader();
                return;
            }

            if (type === 'custom_words_result') {
                const { renderCustomWords, setCwResults, setCwLoading } = await import('./words_renderer.js');
                setCwResults(e.data.results);
                setCwLoading(false);
                renderCustomWords();
                return;
            }

            if (type === 'error') {
                const { hidePulseLoader } = await import('./ui_manager.js');
                console.error('Pulse worker error:', e.data.msg);
                hidePulseLoader();
            }
        };
        pulseWorker.onerror = async function (err) {
            const { hidePulseLoader } = await import('./ui_manager.js');
            console.error('Pulse worker error:', err);
            hidePulseLoader();
        };
    } catch (e) {
        console.warn('Web Worker not available', e);
    }
}

export function isWorkerLoaded() {
    return pulseWorkerLoaded;
}

export async function _triggerCompute(targetCardIds = null) {
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

    const { showPulseLoader } = await import('./ui_manager.js');
    showPulseLoader(targetCardIds);
    
    // Yield to let the browser paint the loaders before blocking the thread
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            pulseWorker.postMessage({
                type: 'compute',
                senders: Array.from(State.pulseCurrentSenders),
                allSendersCount: State.allSendersList.length,
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

export function loadDataIntoWorker(messages, meta) {
    if (pulseWorker) {
        pulseWorkerLoaded = false;
        pulseWorker.postMessage({ type: 'load', messages, meta });
    }
}

export function computeCustomWords(words, senders, startDate, endDate) {
    if (!pulseWorker || !pulseWorkerLoaded) return;
    pulseWorker.postMessage({
        type: 'custom_words',
        words,
        senders,
        allSendersCount: State.allSendersList.length,
        startDate,
        endDate
    });
}
