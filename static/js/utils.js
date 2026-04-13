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
		function formatMessageText(text, excludeMediaPath = null) {
            if (!text) return '';
            
            // 1. Force Telegram's native HTML links to open in a new tab and use the context menu
            let formatted = text.replace(/<a([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi, function(match, p1, p2, p3, content) {
                // Check if it's a media format indicating a custom emoji/sticker
                const isMediaFile = p2.match(/\.(webp|webm|mp4|tgs|png|gif)$/i);
                
                // Expecting absolute path here (populated from DB natively)
                if (isMediaFile && !p2.startsWith('http')) {
                    let cleanPath = p2.replace(/\//g, '\\');
                    
                    // If this exact file path is already rendered natively by an explicit attachment rule, silently hide it here to prevent visual duplication!
                    if (excludeMediaPath) {
                        let excludeFile = excludeMediaPath.split('\\').pop().split('/').pop();
                        let thisFile = cleanPath.split('\\').pop();
                        if (excludeFile === thisFile) return "";
                    }
                    
                    let url = '/media?path=' + encodeURIComponent(cleanPath);
                    
                    if (p2.endsWith('.webm') || p2.endsWith('.mp4')) {
                        return `<video class="custom-emoji" src="${url}" autoplay loop muted playsinline title="${content}" style="width:24px; height:24px; object-fit:cover; border-radius:4px; display:inline-block; vertical-align:middle; cursor:pointer;" onclick="window.open('${url}', '_blank')"></video>`;
                    } else {
                        return `<img class="custom-emoji" src="${url}" title="${content}" style="width:24px; height:24px; object-fit:cover; display:inline-block; vertical-align:middle; cursor:pointer;" onclick="window.open('${url}', '_blank')">`;
                    }
                }

                if (match.includes('chat-link')) return match; // Skip if already formatted
                return `<a${p1}href="${p2}" target="_blank" class="chat-link"${p3}>${content}</a>`;
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

