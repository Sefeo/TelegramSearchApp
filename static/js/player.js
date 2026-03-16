        function startSmoothAnimation() {
            // Stop any existing loop to prevent duplicates
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            
            function step() {
                updatePlaybackUI(); // Update bars and text
                if (!engine.paused && !engine.ended) {
                    animationFrameId = requestAnimationFrame(step);
                }
            }
            animationFrameId = requestAnimationFrame(step);
        }

        function stopSmoothAnimation() {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        }

        function updatePlaybackUI() {
            if (!engine.duration) return;
            
            const currentTime = engine.currentTime;
            const duration = engine.duration;
            const percent = (currentTime / duration) * 100;
            
            // 1. Update Top Seek Bar (Only if user is not currently dragging it)
            const seekBar = document.getElementById('seek-bar');
            if (!isDraggingSeekBar) {
                seekBar.value = percent || 0;
            }
            
            // 2. Update Top Time Display
            document.getElementById('time-display').innerText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
            
            // 3. Update Round Video Sync (Loose sync to prevent jitter)
            if (currentPlayingType === 'round_video' && currentPlayingMsgId) {
                const rv = document.getElementById(`rv-${currentPlayingMsgId}`);
                // Only correct if drift is significant (>0.2s)
                if (rv && Math.abs(rv.currentTime - currentTime) > 0.2) {
                    rv.currentTime = currentTime;
                }
            }
            
            // 4. Update Voice Waveform & Time (The key part for smoothness)
            if (currentPlayingType === 'voice' && currentPlayingMsgId) {
                const canvas = document.getElementById(`vp-canvas-${currentPlayingMsgId}`);
                if (canvas) {
                    const msg = messageDataStore[currentPlayingMsgId];
                    drawWaveform(canvas, currentPlayingMsgId, currentTime / duration, msg ? msg.waveform : null);
                    
                    const vpTime = document.getElementById(`vp-time-${currentPlayingMsgId}`);
                    if (vpTime) vpTime.innerText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
                }
            }
	
        }
		
		async function processRealWaveform(path, msgId) {
            let audioCtx = null;
            try {
                const url = `/media?path=${encodeURIComponent(path)}`;
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

                const channelData = audioBuffer.getChannelData(0);
                // Increase resolution to 100 for better detail
                const samples = 100; 
                const blockSize = Math.floor(channelData.length / samples);
                const peaks = [];
                let max = 0;

                for (let i = 0; i < samples; i++) {
                    let peak = 0;
                    for (let j = 0; j < blockSize; j++) {
                        const val = Math.abs(channelData[i * blockSize + j]);
                        if (val > peak) peak = val;
                    }
                    peaks.push(peak);
                    if (peak > max) max = peak;
                }

                // 1. Normalize (0 to 1)
                // 2. Apply Gamma Correction (power of 0.7) to boost quiet sounds
                // 3. Ensure a minimum baseline (0.02) so silence isn't completely invisible
                const normalized = peaks.map(p => {
                    const norm = max ? p / max : 0;
                    return Math.max(0.02, Math.pow(norm, 0.7)); 
                });
                
                const waveStr = JSON.stringify(normalized);

                if (messageDataStore[msgId]) messageDataStore[msgId].waveform = waveStr;

                await fetch('/api/save_waveform', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: msgId, waveform: waveStr })
                });

                const canvas = document.getElementById(`vp-canvas-${msgId}`);
                if (canvas) {
                    const prog = engine.duration ? (engine.currentTime / engine.duration) : 0;
                    drawWaveform(canvas, msgId, prog, waveStr);
                }
                return true;
            } catch (e) {
                console.error(`Waveform generation failed for ID ${msgId}:`, e);
                return false;
            } finally {
                if (audioCtx && audioCtx.state !== 'closed') {
                    await audioCtx.close();
                }
            }
        }

        async function generateAllWaveforms(force = false) {
            const btn = document.getElementById('btn-gen-all');
            const originalText = force ? "Force Regenerate ALL" : "Generate missing waveforms for ALL messages";
            
            btn.innerText = "Scanning database...";
            btn.disabled = true;

            try {
                // Pass the force flag to the server
                const res = await fetch(`/api/missing_waveforms?force=${force}`);
                const missing = await res.json();
                
                if (missing.length === 0) {
                    btn.innerText = "No waveforms to generate.";
                    setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 3000);
                    return;
                }

                for (let i = 0; i < missing.length; i++) {
                    btn.innerText = `Processing ${i + 1} / ${missing.length}...`;
                    await processRealWaveform(missing[i].media_path, missing[i].id);
                }

                btn.innerText = "✅ Done!";
            } catch (e) {
                btn.innerText = "Error. Check console.";
                console.error(e);
            }

            setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 3000);
        }
		
		function drawWaveform(canvas, msgId, progress = 0, realWaveformStr = null) {
            if (!canvas) return;
            if (isNaN(progress) || !isFinite(progress)) progress = 0;
            
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const barWidth = 3;
            const gap = 2;
            const bars = Math.floor(width / (barWidth + gap));
            const accentColor = '#5288c1'; 
            const grayColor = 'rgba(127,145,164,0.5)';

            // Parse data
            let realData = [];
            if (realWaveformStr) {
                try { realData = JSON.parse(realWaveformStr); } catch (e) {}
            }

            // Seed for fake waveform fallback
            let seed = msgId; 
            const random = () => { let x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

            // Helper to draw all bars in a specific color
            const drawBars = (color) => {
                ctx.fillStyle = color;
                for (let i = 0; i < bars; i++) {
                    let barHeight;
                    if (realData.length > 0) {
                        const dataIdx = Math.floor((i / bars) * realData.length);
                        const val = realData[Math.min(dataIdx, realData.length - 1)] || 0.05;
                        barHeight = Math.max(4, val * height); 
                    } else {
                        barHeight = 4 + random() * (height - 8);
                    }
                    
                    const x = i * (barWidth + gap);
                    const y = (height - barHeight) / 2;
                    
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(x, y, barWidth, barHeight, 5); 
                    else ctx.rect(x, y, barWidth, barHeight); 
                    ctx.fill();
                }
            };

            // 1. Clear Canvas
            ctx.clearRect(0, 0, width, height);

            // 2. Draw the background (Gray) bars completely
            drawBars(grayColor);

            // 3. Draw the foreground (Blue) bars with a Clipping Mask
            ctx.save();
            ctx.beginPath();
            // Define a rectangle that represents the current audio progress (pixel perfect)
            ctx.rect(0, 0, width * progress, height);
            ctx.clip(); // Restrict drawing to this rectangle
            
            drawBars(accentColor); // Draw blue bars (only visible inside the clip)
            ctx.restore();
        }

		function seekVoice(event, msgId) {
            event.stopPropagation();
            if (currentPlayingMsgId !== msgId || currentPlayingType !== 'voice') {
                const btn = document.getElementById(`vp-btn-${msgId}`);
                if (btn) btn.click();
                setTimeout(() => seekVoice(event, msgId), 200);
                return;
            }
            
            const canvas = document.getElementById(`vp-canvas-${msgId}`);
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const progress = (event.clientX - rect.left) / rect.width;
            
            if (engine.duration) { engine.currentTime = engine.duration * progress; }
            
            const msg = messageDataStore[msgId];
            drawWaveform(canvas, msgId, progress, msg ? msg.waveform : null); // <-- Passes real data
        }

        function playGlobalMedia(path, type, msgId = null) {
            if (currentPlayingPath === path) { togglePlay(); return; }

            // Stop previously playing round video
            if (currentPlayingType === 'round_video' && currentPlayingMsgId) {
                const oldRv = document.getElementById(`rv-${currentPlayingMsgId}`);
                const oldPlayBtn = document.getElementById(`rv-play-${currentPlayingMsgId}`);
                if (oldRv) oldRv.pause();
                if (oldPlayBtn) oldPlayBtn.style.display = 'flex';
            }

            currentPlayingPath = path; 
            currentPlayingMsgId = msgId;
            currentPlayingType = type;
            
            const safePath = encodeURIComponent(path);
            engine.src = `/media?path=${safePath}`;
            playerBar.style.display = 'flex';
            engine.playbackRate = speeds[currentSpeedIdx];
            engine.play();
            playPauseBtn.innerText = "⏸";
            
            vidPreview.style.display = 'none'; // Keep player panel clean
			
			// Trigger auto-generation on first listen
            if (type === 'voice' && msgId && waveSetting.checked) {
                const msg = messageDataStore[msgId];
                if (msg && !msg.waveform) {
                    processRealWaveform(msg.media_path, msgId);
                }
            }

            if (type === 'round_video' && msgId) {
                const rv = document.getElementById(`rv-${msgId}`);
                const playBtn = document.getElementById(`rv-play-${msgId}`);
                if (rv) { rv.currentTime = 0; rv.play(); }
                if (playBtn) { playBtn.style.display = 'none'; }
            }
        }
        
        // 1. Timeupdate: Acts as a fallback and handles seeking while paused
        engine.addEventListener('timeupdate', updatePlaybackUI);

        // 2. Pause: Stop animation and update icons
        engine.addEventListener('pause', () => {
            stopSmoothAnimation();
            playPauseBtn.innerText = "▶";
            
            if (currentPlayingType === 'round_video' && currentPlayingMsgId) {
                const rv = document.getElementById(`rv-${currentPlayingMsgId}`);
                if (rv) rv.pause();
                const wrapper = document.getElementById(`rv-wrap-${currentPlayingMsgId}`);
                if (wrapper) wrapper.classList.remove('playing');
            }
            
            if (currentPlayingType === 'voice' && currentPlayingMsgId) {
                const btn = document.getElementById(`vp-btn-${currentPlayingMsgId}`);
                if (btn) btn.innerText = "▶";
                const menuBtn = document.getElementById(`media-menu-vp-btn-${currentPlayingMsgId}`);
                if (menuBtn) menuBtn.innerText = "▶ Play";
            }
        });
        
        // 3. Play: Start smooth animation loop and update icons
        engine.addEventListener('play', () => {
            startSmoothAnimation(); // <--- This triggers the 60FPS updates
            playPauseBtn.innerText = "⏸";
            
            // Reset all voice buttons visually
            document.querySelectorAll('.vp-btn').forEach(b => b.innerText = '▶');
            document.querySelectorAll('[id^="media-menu-vp-btn-"]').forEach(b => b.innerText = '▶ Play');
            
            if (currentPlayingType === 'round_video' && currentPlayingMsgId) {
                const rv = document.getElementById(`rv-${currentPlayingMsgId}`);
                if (rv) rv.play();
                const wrapper = document.getElementById(`rv-wrap-${currentPlayingMsgId}`);
                if (wrapper) wrapper.classList.add('playing');
            }
            
            if (currentPlayingType === 'voice' && currentPlayingMsgId) {
                const btn = document.getElementById(`vp-btn-${currentPlayingMsgId}`);
                if (btn) btn.innerText = "⏸";
                const menuBtn = document.getElementById(`media-menu-vp-btn-${currentPlayingMsgId}`);
                if (menuBtn) menuBtn.innerText = "⏸ Paused";
            }
        });
        
        // 4. Ended: Clean stop
        engine.addEventListener('ended', () => {
            stopSmoothAnimation();
            playPauseBtn.innerText = "▶";
        });
		
        function jumpToPlaying() {
            if (currentPlayingMsgId) jumpToContext(currentPlayingMsgId);
        }

        function togglePlay() {
            if (engine.paused) { engine.play(); vidPreview.play(); playPauseBtn.innerText = "⏸"; } 
            else { engine.pause(); vidPreview.pause(); playPauseBtn.innerText = "▶"; }
        }

        function closePlayer() { engine.pause(); vidPreview.pause(); playerBar.style.display = 'none'; }
        
        function cycleSpeed() {
            currentSpeedIdx = (currentSpeedIdx + 1) % speeds.length;
            engine.playbackRate = speeds[currentSpeedIdx];
            if(vidPreview.style.display === 'block') vidPreview.playbackRate = speeds[currentSpeedIdx];
            speedBtn.innerText = speeds[currentSpeedIdx] + "x";
        }


        seekBar.addEventListener('mousedown', () => isDraggingSeekBar = true);
        seekBar.addEventListener('touchstart', () => isDraggingSeekBar = true, {passive: true});
        seekBar.addEventListener('mouseup', () => isDraggingSeekBar = false);
        seekBar.addEventListener('touchend', () => isDraggingSeekBar = false);
        
        seekBar.addEventListener('input', (e) => { 
            if (engine.duration) {
                engine.currentTime = engine.duration * (e.target.value / 100);
            }
        });
        engine.addEventListener('ended', () => { playPauseBtn.innerText = "▶"; });

		function syncPlayingUI() {
            if (!currentPlayingMsgId) return;
            const isPaused = engine.paused;
            
            if (currentPlayingType === 'round_video') {
                const rv = document.getElementById(`rv-${currentPlayingMsgId}`);
                const wrapper = document.getElementById(`rv-wrap-${currentPlayingMsgId}`);
                if (rv) { rv.currentTime = engine.currentTime; if (!isPaused) rv.play(); }
                if (wrapper) { if (!isPaused) wrapper.classList.add('playing'); }
            }
            
            if (currentPlayingType === 'voice') {
                const btn = document.getElementById(`vp-btn-${currentPlayingMsgId}`);
                if (btn) btn.innerText = isPaused ? "▶" : "⏸";
                
                const canvas = document.getElementById(`vp-canvas-${currentPlayingMsgId}`);
                if (canvas) {
                    const prog = engine.duration ? (engine.currentTime / engine.duration) : 0;
                    drawWaveform(canvas, currentPlayingMsgId, prog);
                }
            }
        }

