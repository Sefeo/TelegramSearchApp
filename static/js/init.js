        document.getElementById('searchInput').addEventListener('keypress', e => { if(e.key === 'Enter') executeSearch(); });
        loadSenders();
		
        const urlParams = new URLSearchParams(window.location.search);
        const jumpDate = urlParams.get('date');
        const searchQ = urlParams.get('search');

        if (jumpDate) {
            // If jumping to a date, don't load the very bottom first, jump directly
            (async () => {
                const res = await fetch(`/api/jump_date?date=${jumpDate}`);
                if (res.ok) {
                    const data = await res.json();
                    jumpToContext(data.id);
                } else {
                    loadInitial();
                }
            })();
        } else if (searchQ) {
            // If we have a search query, set it and execute
            loadInitial(); // Still load the main chat to have context
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = searchQ;
                if (typeof toggleSearch === 'function') toggleSearch();
                if (typeof executeSearch === 'function') executeSearch();
            }
        } else {
            loadInitial();
        }

        // Auto-initialize Whisper if enabled
        if (typeof autoTranscribe !== 'undefined' && autoTranscribe && typeof initializeWhisper === 'function') {
            initializeWhisper();
        }
