import * as State from './state.js';

export async function togglePulseDashboard() {
    const dash = document.getElementById('pulse-dashboard');
    if (dash.classList.contains('pulse-hidden')) {
        dash.classList.remove('pulse-hidden');
        
        // Dynamically import index to avoid circular dependency at top level
        const { initPulse, initPulseSliders } = await import('./index.js');
        
        if (!State.pulseRawMessages) {
            initPulse();
        }
        initPulseSliders();
        injectExpandButtons();
    } else {
        dash.classList.add('pulse-hidden');
    }
}

export function injectExpandButtons() {
    document.querySelectorAll('.pulse-card').forEach(card => {
        if (card.querySelector('.pulse-expand-btn')) return; // already injected
        const btn = document.createElement('button');
        btn.className = 'pulse-expand-btn';
        btn.title = 'Expand card';
        btn.innerHTML = '⛶';
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleCardExpand(card, btn);
        };
        card.appendChild(btn);
    });
}

export function toggleCardExpand(card, btn) {
    const expanding = !card.classList.contains('pulse-expanded');
    card.classList.toggle('pulse-expanded');
    btn.innerHTML = expanding ? '⛌' : '⛶';
    btn.title = expanding ? 'Collapse card' : 'Expand card';

    // If expanding, scroll the card into view
    if (expanding) {
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }

    // Resize Chart.js canvases inside the card after transition
    setTimeout(() => {
        card.querySelectorAll('canvas').forEach(c => {
            const chartInstance = Chart.getChart(c);
            if (chartInstance) chartInstance.resize();
        });
    }, 400);
}

export function showPulseLoader(targetCardIds = null) {
    let cards = [];
    if (targetCardIds && Array.isArray(targetCardIds) && targetCardIds.length > 0) {
        // Clear EVERY loading state first to isolate it
        document.querySelectorAll('.pulse-card.is-loading').forEach(c => c.classList.remove('is-loading'));
        
        targetCardIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) cards.push(el);
        });
    } else {
        cards = document.querySelectorAll('.pulse-card');
    }
    
    cards.forEach(card => {
        let loader = card.querySelector('.pulse-card-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.className = 'pulse-card-loader';
            loader.innerHTML = `
                <div class="pulse-spinner" style="border-top-color: #c084fc; width: 24px; height: 24px; border-width: 2px;"></div>
                <div style="margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500;">Calculating...</div>
            `;
            card.appendChild(loader);
        }
        card.classList.add('is-loading');
    });
}

export function hidePulseLoader() {
    document.querySelectorAll('.pulse-card.is-loading').forEach(card => {
        card.classList.remove('is-loading');
    });
}
