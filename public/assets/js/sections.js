/* Enterprise SOC: comportamiento comun de todas las paginas.
   Menu, reloj, entradas, titulos, linea de guardia, capturas, contadores, cinta, visor del panel,
   recorrido (con la camara de fx.js), alerta que se resuelve, pasar la guardia y formulario. Todo respeta el movimiento reducido.
   Regla: lo que se lee o se toca no se mueve; el movimiento vive en las entradas y en lo decorativo. */
// html.sx = este script corre. El CSS solo deja las entradas ocultas mientras falte .sx durante 3 s
// (si el script no llega, el contenido aparece solo). Va primero, antes que cualquier otra cosa.
// Si llego despues de esa red de seguridad (--fs ya en 1), html.sx-late deja el recorrido como ya se veia
// (todas las capturas, ver site.css) para no moverlo bajo el lector. Antes de los 2,9 s no puede pasar.
if (performance.now() > 2900 && getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() === '1') document.documentElement.classList.add('sx-late');
document.documentElement.classList.add('sx');
(function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const nav = document.querySelector('.nav');

  // Si el script llego tarde (red lenta), la red de seguridad del CSS ya mostro las entradas:
  // se dejan visibles en el mismo cuadro, sin volver a ocultarlas.
  if (performance.now() > 2600) {
    document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('in', 'done'));
    document.querySelectorAll('.alert-card[data-play]').forEach((el) => el.classList.add('s2'));
  }

  // ---------- Menu (celular y tablet, hasta 980 px) ----------
  // Cerrado: fuera del tabulador y del lector (visibility en CSS + inert).
  // Abierto: el foco entra al primer link y queda dentro de la barra, la pagina no se mueve,
  // un velo cubre el resto y tocarlo cierra. Escape cierra y devuelve el foco al boton.
  const menuBtn = nav.querySelector('.menu-btn');
  const menu = nav.querySelector('.nav-links');
  const mobileMenu = matchMedia('(max-width: 980px)');
  const outside = [document.querySelector('.skip'), document.querySelector('main'), document.querySelector('footer')].filter(Boolean);
  const isOpen = () => nav.classList.contains('open');
  const syncMenuInert = () => { if (menu) menu.inert = mobileMenu.matches && !isOpen(); };
  function setMenu(open, restoreFocus) {
    const was = isOpen();
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open);
    menuBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    document.documentElement.classList.toggle('menu-open', open);
    outside.forEach((el) => { el.inert = open; });
    syncMenuInert();
    if (open && !was) {
      const first = menu && menu.querySelector('a[href]');
      if (first) first.focus({ preventScroll: true });
    } else if (!open && was && restoreFocus) {
      menuBtn.focus({ preventScroll: true });
    }
  }
  // orden del tabulador con el menu abierto: la barra (marca, boton) y despues los links del menu
  function menuFocusables() {
    const bar = [...nav.querySelectorAll('a[href], button')].filter((el) => !menu.contains(el));
    return [...bar, ...menu.querySelectorAll('a[href]')].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  menuBtn.addEventListener('click', () => setMenu(!isOpen()));
  nav.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  // el velo es el ::after de la barra: un toque ahi llega con target = nav
  nav.addEventListener('click', (e) => { if (e.target === nav && isOpen()) setMenu(false, true); });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { setMenu(false, true); return; }
    if (e.key !== 'Tab') return;
    const list = menuFocusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const n = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
    e.preventDefault();
    list[n].focus();
  });
  // al pasar a escritorio (girar la tablet, agrandar la ventana) el menu se cierra solo
  mobileMenu.addEventListener('change', () => { if (!mobileMenu.matches && isOpen()) setMenu(false); syncMenuInert(); });
  syncMenuInert();

  // ---------- Reloj de guardia ----------
  const clock = document.querySelector('[data-clock]');
  let lastClock = '';
  function updateClock() {
    const d = new Date();
    const s = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (s !== lastClock) { lastClock = s; clock.textContent = s; }
  }
  if (clock) { updateClock(); setInterval(updateClock, 15000); }

  // ---------- Titulos palabra por palabra ----------
  document.querySelectorAll('[data-split-reveal]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', words.join(' '));
    el.textContent = '';
    words.forEach((w, i) => {
      const wr = document.createElement('span'); wr.className = 'wr'; wr.setAttribute('aria-hidden', 'true');
      const wi = document.createElement('span'); wi.className = 'wi'; wi.style.setProperty('--i', i); wi.textContent = w;
      wr.appendChild(wi); el.appendChild(wr);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  });

  // ---------- Entradas y vida por seccion ----------
  const reveals = [...document.querySelectorAll('[data-reveal]')];
  const revealIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      revealIO.unobserve(e.target);
      setTimeout(() => e.target.classList.add('done'), 1500);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  reveals.forEach((el) => revealIO.observe(el));

  const liveIO = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('live', e.isIntersecting);
  }, { rootMargin: '10% 0px' });
  document.querySelectorAll('.sec, .ticker, .stats, .hero').forEach((s) => liveIO.observe(s));
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));

  // ---------- Cinta de eventos: se duplica para un bucle sin cortes ----------
  document.querySelectorAll('.ticker-track').forEach((t) => {
    [...t.children].forEach((c) => { const k = c.cloneNode(true); k.setAttribute('aria-hidden', 'true'); t.appendChild(k); });
  });

  // ---------- Barra: transparente sobre la zona oscura de arriba, blanca despues ----------
  const top = document.querySelector('.hero, .page-hero, .demo-wrap, .nf');
  // la 404 es oscura de punta a punta: la barra no pasa nunca a blanca
  const allDark = document.body.classList.contains('notfound');
  let navSolid = null;
  function updateNav() {
    const limit = top ? top.offsetTop + top.offsetHeight - nav.offsetHeight : 30;
    const solid = !allDark && window.scrollY > Math.max(30, limit);
    if (solid !== navSolid) { navSolid = solid; nav.classList.toggle('solid', solid); }
    nav.classList.toggle('scrolled', window.scrollY > 24);
  }

  // ---------- Linea de guardia ----------
  const after = document.querySelector('.after-hero');
  const guard = after && after.querySelector('.guard');
  const gBase = guard && guard.querySelector('.base');
  const gLine = guard && guard.querySelector('.live-line');
  const gHead = guard && guard.querySelector('.head');
  const gGlow = guard && guard.querySelector('.head-glow');
  let gLen = 0, gTop = 0, gH = 0, gLast = -1, gPinned = false;
  function buildGuard() {
    if (!guard) return;
    const wrap = after.querySelector('.wrap');
    const secs = [...after.querySelectorAll('.sec')];
    if (!wrap || !secs.length) return;
    const aTop = after.getBoundingClientRect().top + window.scrollY;
    const x = Math.max(18, wrap.getBoundingClientRect().left - after.getBoundingClientRect().left - 46);
    const y0 = secs[0].offsetTop + 40;
    const yEnd = secs[secs.length - 1].offsetTop + 200;
    let d = `M${x} ${y0}`;
    for (const s of secs) {
      const k = s.querySelector('.kicker');
      if (!k) continue;
      // una seccion que el navegador todavia no armo (content-visibility) no se fuerza: se estima
      const skipped = s.checkVisibility && !s.checkVisibility({ contentVisibilityAuto: true });
      const y = skipped ? s.offsetTop + parseFloat(getComputedStyle(s).paddingTop) + 8 : k.getBoundingClientRect().top + window.scrollY - aTop + 8;
      if (y < y0 + 20) continue;
      d += ` V${y - 12} L${x} ${y - 5} L${x - 7} ${y} L${x + 11} ${y + 7} L${x - 4} ${y + 13} L${x} ${y + 17}`;
    }
    d += ` V${yEnd}`;
    guard.style.height = after.offsetHeight + 'px';
    guard.style.width = (x + 30) + 'px';
    gBase.setAttribute('d', d); gLine.setAttribute('d', d);
    gLen = gLine.getTotalLength();
    gLine.style.strokeDasharray = gLen;
    gTop = aTop + y0; gH = yEnd - y0; gLast = -1;
    updateGuard();
  }
  function updateGuard() {
    if (!guard || !gLen) return;
    const p = gPinned ? 1 : clamp((window.scrollY + window.innerHeight * 0.62 - gTop) / gH, 0, 1);
    if (Math.abs(p - gLast) < 0.0015 && p !== 0 && p !== 1) return;
    gLast = p;
    gLine.style.strokeDashoffset = (gLen * (1 - p)).toFixed(1);
    const pt = gLine.getPointAtLength(gLen * p);
    gHead.setAttribute('cx', pt.x.toFixed(1)); gHead.setAttribute('cy', pt.y.toFixed(1));
    gGlow.setAttribute('cx', pt.x.toFixed(1)); gGlow.setAttribute('cy', pt.y.toFixed(1));
    gHead.style.opacity = p > 0.001 ? '1' : '0'; gGlow.style.opacity = p > 0.001 ? '' : '0';
  }

  // ---------- Capturas que se asientan al acercarse al centro ----------
  const tilts = [...document.querySelectorAll('.tilt')].map((el) => ({ el, t: -1 }));
  function updateTilts() {
    if (reduce.matches) return;
    const vh = window.innerHeight;
    for (const o of tilts) {
      const r = o.el.getBoundingClientRect();
      const t = clamp((r.top - vh * 0.3) / (vh * 0.6), 0, 1);
      if (Math.abs(t - o.t) > 0.004) { o.t = t; o.el.style.setProperty('--t', t.toFixed(3)); }
    }
  }

  // ---------- Contadores ----------
  const counters = [...document.querySelectorAll('[data-count]')];
  const countIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      countIO.unobserve(e.target);
      const el = e.target, to = Number(el.dataset.count);
      const from = el.dataset.from !== undefined ? Number(el.dataset.from) : 0;
      if (reduce.matches || from === to) { el.textContent = to; continue; }
      const t0 = performance.now(), dur = 1400;
      const step = (now) => {
        const k = clamp((now - t0) / dur, 0, 1), e2 = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * e2);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  counters.forEach((el) => countIO.observe(el));

  // ---------- Luz que sigue al mouse en las tarjetas ----------
  if (fine.matches) {
    document.querySelectorAll('.spot').forEach((c) => c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }));
  }

  // ---------- Camara de fx sobre las capturas ----------
  // La captura que se activa (pestaña del visor o capitulo del recorrido) se recorre con FX.camera; la que se
  // va se detiene despues del fundido. Solo si la pagina la pide: data-cam en la captura o data-fx="camera"
  // en ella o en su contenedor. Sin fx.js o con movimiento reducido no pasa nada (fx.js lo resuelve).
  const camOn = (shot) => !!(shot && window.FX && (shot.hasAttribute('data-cam') || shot.closest('[data-fx~="camera"]')));
  const camPlay = (shot) => { if (camOn(shot)) window.FX.camera(shot); };
  const camStop = (shot) => { if (camOn(shot)) window.FX.camera(shot, { stop: true }); };

  // ---------- Visor del panel (pestañas con su leyenda) ----------
  document.querySelectorAll('[data-viewer]').forEach((viewer) => {
    const tabs = [...viewer.querySelectorAll('.tab')];
    const caption = viewer.querySelector('.shot-caption');
    function showShot(panel, on) {
      if (on) { panel.hidden = false; requestAnimationFrame(() => panel.classList.add('on')); }
      else { panel.classList.remove('on'); setTimeout(() => { if (!panel.classList.contains('on')) { panel.hidden = true; camStop(panel); } }, 650); }
    }
    function select(tab, focus) {
      const changed = tab.getAttribute('aria-selected') !== 'true';
      // desde el primer cambio la camara la mueve la pestaña, cada vez: data-cam-auto (fx.js, al verse) la repetiria
      if (changed) viewer.querySelectorAll('[data-cam-auto]').forEach((s) => s.removeAttribute('data-cam-auto'));
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        showShot(document.getElementById(t.getAttribute('aria-controls')), on);
      });
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      if (caption && panel.dataset.caption) caption.innerHTML = panel.dataset.caption;
      if (changed) camPlay(panel);
      if (focus) tab.focus();
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        let n = -1;
        if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') n = (i + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = tabs.length - 1;
        if (n < 0) return;
        e.preventDefault();
        select(tabs[n], true);
      });
    });
  });

  // ---------- Recorrido de producto ----------
  const chapters = [...document.querySelectorAll('.chapter')];
  if (chapters.length) {
    const shots = [...document.querySelectorAll('.scrolly .shot')];
    const dots = [...document.querySelectorAll('.scrolly-dots i')];
    // Capturas diferidas: las inactivas pueden venir con data-src/data-srcset para no competir con la carga
    // de la pagina. Se completan cuando su capitulo se activa (y la siguiente), o despues de load, al
    // acercarse el recorrido. Sin JS no hacen falta: solo se ve la captura activa (la primera, con src).
    const lazy = 'img[data-src], img[data-srcset]';
    const promote = (shot) => {
      const img = shot && shot.querySelector(lazy);
      if (!img) return;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      if (img.dataset.src) img.src = img.dataset.src;
      img.removeAttribute('data-srcset'); img.removeAttribute('data-src');
    };
    if (shots.some((s) => s.querySelector(lazy))) {
      const near = () => {
        const io = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect(); shots.forEach(promote);
        }, { rootMargin: '75% 0px' });
        io.observe(shots[0].closest('.scrolly') || shots[0]);
      };
      if (document.readyState === 'complete') near(); else addEventListener('load', near, { once: true });
    }
    let cur = 0, camAt = -1;
    const setStep = (n) => {
      promote(shots[n]); promote(shots[n + 1]);
      if (n !== cur) {
        const prev = shots[cur];
        cur = n;
        chapters.forEach((c, i) => c.classList.toggle('on', i === n));
        shots.forEach((s, i) => s.classList.toggle('on', i === n));
        dots.forEach((d, i) => d.classList.toggle('on', i === n));
        setTimeout(() => { if (prev && !prev.classList.contains('on')) camStop(prev); }, 700);
      }
      // la camara corre cada vez que un capitulo pasa a ser el activo (tambien el primero, al llegar)
      if (n !== camAt) { camAt = n; camPlay(shots[n]); }
    };
    chapters[0].classList.add('on');
    const chIO = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setStep(Number(e.target.dataset.step));
    }, { rootMargin: '-45% 0px -45% 0px' });
    chapters.forEach((c) => chIO.observe(c));
  }

  // ---------- La alerta que se resuelve (una vez, al entrar) ----------
  const alertCard = document.querySelector('.alert-card[data-play]');
  const trail = alertCard ? [...alertCard.querySelectorAll('.ac-trail li')] : [];
  const alertTimers = [];
  function alertFinal() {
    alertTimers.forEach(clearTimeout); alertTimers.length = 0;
    alertCard.classList.add('s2', 's3', 's4');
    trail.forEach((li) => li.classList.add('on'));
  }
  function playAlert() {
    if (reduce.matches) { alertFinal(); return; }
    const at = (ms, fn) => alertTimers.push(setTimeout(fn, ms));
    trail[0] && trail[0].classList.add('on');
    at(500, () => alertCard.classList.add('s2'));
    at(2300, () => { alertCard.classList.add('s3'); trail[1] && trail[1].classList.add('on'); });
    at(3900, () => { alertCard.classList.add('s4'); trail.slice(2).forEach((li) => li.classList.add('on')); });
  }
  if (alertCard) {
    const aIO = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      aIO.disconnect();
      playAlert();
    }, { threshold: 0.5 });
    aIO.observe(alertCard);
  }

  // ---------- Pasar la guardia (mapa real del AMBA) ----------
  const handover = document.querySelector('.handover');
  const holdBtn = handover && handover.querySelector('.hold');
  const msg = handover && handover.querySelector('.handover-msg');
  const NS = 'http://www.w3.org/2000/svg';
  const siteEls = [], linkEls = [];
  function buildHandover() {
    const gLinks = handover.querySelector('.links');
    const sites = [...handover.querySelectorAll('.sites .site')];
    const hub = sites[0], hx = +hub.dataset.x, hy = +hub.dataset.y;
    sites.forEach((g, i) => {
      const x = +g.dataset.x, y = +g.dataset.y;
      if (i > 0) {
        const mx = (hx + x) / 2 + (y - hy) * 0.14, my = (hy + y) / 2 - (x - hx) * 0.14;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('class', 'link');
        p.setAttribute('d', `M${hx} ${hy}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x} ${y}`);
        gLinks.appendChild(p);
        const len = p.getTotalLength();
        p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
        linkEls.push({ p, len });
      }
      const r = i === 0 ? 7 : 4.4;
      const left = x < hx;
      g.innerHTML = `<circle class="halo" cx="${x}" cy="${y}" r="${r * 3.4}"/><circle class="core" cx="${x}" cy="${y}" r="${r * 0.6}"/><circle class="ok" cx="${x}" cy="${y}" r="${r * 2.4}"/><text x="${x + (left ? -1 : 1) * (r * 2.4 + 6)}" y="${y + 4}" text-anchor="${left ? 'end' : 'start'}">${g.dataset.name}</text>`;
      siteEls.push(g);
    });
  }
  const afterPaint = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
  // el mapa se arma cuando la seccion se acerca
  if (handover) {
    const hIO = new IntersectionObserver((entries) => { if (!entries[0].isIntersecting) return; hIO.disconnect(); buildHandover(); }, { rootMargin: '900px 0px' });
    hIO.observe(handover);
  }
  let hp = 0, holding = false, holdRaf = null, holdLast = 0, holdDone = false, holdLit = -1, pinnedHold = false;
  const HOLD_MS = 2200, RELEASE_MS = 900;
  function paintHold() {
    holdBtn.style.setProperty('--hp', hp.toFixed(3));
    const n = siteEls.length - 1;
    linkEls.forEach((l, i) => { const t = clamp(hp * n - i * 0.92, 0, 1); l.p.style.strokeDashoffset = (l.len * (1 - t)).toFixed(1); });
    const lit = hp <= 0 ? -1 : Math.floor(hp * n + 0.08);
    if (lit !== holdLit) { holdLit = lit; siteEls.forEach((g, i) => g.classList.toggle('on', i === 0 ? hp > 0 : i <= lit)); }
  }
  function holdTick(now) {
    holdRaf = null;
    const dt = Math.min(64, now - (holdLast || now));
    holdLast = now;
    if (holdDone) return;
    hp = clamp(hp + (holding ? dt / HOLD_MS : -dt / RELEASE_MS), 0, 1);
    paintHold();
    if (hp >= 1) { completeHold(); return; }
    if (holding || hp > 0) holdRaf = requestAnimationFrame(holdTick); else holdLast = 0;
  }
  function completeHold() {
    holdDone = true; hp = 1; paintHold();
    siteEls.forEach((g) => g.classList.add('on'));
    handover.classList.add('done');
    msg.textContent = 'Listo. Doce sedes vigiladas. Ya puedes irte a dormir.';
  }
  function resetHold() { holdDone = false; hp = 0; holdLit = -1; holding = false; handover.classList.remove('done'); msg.textContent = ''; paintHold(); }
  function startHold() { if (holdDone) return; holding = true; if (!holdRaf) { holdLast = 0; holdRaf = requestAnimationFrame(holdTick); } }
  function endHold() { holding = false; if (!holdRaf && !holdDone && hp > 0) { holdLast = 0; holdRaf = requestAnimationFrame(holdTick); } }
  if (holdBtn) {
    holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); holdBtn.setPointerCapture(e.pointerId); startHold(); });
    holdBtn.addEventListener('pointerup', endHold);
    holdBtn.addEventListener('pointercancel', endHold);
    holdBtn.addEventListener('lostpointercapture', endHold);
    holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    holdBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(); } });
    holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endHold(); } });
  }

  // ---------- Movimiento reducido, en vivo y en ambos sentidos ----------
  function pinToFinalStates() {
    gPinned = true; updateGuard();
    reveals.forEach((el) => el.classList.add('in', 'done'));
    tilts.forEach((o) => { o.el.style.setProperty('--t', '0'); o.t = 0; });
    counters.forEach((el) => { el.textContent = el.dataset.count; });
    if (holdBtn && !holdDone) { pinnedHold = true; completeHold(); }
    if (alertCard) alertFinal();
  }
  function unpinFinalStates() {
    gPinned = false; gLast = -1; updateGuard();
    tilts.forEach((o) => { o.t = -1; }); updateTilts();
    if (pinnedHold) { pinnedHold = false; resetHold(); }
  }
  reduce.addEventListener('change', (e) => { if (e.matches) pinToFinalStates(); else unpinFinalStates(); });
  if (reduce.matches) pinToFinalStates();

  // ---------- Formulario ----------
  const form = document.querySelector('.form');
  if (form) {
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type="submit"]');
    const variant = form.querySelector('input[name="variante"]');
    if (variant) { let v = ''; try { v = localStorage.getItem('es-h') || ''; } catch (e) { /* nada */ } variant.value = /^[abc]$/.test(v) ? v.toUpperCase() : 'sin portada'; }
    const fields = [...form.querySelectorAll('[required]')];
    const markField = (f, bad) => {
      const box = f.closest('.field');
      const msgEl = box.querySelector('.err');
      box.classList.toggle('bad', bad);
      if (bad) { f.setAttribute('aria-invalid', 'true'); if (msgEl) f.setAttribute('aria-describedby', msgEl.id); }
      else { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); }
    };
    fields.forEach((f) => f.addEventListener(f.tagName === 'SELECT' ? 'change' : 'input', () => { if (f.checkValidity()) markField(f, false); }));
    const showError = (html) => { err.innerHTML = html; err.classList.add('show'); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.remove('show');
      const bad = fields.filter((f) => !f.checkValidity());
      fields.forEach((f) => markField(f, bad.includes(f)));
      if (bad.length) {
        showError(bad.length === 1 ? 'Revisa el campo marcado.' : 'Revisa los campos marcados.');
        // el campo entero (con su etiqueta) queda a la vista debajo de la barra fija (scroll-padding-top)
        const box = bad[0].closest('.field') || bad[0];
        box.scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
        bad[0].focus({ preventScroll: true });
        return;
      }
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Enviando…';
      try {
        const res = await fetch(form.getAttribute('action'), { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!data || !data.ok) throw new Error('send');
        const name = (form.elements.nombre.value || '').trim().split(' ')[0];
        form.querySelector('[data-done-title]').textContent = name ? `Listo, ${name}.` : 'Listo.';
        form.classList.add('sent');
        const done = form.querySelector('.form-done');
        done.setAttribute('tabindex', '-1');
        // el formulario se achica: se lleva a la vista entero (con el tilde) y despues recibe el foco
        form.scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
        done.focus({ preventScroll: true });
      } catch (_) {
        showError('No pudimos enviar el formulario. Escríbenos a <a href="mailto:contacto@enterprisesoc.lat?subject=Quiero%20una%20demo%20de%20Enterprise%20SOC">contacto@enterprisesoc.lat</a> y coordinamos la demo.');
      } finally { btn.disabled = false; btn.textContent = label; }
    });
  }

  // ---------- Diagramas con SMIL (paquetes que viajan por los cables) ----------
  // El CSS no alcanza a SMIL: se pausan con movimiento reducido, fuera de pantalla y con la pestaña oculta.
  const smil = [...document.querySelectorAll('svg')].filter((s) => !s.ownerSVGElement && typeof s.pauseAnimations === 'function' && s.querySelector('animate, animateMotion, animateTransform, set'));
  if (smil.length) {
    const smilSeen = new WeakMap();
    const syncSmil = (s) => {
      const run = smilSeen.get(s) && !document.hidden && !reduce.matches;
      if (run) { if (s.animationsPaused()) s.unpauseAnimations(); } else if (!s.animationsPaused()) s.pauseAnimations();
    };
    smil.forEach((s) => s.pauseAnimations());
    const smilIO = new IntersectionObserver((entries) => {
      for (const e of entries) { smilSeen.set(e.target, e.isIntersecting); syncSmil(e.target); }
    }, { rootMargin: '10% 0px' });
    smil.forEach((s) => smilIO.observe(s));
    document.addEventListener('visibilitychange', () => smil.forEach(syncSmil));
    reduce.addEventListener('change', () => smil.forEach(syncSmil));
  }

  // ---------- Scroll y tamaño ----------
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateNav(); updateGuard(); updateTilts(); });
  }, { passive: true });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { buildGuard(); updateNav(); updateTilts(); }, 150); });
  if ('ResizeObserver' in window) {
    let lastH = 0, ro = 0;
    new ResizeObserver(() => {
      const h = document.body.scrollHeight;
      if (Math.abs(h - lastH) < 2) return;
      lastH = h; clearTimeout(ro);
      ro = setTimeout(() => { buildGuard(); updateNav(); }, 60);
    }).observe(document.body);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildGuard);
  // cuando una seccion se arma, la linea toma su posicion exacta
  let cvT = 0;
  document.addEventListener('contentvisibilityautostatechange', () => { clearTimeout(cvT); cvT = setTimeout(buildGuard, 120); }, true);
  addEventListener('load', buildGuard);
  afterPaint(() => { buildGuard(); updateNav(); updateTilts(); });
})();
