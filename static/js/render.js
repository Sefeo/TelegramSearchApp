        // --- RENDER LOGIC ---
        function renderMessages(messages, prepend = false) {
            let html = '';
            let lastSender = prepend && chat.firstElementChild ? chat.firstElementChild.dataset.sender : null;
            let lastRenderedDate = null;

            let oldTopDivider = null;
            let oldTopDate = null;

            if (prepend && chat.firstElementChild) {
                const firstMsg = chat.querySelector('.msg-row');
                if (firstMsg) {
                    oldTopDate = firstMsg.dataset.date;
                    const prevEl = firstMsg.previousElementSibling;
                    if (prevEl && prevEl.classList.contains('date-divider')) oldTopDivider = prevEl;
                }
            }

            if (!prepend) {
                const lastRow = Array.from(chat.children).reverse().find(el => el.classList.contains('msg-row'));
                if (lastRow) {
                    lastRenderedDate = lastRow.dataset.date;
                    lastSender = lastRow.dataset.sender;
                } else { lastSender = null; }
            }

            messages.forEach(msg => {
                messageDataStore[msg.id] = msg; // Save to store
                
                let timeStr = ""; let dateOnly = "";
                if (msg.timestamp) {
                    const parts = msg.timestamp.split(' ');
                    dateOnly = parts[0]; 
                    if(parts.length > 1) timeStr = `${parts[1].split(':')[0]}:${parts[1].split(':')[1]}`;
                }

                if (msg.media_type === 'service' | msg.media_type === 'service_photo') {
                    // Update the lastRenderedDate so the next normal message doesn't duplicate the date header
                    if (dateOnly !== lastRenderedDate) {
                        html += `<div class="date-divider"><span>${formatDateText(dateOnly)}</span></div>`;
                        lastRenderedDate = dateOnly;
                        lastSender = null; 
                    }
					
					let extraHtml = '';
                    if (msg.media_type === 'service_photo' && msg.media_path) {
                        const safePath = `/media?path=${encodeURIComponent(msg.media_path)}`;
                        extraHtml = `<img class="service-photo-preview" src="${safePath}" onclick="window.open('${safePath}','_blank')">`;
                    }
					let sysText = msg.text_content.replace('this message', '<span style="cursor:pointer;border-bottom:1px dashed white" onclick="jumpToCurrentPinned()">this message</span>');
                    html += `<div class="system-msg" id="msg-${msg.id}" data-date="${dateOnly}" data-timestamp="${msg.timestamp}">
                                ${sysText}
                                ${extraHtml}
                             </div>`;
                    lastSender = null; // Reset sender grouping after a system message
                    return; // Skip the rest of the loop for this item
                }

                if (dateOnly !== lastRenderedDate) {
                    html += `<div class="date-divider"><span>${formatDateText(dateOnly)}</span></div>`;
                    lastRenderedDate = dateOnly;
                    lastSender = null; 
                }

                const showHeader = msg.sender !== lastSender;
                lastSender = msg.sender;
                const avatarUrl = `/avatar/${encodeURIComponent(msg.sender)}`;
                
                // PREPARE CONTENT
                let mediaHtml = '';
				let textToRender = formatMessageText(msg.text_content);
                let isSpoilerMedia = textToRender.trim() === 'spoiler image';
                if (isSpoilerMedia) textToRender = ''; // Hide text if it's just a marker
				
                // --- CONTACTS & CALLS (SAFE VERSION) ---
                if (msg.media_type === 'contact') {
                    // Safe split: use (msg.text_content || "") to prevent null crash
                    const parts = (msg.text_content || "").split('|');
                    const cName = parts[0] || "Unknown";
                    const cPhone = parts[1] || "";
                    const phoneClean = cPhone.replace(/[^\d+]/g, '');
                    
                    mediaHtml = `
                        <div class="reply-block" style="background:rgba(0,0,0,0.2); cursor:default; padding:10px;">
                            <img src="/avatar/${encodeURIComponent(cName)}" style="width:40px;height:40px;border-radius:50%;margin-right:10px;">
                            <div style="flex-grow:1; overflow:hidden;">
                                <div style="font-weight:bold;">${cName}</div>
                                <div style="color:var(--accent);margin-bottom:5px;">${cPhone}</div>
                                <button class="play-btn-inline" style="width:100%; justify-content:center;" onclick="window.open('https://t.me/${phoneClean}', '_blank')">Write to contact</button>
                            </div>
                        </div>`;
                    textToRender = '';
                } 
                else if (msg.media_type === 'call') {
                    const parts = msg.text_content.split('|');
                    const cTitle = parts[0] || "Call";
                    const cStatus = parts[1] || "";
                    const isSucc = parts[2] === 'True';
                    
                    const icon = isSucc ? '📞' : '❌';
                    const color = isSucc ? 'var(--text-main)' : '#e17076';
                    mediaHtml = `
                        <div class="reply-block" style="background:rgba(0,0,0,0.2); cursor:default; padding:10px; color:${color};">
                            <div style="font-size: 24px; margin-right: 10px;">${icon}</div>
                            <div>
                                <div style="font-weight:bold;">${cTitle}</div>
                                <div style="font-size:12px;">${cStatus}</div>
                            </div>
                        </div>`;
                    textToRender = '';
                }
				// --- POLLS ---
                else if (msg.media_type === 'poll') {
                    try {
                        const pollData = JSON.parse(msg.text_content);
                        let optionsHtml = '';
                        
                        // Calculate total votes manually if needed, or use stored total
                        let maxVotes = 0;
                        pollData.options.forEach(opt => maxVotes += opt.count);
                        if (maxVotes === 0) maxVotes = 1; // Avoid divide by zero

                        pollData.options.forEach(opt => {
                            const percent = Math.round((opt.count / maxVotes) * 100);
                            const isChosen = opt.chosen ? 'winner' : '';
                            const checkmark = opt.chosen ? '✔ ' : '';
                            
                            optionsHtml += `
                                <div class="poll-option">
                                    <div class="poll-bar-bg">
                                        <div class="poll-bar-fill ${isChosen}" style="width: ${percent}%"></div>
                                    </div>
                                    <div class="poll-text-overlay">
                                        <span>${checkmark}${opt.text}</span>
                                        <span>${percent}%</span>
                                    </div>
                                </div>`;
                        });

                        mediaHtml = `
                            <div class="poll-container">
                                <div class="poll-question">${pollData.question}</div>
                                <div class="poll-meta">${pollData.type} • ${pollData.total}</div>
                                ${optionsHtml}
                            </div>`;
                        textToRender = ''; // Don't show JSON text
                    } catch(e) { textToRender = "Error parsing poll"; }
                }
                
                // --- LOCATIONS ---
                else if (msg.media_type === 'location') {
                    const [coords, link] = msg.text_content.split('|');
                    mediaHtml = `
                        <div class="location-card" onclick="window.open('${link}', '_blank')">
                            <div class="location-map">📍</div>
                            <div class="location-info">
                                <div style="font-weight:bold; color:var(--text-main);">Location</div>
                                <div style="color:var(--accent); font-size:13px;">${coords}</div>
                            </div>
                        </div>`;
                    textToRender = '';
                }
                else if (msg.media_path) {
                    const sCls = isSpoilerMedia ? 'spoiler' : '';
                    const safePath = encodeURIComponent(msg.media_path);
                    const url = `/media?path=${safePath}`;
                    const isAudioFile = msg.media_type === 'audio' || msg.media_path.toLowerCase().endsWith('.mp3');
	
					
					if (msg.media_type === 'photo') {
                        // If spoiled: First click reveals. Second click opens.
                        if (isSpoilerMedia) {
                            mediaHtml = `<img class="media-photo spoiler" src="${url}" onclick="if(this.classList.contains('revealed')){ window.open('${url}','_blank') } else { this.classList.add('revealed') }">`;
                        } else {
                            mediaHtml = `<img class="media-photo" src="${url}" onclick="window.open('${url}','_blank')">`;
                        }
                    }
                    else if (msg.media_type === 'gif') mediaHtml = `<video src="${url}" autoplay loop muted playsinline class="media-gif ${sCls}" ${isSpoilerMedia ? "onclick=\"this.classList.add('revealed')\"" : ""}></video>`;
                    else if (msg.media_type === 'sticker') mediaHtml = `<img class="media-sticker" src="${url}">`;
                    else if (msg.media_type === 'video') mediaHtml = `<video src="${url}" controls class="media-photo ${sCls}"></video>`;
                    else if (msg.media_type === 'round_video') {
                        mediaHtml = `<div class="round-video-wrapper" id="rv-wrap-${msg.id}" onclick="playGlobalMedia('${msg.media_path.replace(/\\/g, '\\\\')}', 'round_video', ${msg.id})">
                                        <video id="rv-${msg.id}" src="${url}#t=0.1" preload="metadata" class="round-video-embed" muted></video>
                                        <div class="play-overlay" id="rv-play-${msg.id}">▶</div>
                                     </div>`;
                    } 
                    else if (msg.media_type === 'voice' || isAudioFile) {
                        const icon = isAudioFile ? '🎵 Audio File' : '🎤 Voice Message';
                        mediaHtml = `
                            <div class="voice-player">
                                <button class="vp-btn" id="vp-btn-${msg.id}" onclick="playGlobalMedia('${msg.media_path.replace(/\\/g, '\\\\')}', 'voice', ${msg.id})">▶</button>
                                <div class="vp-waveform-container" onclick="seekVoice(event, ${msg.id})">
                                    <canvas id="vp-canvas-${msg.id}" class="vp-canvas-uninit" width="160" height="30"></canvas>
                                </div>
                                <div class="vp-time" id="vp-time-${msg.id}">--:--</div>
                                <audio src="${url}" preload="metadata" onloadedmetadata="document.getElementById('vp-time-${msg.id}').innerText = formatTime(this.duration)"></audio>
                            </div>`;
                    } else { 
                        mediaHtml = `<a href="${url}" target="_blank" class="media-file">📄 Open File</a>`; 
                    }
                }

                // --- REPLY BLOCK GENERATION ---
                let replyHtml = '';
                if (msg.reply_to_id) {
                    let rText = formatMessageText(msg.reply_text) || "";
                    let rMediaLabel = "";
                    let rThumbHtml = "";

                    // Determine media labels and thumbnails
                    if (msg.reply_media_type === 'photo') { 
                        rMediaLabel = "Photo"; 
                        if(msg.reply_media_path) rThumbHtml = `<img src="/media?path=${encodeURIComponent(msg.reply_media_path)}" class="reply-thumb">`; 
                    }
                    else if (msg.reply_media_type === 'round_video') { 
                        rMediaLabel = "Video Message"; 
                        if(msg.reply_media_path) rThumbHtml = `<video src="/media?path=${encodeURIComponent(msg.reply_media_path)}#t=0.1" class="reply-thumb" muted></video>`; 
                    }
                    else if (msg.reply_media_type === 'video') rMediaLabel = "Video";
                    else if (msg.reply_media_type === 'voice') rMediaLabel = "Voice Message";
                    else if (msg.reply_media_type === 'gif') rMediaLabel = "GIF";
                    else if (msg.reply_media_type === 'file' || msg.reply_media_type === 'audio') {
                        rMediaLabel = "File";
                        if (msg.reply_media_path) rText = msg.reply_media_path.split(/[\\/]/).pop();
                    }

                    // Apply blue styling to media labels
                    if (rMediaLabel) {
                        rText = `<span class="search-media-label">${rMediaLabel}</span> ${rText}`;
                    }

                    replyHtml = `
                        <div class="reply-block" onclick="jumpToContext(${msg.reply_to_id})">
                            ${rThumbHtml}
                            <div class="reply-content">
                                <div class="reply-sender">${msg.reply_sender || "Unknown"}</div>
                                <div class="reply-text">${rText}</div>
                            </div>
                        </div>`;
                }
				
				// 6. BUILD FINAL HTML
                const pinDot = msg.is_pinned ? `<div class="pin-indicator" title="Pinned Message"></div>` : '';
                
                // Determine if bubble should be frameless (Stickers/GIFs with no text and no reply)
                const isFrameless = (msg.media_type === 'sticker' || msg.media_type === 'gif') && !textToRender && !msg.reply_to_id;
                const bubbleClass = isFrameless ? "bubble frameless" : "bubble";

                html += `
                    <div class="msg-row" id="msg-${msg.id}" data-date="${dateOnly}" data-sender="${msg.sender}" data-timestamp="${msg.timestamp}">
                        ${showHeader ? `<img class="avatar" src="${avatarUrl}">` : `<div style="width: 54px;"></div>`}
                        <div class="${bubbleClass}">
                            ${pinDot}
                            ${showHeader ? `<div class="sender" style="color: ${getColor(msg.sender)};">${msg.sender}</div>` : ''}
                            ${typeof replyHtml !== 'undefined' ? replyHtml : ''}
                            ${mediaHtml}
                            ${textToRender ? `<div class="text">${textToRender} <span class="time">${timeStr}</span></div>` : (isFrameless ? `<span class="time">${timeStr}</span>` : '')}
                        </div>
                    </div>`;
            });

            // 7. INSERTION LOGIC
            if (prepend) {
                const oldHeight = chat.scrollHeight;
                const oldScrollTop = chat.scrollTop; 
                chat.insertAdjacentHTML('afterbegin', html);
                chat.scrollTop = oldScrollTop + (chat.scrollHeight - oldHeight);

                if (oldTopDivider && messages.length > 0) {
                    const lastMsgInNewBatch = messages[messages.length - 1];
                    let lastMsgDate = "";
                    if(lastMsgInNewBatch.timestamp) lastMsgDate = lastMsgInNewBatch.timestamp.split(' ')[0];
                    if (lastMsgDate === oldTopDate) oldTopDivider.remove();
                }
            } else {
                chat.insertAdjacentHTML('beforeend', html);
            }

            // INITIALIZE WAVEFORMS & PIN STATE
            setTimeout(() => {
                chat.querySelectorAll('canvas.vp-canvas-uninit').forEach(canvas => {
                    canvas.classList.remove('vp-canvas-uninit');
                    const id = parseInt(canvas.id.replace('vp-canvas-', ''));
                    const msg = messageDataStore[id];
                    drawWaveform(canvas, id, 0, msg ? msg.waveform : null); 
                });
                syncPlayingUI();
                updatePinnedBar(); // Ensure bar updates when content loads
            }, 50);
        }

