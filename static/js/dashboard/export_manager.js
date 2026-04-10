import * as State from './state.js';

const EXPORT_SECTIONS = [
    { id: 'circadianCard', label: 'Circadian Rhythm 🕒', subtabs: ['hourly', 'weekly'] },
    { id: 'consistencyCard', label: 'Consistency Grid 📅', subtabs: ['matrix', 'stream'] },
    { id: 'mediaDnaCard', label: 'Media DNA 🧬', isMedium: true },
    { id: 'chatDynamicsCard', label: 'Chat Dynamics 📊', subtabs: ['messages', 'icebreaker', 'ghosting', 'length', 'burst'] },
    { id: 'emojiCard', label: 'Emoji Fingerprint ✨' },
    { id: 'signatureWordsCard', label: 'Signature Words 🔠', subtabs: ['percentage', 'custom'], actualId: 'wordsCard' },
    { id: 'stickerCard', label: 'Sticker Fingerprint 🖼️' },
    { id: 'gifCard', label: 'GIF Fingerprint 🎞️' }
];

export function showPulseExportModal() {
    if (document.querySelector('.pulse-export-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'pulse-export-overlay';
    
    let sectionsHtml = EXPORT_SECTIONS.map(section => {
        const subtabsHtml = section.subtabs ? `
            <div class="pulse-export-children">
                ${section.subtabs.map(st => `
                    <label class="pulse-export-child">
                        <input type="checkbox" checked data-parent="${section.id}" data-subtab="${st}">
                        ${st.charAt(0).toUpperCase() + st.slice(1)}
                    </label>
                `).join('')}
            </div>
        ` : '';

        return `
            <div class="pulse-export-item">
                <label class="pulse-export-parent">
                    <input type="checkbox" checked data-section="${section.id}" class="parent-checkbox">
                    ${section.label}
                </label>
                ${subtabsHtml}
            </div>
        `;
    }).join('');

    overlay.innerHTML = `
        <div class="pulse-export-modal">
            <div class="pulse-export-header">
                <h3>Export Dashboard</h3>
                <button class="pulse-close" id="close-export">✖</button>
            </div>
            <div class="pulse-export-body">
                <div id="export-selection-view">
                    ${sectionsHtml}
                    <label class="pulse-export-toggle">
                        <span>Show sliders (fixed position)</span>
                        <input type="checkbox" id="export-show-sliders" checked>
                    </label>
                </div>
                <div class="pulse-export-loading" id="export-loading-view">
                    <div class="spinner"></div>
                    <p id="export-status">Preparing resources...</p>
                </div>
            </div>
            <div class="pulse-export-footer">
                <button class="pulse-export-btn secondary" id="cancel-export">Cancel</button>
                <button class="pulse-export-btn primary" id="confirm-export">Download HTML</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#close-export').onclick = () => overlay.remove();
    overlay.querySelector('#cancel-export').onclick = () => overlay.remove();
    
    overlay.querySelectorAll('.parent-checkbox').forEach(cb => {
        cb.onchange = () => {
            const sectionId = cb.dataset.section;
            overlay.querySelectorAll(`[data-parent="${sectionId}"]`).forEach(child => {
                child.checked = cb.checked;
            });
        };
    });

    overlay.querySelector('#confirm-export').onclick = () => generateInteractiveHtml(overlay);
}

async function generateInteractiveHtml(modal) {
    const status = modal.querySelector('#export-status');
    modal.querySelector('#export-selection-view').style.display = 'none';
    modal.querySelector('#export-loading-view').style.display = 'flex';
    modal.querySelector('.pulse-export-footer').style.display = 'none';

    try {
        const selections = gatherSelections(modal);
        const showSliders = modal.querySelector('#export-show-sliders').checked;

        status.textContent = 'Rendering all subtabs...';
        await ensureAllTabsRendered();

        status.textContent = 'Cloning dashboard...';
        status.textContent = 'Cloning dashboard...';
        const originalDash = document.getElementById('pulse-dashboard');
        
        // Force primary tabs before cloning to ensure predictable start state
        if (window.switchCircadianTab) window.switchCircadianTab('hourly');
        if (window.switchCgMode) window.switchCgMode('matrix');
        if (window.switchDynamicsTab) window.switchDynamicsTab('messages');
        
        const prevSwT = State._sigWordsTab;
        if (window.switchSigWordsTab) {
            if (!State._cwResults || prevSwT === 'custom') window.switchSigWordsTab('pct');
        }

        const dashClone = originalDash.cloneNode(true);
        
        // Restoration handled by user clicking if needed, or we just leave it at defaults for export snapshot

        if (State._cwResults) {
            const vizClone = dashClone.querySelector('#cw-viz');
            if (vizClone) {
                vizClone.innerHTML = '';
                const towContainer = document.createElement('div');
                towContainer.id = 'cw-viz-tug';
                towContainer.style.display = State._cwViewMode === 'tug' ? 'block' : 'none';
                
                const matrixContainer = document.createElement('div');
                matrixContainer.id = 'cw-viz-matrix';
                matrixContainer.style.display = State._cwViewMode === 'matrix' ? 'block' : 'none';
                
                const { renderCustomWords, switchCwView } = await import('./words_renderer.js');
                const origViz = document.getElementById('cw-viz');
                
                const prevMode = State._cwViewMode;
                switchCwView('tug');
                towContainer.innerHTML = origViz.innerHTML;
                switchCwView('matrix');
                matrixContainer.innerHTML = origViz.innerHTML;
                switchCwView(prevMode);
                
                vizClone.appendChild(towContainer);
                vizClone.appendChild(matrixContainer);
            }
        }

        status.textContent = 'Converting media to Base64...';
        await processMedia(dashClone);

        status.textContent = 'Gathering statistics...';
        const chartStates = captureChartStates();
        const exportData = {
            circadian: State.pulseData.circadian,
            weekly: State.pulseData.weekly,
            media_dna: State.pulseData.media_dna,
            consistency: State.pulseData.consistency,
            senderColors: Object.fromEntries(State.allSendersList.map(s => [s.name, s.color])),
            hasCw: !!State._cwResults
        };

        status.textContent = 'Pruning components...';
        pruneDashboard(dashClone, selections, showSliders);

        status.textContent = 'Inlining styles...';
        const cssContent = await bundleCss();

        status.textContent = 'Generating interactivity script...';
        const jsContent = generateLiteScript(selections, chartStates, exportData);

        status.textContent = 'Final Bundle...';
        const finalHtml = assembleBundle(dashClone.innerHTML, cssContent, jsContent);

        const blob = new Blob([finalHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Pulse_Export_${new Date().toISOString().slice(0, 10)}.html`;
        a.click();
        URL.revokeObjectURL(url);
        
        modal.remove();
    } catch (err) {
        console.error('Export failed', err);
        status.innerHTML = `<span style="color: #f87171;">Error: ${err.message}</span>`;
        modal.querySelector('.pulse-export-footer').style.display = 'flex';
    }
}

async function ensureAllTabsRendered() {
    const { renderConsistencyGrid } = await import('./consistency_renderer.js');
    const prevCgMode = State._cgMode;
    State.setCgMode('stream');
    renderConsistencyGrid();
    State.setCgMode('matrix');
    renderConsistencyGrid();
    State.setCgMode(prevCgMode);

    const { renderCurrentDynamicsTab } = await import('./dynamics_renderer.js');
    const prevDynTab = State.currentDynamicsTab;
    const tabs = ['messages', 'icebreaker', 'ghosting', 'length', 'burst'];
    for (const t of tabs) {
        State.setCurrentDynamicsTab(t);
        renderCurrentDynamicsTab();
    }
    State.setCurrentDynamicsTab(prevDynTab);
}

function gatherSelections(modal) {
    const selections = { sections: [], subtabs: [] };
    modal.querySelectorAll('[data-section]').forEach(cb => {
        if (cb.checked) selections.sections.push(cb.dataset.section);
    });
    modal.querySelectorAll('[data-subtab]').forEach(cb => {
        if (cb.checked) selections.subtabs.push(cb.dataset.subtab);
    });
    return selections;
}

async function processMedia(container) {
    const images = Array.from(container.querySelectorAll('img'));
    const videos = Array.from(container.querySelectorAll('video'));
    
    const uniqueUrls = [...new Set([
        ...images.map(img => img.src),
        ...videos.map(vid => vid.src)
    ])].filter(url => url && !url.startsWith('data:'));

    const base64Map = {};
    await Promise.all(uniqueUrls.map(async url => {
        try {
            const b64 = await urlToBase64(url);
            base64Map[url] = b64;
        } catch (e) { 
            console.warn('Failed to bundle media', url); 
        }
    }));

    images.forEach(img => {
        if (base64Map[img.src]) img.src = base64Map[img.src];
    });
    videos.forEach(vid => {
        if (base64Map[vid.src]) {
            vid.src = base64Map[vid.src];
            vid.setAttribute('autoplay', 'true');
            vid.setAttribute('loop', 'true');
            vid.setAttribute('muted', 'true');
            vid.setAttribute('playsinline', 'true');
        }
    });
}

function urlToBase64(url) {
    return new Promise((resolve, reject) => {
        fetch(url)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            })
            .catch(reject);
    });
}

