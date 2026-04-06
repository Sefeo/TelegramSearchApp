		// Sidebar scroll up button logic
        document.getElementById('sidebar-content').addEventListener('scroll', function() {
            document.getElementById('btn-sidebar-up').style.display = this.scrollTop > 100 ? 'flex' : 'none';
        });

        let lastMediaScroll = 0;
        document.getElementById('media-content').addEventListener('scroll', function() {
            if (this.scrollHeight - this.scrollTop - this.clientHeight < 800) {
                if (typeof mediaState !== 'undefined' && !mediaState.isFetching && !mediaState.allLoaded) {
                    loadMedia(mediaState.type, null, true);
                }
            }
            
            if (Math.abs(this.scrollTop - lastMediaScroll) > 400) {
                lastMediaScroll = this.scrollTop;
                const items = this.querySelectorAll('.media-grid-item, .media-list-item');
                const vh = window.innerHeight;
                items.forEach(item => {
                    const rect = item.getBoundingClientRect();
                    if (rect.bottom < -2000 || rect.top > vh + 2000) {
                        if (!item.dataset.unloaded) {
                            item.style.height = item.offsetHeight + 'px';
                            item.dataset.originalHtml = item.innerHTML;
                            item.innerHTML = '';
                            item.dataset.unloaded = 'true';
                        }
                    } else if (item.dataset.unloaded) {
                        item.innerHTML = item.dataset.originalHtml;
                        item.style.height = '';
                        delete item.dataset.unloaded;
                        delete item.dataset.originalHtml;
                    }
                });
            }
        });

        // --- CALENDAR & SEARCH LOGIC ---
        // Dynamically reposition calendar when layout shifts
        document.body.addEventListener('transitionend', (e) => {
            if (e.target.classList && e.target.classList.contains('btn-round') && window.DatePicker) {
                DatePicker.reposition();
            }
        });

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
                    html += `<div class="media-grid-item" data-id="${msg.id}" onclick="window.open('${mediaUrl}','_blank')"><img src="${mediaUrl}"></div>`;
                } else if (type === 'video' || type === 'gif') {
                    // Start with GIF or a placeholder "--:--" for videos
                    const badge = type === 'gif' ? 'GIF' : '--:--';
                    
                    // Tell the browser to read the video duration automatically once loaded
                    const onLoadAttr = type === 'video' ? `onloadedmetadata="if(this.duration && this.duration !== Infinity) this.nextElementSibling.innerText = formatTime(this.duration);"` : '';

                    html += `<div class="media-grid-item" data-id="${msg.id}" onclick="window.open('${mediaUrl}','_blank')">
                                <video src="${mediaUrl}#t=0.1" preload="metadata" muted ${onLoadAttr}></video>
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


