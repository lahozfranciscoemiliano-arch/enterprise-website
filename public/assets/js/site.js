/* Enterprise SOC: portada.
   La introduccion (de la Tierra de noche al AMBA) corre sola una vez por visita, sin secuestrar el scroll.
   Escritorio y tablets acostadas: la escena en vivo (WebGL).
   Celulares, tablets verticales y celulares acostados: no se descarga la escena. Se ve un poster con el
   primer cuadro y, despues de la carga, un video corto (5 s) de la misma bajada que termina en el cuadro
   final. El video se dibuja en un <canvas>: asi el titulo sigue siendo el elemento LCP.
   Sin video (movimiento reducido, ahorro de datos, 2g, error): el cuadro final fijo.
   Parametros de prueba: ?scene=force (siempre animada), ?p=0..1 (cuadro fijo). */
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
  // Diagramacion de la portada fija: P vertical, L celular acostado (identicas a hero.css y a los
  // preload del <head> de index.html). Entre las dos cubren los cuatro primeros GATES.
  const MQ_P = '(orientation: portrait) and (max-width: 1024px), (orientation: portrait) and (pointer: coarse), (orientation: landscape) and (max-width: 720px) and (min-height: 560.02px)';
  const MQ_L = '(orientation: landscape) and (max-height: 560px) and (max-width: 720px), (orientation: landscape) and (pointer: coarse) and (max-height: 560px)';
  const mqP = matchMedia(MQ_P), mqL = matchMedia(MQ_L), mqMotion = matchMedia('(prefers-reduced-motion: no-preference)');

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
        if (lastRender) trackPerf(now - lastRender, moving);
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
  // Si los cuadros tardan, baja la resolucion de la escena (hasta 0.4). Los cuadros muy lentos tambien
  // cuentan (topeados en 200 ms). Durante la bajada se dibuja cada cuadro: lento = mediana > 24 ms y el
  // cuarto mas lento > 36 ms (asi una pantalla limitada a 30 cuadros no baja la calidad). Quieta, la vida
  // ambiental se dibuja cada ~33 ms: lento = mediana > 45 ms.
  let perfMoving = true;
  function trackPerf(ms, moving) {
    if (moving !== perfMoving) { perfMoving = moving; frames.length = 0; }
    frames.push(Math.min(ms, 200));
    if (frames.length < 30) return;
    frames.sort((a, b) => a - b);
    const med = frames[15], p75 = frames[22];
    frames.length = 0;
    const slow = moving ? med > 24 && p75 > 36 : med > 45;
    if (slow && quality > 0.4) { quality = Math.max(0.4, Math.round((quality - 0.2) * 10) / 10); scene.resize(quality); }
  }

  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    if (onScreen) kick();
    videoVisibility();
  }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); videoVisibility(); });

  let rt = 0;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (scene && animOn) { scene.resize(quality); scene.render(progress(), (performance.now() - t0) / 1000); } }, 120);
  });

  // ---------- Video de la introduccion (portada fija) ----------
  // Mismo render de la escena: P 720x512 (liviano 540x384 en pantallas de menos de 900 px fisicos o
  // red 3g), L 1280x720. 30 cuadros por segundo, 5 s, sin audio. AV1 primero; si no, H.264.
  const VIDEOS = {
    p: { w: 720, h: 512, src: [['/assets/video/hero-p.av1.mp4?v=16', 'av01.0.04M.10'], ['/assets/video/hero-p.h264.mp4?v=16', 'avc1.640028']] },
    pl: { w: 540, h: 384, src: [['/assets/video/hero-p-lite.av1.mp4?v=16', 'av01.0.01M.10'], ['/assets/video/hero-p-lite.h264.mp4?v=16', 'avc1.640028']] },
    l: { w: 1280, h: 720, src: [['/assets/video/hero-l.av1.mp4?v=16', 'av01.0.05M.10'], ['/assets/video/hero-l.h264.mp4?v=16', 'avc1.640028']] }
  };
  const CAP_AT = 4.45;       // s: la red ya esta armada, aparece el rotulo "EJEMPLO"
  const SHORT_AT = 4;        // s: en las visitas siguientes solo se arma la red (como SHORT en escritorio)
  const STALL = 10000;       // ms sin primer cuadro: queda el cuadro final
  const frameBox = hero.querySelector('.hero-frame');
  let vid = null, vcv = null, vMode = null, vState = 'idle', vTimer = 0, vScheduled = false;
  let loaded = document.readyState === 'complete';
  // si este archivo llega tarde (red muy lenta), el CSS ya mostro el cuadro final: no se reemplaza
  const lateJs = performance.now() > 5500;
  hero.classList.add('v-js');
  addEventListener('load', () => { loaded = true; videoMode(); }, { once: true });

  const layout = () => (FORCE ? null : mqL.matches ? 'l' : mqP.matches ? 'p' : null);
  function lowData() {
    const c = navigator.connection;
    return !!(c && (c.saveData || /2g$/.test(c.effectiveType || '')));
  }
  function liteVideo() {
    const c = navigator.connection;
    return (innerWidth * (window.devicePixelRatio || 1) < 900) || !!(c && c.effectiveType === '3g') || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 2);
  }
  function showFinal() {
    hero.classList.add('v-final', 'cap-on');
    hero.classList.remove('v-on');
  }
  function dropVideo(keepCanvas) {
    clearTimeout(vTimer);
    if (vid) { const v = vid; vid = null; v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) { /* nada */ } v.remove(); }
    if (vcv && !keepCanvas) { vcv.remove(); vcv = null; }
  }
  function videoFail() {
    if (vState === 'done') return;
    vState = 'done';
    dropVideo(false);
    showFinal();
  }
  function startVideo() {
    vScheduled = false;
    const mode = layout();
    if (vState !== 'wait' || !mode || !loaded || !onScreen || document.hidden || !frameBox) return;
    const v = document.createElement('video');
    const set = mode === 'l' ? VIDEOS.l : liteVideo() ? VIDEOS.pl : VIDEOS.p;
    const pick = set.src.find(([, codecs]) => v.canPlayType('video/mp4; codecs="' + codecs + '"'));
    if (!pick) { videoFail(); return; }
    vState = 'play'; vMode = mode;
    v.className = 'hero-src';
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.autoplay = false; v.loop = false;
    ['muted', 'playsinline', 'webkit-playsinline', 'disablepictureinpicture', 'disableremoteplayback'].forEach((a) => v.setAttribute(a, ''));
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.preload = 'auto';
    // el video se copia a un canvas del tamano del video (el <video> mide 2 px, en una esquina transparente)
    const c = document.createElement('canvas');
    c.className = 'hero-canvas';
    c.width = set.w; c.height = set.h;
    c.setAttribute('aria-hidden', 'true');
    const g = c.getContext('2d', { alpha: false });
    if (!g) { videoFail(); return; }
    let drawn = false, lastT = -1, pending = false;
    // un cuadro nuevo del video -> al canvas (requestVideoFrameCallback; si no hay, requestAnimationFrame)
    const draw = () => {
      pending = false;
      if (vid !== v) return;
      const t = v.currentTime;
      if (t !== lastT) {
        lastT = t;
        try { g.drawImage(v, 0, 0, c.width, c.height); } catch (e) { videoFail(); return; }
        if (!drawn) { drawn = true; clearTimeout(vTimer); hero.classList.add('v-on'); }
        if (t >= CAP_AT) hero.classList.add('cap-on');
      }
      if (!v.ended && !v.paused) next();
    };
    const next = () => {
      if (pending) return;
      pending = true;
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };
    v.addEventListener('playing', next);
    v.addEventListener('ended', () => {
      if (vid !== v) return;
      try { g.drawImage(v, 0, 0, c.width, c.height); } catch (e) { /* queda el ultimo cuadro dibujado */ }
      vState = 'done';
      hero.classList.add('cap-on');
      try { sessionStorage.setItem('es-intro', '1'); } catch (e) { /* nada */ }
      dropVideo(true);   // el canvas se queda con el cuadro final (igual al poster final)
    });
    v.addEventListener('error', videoFail);
    vid = v; vcv = c;
    v.src = pick[0] + (seen ? '#t=' + SHORT_AT : '');
    frameBox.appendChild(c);
    frameBox.appendChild(v);
    vTimer = setTimeout(() => { if (!drawn) videoFail(); }, STALL);
    const pr = v.play();
    if (pr && pr.catch) pr.catch(() => { if (vid === v) videoFail(); });   // sin reproduccion automatica: queda el poster final
  }
  // pausa fuera de pantalla o con la pestana oculta
  function videoVisibility() {
    if (vState === 'wait' && onScreen && !document.hidden) { scheduleVideo(); return; }
    if (vState !== 'play' || !vid) return;
    if (onScreen && !document.hidden) { const pr = vid.play(); if (pr && pr.catch) pr.catch(() => { /* reintenta al volver */ }); }
    else vid.pause();
  }
  function scheduleVideo() {
    if (vScheduled || !loaded) return;
    vScheduled = true;
    if ('requestIdleCallback' in window) requestIdleCallback(startVideo, { timeout: 1500 });
    else setTimeout(startVideo, 250);
  }
  // decide en vivo (rotacion, movimiento reducido, cambio de tamano)
  function videoMode() {
    const mode = layout();
    if (!mode) { if (vState === 'play') videoFail(); return; }
    if (vState === 'done') { if (vMode && vMode !== mode) { dropVideo(false); showFinal(); } return; }
    if (!mqMotion.matches || lowData() || lateJs || (vState === 'play' && vMode !== mode)) { videoFail(); return; }
    if (vState === 'idle') vState = 'wait';
    if (vState === 'wait' && loaded) scheduleVideo();
  }
  [mqP, mqL, mqMotion].forEach((m) => m.addEventListener('change', applyMode));

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
    videoMode();
  }
  MQLS.forEach((m) => m.addEventListener('change', applyMode));
  applyMode();

  window.__hero = { progress, skip: () => { elapsed = hold + dur; }, video: () => ({ state: vState, mode: vMode, src: vid ? vid.currentSrc : null, t: vid ? vid.currentTime : null, quality }) };
})();
