		/**
 * Integrated Media Virtualizer
 * Manages resource loading/unloading for the Media Grid.
 */
class MediaVirtualizer {
    constructor() {
        this.cache = new Map();
        this.timeouts = new Map();
        this.observer = null;
        
        // Video processing queue
        this.videoQueue = [];
        this.activeSnapshots = 0;
        this.maxConcurrentSnapshots = 2; // Keep low to avoid hardware decoder limit
        
        // Video pooling
        this.videoPool = [];
        
        this.setupObserver();
    }

    setupObserver() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const el = entry.target;
                if (entry.isIntersecting) {
                    this.scheduleLoad(el);
                } else {
                    const rect = entry.boundingClientRect;
                    const vh = window.innerHeight;
                    // Extreme persistence: Only unload if we are very far away (5000px)
                    if (rect.top > vh + 5000 || rect.bottom < -5000) {
                        this.unload(el);
                    }
                }
            });
        }, { 
            root: null, 
            rootMargin: '5000px', // Massive pre-load buffer for "always there" feel
            threshold: 0
        });
    }

    observe(el) {
        if (!el) return;
        this.observer.observe(el);
    }

    scheduleLoad(el) {
        // No debounce for loading - we want it the microsecond it hits the predictive buffer
        this.load(el);
    }

    async load(el) {
        const id = el.dataset.id;
        const type = el.dataset.type;
        const src = el.dataset.src;
        const thumb = el.querySelector('.media-thumb');

        if (!thumb) return;

        // 1. Check In-Memory Cache (Immediate restore)
        if (this.cache.has(id)) {
            if (thumb.src !== this.cache.get(id)) {
                thumb.src = this.cache.get(id);
                thumb.classList.add('loaded');
            }
            el.classList.remove('loading');
            return;
        }

        // 2. Try Server-Side Persistence Cache
        if (type === 'video' || type === 'gif') {
            const cachedUrl = `/static/thumbnails/${id}.jpg`;
            
            // Check if specifically this session's cache already has it decoded
            if (this.cache.has(id)) {
                thumb.classList.add('no-transition');
                thumb.src = cachedUrl;
                thumb.classList.add('loaded');
                el.classList.remove('loading');
                return;
            }

            thumb.src = cachedUrl;
            thumb.onload = () => {
                thumb.classList.add('loaded');
                el.classList.remove('loading');
                this.cache.set(id, cachedUrl);
            };

            thumb.onerror = () => {
                this.addToVideoQueue(el, id, src, thumb);
            };
        } else {
            // Photos with Predictive Decoding
            el.classList.add('loading');
            await this.handlePhotoLoad(el, id, src, thumb);
        }
    }

    addToVideoQueue(el, id, src, thumb) {
        if (this.cache.has(id) || el.classList.contains('loading')) return;
        el.classList.add('loading');

        // Reset onerror to avoid infinite loops
        thumb.onerror = null; 

        this.videoQueue.push({ el, id, src, thumb });
        this.processVideoQueue();
    }

    async processVideoQueue() {
        if (this.activeSnapshots >= this.maxConcurrentSnapshots || this.videoQueue.length === 0) {
            return;
        }

        const task = this.videoQueue.shift();
        this.activeSnapshots++;

        try {
            await this.handleVideoLoad(task.el, task.id, task.src, task.thumb);
        } catch (err) {
            console.error("[Virtualizer] Queue error:", err);
            task.el.classList.remove('loading');
            task.el.classList.add('error');
        } finally {
            this.activeSnapshots--;
            this.processVideoQueue();
        }
    }

    async handleVideoLoad(el, id, src, thumb) {
        // Get or create pooled video element
        let video = this.videoPool.find(v => !v.inUse);
        if (!video) {
            video = document.createElement('video');
            video.className = 'virtual-video';
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            this.videoPool.push(video);
        }
        
        video.inUse = true;
        video.src = src + '#t=0.1';
        el.appendChild(video);

        return new Promise((resolve) => {
            const cleanup = () => {
                video.inUse = false;
                video.pause();
                video.src = '';
                video.load();
                if (video.parentNode) video.parentNode.removeChild(video);
                el.classList.remove('loading');
                resolve();
            };

            // Use onseeked instead of onloadeddata for better snapshot accuracy
            video.onseeked = async () => {
                try {
                    // Small delay to ensure the frame is actually drawn on the internal GPU buffer
                    await new Promise(r => setTimeout(r, 45));
                    
                    const blob = await this.captureFrameBlob(video);
                    const blobUrl = URL.createObjectURL(blob);
                    this.cache.set(id, blobUrl);
                    
                    // Permanent Server Cache: Upload binary to server
                    this.uploadThumbnail(id, blob);
                    
                    thumb.src = blobUrl;
                    thumb.onload = () => {
                        thumb.classList.add('loaded');
                        cleanup();
                    };
                } catch (e) {
                    cleanup();
                }
            };

            video.onerror = cleanup;

            // Safety timeout
            setTimeout(cleanup, 6000);
        });
    }

    async uploadThumbnail(id, blob) {
        try {
            await fetch('/api/cache_thumbnail', {
                method: 'POST',
                body: blob,
                headers: { 'X-Message-ID': id }
            });
        } catch (e) { console.warn("[Virtualizer] Failed to upload thumb:", e); }
    }

    async captureFrameBlob(video) {
        return new Promise((resolve, reject) => {
            if (video.videoWidth === 0) {
                video.addEventListener('loadedmetadata', () => resolve(this.captureFrameBlob(video)), {once: true});
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject('blob_null');
            }, 'image/jpeg', 0.85);
        });
    }

    async handlePhotoLoad(el, id, src, thumb) {
        // High-Tier Optimization: Image.decode()
        // This ensures the pixels are fully decoded in GPU memory BEFORE being assigned to the DOM
        const img = new Image();
        img.src = src;

        try {
            if (this.cache.has(id)) thumb.classList.add('no-transition');
            
            await img.decode();
            thumb.src = src;
            thumb.classList.add('loaded');
            el.classList.remove('loading');
            this.cache.set(id, src);
        } catch (e) {
            // Fallback to standard load if decode fails
            thumb.src = src;
            thumb.onload = () => {
                thumb.classList.add('loaded');
                el.classList.remove('loading');
                this.cache.set(id, src);
            };
        }
    }

    unload(el) {
        // Stop any active snapshots in the element
        el.querySelectorAll('video').forEach(v => {
            v.pause();
            v.src = '';
            v.load();
            v.remove();
        });

        // Remove from queue if it hasn't started yet
        this.videoQueue = this.videoQueue.filter(task => task.el !== el);

        if (this.timeouts.has(el)) {
            clearTimeout(this.timeouts.get(el));
            this.timeouts.delete(el);
        }
        el.classList.remove('loading');
    }

    async captureFrame(video) {
        return new Promise((resolve, reject) => {
            if (video.videoWidth === 0) {
                video.addEventListener('loadedmetadata', () => resolve(this.captureFrame(video)), {once: true});
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) resolve(URL.createObjectURL(blob));
                else reject('blob_null');
            }, 'image/jpeg', 0.82);
        });
    }

    reset() {
        this.cache.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
        this.cache.clear();
        this.timeouts.forEach(t => clearTimeout(t));
        this.timeouts.clear();
        if (this.observer) this.observer.disconnect();
        this.setupObserver();
    }
}
window.mediaVirtualizer = new MediaVirtualizer();

