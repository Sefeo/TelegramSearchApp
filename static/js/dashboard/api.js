// Pulse Dashboard API Module
// Handles IndexedDB caching and server-side data fetching

import * as State from './state.js';

const IDB_NAME = 'PulseCache';
const IDB_STORE = 'raw';
const IDB_KEY = 'pulse_raw_v1';

export function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

export async function idbGet() {
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

export async function idbSet(value) {
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

export async function fetchSenders() {
    try {
        const res = await fetch('/api/senders');
        const list = await res.json();
        State.setAllSendersList(list);
    } catch (e) {
        console.error("Error fetching senders", e);
    }
}

export async function fetchDbSig() {
    try {
        const sigRes = await fetch('/api/db_sig');
        if (sigRes.ok) {
            const sigData = await sigRes.json();
            return sigData.db_sig;
        }
    } catch (e) {
        console.warn("Could not fetch db_sig", e);
    }
    return null;
}

export async function fetchRawPulseData() {
    const res = await fetch('/api/pulse_raw');
    const raw = await res.json();
    
    // Persist to IndexedDB for instant re-opens (no quota issues)
    idbSet(raw); // fire-and-forget
    
    return raw;
}