function captureChartStates() {
    const result = {};
    ['circadianChart', 'weeklyChart', 'mediaDnaChart', 'icebreakerChart'].forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas && typeof Chart !== 'undefined') {
            const chart = Chart.getChart(canvas);
            if (chart) {
                result[id] = {
                    type: chart.config.type,
                    data: JSON.parse(JSON.stringify(chart.config.data)),
                    options: JSON.parse(JSON.stringify(chart.config.options))
                };
            }
        }
    });
    return result;
}

function pruneDashboard(clone, selections, showSliders) {
    EXPORT_SECTIONS.forEach(s => {
        const id = s.actualId || s.id;
        const card = clone.querySelector(`#${id}`);
        if (card && !selections.sections.includes(s.id)) {
            card.remove();
        }
    });

    const subtabMap = {
        'hourly': '#circ-panel-hourly, #circ-tab-hourly',
        'weekly': '#circ-panel-weekly, #circ-tab-weekly',
        'matrix': '#cg-time-matrix, [data-cgmode="matrix"]',
        'stream': '#cg-pulse-stream, [data-cgmode="stream"]',
        'messages': '#dyn-content-messages, [data-tab="messages"]',
        'icebreaker': '#dyn-content-icebreaker, [data-tab="icebreaker"]',
        'ghosting': '#dyn-content-ghosting, [data-tab="ghosting"]',
        'length': '#dyn-content-length, [data-tab="length"]',
        'burst': '#dyn-content-burst, [data-tab="burst"]',
        'percentage': '#sigwords-panel-pct, [data-tab="pct"]',
        'custom': '#sigwords-panel-custom, [data-tab="custom"]'
    };

    Object.entries(subtabMap).forEach(([key, selector]) => {
        if (!selections.subtabs.includes(key)) {
            clone.querySelectorAll(selector).forEach(el => el.remove());
        }
    });

    clone.querySelector('.pulse-timeline')?.remove();
    clone.querySelector('.pulse-header .pulse-controls')?.remove();
    clone.querySelector('#pulse-senders-container')?.remove();

    // 4. Handle Controls/Sliders (Specific Selectors)
    if (!showSliders) {
        // Chat Dynamics Control Pod (the grid/flex sibling of the tabs)
        clone.querySelector('#chatDynamicsCard > div > div:last-child')?.remove();
        // Signature Words Control Pod (the panel sibling of the cloud)
        clone.querySelector('#sigwords-panel-pct > div:first-child')?.remove();
        // Timeline & Date Controls
        clone.querySelector('.pulse-timeline')?.remove();
        clone.querySelector('#cw-input')?.remove();
    } else {
        // Disable and lock all interactive inputs
        clone.querySelectorAll('input, select, button').forEach(input => {
            if (input.innerText.includes('Apply') || input.innerText.includes('Fetch') || input.innerText.includes('Reset') || input.tagName === 'INPUT') {
                input.setAttribute('disabled', 'true');
                input.setAttribute('readonly', 'true');
                input.style.opacity = '0.7';
                input.style.cursor = 'not-allowed';
                input.style.pointerEvents = 'none';
            }
        });
    }

    // 5. Strip Jump-to-Chat indicators
    clone.querySelectorAll('.matrix-row-label, .matrix-orb, .pulse-sb-row, .pulse-word').forEach(el => {
        el.removeAttribute('onclick');
        el.style.cursor = 'default';
    });

    // 6. Clean up Tab Styles (Remove inline backgrounds so they rely on CSS)
    clone.querySelectorAll('.pulse-dyn-tab, .cw-view-btn, .sigwords-tab').forEach(btn => {
        btn.removeAttribute('style');
        btn.style.cursor = 'pointer';
    });

    // 7. Hide "Custom" Words if results are missing
    if (!State._cwResults) {
        clone.querySelector('[data-tab="custom"]')?.remove();
        clone.querySelector('#sigwords-panel-custom')?.remove();
    }
}

