        async function loadInitial() {
            chat.innerHTML = '';
            const res = await fetch('/api/messages');
            const messages = await res.json();
            if (messages.length > 0) {
                oldestMsgId = messages[0].id;
                newestMsgId = messages[messages.length - 1].id;
                allOldLoaded = false;
                allNewLoaded = true;
                renderMessages(messages);
                chat.scrollTop = chat.scrollHeight;
            } else {
                document.getElementById('date-pill').innerText = "No messages";
            }
        }

        async function loadOlder() {
            if (isFetching || allOldLoaded || !oldestMsgId) return;
            isFetching = true;
            const res = await fetch(`/api/messages?before_id=${oldestMsgId}`);
            const messages = await res.json();
            if (messages.length === 0) allOldLoaded = true;
            else { oldestMsgId = messages[0].id; renderMessages(messages, true); }
            isFetching = false;
        }

        async function loadNewer() {
            if (isFetching || allNewLoaded || !newestMsgId) return;
            isFetching = true;
            const res = await fetch(`/api/messages?after_id=${newestMsgId}`);
            const messages = await res.json();
            if (messages.length === 0) allNewLoaded = true;
            else { newestMsgId = messages[messages.length - 1].id; renderMessages(messages, false); }
            isFetching = false;
        }

        // --- HELPER: Handles the scrolling, pulsing, and keyword highlighting ---
        function applyJumpEffects(target, highlightKeyword) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
            
            // Force animation restart for the dialogue highlight
            const bubble = target.querySelector('.bubble');
            if (bubble) {
                bubble.style.animation = "none";
                void bubble.offsetWidth; // Trigger reflow
                bubble.style.animation = "pulse 1.5s ease"; 
            }

            // Apply keyword highlight if jumping from Search
            if (highlightKeyword) {
                const textArea = target.querySelector('.text');
                if (textArea) {
                    const originalText = textArea.innerHTML;
                    const safeKeyword = escapeRegExp(highlightKeyword);
                    const regex = new RegExp(`(${safeKeyword})`, 'gi');
                    textArea.innerHTML = originalText.replace(regex, '<span class="highlight-match">$1</span>');
                    setTimeout(() => { if(textArea) textArea.innerHTML = originalText; }, 3000);
                }
            }
        }

        async function jumpToContext(id, highlightKeyword = null, clickedSearchItem = null) {
            // 1. Handle sidebars active styling
            if (clickedSearchItem) {
                document.querySelectorAll('.search-item, .media-grid-item, .media-list-item').forEach(el => el.classList.remove('active'));
                clickedSearchItem.classList.add('active');
                // Scroll the sidebar itself so the clicked item is visible
                clickedSearchItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // 2. OPTIMIZATION: Is the message already loaded?
            const existingTarget = document.getElementById(`msg-${id}`);
            if (existingTarget) {
                // It's already here! Just scroll to it instantly and exit.
                applyJumpEffects(existingTarget, highlightKeyword);
                return; 
            }

            // 3. Not loaded. Fetch context from the server.
            isFetching = true; 
            chat.innerHTML = '<div style="text-align:center; padding: 20px;">Loading context...</div>';
            
            const res = await fetch(`/api/messages?around_id=${id}`);
            const messages = await res.json();
            chat.innerHTML = ''; 
            
            if (messages.length > 0) {
                oldestMsgId = messages[0].id; 
                newestMsgId = messages[messages.length - 1].id;
                allOldLoaded = false; 
                allNewLoaded = false; 
                
                renderMessages(messages);
                
                // Wait for the DOM to render the new messages, then jump
                setTimeout(() => {
                    const target = document.getElementById(`msg-${id}`);
                    if (target) { 
                        applyJumpEffects(target, highlightKeyword);
                    }
                    setTimeout(() => { isFetching = false; }, 500);
                }, 100);
            } else {
                isFetching = false;
            }
            
            // Show the "Scroll to Bottom" arrow since we are definitely in the past
            document.getElementById('btn-down').style.display = 'flex';
        }

        function jumpToBottom() { loadInitial(); document.getElementById('btn-down').style.display = 'none'; }

        chat.addEventListener('scroll', () => {
            // Increased threshold from 150 to 1500 to load messages much earlier
            if (chat.scrollTop < 1500) loadOlder();
            if (chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 1500) loadNewer();

            // Calculate if we should hide the down arrow
            document.getElementById('btn-down').style.display = (allNewLoaded && chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 100) ? 'none' : 'flex';
            
            // Floating date pill logic
            const elements = document.elementsFromPoint(window.innerWidth / 2, 80);
            if (elements) {
                const msgRow = elements.find(el => el.classList && el.classList.contains('msg-row'));
                if (msgRow) document.getElementById('date-pill').innerText = formatDateText(msgRow.getAttribute('data-date'));
            }
			
			updatePinnedBar(); 
        });

		async function loadPinnedData() {
            try {
                const res = await fetch('/api/pinned');
                allPinned = await res.json();
                if (!Array.isArray(allPinned)) allPinned =[]; // Protect against API errors
                updatePinnedBar();
            } catch (e) {
                console.error("Pinned API not ready.");
            }
        }

        function updatePinnedBar() {
            if (allPinned.length === 0) return;
            
            const msgRows = chat.getElementsByClassName('msg-row');
            if (msgRows.length === 0) return; // Prevent flicker while loading context
            
            const bar = document.getElementById('pinned-bar');
            
            // 1. Find a reliable timestamp currently in the viewport
            let currentViewTime = "9999-12-31"; 
            const chatRect = chat.getBoundingClientRect();
            
            // Scan visible rows to find the one closest to the top
            for (let row of msgRows) {
                const rect = row.getBoundingClientRect();
                // If the message is inside the visible chat area
                if (rect.bottom > chatRect.top && rect.top < chatRect.bottom) {
                    currentViewTime = row.getAttribute('data-timestamp');
                    break; 
                }
            }

            // 2. Find the most recent pin that happened BEFORE or AT the current view time
            let activePin = allPinned[0];
            let activeIdx = 1;
            
            // allPinned is ordered oldest to newest. We search backwards.
            for (let i = allPinned.length - 1; i >= 0; i--) {
                if (allPinned[i].timestamp <= currentViewTime) {
                    activePin = allPinned[i];
                    activeIdx = i + 1;
                    break;
                }
            }

            // 3. FLICKER FIX: Only update the UI if the pin has actually changed!
            if (currentPinTargetId === activePin.id) return;
            currentPinTargetId = activePin.id;

            // 4. Render the Bar
            document.getElementById('pinned-title').innerText = `Pinned Message #${activeIdx}`;
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = activePin.text_content || "";
            let previewText = tempDiv.innerText || activePin.media_type || "Message";
            document.getElementById('pinned-text').innerText = previewText;

            const img = document.getElementById('pinned-img');
            const vid = document.getElementById('pinned-vid');
            img.style.display = 'none'; vid.style.display = 'none';

            if (activePin.media_path) {
                const safePath = `/media?path=${encodeURIComponent(activePin.media_path)}`;
                if (activePin.media_type === 'photo') { img.src = safePath; img.style.display = 'block'; }
                else if (activePin.media_type === 'round_video') { vid.src = safePath + "#t=0.1"; vid.style.display = 'block'; }
            }
            bar.style.display = 'flex';
        }

        function jumpToCurrentPinned() {
            if (currentPinTargetId) jumpToContext(currentPinTargetId);
        }

        // Initialize pins on load
        loadPinnedData();