// Sidebar scroll up button logic

        document.getElementById('sidebar-content').addEventListener('scroll', function() {
            document.getElementById('btn-sidebar-up').style.display = this.scrollTop > 100 ? 'flex' : 'none';
        });

        // Infinite scroll for Media Menu
        document.getElementById('media-content').addEventListener('scroll', function() {
            if (this.scrollHeight - this.scrollTop - this.clientHeight < 800) {
                if (typeof mediaState !== 'undefined' && !mediaState.isFetching && !mediaState.allLoaded) {
                    loadMedia(mediaState.type, null, true);
                }
            }
        });

        // Handled by media_virtualizer.js now


        // --- CALENDAR & SEARCH LOGIC ---
        // Dynamically reposition calendar when layout shifts
        document.body.addEventListener('transitionend', (e) => {
            if (e.target.classList && e.target.classList.contains('btn-round') && window.DatePicker) {
                DatePicker.reposition();
            }
        });

        // --- MODULAR MEDIA VIRTUALIZATION ---
        console.log("[UI] Virtualizer status check:", window.mediaVirtualizer ? "Detected" : "Missing");
        const lazyVideoObserver = {
            observe: (el) => { if(window.mediaVirtualizer) window.mediaVirtualizer.observe(el); },
            reset: () => { if(window.mediaVirtualizer) window.mediaVirtualizer.reset(); }
        };




        function toggleSearch() { 
            const sidebar = document.getElementById('sidebar');
            if (sidebar.classList.contains('open')) {
                // When closing, reset all fields and highlights
                document.getElementById('searchInput').value = '';
                document.getElementById('searchResults').innerHTML = '';
                document.getElementById('start_date').value = '';
                document.getElementById('end_date').value = '';
                document.getElementById('disp-start-date').textContent = 'Not set';
                document.getElementById('disp-end-date').textContent = 'Not set';
                _dpDates.start = null; _dpDates.end = null;
                document.querySelectorAll('.sender-checkbox').forEach(cb => cb.checked = false);
            }
            sidebar.classList.toggle('open'); 
        }
		
		// --- SMART MODAL TOGGLER ---
        function toggleModal(modalId) {
            const targetModal = document.getElementById(modalId);
            const isOpening = targetModal.style.display !== 'block';
            
            // Close ALL center modals first
            document.getElementById('date-modal').style.display = 'none';
            document.getElementById('settings-modal').style.display = 'none';
            
            // If the user clicked a different icon, open its modal
            if (isOpening) {
                targetModal.style.display = 'block';
            }
        }

        // Stored dates so the picker re-opens on the same selection
        const _dpDates = { jump: null, start: null, end: null };

        function openJumpDatePicker(anchorEl) {
            DatePicker.open({
                anchorEl,
                value: _dpDates.jump,   // null → auto-detect scroll date
                confirmLabel: 'Перейти',
                onConfirm: async (date) => {
                    _dpDates.jump = date;
                    const res = await fetch(`/api/jump_date?date=${date}`);
                    if (res.ok) { const d = await res.json(); jumpToContext(d.id); }
                    else alert('No messages found on or after this date.');
                }
            });
        }

        function openSearchDatePicker(anchorEl, which) {
            const key = which === 'start' ? 'start' : 'end';
            DatePicker.open({
                anchorEl,
                value: _dpDates[key],
                showClear: true,
                confirmLabel: 'Обрати',
                onConfirm: (date) => {
                    _dpDates[key] = date;
                    document.getElementById(which === 'start' ? 'start_date' : 'end_date').value = date || '';
                    document.getElementById(which === 'start' ? 'disp-start-date' : 'disp-end-date').textContent = date || 'Not set';
                }
            });
        }

        async function executeDateJump() {
            // Kept for backward-compat; the custom picker calls jumpToContext directly
        }


        // --- WHISPER INITIALIZATION ---
        const transcribeSetting = document.getElementById('setting-auto-transcribe');
        transcribeSetting.checked = autoTranscribe;
        
        const calScrollSetting = document.getElementById('setting-cal-scroll');
        const calScroll = localStorage.getItem('calScroll') !== 'false'; // Default true
        calScrollSetting.checked = calScroll;

        // Listen for checkbox changes
        transcribeSetting.addEventListener('change', (e) => {
            if (e.target.checked && !whisperReady) {
                alert("Please initialize the Whisper model first.");
                e.target.checked = false;
                return;
            }
            autoTranscribe = e.target.checked;
            localStorage.setItem('autoTranscribe', autoTranscribe);
        });

        calScrollSetting.addEventListener('change', (e) => {
            localStorage.setItem('calScroll', e.target.checked);
        });

        function initializeWhisper() {
            const btn = document.getElementById('btn-init-whisper');
            if (whisperReady) {
                alert("Whisper model is already initialized and ready.");
                return;
            }

            if (!whisperWorker) {
                whisperWorker = new Worker('/static/js/transcribe_worker.js', { type: 'module' });
                
                whisperWorker.addEventListener('message', (e) => {
                    const { type, status, data, error } = e.data;
                    
                    if (type === 'status') {
                        if (status === 'loading') {
                            btn.innerText = "Loading Model (0%)...";
                            btn.style.background = "#888";
                            btn.disabled = true;
                        } else if (status === 'ready') {
                            whisperReady = true;
                            const device = e.data.device || 'wasm';
                            const deviceLabel = device === 'webgpu' ? '⚡ GPU' : '🖥️ CPU';
                            btn.innerText = `✅ Whisper Ready (${deviceLabel})`;
                            btn.style.background = device === 'webgpu' ? '#7bc862' : '#c8a830';
                            transcribeSetting.checked = true;
                            autoTranscribe = true;
                            localStorage.setItem('autoTranscribe', 'true');
                        }
                    } else if (type === 'progress') {
                        // data is the HuggingFace progress object
                        if (data && data.progress !== undefined) {
                            btn.innerText = `Loading Model (${Math.round(data.progress)}%)...`;
                        }
                    } else if (type === 'error') {
                        console.error("Whisper Error:", error);
                        btn.innerText = "❌ Initialization Failed";
                        btn.style.background = "#e17076";
                        btn.disabled = false;
                        alert("Failed to initialize Whisper. Please check the console or ensure your browser supports WebGPU/WASM.");
                    }
                });
            }

            whisperWorker.postMessage({ type: 'init' });
        }

        async function loadSenders() {
            try {
                const res = await fetch('/api/senders');
                const senders = await res.json();
                const container = document.getElementById('sender-list-container');
                container.innerHTML = '';
                
                if (senders.length === 0) { 
                    container.innerHTML = '<div style="color:gray; font-size:12px;">No users found.</div>'; 
                    return; 
                }
                
                // Now 'senders' is an array of objects: {name: "Svyat dy", count: 4500}
                senders.forEach(s => {
                    const safeS = s.name.replace(/"/g, '&quot;'); 
                    container.innerHTML += `
                        <label class="sender-label">
                            <input type="checkbox" value="${safeS}" class="sender-checkbox"> 
                            ${s.name} <span style="color:var(--text-muted); font-size:11px; margin-left:5px;">(${s.count})</span>
                        </label>
                    `;
                });
            } catch (e) {
                document.getElementById('sender-list-container').innerHTML = 'Error loading users.';
            }
        }

        function toggleMediaMenu() { 
            const menu = document.getElementById('media-menu');
            menu.classList.toggle('open'); 
            
            // Sync body class to shift the floating buttons left
            document.body.classList.toggle('media-open', menu.classList.contains('open')); 
            
            if (menu.classList.contains('open') && document.getElementById('media-content').innerHTML === '') {
                loadMedia('photo', document.querySelector('.media-tab'));
            }
        }

        async function loadMedia(type, btnElement = null, append = false) {
            if (!append) {
                // Reset State on new tab click
                mediaState = { type: type, oldestId: null, isFetching: false, allLoaded: false, currentMonth: "" };
                if (window.mediaVirtualizer) window.mediaVirtualizer.reset(); // Cleanup previous Blob URLs
                if (btnElement) {
                    document.querySelectorAll('.media-tab').forEach(btn => btn.classList.remove('active'));
                    btnElement.classList.add('active');
                }
                document.getElementById('media-content').innerHTML = '<div style="text-align:center; padding:20px;">Loading...</div>';
            }

            if (mediaState.isFetching || mediaState.allLoaded) return;
            mediaState.isFetching = true;

            let url = `/api/media_list?type=${mediaState.type}`;
            if (mediaState.oldestId) url += `&before_id=${mediaState.oldestId}`;

            const res = await fetch(url);
            const items = await res.json();

            if (items.length === 0) {
                mediaState.allLoaded = true;
                if (!append) document.getElementById('media-content').innerHTML = '<div style="text-align:center; color:gray; padding:20px;">No media found.</div>';
                mediaState.isFetching = false;
                return;
            }

            mediaState.oldestId = items[items.length - 1].id;
            const isGrid = (type === 'photo' || type === 'video' || type === 'gif');

            let html = '';
            
            items.forEach(msg => {
                messageDataStore[msg.id] = msg; 
                const d = new Date(msg.timestamp.split(' ')[0]);
                const monthStr = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                
                if (monthStr !== mediaState.currentMonth) {
                    const gridStyle = isGrid ? 'style="grid-column: 1/-1;"' : '';
                    html += `<div class="media-month-header" ${gridStyle}>${monthStr}</div>`;
                    mediaState.currentMonth = monthStr;
                }

                const mediaUrl = msg.media_path ? `/media?path=${encodeURIComponent(msg.media_path)}` : '';
                const title = msg.media_path ? msg.media_path.split(/[\\/]/).pop() : "Link";
                
                if (type === 'photo') {
                    html += `<div class="media-grid-item" data-id="${msg.id}" data-type="photo" data-src="${mediaUrl}" onclick="window.open('${mediaUrl}','_blank')">
                                <img class="media-thumb">
                             </div>`;
                } else if (type === 'video' || type === 'gif') {
                    // Use GIF badge or the pre-calculated duration from the database
                    let badge = type === 'gif' ? 'GIF' : '--:--';
                    
                    if (type === 'video' && msg.duration) {
                        badge = formatTime(msg.duration);
                    }

                    html += `<div class="media-grid-item" data-id="${msg.id}" data-type="${type}" data-src="${mediaUrl}" onclick="window.open('${mediaUrl}','_blank')">
                                <img class="media-thumb">
                                <div class="media-badge">${badge}</div>
                             </div>`;
                } else if (type === 'voice') {
                    const avatarUrl = `/avatar/${encodeURIComponent(msg.sender)}`;
                    const dateOnly = msg.timestamp.split(' ')[0];
                    html += `
                        <div class="media-list-item" data-id="${msg.id}" onclick="playGlobalMedia('${msg.media_path.replace(/\\/g, '\\\\')}', '${msg.media_type}', ${msg.id})">
                            <img class="media-icon" src="${avatarUrl}" onerror="this.src=''; this.innerText='🎤'">
                            <div class="media-info">
                                <div class="media-title">${msg.sender}</div>
                                <div class="media-sub">${dateOnly} • <span id="media-menu-vp-btn-${msg.id}">▶ Play</span></div>
                            </div>
                        </div>`;
                } else if (type === 'file') {
                    html += `
                        <div class="media-list-item" data-id="${msg.id}" onclick="window.open('${mediaUrl}','_blank')">
                            <div class="media-icon">📄</div>
                            <div class="media-info">
                                <div class="media-title">${title}</div>
                                <div class="media-sub">${msg.file_size || 'Unknown size'} • ${msg.timestamp.split(' ')[0]}</div>
                            </div>
                        </div>`;
                } else if (type === 'link') {
                    html += `
                        <div class="media-list-item" data-id="${msg.id}">
                            <div class="media-icon" style="background: #3b5998;">🔗</div>
                            <div class="media-info">
                                <div class="media-title">${formatMessageText(msg.text_content)}</div>
                                <div class="media-sub">${msg.timestamp.split(' ')[0]}</div>
                            </div>
                        </div>`;
                }
            });

            const contentDiv = document.getElementById('media-content');
            if (!append) {
                // First load: Create the inner container
                contentDiv.innerHTML = `<div id="media-inner" class="${isGrid ? 'media-grid' : ''}">${html}</div>`;
            } else {
                // Append chunk: Add to existing inner container
                document.getElementById('media-inner').insertAdjacentHTML('beforeend', html);
            }
            
            // Initialize virtualization for new items with a tiny delay to ensure DOM stability
            console.log(`[UI] Media rendered. Found ${document.getElementById('media-inner').querySelectorAll('.media-grid-item').length} items.`);
            
            if (isGrid && window.mediaVirtualizer) {
                setTimeout(() => {
                    const inner = document.getElementById('media-inner');
                    if (!inner) return;
                    const containers = Array.from(inner.querySelectorAll('.media-grid-item:not(.observed)'));
                    console.log(`[UI] Applying virtualizer to ${containers.length} new items.`);
                    
                    containers.forEach((item, index) => {
                        item.classList.add('observed');
                        window.mediaVirtualizer.observe(item);
                        
                        // DEEP DEBUG: Force load the first 4 items immediately if they are at the top
                        if (index < 4 && !append) {
                            console.log(`[UI] ⚡ Force-loading initial item ${item.dataset.id}`);
                            window.mediaVirtualizer.load(item);
                        }
                    });
                }, 100);
            }
            
            mediaState.isFetching = false;
        }

        async function executeSearch() {
            const q = document.getElementById('searchInput').value;
            const checkedBoxes = Array.from(document.querySelectorAll('.sender-checkbox:checked'));
            const user = checkedBoxes.map(cb => cb.value).join(','); 
            const start = document.getElementById('start_date').value;
            const end = document.getElementById('end_date').value;
            const resDiv = document.getElementById('searchResults');
            
            if (!q && !user && !start && !end) return;
            resDiv.innerHTML = "Searching...";
            
            const params = new URLSearchParams({ q, sender: user, start, end });
            const res = await fetch(`/api/search?${params}`);
            const data = await res.json();
            
            if(data.length === 0) { resDiv.innerHTML = "No results."; return; }
            
            let html = `<div style="color:var(--text-muted); margin-bottom:10px;">Found ${data.length} results:</div>`;
            const safeQ = q.replace(/'/g, "\\'"); 

            data.forEach(msg => {
                // 1. Determine the text label
                let text = msg.text_content;
				let isMediaLabel = false;
				
                if (!text) {
                    // If no caption, label it by type
					isMediaLabel = true;
                    if (msg.media_type === 'photo') text = "Photo";
                    else if (msg.media_type === 'video') text = "Video";
                    else if (msg.media_type === 'round_video') text = "Video Message";
                    else if (msg.media_type === 'voice') text = "Voice Message";
                    else if (msg.media_type) text = `${msg.media_type.charAt(0).toUpperCase() + msg.media_type.slice(1)}`;
                    else text = "Message";
                } else {
                    // Replace line breaks with spaces before stripping tags
                    let processedText = text.replace(/<br\s*\/?>/gi, ' ').replace(/\n/g, ' ');
                    const doc = new DOMParser().parseFromString(processedText, 'text/html');
                    text = doc.body.textContent || "";
                }
				
				//Smart snippet generation
				if (q && !isMediaLabel) {
                    // Find where the match is
                    const idx = text.toLowerCase().indexOf(q.toLowerCase());
                    if (idx !== -1) {
                        const contextChars = 20; // Characters to show before/after
                        const start = Math.max(0, idx - contextChars);
                        const end = Math.min(text.length, idx + q.length + contextChars);
                        
                        let snippet = text.substring(start, end);
                        
                        if (start > 0) snippet = "..." + snippet;
                        if (end < text.length) snippet = snippet + "...";
                        
                        text = snippet;
                    }
                }

                // 2. Highlight keyword
                if (q) text = text.replace(new RegExp(`(${escapeRegExp(q)})`, "gi"), "<mark>$1</mark>");
                
				// Apply Blue Color if it is a Media Label
                if (isMediaLabel) {
                    text = `<span class="search-media-label">${text}</span>`;
                }
				
                // 3. Generate Thumbnail HTML (if it's a photo)
                let thumbHtml = '';
                if (msg.media_type === 'photo' && msg.media_path) {
                    const thumbUrl = `/media?path=${encodeURIComponent(msg.media_path)}`;
                    thumbHtml = `<img src="${thumbUrl}" class="search-preview-img">`;
                }

                // 4. Build the Item HTML
                html += `
                    <div class="search-item" onclick="jumpToContext(${msg.id}, '${safeQ}', this)">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <b style="color: ${getColor(msg.sender)}">${msg.sender}</b>
                            <div class="time">${msg.timestamp.split(' ')[0]}</div>
                        </div>
                        <div style="display: flex; align-items: center; color: var(--text-muted);">
                            ${thumbHtml}
                            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${text}</div>
                        </div>
                    </div>`;
            });
            resDiv.innerHTML = html;
        }