async function bundleCss() {
    const urls = [
        '/static/css/style.css',
        '/static/css/pulse.css',
        '/static/css/dashboard/base.css',
        '/static/css/dashboard/cards.css',
        '/static/css/dashboard/filters.css',
        '/static/css/dashboard/components.css',
        '/static/css/dashboard/consistency.css'
    ];

    const contents = await Promise.all(urls.map(url => 
        fetch(url).then(r => r.text()).catch(e => '')
    ));

    return contents.join('\n');
}

function generateLiteScript(selections, chartStates, exportData) {
    return `
        const EXPORT_DATA = ${JSON.stringify(exportData)};
        const CHART_CONFIGS = ${JSON.stringify(chartStates)};
        const STREAK_DATA = (() => {
            const streaks = {};
            const allDates = Object.keys(EXPORT_DATA.consistency).sort();
            if (allDates.length === 0) return {};
            let streakStart = allDates[0], streakLen = 1;
            const nextDay = (ds) => {
                const d = new Date(ds + 'T00:00:00Z');
                d.setUTCDate(d.getUTCDate() + 1);
                return d.toISOString().substring(0, 10);
            };
            for (let i = 1; i < allDates.length; i++) {
                if (allDates[i] === nextDay(allDates[i - 1])) streakLen++;
                else {
                    if (streakLen > 1) {
                        let cur = streakStart;
                        for (let j = 0; j < streakLen; j++) { streaks[cur] = streakLen; cur = nextDay(cur); }
                    }
                    streakStart = allDates[i]; streakLen = 1;
                }
            }
            if (streakLen > 1) {
                let cur = streakStart;
                for (let j = 0; j < streakLen; j++) { streaks[cur] = streakLen; cur = nextDay(cur); }
            }
            return streaks;
        })();

        window.switchDynamicsTab = (t) => toggleGroup('chatDynamicsCard', '.pulse-dyn-tab', 'dyn-content-', t, 'active');
        window.switchSigWordsTab = (t) => toggleGroup('wordsCard', '.sigwords-tab', 'sigwords-panel-', t === 'pct' ? 'pct' : 'custom', 'active');
        window.switchCgMode = (t) => {
            const card = document.getElementById('consistencyCard');
            if (!card) return;
            card.querySelectorAll('.cw-view-btn').forEach(b => b.classList.toggle('active', b.dataset.cgmode === t));
            const activeId = t === 'matrix' ? 'time-matrix' : 'pulse-stream';
            card.querySelectorAll('[id^="cg-"]').forEach(c => {
                 if (c.id === 'cg-tooltip') return;
                 c.style.display = c.id === 'cg-' + activeId ? (activeId === 'pulse-stream' ? 'flex' : 'block') : 'none';
            });

            if (t === 'matrix') {
                const lbl = document.getElementById('ps-hover-month');
                if (lbl) lbl.style.display = 'none';
            }
        };
        window.switchCircadianTab = (t) => toggleGroup('circadianCard', '.cw-view-btn', 'circ-panel-', t === 'hourly' ? 'hourly' : 'weekly', 'active');
        
        window.switchCwView = (mode) => {
            document.querySelectorAll('.cw-view-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
            const tug = document.getElementById('cw-viz-tug');
            const mat = document.getElementById('cw-viz-matrix');
            if (tug) tug.style.display = mode === 'tug' ? 'block' : 'none';
            if (mat) mat.style.display = mode === 'matrix' ? 'block' : 'none';
        };

        window.toggleBurstBreakdown = (rowId) => {
            const row = document.getElementById(rowId);
            if (!row) return;
            const bd = row.querySelector('.burst-breakdown');
            if (!bd) return;
            const isHidden = bd.style.display === 'none';
            bd.style.display = isHidden ? 'block' : 'none';
            row.style.background = isHidden ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
        };

        function toggleGroup(cardId, btnClass, contentPrefix, activeId, activeClass) {
            const card = document.getElementById(cardId);
            if (!card) return;
            card.querySelectorAll(btnClass).forEach(b => {
                const bId = b.dataset.tab || b.dataset.cgmode || b.id.replace('circ-tab-','');
                b.classList.toggle(activeClass, bId === activeId);
            });
            card.querySelectorAll('[id^="'+contentPrefix+'"]').forEach(c => {
                 const isFlex = c.id === 'cg-pulse-stream' || c.id === 'dyn-content-messages';
                 c.style.display = c.id === contentPrefix + activeId ? (isFlex ? 'flex' : 'block') : 'none';
            });
            if (typeof Chart !== 'undefined') Chart.getChart(card.querySelector('canvas'))?.resize();
        }

        document.querySelectorAll('.pulse-expand-btn').forEach(btn => {
            btn.onclick = (e) => {
                const card = btn.closest('.pulse-card');
                const expanding = !card.classList.contains('pulse-expanded');
                card.classList.toggle('pulse-expanded');
                btn.innerHTML = expanding ? '⛌' : '⛶';
                if (expanding) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setTimeout(() => { if (window.Chart) Chart.getChart(card.querySelector('canvas'))?.resize(); }, 400);
            };
        });

        document.addEventListener('DOMContentLoaded', () => {
            Object.entries(CHART_CONFIGS).forEach(([id, config]) => {
                const ctx = document.getElementById(id)?.getContext('2d'); if (!ctx) return;
                if (id === 'circadianChart') {
                    config.options.plugins.tooltip.callbacks.label = (context) => {
                        const hourKey = context.dataIndex.toString().padStart(2, '0');
                        const hObj = EXPORT_DATA.circadian[hourKey]; if (!hObj) return 'Total: 0';
                        const lines = ['Total: ' + hObj.total];
                        Object.entries(hObj.senders).sort((a,b) => b[1]-a[1]).forEach(([name, count]) => lines.push(name + ': ' + count + ' (' + ((count/hObj.total)*100).toFixed(1) + '%)'));
                        return lines;
                    };
                } else if (id === 'mediaDnaChart') {
                    config.options.plugins.tooltip.callbacks.label = (ctx) => {
                        const label = ctx.label;
                        const mapping = { 'Text':['text'], 'Photos':['photo'], 'Voice/Video':['voice','round_video'], 'Stickers/GIFs':['sticker','gif'], 'Other':['file','location','poll'] };
                        const keys = mapping[label] || [];
                        let total = 0; let senders = {};
                        keys.forEach(k => { if (EXPORT_DATA.media_dna[k]) { total += EXPORT_DATA.media_dna[k].total; Object.entries(EXPORT_DATA.media_dna[k].senders).forEach(([s,c]) => senders[s] = (senders[s]||0)+c); } });
                        const lines = ['Total: ' + total];
                        Object.entries(senders).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => lines.push(n + ': ' + c + ' (' + ((c/total)*100).toFixed(1) + '%)'));
                        return lines;
                    };
                } else if (id === 'weeklyChart') {
                     config.options.plugins.tooltip.callbacks.label = (ctx) => {
                        const dayName = ctx.label; const dObj = EXPORT_DATA.weekly[dayName]; if (!dObj) return 'Total: 0';
                        const lines = [dayName + ': ' + dObj.total];
                        Object.entries(dObj.senders).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => lines.push('  ' + n + ': ' + c + ' (' + ((c/dObj.total)*100).toFixed(1) + '%)'));
                        return lines;
                    };
                }
                new Chart(ctx, config);
            });
            document.querySelectorAll('.cg-sq').forEach(sq => {
                sq.onmouseenter = (e) => showCgTooltip(e, sq.dataset.date);
                sq.onmouseleave = hideCgTooltip;
                sq.onmousemove = (e) => moveCgTooltip(e);
            });
        });
        
        const tooltip = document.createElement('div');
        tooltip.style = 'position:fixed; background:#000; color:#fff; padding:8px; border-radius:6px; font-size:11px; z-index:100000; display:none; pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.5);';
        document.body.appendChild(tooltip);

        const customTooltip = document.createElement('div');
        customTooltip.id = 'cg-tooltip-export';
        customTooltip.style = 'position:fixed; z-index:100000; background:rgba(15, 23, 42, 0.95); backdrop-filter:blur(8px); padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 10px 25px rgba(0,0,0,0.5); font-size:13px; color:#fff; pointer-events:none; display:none; width:220px; line-height:1.4;';
        document.body.appendChild(customTooltip);

        function showCgTooltip(e, dateStr) {
            const data = EXPORT_DATA.consistency[dateStr];
            const psEl = document.getElementById('cg-pulse-stream');
            const isStream = psEl && psEl.style.display !== 'none';
            const hoverLbl = document.getElementById('ps-hover-month');
            if (hoverLbl) {
                if (!isStream) hoverLbl.style.display = 'none';
                else {
                    const [y, m] = dateStr.split('-');
                    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    hoverLbl.textContent = 'Viewing: ' + monthNames[parseInt(m)-1] + ' ' + y;
                    hoverLbl.style.display = 'flex';
                }
            }
            let html = '<div style="font-weight:700; margin-bottom:6px; color:#94a3b8; font-size:11px; text-transform:uppercase;">📅 ' + dateStr + '</div>';
            if (!data || data.total === 0) html += '<div>✉️ No messages</div>';
            else {
                html += '<div style="font-size:14px; font-weight:800; margin-bottom:8px;">✉️ ' + data.total.toLocaleString() + ' messages</div>';
                Object.entries(data.senders).sort((a,b)=>b[1]-a[1]).forEach(([name, count]) => {
                    const color = EXPORT_DATA.senderColors[name] || '#fff';
                    html += '<div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px;"><span style="color:'+color+'">🗣️ '+name+'</span><span>'+count+' ('+((count/data.total)*100).toFixed(0)+'%)</span></div>';
                });
                const streak = STREAK_DATA[dateStr];
                if (streak && streak > 1) html += '<div style="margin-top:8px; font-weight:700; color:#f59e0b; font-size:11px;">🔥 Hot Streak: ' + streak + ' days</div>';
            }
            customTooltip.innerHTML = html; customTooltip.style.display = 'block'; moveCgTooltip(e);
        }
        function moveCgTooltip(e) { customTooltip.style.left = (e.clientX + 15) + 'px'; customTooltip.style.top = (e.clientY - 10) + 'px'; }
        function hideCgTooltip() { customTooltip.style.display = 'none'; }
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.pulse-tooltip');
            const local = target?.querySelector('.pulse-tooltip-text');
            if (local && !e.target.closest('.cg-sq')) { tooltip.innerHTML = local.innerHTML; tooltip.style.display = 'block'; }
        });
        document.addEventListener('mousemove', (e) => { if (tooltip.style.display === 'block') { tooltip.style.left = (e.clientX + 15) + 'px'; tooltip.style.top = (e.clientY + 15) + 'px'; } });
        document.addEventListener('mouseout', (e) => { if (e.target.closest('.pulse-tooltip')) tooltip.style.display = 'none'; });
    `;
}

