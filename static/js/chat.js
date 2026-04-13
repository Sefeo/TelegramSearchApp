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

        // --- Floating date pill (JS-controlled overlay) ---
        let floatingPill = null;
        let floatingPillSpan = null;

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
                    const originalHTML = textArea.innerHTML;
                    const safeKeyword = escapeRegExp(highlightKeyword);
                    const regex = new RegExp(`(${safeKeyword})`, 'gi');
                    
                    // Safe highlighting that only touches text nodes
                    const walkAndHighlight = (node) => {
                        if (node.nodeType === 3) { // Text Node
                            const val = node.nodeValue;
                            if (regex.test(val)) {
                                regex.lastIndex = 0; // Reset for use in loop
                                const fragment = document.createDocumentFragment();
                                let lastIdx = 0;
                                let match;
                                while ((match = regex.exec(val)) !== null) {
                                    fragment.appendChild(document.createTextNode(val.substring(lastIdx, match.index)));
                                    const highlight = document.createElement('span');
                                    highlight.className = 'highlight-match';
                                    highlight.textContent = match[0];
                                    fragment.appendChild(highlight);
                                    lastIdx = regex.lastIndex;
                                }
                                fragment.appendChild(document.createTextNode(val.substring(lastIdx)));
                                node.parentNode.replaceChild(fragment, node);
                            }
                        } else if (node.nodeType === 1 && node.childNodes && node.className !== 'highlight-match') {
                            // Don't recurse into our own highlights or non-element nodes
                            Array.from(node.childNodes).forEach(walkAndHighlight);
                        }
                    };
                    
                    walkAndHighlight(textArea);
                    setTimeout(() => { if(textArea) textArea.innerHTML = originalHTML; }, 3000);
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

        function updateFloatingPill() {
            // Lazy init: find or create the floating pill element
            if (!floatingPill) {
                floatingPill = document.getElementById('floating-date');
                if (!floatingPill) {
                    // Create it dynamically if missing (e.g. cached HTML)
                    floatingPill = document.createElement('div');
                    floatingPill.id = 'floating-date';
                    floatingPill.innerHTML = '<span></span>';
                    chat.parentNode.insertBefore(floatingPill, chat);
                }
                // Apply essential styles inline (cache-proof)
                floatingPill.style.cssText = 'position:fixed;z-index:55;pointer-events:none;display:none;justify-content:center;left:0;right:0;transition:opacity 0.4s ease;';
                floatingPillSpan = floatingPill.querySelector('span');
                floatingPillSpan.style.cssText = 'background-color:rgba(24,37,51,0.5);backdrop-filter:blur(4px);padding:4px 12px;border-radius:12px;font-size:13px;color:white;font-weight:600;pointer-events:auto;';
            }

            const chatRect = chat.getBoundingClientRect();
            const stickyTop = document.body.classList.contains('player-open') ? 60 : 10;
            const ceilY = chatRect.top + stickyTop;   // viewport Y where pill sits

            const dividers = Array.from(chat.querySelectorAll('.date-divider'));
            if (dividers.length === 0) { floatingPill.style.display = 'none'; return; }

            // Find the "active" divider: the LAST one whose visible span has fully
            // scrolled above ceilY, so the fixed pill is truly gone before floating appears.
            let activeIdx = -1;
            for (let i = 0; i < dividers.length; i++) {
                const span = dividers[i].querySelector('span');
                const bottom = span ? span.getBoundingClientRect().bottom : dividers[i].getBoundingClientRect().bottom;
                if (bottom < ceilY) activeIdx = i;
                else break;  // dividers are in DOM order (top-to-bottom)
            }

            if (activeIdx === -1) {
                // No divider has fully scrolled past → hide overlay
                floatingPill.style.display = 'none';
                return;
            }

            const activeDivider = dividers[activeIdx];
            const nextDivider = dividers[activeIdx + 1] || null;

            // Set the text
            const dateText = activeDivider.querySelector('span')?.textContent || '';
            floatingPillSpan.textContent = dateText;
            floatingPill.style.display = 'flex';
            floatingPill.style.opacity = '1';

            // Calculate the "floor": the pill must not go below the last message of its day.
            // The floor is the top of the next date-divider minus the pill's own height.
            let pillY = ceilY;
            if (nextDivider) {
                const nextTop = nextDivider.getBoundingClientRect().top;
                const pillH = floatingPill.offsetHeight;
                const floorY = nextTop - pillH;
                pillY = Math.min(ceilY, floorY);
            }

            floatingPill.style.top = pillY + 'px';

            // If the pill is pushed above the viewport top (scrolled past the entire day), hide it
            if (pillY + floatingPill.offsetHeight < chatRect.top) {
                floatingPill.style.display = 'none';
            }
        }

        chat.addEventListener('scroll', () => {
            // Increased threshold from 150 to 1500 to load messages much earlier
            if (chat.scrollTop < 1500) loadOlder();
            if (chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 1500) loadNewer();

            // Calculate if we should hide the down arrow
            document.getElementById('btn-down').style.display = (allNewLoaded && chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 100) ? 'none' : 'flex';
            
            // --- Update floating date pill ---
            updateFloatingPill();

            // --- Scroll-idle auto-fade ---
            clearTimeout(chat._scrollIdleTimer);
            chat._scrollIdleTimer = setTimeout(() => {
                if (floatingPill && floatingPill.style.display === 'flex') {
                    floatingPill.style.opacity = '0';
                }
            }, 1000);

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

