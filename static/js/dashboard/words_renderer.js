// Pulse Dashboard Words Renderer Module
// Handles Signature Words and Custom Words analysis logic

import * as State from './state.js';
import { computeCustomWords as workerComputeCustomWords } from './worker_client.js';

export function setCwResults(val) { State.setCwResults(val); }
export function setCwLoading(val) { State.setCwLoading(val); }

export function switchSigWordsTab(tabId) {
    document.querySelectorAll('.sigwords-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    const pctPanel = document.getElementById('sigwords-panel-pct');
    const customPanel = document.getElementById('sigwords-panel-custom');
    if (pctPanel) pctPanel.style.display = tabId === 'pct' ? 'flex' : 'none';
    if (customPanel) customPanel.style.display = tabId === 'custom' ? 'flex' : 'none';

    if (tabId === 'custom' && State._cwWords.length === 0) {
        const participantCount = State.pulseCurrentSenders ? State.pulseCurrentSenders.size : 0;
        if (participantCount > 3) {
            switchCwView('matrix');
        }
    }
}

export function switchCwView(mode) {
    State.setCwViewMode(mode);
    document.querySelectorAll('.cw-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (State._cwResults) renderCustomWords();
}

export function initCwInput() {
    const input = document.getElementById('cw-input');
    if (!input) return;
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const word = input.value.trim().toLowerCase();
            if (!word || State._cwWords.includes(word)) { input.value = ''; return; }
            State._cwWords.push(word);
            input.value = '';
            renderCwTags();
            debouncedComputeCustomWords();
        }
    });
}

