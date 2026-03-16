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
let pulseLastMousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// Track mouse position for floating loader
document.addEventListener('mousemove', (e) => {
    pulseLastMousePos.x = e.clientX;
    pulseLastMousePos.y = e.clientY;
    const loader = document.getElementById('pulse-loading');
    if (loader && loader.style.display === 'block') {
        positionFloatingLoader(loader);
    }
});

function positionFloatingLoader(loader) {
    const offsetX = 20;
    const offsetY = 20;
    let x = pulseLastMousePos.x + offsetX;
    let y = pulseLastMousePos.y + offsetY;

    // Keep within viewport
    const rect = loader.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = pulseLastMousePos.x - rect.width - offsetX;
    if (y + rect.height > window.innerHeight) y = pulseLastMousePos.y - rect.height - offsetY;
    if (x < 0) x = 10;
    if (y < 0) y = 10;

    loader.style.left = x + 'px';
    loader.style.top = y + 'px';
}

function showPulseLoader() {
    const loader = document.getElementById('pulse-loading');
    if (loader) {
        loader.style.display = 'block';
        positionFloatingLoader(loader);
    }
}

function hidePulseLoader() {
    const loader = document.getElementById('pulse-loading');
    if (loader) loader.style.display = 'none';
}

function togglePulseDashboard() {
    const dash = document.getElementById('pulse-dashboard');
    if (dash.classList.contains('pulse-hidden')) {
        dash.classList.remove('pulse-hidden');
        if (!pulseRawMessages) {
            initPulse();
        }
    } else {
        dash.classList.add('pulse-hidden');
    }
}

async function initPulse() {
    try {
        const res = await fetch('/api/senders');
        allSendersList = await res.json();
    } catch (e) { console.error("Error fetching senders", e); }

    pulseCurrentSenders = new Set(allSendersList.slice(0, 5).map(s => s.name));
    renderSenderToggles();
    await loadRawDataAndRender();
}

async function loadRawDataAndRender() {
    showPulseLoader();
    try {
        const res = await fetch('/api/pulse_raw');
        const raw = await res.json();
        pulseRawMessages = raw.messages;
        pulseRawMeta = { min_date: raw.min_date, max_date: raw.max_date };

        // Initialize slider data from raw metadata
        if (pulseMonths.length === 0 && pulseRawMeta.min_date && pulseRawMeta.max_date) {
            initSlider(pulseRawMeta.min_date, pulseRawMeta.max_date);
        }

        recomputeAndRender();
    } catch (e) {
        console.error("Error fetching raw pulse data", e);
    } finally {
        hidePulseLoader();
    }
}

function recomputeAndRender() {
    if (!pulseRawMessages) return;

    const filtered = filterMessages(pulseRawMessages);
    pulseData = computePulseStats(filtered);

    // Carry over meta info for date placeholders
    if (pulseRawMeta) {
        pulseData.min_date = pulseRawMeta.min_date;
        pulseData.max_date = pulseRawMeta.max_date;
        // Compute year range
        const minY = parseInt(pulseRawMeta.min_date.substring(0, 4));
        const maxY = parseInt(pulseRawMeta.max_date.substring(0, 4));
        pulseData.years = [];
        for (let y = minY; y <= maxY; y++) pulseData.years.push(String(y));
    }

    // Auto-fill date placeholders
    const start = document.getElementById('pulse-start-date')?.value || '';
    const end = document.getElementById('pulse-end-date')?.value || '';
    if (!start && !end && pulseData.years && pulseData.years.length > 0) {
        document.getElementById('pulse-start-date').placeholder = pulseData.years[0] + "-01-01";
        document.getElementById('pulse-end-date').placeholder = pulseData.years[pulseData.years.length - 1] + "-12-31";
    }

    renderCharts();
}

