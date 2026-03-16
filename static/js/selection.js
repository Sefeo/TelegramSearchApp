        // Context Menu trigger
        document.addEventListener('contextmenu', (e) => {
            const msgRow = e.target.closest('.msg-row');
            const mediaItem = e.target.closest('.media-grid-item, .media-list-item');
            rightClickedMediaItem = mediaItem;
			
            if (msgRow || mediaItem) {
                e.preventDefault();
                rightClickedMsgId = msgRow ? msgRow.id : `msg-${mediaItem.dataset.id}`;
                const numericId = parseInt(rightClickedMsgId.replace('msg-', ''));
                const msg = messageDataStore[numericId];
                
                const menu = document.getElementById('context-menu');
                if (!menu) return;

                // Safe helper to prevent silent crashes if an HTML element is missing
                const toggleItem = (id, condition) => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = condition ? 'block' : 'none';
                };

                // 1. "Select" (Only show if clicked inside the chat, not media menu)
                toggleItem('menu-select-msg', !!msgRow);

                // 2. "See in dialogue" (Only show if clicked from media menu)
                toggleItem('menu-jump-dialogue', !!mediaItem);

                // 3. Selection until here logic
                toggleItem('menu-select-until', msgRow && selectionMode && selectedIds.size > 0 && !selectedIds.has(numericId));

                // 4. Link logic
                const linkTarget = e.target.closest('.chat-link');
                if (linkTarget) rightClickedLinkUrl = linkTarget.href;
                toggleItem('menu-copy-link', !!linkTarget);

                // 5. Image copying logic
                toggleItem('menu-copy-image', msg && msg.media_type === 'photo');

                // 6. Open Destination logic
                toggleItem('menu-open-dest', msg && msg.media_path);

                menu.style.display = 'block';
                
                // Set initial position
                let x = e.pageX;
                let y = e.pageY;
                menu.style.left = x + 'px';
                menu.style.top = y + 'px';
                
                // Wait 1 frame to prevent menu from clipping off the edge of the screen
                setTimeout(() => {
                    const rect = menu.getBoundingClientRect();
                    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 5;
                    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 5;
                    menu.style.left = x + 'px';
                    menu.style.top = y + 'px';
                }, 0);
            }
        });
		
        function jumpToRightClicked() {
            document.getElementById('context-menu').style.display = 'none';
            if (rightClickedMsgId) {
                const numericId = rightClickedMsgId.replace('msg-', '');
                // No longer closes the media menu
                jumpToContext(numericId, null, rightClickedMediaItem);
            }
        }
		
		// Slide-to-Select: Mouse Down (Start Dragging)
        chat.addEventListener('mousedown', (e) => {
            const menu = document.getElementById('context-menu');
            
            // If menu is open, close it and DO NOT select anything.
            if (menu.style.display === 'block') {
                menu.style.display = 'none';
                return; // Stop execution here
            }

            if (selectionMode && e.button === 0) { // Left click only
                const msgRow = e.target.closest('.msg-row');
                if (msgRow) {
                    e.preventDefault(); 
                    isDraggingSelection = true;
                    const numericId = parseInt(msgRow.id.replace('msg-', ''));
                    dragSelectMode = !selectedIds.has(numericId);
                    setSelectionState(msgRow.id, dragSelectMode);
                }
            }
        }, true);

        // Slide-to-Select: Mouse Over (Apply selection to hovered items)
        chat.addEventListener('mouseover', (e) => {
            if (selectionMode && isDraggingSelection) {
                const msgRow = e.target.closest('.msg-row');
                if (msgRow) {
                    setSelectionState(msgRow.id, dragSelectMode);
                }
            }
        });

        // Slide-to-Select: Mouse Up (Stop Dragging)
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                isDraggingSelection = false;
            }
        });
		
        chat.addEventListener('click', (e) => {
            if (selectionMode) {
                const msgRow = e.target.closest('.msg-row');
                if (msgRow) {
                    e.preventDefault();
                    e.stopPropagation(); 
                    // Toggling is already handled by 'mousedown', so we just stop the event here
                }
            }
        }, true);

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', () => {
            document.getElementById('context-menu').style.display = 'none';
        });

        // Intercept clicks during Selection Mode
        chat.addEventListener('click', (e) => {
            if (selectionMode) {
                const msgRow = e.target.closest('.msg-row');
                if (msgRow) {
                    // Block opening links/images while selecting
                    e.preventDefault();
                    e.stopPropagation(); 
                }
            }
        }, true);

        // Ctrl+C shortcut for copying
        document.addEventListener('keydown', e => {
            // Check for Ctrl (Windows) or Meta (Mac) + C
            // We use e.code === 'KeyC' so it works on English, Ukrainian, and Russian layouts
            if (selectionMode && (e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
                e.preventDefault();
                copySelected();
            }
        });
		
		// --- ADD THESE ACTION FUNCTIONS ---
        function copyRightClickedLink() {
            document.getElementById('context-menu').style.display = 'none';
            if (rightClickedLinkUrl) {
                navigator.clipboard.writeText(rightClickedLinkUrl);
            }
        }

        async function openRightClickedDestination() {
            document.getElementById('context-menu').style.display = 'none';
            if (!rightClickedMsgId) return;
            const numericId = parseInt(rightClickedMsgId.replace('msg-', ''));
            const msg = messageDataStore[numericId];
            
            if (msg && msg.media_path) {
                await fetch('/api/open_file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: msg.media_path })
                });
            }
        }

        async function copyRightClickedImage() {
            document.getElementById('context-menu').style.display = 'none';
            if (!rightClickedMsgId) return;
            const numericId = parseInt(rightClickedMsgId.replace('msg-', ''));
            const msg = messageDataStore[numericId];
            
            if (!msg || msg.media_type !== 'photo') return;

            try {
                const safePath = encodeURIComponent(msg.media_path);
                const response = await fetch(`/media?path=${safePath}`);
                const blob = await response.blob();
                
                // The Clipboard API requires images to be in PNG format.
                // Telegram exports JPEGs, so we convert it via a temporary Canvas.
                const img = new Image();
                img.src = URL.createObjectURL(blob);
                await new Promise(resolve => img.onload = resolve);
                
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': pngBlob })
                ]);
            } catch (e) {
                console.error("Failed to copy image: ", e);
                alert("Could not copy image. (Clipboard API requires localhost or HTTPS)");
            }
        }
		
		function startSelection() {
            selectionMode = true;
            toggleSelection(rightClickedMsgId);
            document.getElementById('selection-bar').style.display = 'flex';
        }

        function toggleSelection(rowId) {
            const numericId = parseInt(rowId.replace('msg-', ''));
            setSelectionState(rowId, !selectedIds.has(numericId));
        }
		
       function setSelectionState(rowId, state) {
            const row = document.getElementById(rowId);
            if (!row) return;
            const numericId = parseInt(rowId.replace('msg-', ''));
            
            if (state) {
                selectedIds.add(numericId);
                row.classList.add('selected');
            } else {
                selectedIds.delete(numericId);
                row.classList.remove('selected');
            }
            document.getElementById('sel-count').innerText = selectedIds.size;
            
            // Exit selection mode if 0 messages are selected
            if (selectedIds.size === 0) clearSelection();
        }
		
        function selectUntilHere() {
            document.getElementById('context-menu').style.display = 'none';
            if (!rightClickedMsgId || selectedIds.size === 0) return;
            
            const targetIdNum = parseInt(rightClickedMsgId.replace('msg-', ''));
            
            // Find the nearest ID that is already selected
            const sortedSelected = Array.from(selectedIds).sort((a, b) => a - b);
            const nearestIdNum = sortedSelected.reduce((prev, curr) => 
                Math.abs(curr - targetIdNum) < Math.abs(prev - targetIdNum) ? curr : prev
            );
            
            // Iterate through the DOM to select everything in between
            const msgRows = Array.from(chat.querySelectorAll('.msg-row'));
            let inRange = false;
            
            for (let row of msgRows) {
                const rowIdNum = parseInt(row.id.replace('msg-', ''));
                
                if (rowIdNum === targetIdNum || rowIdNum === nearestIdNum) {
                    if (!inRange) {
                        inRange = true; // Start selecting
                        setSelectionState(row.id, true);
                        continue;
                    } else {
                        setSelectionState(row.id, true); // Select the final boundary
                        break; // Stop loop, we're done
                    }
                }
                
                if (inRange) {
                    setSelectionState(row.id, true);
                }
            }
        }

        function clearSelection() {
            selectionMode = false;
            selectedIds.clear();
            document.querySelectorAll('.msg-row.selected').forEach(el => el.classList.remove('selected'));
            document.getElementById('selection-bar').style.display = 'none';
        }

        function copySelected() {
            if (selectedIds.size === 0) return;
            const sortedIds = Array.from(selectedIds).sort((a, b) => a - b);
            
            let copyText = "";
            sortedIds.forEach(id => {
                const msg = messageDataStore[id];
                if (msg) {
                    // Strip HTML tags for clipboard
                    let rawText = msg.text_content || "";
                    if (rawText) {
                        const temp = document.createElement("div");
                        temp.innerHTML = rawText;
                        rawText = temp.innerText;
                    }
                    
                    const mediaLabel = msg.media_type ? `[${msg.media_type.toUpperCase()}] ` : '';
                    copyText += `[${msg.timestamp}] ${msg.sender}: ${mediaLabel}${rawText}\n`;
                }
            });

            navigator.clipboard.writeText(copyText.trim()).then(() => {
                const btn = document.getElementById('copy-btn');
                btn.innerText = "✅ Copied!";
                setTimeout(() => { btn.innerText = "📋 Copy"; }, 1000);
            });
        }

