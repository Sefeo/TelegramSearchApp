// Pulse Dashboard Consistency Renderer Module
// Handles the Consistency Grid (Time Matrix and Pulse Stream)

import * as State from './state.js';

export function switchCgMode(mode) {
    State.setCgMode(mode);
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

export function renderConsistencyGrid() {
    if (!State.pulseData || !State.pulseData.consistency) return;
    const consistency = State.pulseData.consistency;
    const metrics = computeCgMetrics(consistency);

    if (State._cgMode === 'matrix') renderTimeMatrix(consistency, metrics);
    else renderPulseStream(consistency, metrics);
}

function computeCgMetrics(consistency) {
    const counts = Object.values(consistency).map(d => d.total);
    const maxVal = Math.max(...counts, 1);

    const sorted = [...counts].sort((a, b) => a - b);
    const p99idx = Math.floor(sorted.length * 0.99);
    const top1pct = sorted[p99idx] || maxVal;

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

    for (let year = maxYear; year >= minYear; year--) {
        const block = document.createElement('div');
        block.className = 'tm-year-block';

        const label = document.createElement('div');
        label.className = 'tm-year-label';
        label.textContent = String(year);
        block.appendChild(label);

        const wrapper = document.createElement('div');
        wrapper.className = 'tm-wrapper';

        const dowCol = document.createElement('div');
        dowCol.className = 'tm-dow-labels';
        for (let i = 0; i < 7; i++) {
            const lbl = document.createElement('div');
            lbl.className = 'tm-dow-label';
            lbl.textContent = DOW_LABELS[i];
            dowCol.appendChild(lbl);
        }
        wrapper.appendChild(dowCol);

        const main = document.createElement('div');
        main.className = 'tm-main';

        const jan1 = new Date(Date.UTC(year, 0, 1));
        const dec31 = new Date(Date.UTC(year, 11, 31));
        const jan1Dow = (jan1.getUTCDay() + 6) % 7;

        const weeks = [];
        let currentDate = new Date(jan1);
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

        const monthRow = document.createElement('div');
        monthRow.className = 'tm-month-row';
        let lastMonth = -1;
        weeks.forEach(week => {
            const lbl = document.createElement('div');
            lbl.className = 'tm-month-label';
            const firstInYear = week.find(d => d.inYear);
            if (firstInYear && firstInYear.month !== lastMonth) {
                lbl.textContent = MONTHS[firstInYear.month];
                lastMonth = firstInYear.month;
            }
            monthRow.appendChild(lbl);
        });
        main.appendChild(monthRow);

        const grid = document.createElement('div');
        grid.className = 'tm-grid';
        weeks.forEach(week => {
            const col = document.createElement('div');
            col.className = 'tm-week-col';
            week.forEach(day => {
                if (!day.inYear) {
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
            el.lastElementChild.style.marginRight = '8px';
        }
        lastMonth = curMonth;

        const data = consistency[d];
        const sq = makeCgSquare(d, data, metrics);
        el.appendChild(sq);
    });
}

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

        if (data.total >= metrics.top1pct && metrics.top1pct > 5) {
            sq.classList.add('cg-supernova');
        }

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

    sq.onclick = () => window.open('/?date=' + dateStr, '_blank');
    sq.addEventListener('mouseenter', (e) => showCgTooltip(e, dateStr, data, metrics));
    sq.addEventListener('mouseleave', hideCgTooltip);
    sq.addEventListener('mousemove', (e) => moveCgTooltip(e));

    return sq;
}

function showCgTooltip(e, dateStr, data, metrics) {
    const tip = document.getElementById('cg-tooltip');
    if (!tip) return;

    if (State._cgMode === 'stream') {
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
        const senders = Object.entries(data.senders).sort((a, b) => b[1] - a[1]);
        html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 2px;">';
        senders.forEach(([name, count]) => {
            const pct = ((count / data.total) * 100).toFixed(0);
            html += `<div class="cg-tt-sender"><span style="color:${getColor(name)}">🗣️ ${name}</span><span>${count} (${pct}%)</span></div>`;
        });
        html += '</div>';
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
    let left = e.clientX + 12;
    let top = e.clientY - 10;
    if (tip.parentElement !== document.body) document.body.appendChild(tip);
    if (left + tip.offsetWidth > window.innerWidth - 10) left = e.clientX - tip.offsetWidth - 12;
    if (top + tip.offsetHeight > window.innerHeight - 10) top = window.innerHeight - tip.offsetHeight - 10;
    if (top < 10) top = 10;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
}

function hideCgTooltip() {
    const tip = document.getElementById('cg-tooltip');
    if (tip) tip.style.display = 'none';
}