function filterMessages(messages) {
    const isAllSenders = pulseCurrentSenders.size === allSendersList.length;
    const startDate = document.getElementById('pulse-start-date')?.value || '';
    const endDate = document.getElementById('pulse-end-date')?.value || '';
    const startTs = startDate ? startDate + ' 00:00:00' : '';
    const endTs = endDate ? endDate + ' 23:59:59' : '';

    return messages.filter(msg => {
        // Filter by sender
        if (!isAllSenders && !pulseCurrentSenders.has(msg.s)) return false;
        // Filter by date
        if (startTs && msg.t < startTs) return false;
        if (endTs && msg.t > endTs) return false;
        return true;
    });
}

function computePulseStats(messages) {
    const stats = {};

    // Pre-initialize buckets
    const hours = {};
    for (let i = 0; i < 24; i++) hours[i.toString().padStart(2, '0')] = { total: 0, senders: {} };

    const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekly = {};
    for (let i = 0; i < 7; i++) weekly[DOW_NAMES[i]] = { total: 0, senders: {} };

    const consistency = {};
    const mediaCounts = {};
    const textCount = { total: 0, senders: {} };
    const senderCounts = {};
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu;
    const emojiCounts = {};
    const stopWords = new Set(['that', 'this', 'with', 'from', 'your', 'have', 'they', 'will', 'what', 'there', 'would', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'person', 'into', 'year', 'good', 'some', 'could', 'them', 'other', 'than', 'then', 'look', 'only', 'come', 'over', 'think', 'also', 'back', 'after', 'even', 'want', 'because', 'these', 'give', 'most', 'меня', 'тебя', 'тебе', 'мне', 'что', 'как', 'это', 'все', 'так', 'его', 'только', 'было', 'чтобы', 'если', 'уже', 'или', 'нет', 'еще', 'даже', 'быть', 'когда', 'нас', 'для', 'вот', 'вам', 'мы', 'ты', 'вы', 'он', 'она', 'они', 'оно', 'вас', 'их', 'нам', 'им', 'мной', 'тобой', 'нами', 'вами', 'ими', 'href']);
    const wordPattern = /\p{L}{2,}/gu; // Reduced from 4 to 2 to support phrases
    let wordCounts = {};
    const stickerCounts = {};
    const gifCounts = {};
    
    // Read phrase length ONCE before the loop (performance: avoid DOM reads inside tight loop)
    const phraseInput = document.getElementById('pulse-phrase-len');
    const maxNGram = phraseInput ? Math.max(1, Math.min(5, parseInt(phraseInput.value) || 1)) : 1;

    // === SINGLE PASS ===
    for (const msg of messages) {
        const s = msg.s;

        // Sender count
        senderCounts[s] = (senderCounts[s] || 0) + 1;

        if (msg.t) {
            const h = msg.t.substring(11, 13);
            if (hours[h]) { hours[h].total++; hours[h].senders[s] = (hours[h].senders[s] || 0) + 1; }

            const d = msg.t.substring(0, 10);
            consistency[d] = (consistency[d] || 0) + 1;

            // Day of week
            const dow = DOW_NAMES[new Date(d).getDay()];
            if (weekly[dow]) { weekly[dow].total++; weekly[dow].senders[s] = (weekly[dow].senders[s] || 0) + 1; }
        }

        // Media DNA
        if (msg.m) {
            if (!mediaCounts[msg.m]) mediaCounts[msg.m] = { total: 0, senders: {} };
            mediaCounts[msg.m].total++;
            mediaCounts[msg.m].senders[s] = (mediaCounts[msg.m].senders[s] || 0) + 1;
        } else if (msg.x && msg.x.trim()) {
            textCount.total++;
            textCount.senders[s] = (textCount.senders[s] || 0) + 1;
        }

        // Stickers & GIFs (by size fingerprint)
        if (msg.m === 'sticker' && msg.p && msg.z) {
            if (!stickerCounts[msg.z]) stickerCounts[msg.z] = { total: 0, senders: {}, path: msg.p };
            stickerCounts[msg.z].total++;
            stickerCounts[msg.z].senders[s] = (stickerCounts[msg.z].senders[s] || 0) + 1;
        } else if (msg.m === 'gif' && msg.p && msg.z) {
            if (!gifCounts[msg.z]) gifCounts[msg.z] = { total: 0, senders: {}, path: msg.p };
            gifCounts[msg.z].total++;
            gifCounts[msg.z].senders[s] = (gifCounts[msg.z].senders[s] || 0) + 1;
        }

        // Emojis + words from text
        if (msg.x) {
            const foundEmoji = msg.x.match(emojiPattern);
            if (foundEmoji) {
                for (const e of foundEmoji) {
                    if (!emojiCounts[e]) emojiCounts[e] = { total: 0, senders: {} };
                    emojiCounts[e].total++;
                    emojiCounts[e].senders[s] = (emojiCounts[e].senders[s] || 0) + 1;
                }
            }
            
            const cleanText = msg.x.toLowerCase().replace(/http\S+|www\.\S+|<.*?>/g, '');
            const foundWords = cleanText.match(wordPattern);
            
            if (foundWords) {
                // === PERFORMANCE: Only collect n-gram sizes we actually need ===
                for (let n = 1; n <= maxNGram; n++) {
                    if (foundWords.length < n) continue;
                    const wordLimit = Math.min(foundWords.length, 80);
                    const seenInThisMessage = new Set();
                    
                    // For n>1, use NON-OVERLAPPING stride (step by n) to prevent
                    // sliding-window variants like "A B C", "B C D", "C D E" from all
                    // accumulating counts in the same forwarded/repetitive message.
                    // Unigrams (n=1) still slide by 1 since they can't "overlap".
                    const step = n > 1 ? n : 1;
                    
                    for (let i = 0; i <= wordLimit - n; i += step) {
                        const chunk = foundWords.slice(i, i + n);
                        if (n === 1) {
                            if (stopWords.has(chunk[0]) || chunk[0].length > 20 || chunk[0].length < 4) continue;
                        }
                        
                        const phrase = chunk.join(' ');
                        if (phrase.length > 70 || seenInThisMessage.has(phrase)) continue;
                        seenInThisMessage.add(phrase);

                        if (!wordCounts[phrase]) {
                            wordCounts[phrase] = { total: 0, senders: {}, msgIds: new Set(), len: n };
                        }
                        if (!wordCounts[phrase].msgIds.has(msg.i)) {
                            wordCounts[phrase].msgIds.add(msg.i);
                            wordCounts[phrase].total++;
                            wordCounts[phrase].senders[s] = (wordCounts[phrase].senders[s] || 0) + 1;
                        }
                    }
                }
            }
        }
    }

    // === POST-PROCESSING ===
    
    // 1. Min Usage Filter (O(N) prune - run first to shrink the working set)
    const minInput = document.getElementById('pulse-word-min');
    const minUsage = minInput ? parseInt(minInput.value) || 5 : 5;
    for (const w of Object.keys(wordCounts)) {
        if (wordCounts[w].total < minUsage) delete wordCounts[w];
    }

    // 2. Message-Set Deduplication (Anti-Template Filter)
    // Phrases that appear in EXACTLY the same set of messages are all fragments
    // of the same repeated template (e.g. news channel promo footers).
    // Keep only the highest-frequency phrase per group to surface one clean result.
    {
        const templateGroups = new Map(); // fingerprint → [phrase, ...]
        for (const [phrase, data] of Object.entries(wordCounts)) {
            // Fingerprint = sorted message IDs joined as string
            const fp = [...data.msgIds].sort((a, b) => a - b).join(',');
            if (!templateGroups.has(fp)) templateGroups.set(fp, []);
            templateGroups.get(fp).push(phrase);
        }
        for (const [, group] of templateGroups) {
            if (group.length <= 1) continue;
            // Sort group by frequency descending, delete all but the top
            group.sort((a, b) => wordCounts[b].total - wordCounts[a].total);
            for (let k = 1; k < group.length; k++) delete wordCounts[group[k]];
        }
    }

    // 3. O(N) Subsumption Filtering (Maximal Phrases)
    const toRemove = new Set();
    const sortedByLen = Object.keys(wordCounts).sort((a, b) => wordCounts[b].len - wordCounts[a].len);
    for (const p of sortedByLen) {
        if (wordCounts[p].len <= 1) continue;
        const words = p.split(' ');
        const f1 = words.slice(0, -1).join(' ');
        const f2 = words.slice(1).join(' ');
        if (wordCounts[f1] && wordCounts[f1].total < 1.1 * wordCounts[p].total) toRemove.add(f1);
        if (wordCounts[f2] && wordCounts[f2].total < 1.1 * wordCounts[p].total) toRemove.add(f2);
    }
    toRemove.forEach(p => delete wordCounts[p]);

    // Cleanup Set data to free memory
    for (const w in wordCounts) { delete wordCounts[w].msgIds; }

    // Assign simple stats
    stats.circadian = hours;
    stats.weekly = weekly;
    stats.consistency = consistency;
    mediaCounts['text'] = textCount;
    stats.media_dna = mediaCounts;
    stats.sender_battle = Object.entries(senderCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    stats.emojis = Object.entries(emojiCounts).sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([emoji, data]) => ({ emoji, count: data.total, senders: data.senders }));

    // 3. Display Filter: strict exact-length match
    //    (e.g., displayMinLen=1 → show ONLY 1-word phrases)
    //    If subsumption promoted a longer phrase in its place, it won't appear because
    //    it's not of the selected length — this is intentional "Phrase Length" behavior.
    const displayMinLen = maxNGram; // same as the user's selected value (read above)
    
    // Apply Percentile Filter
    const pctInput = document.getElementById('pulse-word-pct');
    const targetPct = pctInput ? parseInt(pctInput.value) / 100.0 : 0.10;
    
    // Only include phrases of the exact selected length
    let candidates = Object.entries(wordCounts).filter(([, data]) => data.len === displayMinLen);

    if (targetPct < 1.0 && candidates.length > 0) {
        const sortedCandidates = candidates.sort((a, b) => b[1].total - a[1].total);
        const totalOccurrences = sortedCandidates.reduce((sum, item) => sum + item[1].total, 0);
        const cutoffThreshold = totalOccurrences * (1.0 - targetPct);
        let cumulative = 0;
        const filtered = [];
        for (const entry of sortedCandidates) {
            cumulative += entry[1].total;
            if (cumulative > cutoffThreshold) filtered.push(entry);
        }
        candidates = filtered;
    }
    
    stats.words = candidates.sort((a, b) => b[1].total - a[1].total).slice(0, 15).map(([word, data]) => ({ word, count: data.total, senders: data.senders }));

    // Top stickers & GIFs
    stats.stickers = Object.values(stickerCounts).sort((a, b) => b.total - a.total).slice(0, 10).map(v => ({ path: '/media?path=' + v.path, name: v.path.split(/[/\\]/).pop(), count: v.total, senders: v.senders }));
    stats.gifs = Object.values(gifCounts).sort((a, b) => b.total - a.total).slice(0, 10).map(v => ({ path: '/media?path=' + v.path, name: v.path.split(/[/\\]/).pop(), count: v.total, senders: v.senders }));

    return stats;
}

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
            recomputeAndRender();
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

    // 1. Circadian Rhythm (Radar or PolarArea)
    const circCanvas = document.getElementById('circadianChart');
    if (circCanvas) {
        const circCtx = circCanvas.getContext('2d');
        const cD = pulseData.circadian;

        if (pulseCharts.circadian) pulseCharts.circadian.destroy();
        pulseCharts.circadian = new Chart(circCtx, {
            type: 'radar',
            data: {
                labels: Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00'),
                datasets: [{
                    label: 'Activity',
                    data: Array.from({ length: 24 }, (_, i) => {
                        let obj = cD[i.toString().padStart(2, '0')];
                        return obj ? obj.total : 0;
                    }),
                    backgroundColor: 'rgba(192, 132, 252, 0.2)',
                    borderColor: '#c084fc',
                    pointBackgroundColor: '#c084fc',
                    borderWidth: 2
                }]
            },
            options: {
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

    // 1b. Weekly Activity (PolarArea)
    const weekCanvas = document.getElementById('weeklyChart');
    if (weekCanvas && pulseData.weekly) {
        const weekCtx = weekCanvas.getContext('2d');
        if (pulseCharts.weekly) pulseCharts.weekly.destroy();
        const DOW_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const DOW_COLORS = ['#3b82f6','#06b6d4','#10b981','#84cc16','#f59e0b','#f43f5e','#8b5cf6'];
        const wd = pulseData.weekly;
        pulseCharts.weekly = new Chart(weekCtx, {
            type: 'polarArea',
            data: {
                labels: DOW_ORDER,
                datasets: [{
                    data: DOW_ORDER.map(d => wd[d] ? wd[d].total : 0),
                    backgroundColor: DOW_COLORS.map(c => c + 'aa'),
                    borderColor: DOW_COLORS,
                    borderWidth: 2
                }]
            },
            options: {
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

    // 2. Consistency Grid
    const consGrid = document.getElementById('consistencyGrid');
    if (consGrid) {
        consGrid.innerHTML = '';
        const maxVal = Math.max(...Object.values(pulseData.consistency), 1);

        const sortedDates = Object.keys(pulseData.consistency).sort();
        sortedDates.forEach(d => {
            const count = pulseData.consistency[d];
            const intensity = count / maxVal;
            const sq = document.createElement('div');
            sq.className = 'pulse-day-sq';
            if (intensity > 0) sq.classList.add('pulse-day-l1');
            if (intensity > 0.25) sq.classList.add('pulse-day-l2');
            if (intensity > 0.5) sq.classList.add('pulse-day-l3');
            if (intensity > 0.75) sq.classList.add('pulse-day-l4');
            sq.title = `${d}: ${count} messages`;
            
            // Open dialogue at this date in a new tab
            sq.style.cursor = 'pointer';
            sq.onclick = () => {
                window.open('/?date=' + d, '_blank');
            };
            
            consGrid.appendChild(sq);
        });
    }

    // 3. Media DNA (Doughnut)
    const mediaCanvas = document.getElementById('mediaDnaChart');
    if (mediaCanvas) {
        const mediaCtx = mediaCanvas.getContext('2d');
        if (pulseCharts.mediaDna) pulseCharts.mediaDna.destroy();

        const mD = pulseData.media_dna;
        pulseCharts.mediaDna = new Chart(mediaCtx, {
            type: 'doughnut',
            data: {
                labels: ['Text', 'Photos', 'Voice/Video', 'Stickers/GIFs', 'Other'],
                datasets: [{
                    data: [
                        mD.text?.total || 0,
                        mD.photo?.total || 0,
                        (mD.voice?.total || 0) + (mD.round_video?.total || 0),
                        (mD.sticker?.total || 0) + (mD.gif?.total || 0),
                        (mD.file?.total || 0) + (mD.location?.total || 0) + (mD.poll?.total || 0)
                    ],
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
                        callbacks: {
                            label: function (context) {
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
                            }
                        }
                    }
                },
                cutout: '70%'
            }
        });
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
    
    const loader = document.getElementById('dynamics-loader');
    if (loader) loader.style.display = 'block';
    
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
        if (loader) loader.innerHTML = `<div style="color:red;">Failed to load data.</div>`;
        return;
    } finally {
        if (loader) loader.style.display = 'none';
    }

    // Unhide the active container
    const activeCont = document.getElementById('dyn-content-' + currentDynamicsTab);
    if (activeCont) activeCont.style.display = 'block';

    renderCurrentDynamicsTab();
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
                const colors = ['#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#db2777', '#be185d', '#9d174d', '#831843'];
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
