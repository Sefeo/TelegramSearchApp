        function getColor(name) {
            if (!colorCache[name]) colorCache[name] = colors[Object.keys(colorCache).length % colors.length];
            return colorCache[name];
        }

        function formatTime(seconds) {
            if (isNaN(seconds)) return "0:00";
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

		window.ShowSpoiler = function(el) { el.classList.add('revealed'); };
		function formatMessageText(text) {
            if (!text) return '';
            
            // 1. Force Telegram's native HTML links to open in a new tab and use the context menu
            let formatted = text.replace(/<a([^>]*)href="([^"]+)"([^>]*)>/gi, function(match, p1, p2, p3) {
                if (match.includes('chat-link')) return match; // Skip if already formatted
                return `<a${p1}href="${p2}" target="_blank" class="chat-link"${p3}>`;
            });
            
            // 2. Safely auto-link raw URLs that are not part of an HTML tag
            try {
                const urlRegex = /(?<!href="|href='|>)(https?:\/\/[^\s<]+)/g;
                formatted = formatted.replace(urlRegex, '<a href="$1" target="_blank" class="chat-link">$1</a>');
            } catch(e) {}
            
            return formatted;
        }

		function formatDateText(dateString) {
            // dateString is "YYYY-MM-DD"
            if (!dateString) return '';
            const date = new Date(dateString);
            const now = new Date();
            
            const options = { day: 'numeric', month: 'long' };
            
            // If the message year is different from the current year, add the year to the label
            if (date.getFullYear() !== now.getFullYear()) {
                options.year = 'numeric';
            }
            
            // Using 'uk-UA' or 'en-GB' for "Day Month Year" format instead of "Month Day"
            return date.toLocaleDateString('uk-UA', options); 
        }

		function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

