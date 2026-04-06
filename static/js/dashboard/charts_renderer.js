import * as State from './state.js';
import { formatTooltip } from './tooltips.js';

export async function renderCharts() {
    if (!State.pulseData) return;
    const pulseData = State.pulseData;

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

    // 1. Circadian Rhythm (Radar)
    renderCircadianChart(pulseData);

    // 1b. Weekly Activity (PolarArea)
    renderWeeklyChart(pulseData);

    // 2. Consistency Grid — Dual Mode (Dynamic import)
    const { renderConsistencyGrid } = await import('./consistency_renderer.js');
    renderConsistencyGrid();

    // 3. Media DNA (Doughnut)
    renderMediaDnaChart(pulseData);

    // 4. Chat Dynamics (Dynamic import)
    const dynamicsCard = document.getElementById('chatDynamicsCard');
    if (dynamicsCard) {
        const { fetchAndRenderChatDynamics } = await import('./dynamics_renderer.js');
        fetchAndRenderChatDynamics();
    }

    // 5. Fingerprints
    renderFingerprints(pulseData);

    // 6. Signature Words
    renderSignatureWords(pulseData);
}

function renderCircadianChart(pulseData) {
    const circCanvas = document.getElementById('circadianChart');
    if (!circCanvas) return;
    
    const cD = pulseData.circadian;
    const circData = Array.from({ length: 24 }, (_, i) => {
        let obj = cD[i.toString().padStart(2, '0')];
        return obj ? obj.total : 0;
    });

    if (State.pulseCharts.circadian) {
        State.pulseCharts.circadian.data.datasets[0].data = circData;
        State.pulseCharts.circadian.options.plugins.tooltip.callbacks.label = function (context) {
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
        State.pulseCharts.circadian.update('none');
    } else {
        const circCtx = circCanvas.getContext('2d');
        State.pulseCharts.circadian = new Chart(circCtx, {
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

function renderWeeklyChart(pulseData) {
    const weekCanvas = document.getElementById('weeklyChart');
    if (!weekCanvas || !pulseData.weekly) return;
    
    const DOW_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const DOW_COLORS = ['#3b82f6','#06b6d4','#10b981','#84cc16','#f59e0b','#f43f5e','#8b5cf6'];
    const wd = pulseData.weekly;
    const weekData = DOW_ORDER.map(d => wd[d] ? wd[d].total : 0);

    if (State.pulseCharts.weekly) {
        State.pulseCharts.weekly.data.datasets[0].data = weekData;
        State.pulseCharts.weekly.options.plugins.tooltip.callbacks.label = function(context) {
            const dayName = context.label;
            const dayObj = wd[dayName];
            if (!dayObj || !dayObj.total) return `Total: 0`;
            const lines = [`${dayName}: ${dayObj.total} msgs`];
            Object.entries(dayObj.senders).sort((a,b) => b[1]-a[1]).slice(0,3).forEach(([sName, sCount]) => {
                lines.push(`  ${sName}: ${sCount} (${((sCount/dayObj.total)*100).toFixed(1)}%)`);
            });
            return lines;
        };
        State.pulseCharts.weekly.update('none');
    } else {
        const weekCtx = weekCanvas.getContext('2d');
        State.pulseCharts.weekly = new Chart(weekCtx, {
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

function renderMediaDnaChart(pulseData) {
    const mediaCanvas = document.getElementById('mediaDnaChart');
    if (!mediaCanvas) return;
    
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

    if (State.pulseCharts.mediaDna) {
        State.pulseCharts.mediaDna.data.datasets[0].data = mediaData;
        State.pulseCharts.mediaDna.options.plugins.tooltip.callbacks.label = mediaTooltipFn;
        State.pulseCharts.mediaDna.update('none');
    } else {
        const mediaCtx = mediaCanvas.getContext('2d');
        State.pulseCharts.mediaDna = new Chart(mediaCtx, {
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

function renderFingerprints(pulseData) {
    // Emoji Fingerprint
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

    // Sticker Fingerprint
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

    // GIF Fingerprint
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
}

function renderSignatureWords(pulseData) {
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
            el.style.cursor = 'pointer'; // Make it look clickable
            el.textContent = w.word;

            el.onclick = () => window.open('/?search=' + encodeURIComponent(w.word), '_blank');

            const tooltip = document.createElement('div');
            tooltip.className = 'pulse-tooltip-text';
            tooltip.innerHTML = formatTooltip(w.senders, w.word);
            el.appendChild(tooltip);

            wordCont.appendChild(el);
        });
    }
}