export function renderCwTags() {
    const container = document.getElementById('cw-tags');
    if (!container) return;
    container.innerHTML = '';
    State._cwWords.forEach(w => {
        const tag = document.createElement('span');
        tag.className = 'cw-tag';
        tag.innerHTML = `${escapeHtml(w)} <span class="cw-tag-x" onclick="window.removeCwTag('${escapeHtml(w)}', this)">✖</span>`;
        container.appendChild(tag);
    });
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

window.removeCwTag = function(word, el) {
    const tagEl = el.parentElement;
    tagEl.classList.add('removing');
    setTimeout(() => {
        State.setCwWords(State._cwWords.filter(w => w !== word));
        renderCwTags();
        if (State._cwWords.length === 0) {
            State.setCwResults(null);
            const viz = document.getElementById('cw-viz');
            if (viz) viz.innerHTML = '<div class="cw-empty">Type a word above to see who uses it most ✨</div>';
        } else {
            debouncedComputeCustomWords();
        }
    }, 250);
};

export function debouncedComputeCustomWords() {
    clearTimeout(State._cwDebounce);
    State.setCwDebounce(setTimeout(() => computeCustomWords(), 300));
}

export function computeCustomWords() {
    if (State._cwWords.length === 0) return;
    const viz = document.getElementById('cw-viz');
    if (viz) viz.innerHTML = '<div class="cw-loading"><div class="pulse-spinner"></div>Searching messages...</div>';

    const startDate = document.getElementById('pulse-start-date')?.value || '';
    const endDate = document.getElementById('pulse-end-date')?.value || '';
    
    workerComputeCustomWords(State._cwWords, Array.from(State.pulseCurrentSenders), startDate, endDate);
}

export function renderCustomWords() {
    if (!State._cwResults) return;
    if (State._cwViewMode === 'tug') renderCwTugOfWar();
    else renderCwMatrix();
}

function renderCwTugOfWar() {
    const viz = document.getElementById('cw-viz');
    if (!viz || !State._cwResults) return;
    viz.innerHTML = '';

    if (State._cwResults.every(r => r.total === 0)) {
        viz.innerHTML = '<div class="cw-empty">No matches found for these words 🔍</div>';
        return;
    }

    State._cwResults.forEach(result => {
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

        const sortedSenders = Object.entries(result.senders).sort((a, b) => b[1].count - a[1].count);
        const row = document.createElement('div');
        row.className = 'tow-row';
        const label = document.createElement('div');
        label.className = 'tow-word-label';
        label.innerHTML = `<span>"${escapeHtml(result.word)}"</span><span class="tow-word-total">${result.total.toLocaleString()} uses</span>`;
        row.appendChild(label);

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

            if (pct > 15) {
                seg.innerHTML = `<img src="/avatar/${encodeURIComponent(name)}"><span class="tow-segment-label">${data.count} (${pct.toFixed(0)}%)</span>`;
            } else if (pct > 8) {
                seg.innerHTML = `<span class="tow-segment-label">${data.count}</span>`;
            }

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

function renderCwMatrix() {
    const viz = document.getElementById('cw-viz');
    if (!viz || !State._cwResults) return;
    viz.innerHTML = '';

    if (State._cwResults.every(r => r.total === 0)) {
        viz.innerHTML = '<div class="cw-empty">No matches found for these words 🔍</div>';
        return;
    }

    const senderSet = new Set();
    State._cwResults.forEach(r => Object.keys(r.senders).forEach(s => senderSet.add(s)));
    const senders = Array.from(senderSet);

    if (senders.length === 0) {
        viz.innerHTML = '<div class="cw-empty">No matches found 🔍</div>';
        return;
    }

    let globalMax = 1;
    State._cwResults.forEach(r => {
        Object.values(r.senders).forEach(d => {
            if (d.count > globalMax) globalMax = d.count;
        });
    });

    const container = document.createElement('div');
    container.className = 'matrix-container';
    const grid = document.createElement('div');
    grid.className = 'matrix-grid';
    grid.style.gridTemplateColumns = `auto repeat(${senders.length}, 1fr)`;

    grid.innerHTML += '<div></div>';
    senders.forEach(s => {
        grid.innerHTML += `<div class="matrix-header-cell">
            <img src="/avatar/${encodeURIComponent(s)}">
            <span>${escapeHtml(s)}</span>
        </div>`;
    });

    State._cwResults.forEach((result, rowIdx) => {
        const labelEl = document.createElement('div');
        labelEl.className = 'matrix-row-label';
        labelEl.textContent = '"' + result.word + '"';
        labelEl.onclick = () => deepLinkSearch(result.word);
        grid.appendChild(labelEl);

        senders.forEach(s => {
            const cell = document.createElement('div');
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.setAttribute('data-row', rowIdx);

            const data = result.senders[s];
            if (data && data.count > 0) {
                const ratio = data.count / globalMax;
                const scale = 0.3 + ratio * 0.7;
                const opacity = 0.3 + ratio * 0.7;
                const color = getColor(s);

                const orb = document.createElement('div');
                orb.className = 'matrix-orb pulse-tooltip';
                orb.style.background = color;
                orb.style.transform = `scale(${scale.toFixed(2)})`;
                orb.style.opacity = opacity.toFixed(2);
                orb.style.boxShadow = `0 0 ${Math.round(ratio * 15)}px ${color}88`;
                orb.textContent = data.count;

                const pct = result.total > 0 ? ((data.count / result.total) * 100).toFixed(1) : 0;
                const tip = document.createElement('div');
                tip.className = 'pulse-tooltip-text';
                tip.innerHTML = `<b>${escapeHtml(result.word)}</b><hr style="border-color:#333;margin:3px 0;"><b>${escapeHtml(s)}</b><br>Count: ${data.count} (${pct}%)`
                    + (data.first_date ? `<br><span style="color:#94a3b8;">First used: ${data.first_date}</span>` : '');
                orb.appendChild(tip);

                orb.onclick = (e) => { e.stopPropagation(); deepLinkSearch(result.word); };
                cell.appendChild(orb);
            } else {
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

export function deepLinkSearch(word) {
    // Open in a new tab as requested by the user
    window.open('/?search=' + encodeURIComponent(word), '_blank');
}
