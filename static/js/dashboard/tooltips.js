// Pulse Dashboard Tooltips Module
// Handles global tooltips and content formatting

let pulseGlobalTooltip = null;

export function formatTooltip(sendersObj, itemName) {
    if (!sendersObj) return "";
    let html = itemName ? `<b>${itemName}</b><br><hr style="border-color: #333; margin: 4px 0;">` : '';
    const total = Object.values(sendersObj).reduce((sum, val) => sum + val, 0);
    const details = Object.entries(sendersObj)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => {
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
            return `<span>${name}: ${count} (${pct}%)</span>`;
        })
        .join('<br>');
    return html + details;
}

export function initGlobalTooltips() {
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('.pulse-tooltip');
        if (target) {
            if (!pulseGlobalTooltip) {
                pulseGlobalTooltip = document.createElement('div');
                pulseGlobalTooltip.className = 'pulse-global-tooltip';
                pulseGlobalTooltip.style.position = 'fixed';
                pulseGlobalTooltip.style.backgroundColor = '#000';
                pulseGlobalTooltip.style.color = '#fff';
                pulseGlobalTooltip.style.padding = '8px 12px';
                pulseGlobalTooltip.style.borderRadius = '6px';
                pulseGlobalTooltip.style.fontSize = '12px';
                pulseGlobalTooltip.style.zIndex = '999999';
                pulseGlobalTooltip.style.pointerEvents = 'none';
                pulseGlobalTooltip.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
                pulseGlobalTooltip.style.width = 'max-content';
                pulseGlobalTooltip.style.maxWidth = '300px';
                pulseGlobalTooltip.style.wordWrap = 'break-word';
                document.body.appendChild(pulseGlobalTooltip);
            }
            
            const localTooltip = target.querySelector('.pulse-tooltip-text');
            if (localTooltip) {
                pulseGlobalTooltip.innerHTML = localTooltip.innerHTML;
                pulseGlobalTooltip.style.display = 'block';
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (pulseGlobalTooltip && pulseGlobalTooltip.style.display === 'block') {
            let x = e.clientX + 15;
            let y = e.clientY + 15;
            
            // Prevent tooltip from going off-screen
            const rect = pulseGlobalTooltip.getBoundingClientRect();
            if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 10;
            if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 10;
            
            pulseGlobalTooltip.style.left = x + 'px';
            pulseGlobalTooltip.style.top = y + 'px';
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('.pulse-tooltip');
        if (target && pulseGlobalTooltip) {
            pulseGlobalTooltip.style.display = 'none';
        }
    });
}
