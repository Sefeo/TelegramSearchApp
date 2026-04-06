// Pulse Dashboard Dynamics Renderer Module
// Handles Chat Dynamics tabs and visualizations

import * as State from './state.js';

export function switchDynamicsTab(tabId) {
    State.setCurrentDynamicsTab(tabId);
    
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
    if (State.dynamicsData) {
        renderCurrentDynamicsTab();
    }
}

export async function fetchAndRenderChatDynamics() {
    const dynamicsCard = document.getElementById('chatDynamicsCard');
    if (!dynamicsCard || dynamicsCard.style.display === 'none') return;
    
    const isAllSenders = State.pulseCurrentSenders.size === State.allSendersList.length;
    const sendersQuery = isAllSenders ? 'all' : Array.from(State.pulseCurrentSenders).join(',');
    const startDate = document.getElementById('pulse-start-date')?.value || '';
    const endDate = document.getElementById('pulse-end-date')?.value || '';
    const iceGap = parseInt(document.getElementById('pulse-ice-gap')?.value) || 8;
    const ghsGap = parseInt(document.getElementById('pulse-ghs-gap')?.value) || 4;

    const currentParams = `${startDate}|${endDate}|${sendersQuery}|${iceGap}|${ghsGap}`;
    
    // Check if we need to refetch
    if (State.lastDynamicsFetchParams === currentParams && State.dynamicsData) {
        renderCurrentDynamicsTab();
        return;
    }
    
    State.setLastDynamicsFetchParams(currentParams);
    
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
        const data = await res.json();
        State.setDynamicsData(data);
    } catch (e) {
        console.error("Error fetching chat dynamics", e);
        State.setLastDynamicsFetchParams(null); // Reset so next attempt can retry
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
    const activeCont = document.getElementById('dyn-content-' + State.currentDynamicsTab);
    if (activeCont) activeCont.style.display = 'block';

    renderCurrentDynamicsTab();
}

export async function applyAndFetchDynamics() {
    State.setLastDynamicsFetchParams(null);
    await fetchAndRenderChatDynamics();
}

export function renderCurrentDynamicsTab() {
    const data = State.dynamicsData;
    if (!data || data.error) return;
    
    const dataArr = Object.entries(data)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.msgs - a.msgs);
        
    const top10 = dataArr.slice(0, 10);

    if (State.currentDynamicsTab === 'messages') renderDynamicsMessages(top10, dataArr.length);
    else if (State.currentDynamicsTab === 'icebreaker') renderDynamicsIcebreaker(top10);
    else if (State.currentDynamicsTab === 'ghosting') renderDynamicsGhosting(top10);
    else if (State.currentDynamicsTab === 'length') renderDynamicsLength(top10);
    else if (State.currentDynamicsTab === 'burst') renderDynamicsBurst(top10);
}

function renderDynamicsMessages(top10, totalSendersCount) {
    const sb = document.getElementById('dyn-content-messages');
    if (!sb) return;
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
    if (State.pulseCharts.icebreaker) State.pulseCharts.icebreaker.destroy();
    
    const sorted = [...top10].sort((a,b) => b.icebreakers - a.icebreakers);
    const labels = sorted.map(s => s.name);
    const data = sorted.map(s => s.icebreakers);
    
    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#64748b', '#d946ef'];

    State.pulseCharts.icebreaker = new Chart(ctx, {
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
    if (!el) return;
    el.innerHTML = '';

    const gapThresholdHours = document.getElementById('pulse-ghs-gap') ? parseInt(document.getElementById('pulse-ghs-gap').value) || 1 : 1;
    
    const CATEGORIES = [
        { key: 'insta',   label: 'Inter',   color: '#10b981', desc: '< 30s' },
        { key: 'active',  label: 'Active',  color: '#3b82f6', desc: '30s – 5m'  },
        { key: 'delayed', label: 'Delayed', color: '#f59e0b', desc: '5m – 1h'   }
    ];
    
    if (gapThresholdHours > 1) {
        CATEGORIES.push({ key: 'ghosted', label: 'Ghosted', color: '#ef4444', desc: `1h – ${gapThresholdHours}h` });
        CATEGORIES.push({ key: 'extended', label: 'Extended', color: '#7f1d1d', desc: `≥ ${gapThresholdHours}h` });
    } else {
        CATEGORIES.push({ key: 'ghosted', label: 'Ghosted', color: '#ef4444', desc: '≥ 1h' });
    }

    const valid = top10.filter(s => s.ghost_stats);
    if (valid.length === 0) {
        el.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--pulse-text-muted);">No reply data.</div>`;
        return;
    }
    
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

        const segments = CATEGORIES.map(c => {
            const bucket = gs[c.key];
            if (!bucket || bucket.count === 0) return '';
            const pct = bucket.pct;
            const tooltipHtml = `<b>${c.label}</b> (${c.desc})<hr style="border-color:#333; margin:3px 0;">Count: ${bucket.count} of ${totalRecords}<br>Share: ${pct}%`;
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
    if (!el) return;
    el.innerHTML = '';
    
    const sorted = [...top10].sort((a, b) => b.avg_length - a.avg_length);
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
    if (!el) return;
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
                const colors = ['#c084fc','#a855f7','#8b5cf6','#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#881337'];
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
            <div id="${rowId}" class="pulse-burst-row" style="margin-bottom: 12px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; position: relative; z-index: ${100-i};" onclick="window.toggleBurstBreakdown('${rowId}')">
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

window.toggleBurstBreakdown = function(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const bd = row.querySelector('.burst-breakdown');
    if (!bd) return;
    const isHidden = bd.style.display === 'none';
    bd.style.display = isHidden ? 'block' : 'none';
    row.style.background = isHidden ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
};