function assembleBundle(html, css, js) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat Pulse - Wrapped</title>
    <style>
        html, body { height: auto !important; min-height: 100%; overflow-x: hidden !important; overflow-y: visible !important; }
        body { background: #0f172a; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        #pulse-dashboard { position: relative !important; width: 100% !important; height: auto !important; min-height: 100vh !important; transform: none !important; opacity: 1 !important; visibility: visible !important; display: block !important; overflow: visible !important; padding: 40px 20px !important; }
        ${css}
        .pulse-card { max-height: 900px; display: flex; flex-direction: column; overflow: hidden !important; }
        .pulse-card.pulse-expanded { max-height: none; }
        #cg-time-matrix, #cg-pulse-stream { flex: 1; overflow-y: auto !important; padding-right: 5px; }
        #cg-time-matrix { max-height: 500px; }
        #cg-pulse-stream { max-height: 480px; display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
        .pulse-overlay { position: relative !important; top: 0 !important; left: 0 !important; height: auto !important; width: 100% !important; overflow: visible !important; background: none !important; backdrop-filter: none !important; }
        .matrix-container { max-height: 600px; overflow: auto; }
        
        /* Export-specific Tab Highlighting */
        .pulse-dyn-tab.active, .sigwords-tab.active, .cw-view-btn.active, .cg-mode-btn.active {
            background: rgba(255, 255, 255, 0.15) !important;
            color: #fff !important;
            border: 1px solid rgba(255, 255, 255, 0.25) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
            font-weight: 600 !important;
        }
        .pulse-dyn-tab, .sigwords-tab, .cw-view-btn {
            background: transparent !important;
            border: 1px solid transparent !important;
            transition: all 0.2s;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div id="pulse-dashboard" class="pulse-overlay">
        ${html}
    </div>
    <script>${js}</script>
</body>
</html>
`;
}
