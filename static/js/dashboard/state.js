// Pulse Dashboard State Module
// Manages the internal state, data, and charts of the dashboard

export let pulseData = null;
export let pulseCharts = {};
export let pulseCurrentSenders = new Set();
export let allSendersList = [];
export let showingAllSenders = false;
export let pulseMonths = [];
export let isProgrammaticDateChange = false;

// Client-side data cache
export let pulseRawMessages = null;  // All messages from /api/pulse_raw (fetched once)
export let pulseRawMeta = null;      // min_date, max_date from the raw endpoint

// Debounce timer for sender toggles
export let senderDebounceTimer = null;

// Custom words state
export let _cwWords = [];          // User's custom words list
export let _cwResults = null;      // Latest worker results
export let _cwViewMode = 'tug';    // 'tug' or 'matrix'
export let _cwLoading = false;
export let _cwDebounce = null;

// Dynamics state
export let currentDynamicsTab = 'messages';
export let lastDynamicsFetchParams = null;
export let dynamicsData = null;

// Consistency Grid state
export let _cgMode = 'matrix'; // 'matrix' or 'stream'

// Exports for modification (since exports are read-only)
export function setPulseData(val) { pulseData = val; }
export function setPulseRawMessages(val) { pulseRawMessages = val; }
export function setPulseRawMeta(val) { pulseRawMeta = val; }
export function setAllSendersList(val) { allSendersList = val; }
export function setPulseCurrentSenders(val) { pulseCurrentSenders = val; }
export function setShowingAllSenders(val) { showingAllSenders = val; }
export function setPulseMonths(val) { pulseMonths = val; }
export function setIsProgrammaticDateChange(val) { isProgrammaticDateChange = val; }
export function setSenderDebounceTimer(val) { senderDebounceTimer = val; }

export function setCwWords(val) { _cwWords = val; }
export function setCwResults(val) { _cwResults = val; }
export function setCwViewMode(val) { _cwViewMode = val; }
export function setCwLoading(val) { _cwLoading = val; }
export function setCwDebounce(val) { _cwDebounce = val; }

export function setCurrentDynamicsTab(val) { currentDynamicsTab = val; }
export function setLastDynamicsFetchParams(val) { lastDynamicsFetchParams = val; }
export function setDynamicsData(val) { dynamicsData = val; }

export function setCgMode(val) { _cgMode = val; }
