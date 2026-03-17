// pulse_worker.js — Web Worker for Pulse Dashboard computation
// Runs filterMessages + computePulseStats off the main thread so the UI never freezes.

// Pre-compiled regexes (created once, reused every call)
const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu;
const wordPattern = /\p{L}{2,}/gu;
const linkPattern = /http\S+|www\.\S+|<.*?>/g;

const stopWords = new Set(['that', 'this', 'with', 'from', 'your', 'have', 'they', 'will', 'what', 'there', 'would', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'person', 'into', 'year', 'good', 'some', 'could', 'them', 'other', 'than', 'then', 'look', 'only', 'come', 'over', 'think', 'also', 'back', 'after', 'even', 'want', 'because', 'these', 'give', 'most', 'меня', 'тебя', 'тебе', 'мне', 'что', 'как', 'это', 'все', 'так', 'его', 'только', 'было', 'чтобы', 'если', 'уже', 'или', 'нет', 'еще', 'даже', 'быть', 'когда', 'нас', 'для', 'вот', 'вам', 'мы', 'ты', 'вы', 'он', 'она', 'они', 'оно', 'вас', 'их', 'нам', 'им', 'мной', 'тобой', 'нами', 'вами', 'ими', 'href']);

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Tomohiko Sakamoto's day-of-week algorithm.
 * Returns 0=Sun, 1=Mon, ..., 6=Sat — same as Date.getDay().
 * Pure arithmetic, zero allocations.
 */
const DOW_TABLE = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
function dayOfWeek(y, m, d) {
    if (m < 3) y--;
    return (y + (y >> 2) - Math.floor(y / 100) + Math.floor(y / 400) + DOW_TABLE[m - 1] + d) % 7;
}

function filterMessages(messages, senderSet, isAllSenders, startDate, endDate) {
    const startTs = startDate ? startDate + ' 00:00:00' : '';
    const endTs = endDate ? endDate + ' 23:59:59' : '';

    return messages.filter(msg => {
        if (!isAllSenders && !senderSet.has(msg.s)) return false;
        if (startTs && msg.t < startTs) return false;
        if (endTs && msg.t > endTs) return false;
        return true;
    });
}

function computePulseStats(messages, maxNGram, minUsage, targetPct) {
    const stats = {};

    // Pre-initialize buckets
    const hours = {};
    for (let i = 0; i < 24; i++) hours[i.toString().padStart(2, '0')] = { total: 0, senders: {} };

    const weekly = {};
    for (let i = 0; i < 7; i++) weekly[DOW_NAMES[i]] = { total: 0, senders: {} };

    const consistency = {};
    const mediaCounts = {};
    const textCount = { total: 0, senders: {} };
    const senderCounts = {};
    const emojiCounts = {};
    let wordCounts = {};
    const stickerCounts = {};
    const gifCounts = {};

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

            // Day of week — arithmetic instead of new Date()
            const yr = (msg.t.charCodeAt(0) - 48) * 1000 + (msg.t.charCodeAt(1) - 48) * 100 + (msg.t.charCodeAt(2) - 48) * 10 + (msg.t.charCodeAt(3) - 48);
            const mo = (msg.t.charCodeAt(5) - 48) * 10 + (msg.t.charCodeAt(6) - 48);
            const dy = (msg.t.charCodeAt(8) - 48) * 10 + (msg.t.charCodeAt(9) - 48);
            const dow = DOW_NAMES[dayOfWeek(yr, mo, dy)];
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

            const cleanText = msg.x.toLowerCase().replace(linkPattern, '');
            const foundWords = cleanText.match(wordPattern);

            if (foundWords) {
                for (let n = 1; n <= maxNGram; n++) {
                    if (foundWords.length < n) continue;
                    const wordLimit = Math.min(foundWords.length, 80);
                    const seenInThisMessage = new Set();

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

    // 1. Min Usage Filter
    for (const w of Object.keys(wordCounts)) {
        if (wordCounts[w].total < minUsage) delete wordCounts[w];
    }

    // 2. Message-Set Deduplication (Anti-Template Filter)
    {
        const templateGroups = new Map();
        for (const [phrase, data] of Object.entries(wordCounts)) {
            const fp = [...data.msgIds].sort((a, b) => a - b).join(',');
            if (!templateGroups.has(fp)) templateGroups.set(fp, []);
            templateGroups.get(fp).push(phrase);
        }
        for (const [, group] of templateGroups) {
            if (group.length <= 1) continue;
            group.sort((a, b) => wordCounts[b].total - wordCounts[a].total);
            for (let k = 1; k < group.length; k++) delete wordCounts[group[k]];
        }
    }

    // 3. Subsumption Filtering
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

    // Cleanup Set data
    for (const w in wordCounts) { delete wordCounts[w].msgIds; }

    // Assign stats
    stats.circadian = hours;
    stats.weekly = weekly;
    stats.consistency = consistency;
    mediaCounts['text'] = textCount;
    stats.media_dna = mediaCounts;
    stats.sender_battle = Object.entries(senderCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    stats.emojis = Object.entries(emojiCounts).sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([emoji, data]) => ({ emoji, count: data.total, senders: data.senders }));

    // Display Filter: strict exact-length match
    const displayMinLen = maxNGram;

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

// === Worker-owned data store ===
// Messages are loaded ONCE via 'load' message and kept here.
// Subsequent 'compute' messages only pass small filter params — no repeated cloning.
let _workerMessages = null;
let _workerMeta = null;

// === Worker message handler ===
self.onmessage = function (e) {
    const { type } = e.data;

    if (type === 'load') {
        // Store data in worker memory — happens only once per session
        _workerMessages = e.data.messages;
        _workerMeta = e.data.meta;
        self.postMessage({ type: 'loaded' });
        return;
    }

    if (type === 'compute') {
        if (!_workerMessages) {
            self.postMessage({ type: 'error', msg: 'Worker has no data — send load first' });
            return;
        }

        const { senders, allSendersCount, startDate, endDate, maxNGram, minUsage, targetPct } = e.data;
        const senderSet = new Set(senders);
        const isAllSenders = senderSet.size === allSendersCount;

        const filtered = filterMessages(_workerMessages, senderSet, isAllSenders, startDate, endDate);
        const stats = computePulseStats(filtered, maxNGram, minUsage, targetPct);

        // Carry over meta info
        if (_workerMeta) {
            stats.min_date = _workerMeta.min_date;
            stats.max_date = _workerMeta.max_date;
            const minY = parseInt(_workerMeta.min_date.substring(0, 4));
            const maxY = parseInt(_workerMeta.max_date.substring(0, 4));
            stats.years = [];
            for (let y = minY; y <= maxY; y++) stats.years.push(String(y));
        }

        self.postMessage({ type: 'result', stats });
        return;
    }
};
