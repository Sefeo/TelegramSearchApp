const chat = document.getElementById('chat');
        const colorCache = {};
        const colors = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

		
		// Waveforms setting preference
		const waveSetting = document.getElementById('setting-auto-wave');
        waveSetting.checked = localStorage.getItem('autoWaveforms') === 'true';
        waveSetting.addEventListener('change', (e) => localStorage.setItem('autoWaveforms', e.target.checked));

        // --- MEDIA PLAYER LOGIC ---
        const engine = document.getElementById('media-engine');
        const playerBar = document.getElementById('global-player');
        const playPauseBtn = document.getElementById('play-pause-btn');
        const seekBar = document.getElementById('seek-bar');
        const timeDisplay = document.getElementById('time-display');
        const speedBtn = document.getElementById('speed-btn');
        const vidPreview = document.getElementById('player-video');
        const speeds = [1, 1.5, 2];
        let currentSpeedIdx = 0;
		let isDragging = false;
		let currentPlayingPath = null; 
		let currentPlayingMsgId = null;
        let currentPlayingType = null;
		let messageDataStore = {}; // Stores all loaded message data for quick access when copying
        let selectionMode = false;
        let selectedIds = new Set();
        let rightClickedMsgId = null;
		let isDraggingSelection = false;
        let dragSelectMode = true; 
		let rightClickedLinkUrl = null; 
		let rightClickedMediaItem = null;

		// --- SMOOTH PLAYBACK LOGIC ---
        let animationFrameId;

		// --- SEEK BAR DRAG TRACKING ---
        let isDraggingSeekBar = false;

        // --- FETCH & SCROLL LOGIC ---
        let oldestMsgId = null;
        let newestMsgId = null;
        let isFetching = false;
        let allOldLoaded = false;
        let allNewLoaded = true;

		let allPinned =[];
        let currentPinTargetId = null;

		let mediaState = { type: 'photo', oldestId: null, isFetching: false, allLoaded: false, currentMonth: "" };

