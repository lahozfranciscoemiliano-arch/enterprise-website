/* Enterprise SOC: portada.
   La introduccion (de la Tierra de noche al AMBA) corre sola una vez por visita, sin secuestrar el scroll.
   En celulares, tablets verticales y con movimiento reducido la portada es una imagen fija y no se
   descarga el codigo de la escena. Parametros de prueba: ?scene=force (siempre animada), ?p=0..1 (cuadro fijo). */
(function () {
  'use strict';

  const hero = document.querySelector('.hero');
  if (!hero) return;
  const stage = hero.querySelector('.stage');
  const glCanvas = stage.querySelector('.scene');
  const overlay = stage.querySelector('.scene-overlay');
  const ticker = stage.querySelector('.ticker');

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const params = new URLSearchParams(location.search);
  const FORCE = params.get('scene') === 'force';
  const FIXED_P = params.has('p') ? clamp(Number(params.get('p')) || 0, 0, 1) : null;

  // ---------- Gates de portada fija (identicos a site.css) ----------
  const GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  const MQLS = GATES.map((q) => matchMedia(q));
  const gated = () => !FORCE && MQLS.some((m) => m.matches);

  // ---------- Tiempos de la introduccion ----------
  const HOLD = 500;          // la mira sobre Buenos Aires antes de bajar
  const FULL = 6000;         // bajada completa: Tierra, nubes, AMBA, red
  const SHORT = 1700;        // visitas siguientes: solo se arma la red
  const SHORT_FROM = 0.8;
  const LATE = 3500;         // si la escena tarda mas que esto, se muestra la version corta
  let seen = false;
  try { seen = sessionStorage.getItem('es-intro') === '1'; } catch (e) { /* sin almacenamiento */ }
  const tLoad = performance.now();

  let scene = null, failed = false, loading = false, animOn = false;
  let from = 0, dur = FULL, hold = HOLD, elapsed = 0, lastTick = 0, rafId = null, onScreen = true;
  let lastRender = 0, quality = 1, started = false;
  const t0 = performance.now();
  const frames = [];

  function progress() {
    if (FIXED_P !== null) return FIXED_P;
    if (!started) return from;
    const k = clamp((elapsed - hold) / dur, 0, 1);
    return from + (1 - from) * k;
  }

  function fail() {
    failed = true; scene = null; animOn = false;
    hero.classList.remove('scene-ready', 'is-anim');
    hero.classList.add('scene-failed');
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // carga los scripts de la escena (solo cuando hace falta)
  function loadScene(cb) {
    if (window.HeroScene && window.GEO) { cb(); return; }
    if (loading) return;
    loading = true;
    let list = [];
    try { list = JSON.parse(hero.dataset.scene || '[]'); } catch (e) { list = []; }
    let i = 0;
    const next = () => {
      if (i >= list.length) { loading = false; cb(); return; }
      const s = document.createElement('script');
      s.src = list[i++];
      s.onload = next;
      s.onerror = fail;
      document.head.appendChild(s);
    };
    next();
  }

  function createScene() {
    if (scene || failed) return;
    try {
      const inset = ticker ? ticker.offsetHeight : 0;
      scene = window.HeroScene.create(glCanvas, overlay, (full) => {
        if (!full || !animOn) return;
        scene.resize(quality);
        // la version completa solo en la primera visita y si la escena llego a tiempo
        if (FIXED_P === null && !started) {
          const late = performance.now() - tLoad > LATE;
          if (seen || late) { from = SHORT_FROM; dur = SHORT; hold = 0; }
        }
        started = true;
        scene.render(progress(), (performance.now() - t0) / 1000);
        hero.classList.add('scene-ready');
        kick();
      }, fail, { bottomInset: inset });
    } catch (e) { scene = null; }
    if (!scene) { fail(); return; }
    glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail(); }, { once: true });
  }

  // ---------- Bucle: corre solo con la portada visible ----------
  function tick(now) {
    rafId = null;
    if (!animOn || !scene) return;
    const dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    if (started && scene.isFull()) {
      const before = progress();
      elapsed += dt;
      const p = progress();
      const moving = p !== before || p < 1;
      // la vida ambiental (nubes, luces, la red) sigue a ~30 cuadros por segundo una vez quieta
      if (moving || now - lastRender > 32) {
        if (moving && lastRender) trackPerf(now - lastRender);
        scene.render(p, (now - t0) / 1000);
        lastRender = now;
      }
      if (p >= 1 && !seen) { seen = true; try { sessionStorage.setItem('es-intro', '1'); } catch (e) { /* nada */ } }
    }
    if (onScreen && !document.hidden) rafId = requestAnimationFrame(tick);
    else lastTick = 0;
  }
  function kick() {
    if (rafId === null && animOn && onScreen && !document.hidden) { lastTick = 0; rafId = requestAnimationFrame(tick); }
  }
  // si los cuadros tardan mas de ~24 ms, baja la resolucion de la escena
  function trackPerf(ms) {
    if (ms > 200) return;
    frames.push(ms);
    if (frames.length < 30) return;
    frames.sort((a, b) => a - b);
    const med = frames[15];
    frames.length = 0;
    if (med > 24 && quality > 0.6) { quality = Math.max(0.6, quality - 0.2); scene.resize(quality); }
  }

  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    if (onScreen) kick();
  }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  let rt = 0;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (scene && animOn) { scene.resize(quality); scene.render(progress(), (performance.now() - t0) / 1000); } }, 120);
  });

  // ---------- Modo animado o fijo, decidido en vivo ----------
  function enableAnim() {
    if (animOn || failed) return;
    animOn = true;
    hero.classList.remove('is-static');
    hero.classList.add('is-anim');
    const go = () => loadScene(() => { if (!animOn) return; createScene(); if (scene) { scene.ensureFull(); kick(); } });
    // primero se pinta el texto; la escena se pide enseguida (lo pesado corre en un worker, no traba la pagina)
    requestAnimationFrame(() => setTimeout(go, 0));
  }
  function disableAnim() {
    animOn = false;
    hero.classList.remove('is-anim', 'scene-ready');
    hero.classList.add('is-static');
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }
  function applyMode() {
    if (gated()) disableAnim();
    else enableAnim();
    if (scene && animOn && scene.isFull()) hero.classList.add('scene-ready');
  }
  MQLS.forEach((m) => m.addEventListener('change', applyMode));
  applyMode();

  window.__hero = { progress, skip: () => { elapsed = hold + dur; } };
})();
