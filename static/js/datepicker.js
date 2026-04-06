// datepicker.js — Custom Telegram-style Date Picker
const DatePicker = (() => {
    const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
    const WDAYS  = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

    let popup = null, view = 'cal';
    let dispY, dispM;           // month currently shown
    let selDate = null;         // 'YYYY-MM-DD' currently selected
    let minDate = null, maxDate = null;
    let activeMonths = null;    // array of "YYYY-MM" with messages
    const cache = new Map();
    let onConfirmCb = null, confirmLbl = 'Підтвердити';
    let anchor = null;
    let tipTimer = null, tipEl = null;
    let pendY, pendM;           // month/year picker pending selection
    let showClear = false;

    /* ─── helpers ─── */
    function _reposition(){ _pos(); }
    function pDate(s) {
        if (!s) return null;
        const p = s.split('-'); return { y:+p[0], m:+p[1], d:+(p[2]||1) };
    }
    function fmt(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d||1).padStart(2,'0')}`; }
    function cmpYM(y1,m1,y2,m2){ return y1!==y2 ? y1-y2 : m1-m2; }
    function canPrev(){ if(!minDate) return true; const mn=pDate(minDate); return cmpYM(dispY,dispM,mn.y,mn.m)>0; }
    function canNext(){ if(!maxDate) return true; const mx=pDate(maxDate); return cmpYM(dispY,dispM,mx.y,mx.m)<0; }

    function clampDisp(){
        if(minDate){ const mn=pDate(minDate); if(cmpYM(dispY,dispM,mn.y,mn.m)<0){dispY=mn.y;dispM=mn.m;} }
        if(maxDate){ const mx=pDate(maxDate); if(cmpYM(dispY,dispM,mx.y,mx.m)>0){dispY=mx.y;dispM=mx.m;} }
    }

    function getAutoDate(){
        const chat = document.getElementById('chat');
        if(!chat) return null;
        const cr = chat.getBoundingClientRect();
        for(const row of chat.getElementsByClassName('msg-row')){
            const r = row.getBoundingClientRect();
            if(r.bottom > cr.top && r.top < cr.bottom){
                const ts = row.getAttribute('data-timestamp');
                if(ts) return ts.substring(0,10);
            }
        }
        return null;
    }

    /* ─── API fetch (cached) ─── */
    async function fetchMonth(y,m){
        const key = fmt(y,m);
        if(cache.has(key)) return cache.get(key);
        try {
            const res = await fetch(`/api/calendar_data?year=${y}&month=${m}`);
            const data = await res.json();
            if(data.min_date && !minDate) minDate = data.min_date;
            if(data.max_date && !maxDate) maxDate = data.max_date;
            cache.set(key, data);
            return data;
        } catch(e){ return {days:{}}; }
    }

    async function fetchActiveMonths() {
        if (activeMonths) return;
        try {
            const res = await fetch('/api/calendar_summary');
            const data = await res.json();
            activeMonths = data.active_months || [];
        } catch(e) { activeMonths = []; }
    }

    /* ─── Public open() ─── */
    async function open(opts){
        // 1. Toggle behavior: if already open on same anchor, close and abort
        if (popup && anchor === opts.anchorEl) {
            close();
            return;
        }
        close();
        anchor      = opts.anchorEl;
        onConfirmCb = opts.onConfirm || null;
        confirmLbl  = opts.confirmLabel || 'Підтвердити';
        showClear   = !!opts.showClear;
        view        = 'cal';

        // Bootstrap min/max and active months
        if(!minDate||!maxDate || !activeMonths){
            const now = new Date();
            await Promise.all([
                fetchMonth(now.getFullYear(), now.getMonth()+1),
                fetchActiveMonths()
            ]);
        }

        // Resolve selected date
        selDate = (opts.value !== undefined) ? opts.value : selDate;
        if(!selDate) selDate = getAutoDate();
        if(!selDate){ const t=new Date(); selDate=fmt(t.getFullYear(),t.getMonth()+1,t.getDate()); }

        // Set display month
        const s = pDate(selDate);
        if (s) { dispY = s.y; dispM = s.m; }
        clampDisp();

        // Build popup
        popup = document.createElement('div');
        popup.className = 'dp-popup';
        document.body.appendChild(popup);
        _pos();
        setTimeout(() => document.addEventListener('mousedown', _outside), 0);
        window.addEventListener('resize', _reposition);
        await _renderCal();
    }

    function close(){
        document.removeEventListener('mousedown', _outside);
        window.removeEventListener('resize', _reposition);
        _clearTip();
        if(popup){ 
            popup.remove(); 
            popup=null; 
        }
    }

    function getValue(){ return selDate; }

    /* ─── positioning ─── */
    function _pos(){
        if(!popup||!anchor) return;
        const r = anchor.getBoundingClientRect(), W=280;
        let left = r.left, top = r.bottom + 8;
        
        // 2. Adjust position so it doesn't obscure floating buttons (btn-round)
        if (anchor.classList.contains('btn-round')) {
            // Anchor is a right-side floating button -> place calendar to its left
            left = r.left - W - 15;
            top = r.top; 
            // Keep on screen vertically
            if(top+360 > window.innerHeight-10) top = window.innerHeight - 360 - 10;
        } else {
            // Default dropdown logic (e.g., from Search Sidebar inputs)
            if(left+W > window.innerWidth-10) left = window.innerWidth-W-10;
            if(top+360 > window.innerHeight-10) top = r.top - 360 - 8;
        }

        if(top < 10) top = 10;
        if(left < 10) left = 10;
        Object.assign(popup.style,{position:'fixed',left:left+'px',top:top+'px',width:W+'px',zIndex:'10001'});
    }

    function _outside(e){ if(popup && !popup.contains(e.target) && !anchor?.contains(e.target)) close(); }

    /* ─── Calendar view ─── */
    async function _renderCal(){
        if(!popup) return;
        const data = await fetchMonth(dispY, dispM);
        const days = data.days || {};

        const dInM    = new Date(dispY, dispM, 0).getDate();
        const firstDow= (new Date(dispY, dispM-1, 1).getDay()+6)%7; // Mon=0
        const prevDays= new Date(dispY, dispM-1, 0).getDate();
        const todayStr= new Date().toISOString().split('T')[0];
        const mn = pDate(minDate), mx = pDate(maxDate);
        const prevOk = canPrev(), nextOk = canNext();

        let cells = '';
        // Prev overflow
        for(let i=firstDow-1; i>=0; i--)
            cells += `<div class="dp-cell dp-other">${prevDays-i}</div>`;
        // Current month
        for(let d=1; d<=dInM; d++){
            const ds = fmt(dispY,dispM,d);
            const cnt = parseInt(days[String(d)]||0);
            const minDs = mn ? fmt(mn.y,mn.m,mn.d) : '0000-00-00';
            const maxDs = mx ? fmt(mx.y,mx.m,mx.d) : '9999-99-99';
            const oob   = ds < minDs || ds > maxDs;
            const disabled = cnt===0 || oob;
            let cls = 'dp-cell dp-mday' + (disabled?' dp-dis':' dp-act') +
                      (ds===todayStr&&!disabled?' dp-today':'') +
                      (ds===selDate?' dp-sel':'');
            const attrs = !disabled ? `data-date="${ds}" data-cnt="${cnt}"` : '';
            cells += `<div class="${cls}" ${attrs}>${d}</div>`;
        }
        // Next overflow — fill to 42 cells
        const filled = firstDow + dInM;
        const tail   = (42 - filled);
        for(let i=1; i<=tail; i++) cells += `<div class="dp-cell dp-other">${i}</div>`;

        popup.innerHTML = `
          <div class="dp-header">
            <button class="dp-nav ${!prevOk?'dp-nav-dis':''}" id="dp-prev">&#8679;</button>
            <button class="dp-title" id="dp-title"><span class="dp-title-tri">&#9658;</span> ${MONTHS[dispM-1]} ${dispY}</button>
            <button class="dp-nav ${!nextOk?'dp-nav-dis':''}" id="dp-next">&#8681;</button>
          </div>
          <div class="dp-wdays">${WDAYS.map(w=>`<div class="dp-wday">${w}</div>`).join('')}</div>
          <div class="dp-grid" id="dp-grid">${cells}</div>
          <div class="dp-footer">
            ${showClear ? '<button class="dp-fbtn dp-fcancel" id="dp-clear">Очистити</button>' : ''}
            <button class="dp-fbtn dp-fcancel" id="dp-cancel">Скасувати</button>
            <button class="dp-fbtn dp-fconfirm" id="dp-confirm">${confirmLbl}</button>
          </div>`;

        popup.querySelector('#dp-prev')?.addEventListener('click', async ()=>{
            if(!prevOk) return;
            dispM--; if(dispM<1){dispM=12;dispY--;} await _renderCal();
        });
        popup.querySelector('#dp-next')?.addEventListener('click', async ()=>{
            if(!nextOk) return;
            dispM++; if(dispM>12){dispM=1;dispY++;} await _renderCal();
        });
        popup.querySelector('#dp-title')?.addEventListener('click', _renderMY);
        popup.querySelector('#dp-clear')?.addEventListener('click', ()=>{
            if(onConfirmCb) onConfirmCb(null);
            close();
        });
        popup.querySelector('#dp-cancel')?.addEventListener('click', close);
        popup.querySelector('#dp-confirm')?.addEventListener('click', ()=>{
            if(selDate && onConfirmCb) onConfirmCb(selDate);
            close();
        });

        // Day interactions via delegation
        const grid = popup.querySelector('#dp-grid');
        grid?.addEventListener('click', e=>{
            const c = e.target.closest('.dp-act[data-date]');
            if(!c) return;
            selDate = c.getAttribute('data-date');
            grid.querySelectorAll('.dp-sel').forEach(el=>el.classList.remove('dp-sel'));
            c.classList.add('dp-sel');
        });
        grid?.addEventListener('mouseover', e=>{
            const c = e.target.closest('.dp-act[data-cnt]');
            if(!c){ _clearTip(); return; }
            _clearTip();
            tipTimer = setTimeout(()=>_showTip(c, c.getAttribute('data-cnt')+' повідомлень'), 1000);
        });
        grid?.addEventListener('mouseout', e=>{
            if(!e.relatedTarget?.closest?.('.dp-act[data-cnt]')) _clearTip();
        });
    }

    /* ─── Month/Year picker ─── */
    function _renderMY(){
        if(!popup) return;
        view = 'my';
        pendY = dispY; pendM = dispM;
        const mn = pDate(minDate), mx = pDate(maxDate);
        const minY = mn?.y || 2010, maxY = mx?.y || new Date().getFullYear();

        function mValid(m){ return !(mn&&pendY===mn.y&&m<mn.m) && !(mx&&pendY===mx.y&&m>mx.m); }
        function hasMsg(y, m) { return activeMonths ? activeMonths.includes(fmt(y, m).substring(0, 7)) : true; }
        function hasYearMsg(y) { return activeMonths ? activeMonths.some(am => am.startsWith(y.toString())) : true; }

        function mHTML(){ 
            return MONTHS.map((n,i)=>{ 
                const m=i+1, v=mValid(m), s=m===pendM, empty=!hasMsg(pendY, m);
                return `<div class="dp-prow${s?' dp-psel':''}${!v?' dp-pdis':''}${empty&&v?' dp-pempty':''}" data-month="${m}">${n}</div>`; 
            }).join(''); 
        }
        function yHTML(){ 
            let h=''; 
            for(let y=minY;y<=maxY;y++) {
                const s=y===pendY, empty=!hasYearMsg(y);
                h+=`<div class="dp-prow${s?' dp-psel':''}${empty?' dp-pempty':''}" data-year="${y}">${y}</div>`; 
            }
            return h; 
        }

        popup.innerHTML = `
          <div class="dp-my-wrap">
            <div class="dp-my-cols">
              <div class="dp-my-lens"></div>
              <div class="dp-my-col" id="dp-mcol"><div class="dp-my-scroll" id="dp-mscroll">${mHTML()}</div></div>
              <div class="dp-my-sep"></div>
              <div class="dp-my-col" id="dp-ycol"><div class="dp-my-scroll" id="dp-yscroll">${yHTML()}</div></div>
            </div>
            <div class="dp-footer">
              <button class="dp-fbtn dp-fcancel" id="dp-my-cancel">Скасувати</button>
              <button class="dp-fbtn dp-fconfirm" id="dp-my-ok">Показати</button>
            </div>
          </div>`;

        const mCol = popup.querySelector('#dp-mcol');
        const yCol = popup.querySelector('#dp-ycol');

        // Scroll to center initially
        requestAnimationFrame(()=>{
            popup.querySelector('#dp-mscroll .dp-psel')?.scrollIntoView({block:'center',behavior:'instant'});
            popup.querySelector('#dp-yscroll .dp-psel')?.scrollIntoView({block:'center',behavior:'instant'});
        });

        // Strictly handle mouse wheel events to step item-by-item smoothly
        let wheelScrollTimer = null;
        function handleWheel(e, colSelector, isYear) {
            e.preventDefault();
            const col = popup.querySelector(colSelector);
            const items = Array.from(col.querySelectorAll('.dp-prow:not(.dp-pdis)'));
            const current = col.querySelector('.dp-psel') || items[0];
            let idx = items.indexOf(current);
            if(idx !== -1) {
                // Determine direction based on scroll delta
                const dir = e.deltaY > 0 ? 1 : -1;
                const newIdx = Math.max(0, Math.min(items.length - 1, idx + dir));
                const target = items[newIdx];
                
                // Immediately update selection visually and initiate scroll animation
                col.querySelectorAll('.dp-psel').forEach(el => el.classList.remove('dp-psel'));
                target.classList.add('dp-psel');
                target.scrollIntoView({block: 'center', behavior: 'smooth'});
                
                // Update internal state
                if(isYear) {
                    pendY = +target.getAttribute('data-year');
                    if(mn&&pendY===mn.y&&pendM<mn.m) pendM=mn.m;
                    if(mx&&pendY===mx.y&&pendM>mx.m) pendM=mx.m;
                } else {
                    pendM = +target.getAttribute('data-month');
                }
                
                // Debounce only the heavy DOM re-rendering to keep the UI thread fully dedicated to the scroll animation
                if(isYear) {
                    clearTimeout(wheelScrollTimer);
                    wheelScrollTimer = setTimeout(() => {
                        popup.querySelector('#dp-mscroll').innerHTML = mHTML();
                        requestAnimationFrame(() => popup.querySelector('#dp-mscroll .dp-psel')?.scrollIntoView({block:'center',behavior:'instant'}));
                    }, 150);
                }
            }
        }

        mCol?.addEventListener('wheel', e => handleWheel(e, '#dp-mcol', false), {passive: false});
        yCol?.addEventListener('wheel', e => handleWheel(e, '#dp-ycol', true), {passive: false});

        // Smooth scroll if clicked
        mCol?.addEventListener('click', e => {
            const r = e.target.closest('.dp-prow:not(.dp-pdis)');
            if(r) {
                mCol.querySelectorAll('.dp-psel').forEach(el => el.classList.remove('dp-psel'));
                r.classList.add('dp-psel');
                pendM = +r.getAttribute('data-month');
                r.scrollIntoView({block:'center', behavior:'smooth'});
            }
        });
        yCol?.addEventListener('click', e => {
            const r = e.target.closest('.dp-prow:not(.dp-pdis)');
            if(r) {
                yCol.querySelectorAll('.dp-psel').forEach(el => el.classList.remove('dp-psel'));
                r.classList.add('dp-psel');
                pendY = +r.getAttribute('data-year');
                if(mn&&pendY===mn.y&&pendM<mn.m) pendM=mn.m;
                if(mx&&pendY===mx.y&&pendM>mx.m) pendM=mx.m;
                popup.querySelector('#dp-mscroll').innerHTML = mHTML();
                requestAnimationFrame(() => popup.querySelector('#dp-mscroll .dp-psel')?.scrollIntoView({block:'center',behavior:'instant'}));
                r.scrollIntoView({block:'center', behavior:'smooth'});
            }
        });

        popup.querySelector('#dp-my-cancel')?.addEventListener('click', async()=>{ view='cal'; await _renderCal(); });
        popup.querySelector('#dp-my-ok')?.addEventListener('click', async()=>{
            dispY=pendY; dispM=pendM; 
            // Auto-select first available day
            const dData = await fetchMonth(dispY, dispM);
            const rDays = dData.days || {};
            for(let d=1; d<=31; d++){
                if(rDays[String(d)] > 0){
                    selDate = fmt(dispY, dispM, d);
                    break;
                }
            }
            view='cal'; await _renderCal();
        });
    }

    /* ─── Tooltip ─── */
    function _showTip(el, text){
        if(tipEl) tipEl.remove();
        tipEl = document.createElement('div');
        tipEl.className = 'dp-tip';
        tipEl.textContent = text;
        document.body.appendChild(tipEl);
        const r = el.getBoundingClientRect();
        tipEl.style.cssText = `position:fixed;left:${r.left+r.width/2}px;top:${r.top-4}px;transform:translate(-50%,-100%);`;
    }
    function _clearTip(){ clearTimeout(tipTimer); tipTimer=null; if(tipEl){tipEl.remove();tipEl=null;} }

    return { open, close, getValue, reposition: _reposition };
})();
