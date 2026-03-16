        document.getElementById('searchInput').addEventListener('keypress', e => { if(e.key === 'Enter') executeSearch(); });
        loadSenders();
		
        const urlParams = new URLSearchParams(window.location.search);
        const jumpDate = urlParams.get('date');
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
        } else {
            loadInitial();
        }
