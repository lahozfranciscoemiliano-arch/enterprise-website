/* Enterprise SOC: reproductores de video, v16. Propio, sin dependencias; inspirado en Hero Video Dialog (Magic UI),
   Chapter Scrubber y HoverPlayCard (Ruixen UI) de 21st.dev (ver /assets/CREDITOS.txt).
   data-video="dialog": abre UN <dialog> compartido con <video controls> y capitulos WebVTT. Esc/cerrar/fondo pausan y
   devuelven el foco. data-video="preview": poster + boton; el video muted+loop carga al primer gesto o cerca de la
   pantalla con buena conexion; pausa visible, fuera de pantalla y con la pestaña oculta.
   Con movimiento reducido, Save-Data o 2g nada carga ni arranca solo. Fuentes: data-sources="url codecs, url codecs"
   (AV1 primero) o JSON [{"src","type"}]. API window.VIDEO: open, close, init, pauseAll, pick, auto. */
document.documentElement.classList.add('vx');
(function () {
  'use strict';

  const D = document, W = window, H = D.documentElement, mq = (q) => W.matchMedia(q);
  const RM = mq('(prefers-reduced-motion: reduce)'), FINE = mq('(hover: hover) and (pointer: fine)');
  const PORT = mq('(max-width: 720px), (orientation: portrait) and (pointer: coarse)');
  const ERR = 'Tu navegador no puede reproducir este video.', noop = () => {};
  const playing = (v) => !!v && !v.paused && !v.ended;
  let loaded = D.readyState === 'complete';

  // ---------- Ayudas: conexion, codec ----------
  const net = () => navigator.connection || {};
  // carga o arranque automatico: movimiento permitido, sin ahorro de datos ni 2g, pestaña visible
  const auto = () => !RM.matches && !net().saveData && !/2g/.test(net().effectiveType || '') && !D.hidden;
  // buena conexion conocida (iOS y Firefox no informan: ahi se carga al primer gesto)
  const good = () => loaded && auto() && net().effectiveType === '4g';

  function parse(s) {
    s = (s || '').trim();
    if (s[0] === '[') {
      try { return JSON.parse(s).map((o) => (typeof o === 'string' ? { src: o } : o)); } catch (e) { return []; }
    }
    return s ? s.split(/,\s+/).map((p) => {
      const a = p.trim().split(/\s+/);
      return { src: a[0], type: 'video/' + (/\.webm(\?|#|$)/.test(a[0]) ? 'webm' : 'mp4') + (a[1] ? '; codecs="' + a[1] + '"' : '') };
    }) : [];
  }

  // lo que el navegador puede reproducir: primero 'probably', despues 'maybe', en el orden escrito
  const probe = D.createElement('video');
  function pick(list) {
    const r = list.map((s) => [s, probe.canPlayType(s.type || 'video/mp4')]).filter((x) => x[1]);
    return r.filter((x) => x[1] === 'probably').concat(r.filter((x) => x[1] === 'maybe')).map((x) => x[0]);
  }

  // video largo: si la primera opcion se decodifica por software y otra por hardware, va primero la de hardware
  function efficient(list, port) {
    const mc = navigator.mediaCapabilities;
    if (!mc || list.length < 2) return Promise.resolve(list);
    const q = Promise.all(list.map((s) => mc.decodingInfo({ type: 'file', video: { contentType: s.type, width: port ? 720 : 1280, height: port ? 1280 : 720, bitrate: 6e5, framerate: 30 } }).catch(() => ({})))).then((r) => {
      const i = r[0].powerEfficient ? 0 : r.findIndex((x) => x.supported && x.powerEfficient);
      return i > 0 ? [list[i]].concat(list.filter((_, j) => j !== i)) : list;
    }, () => list);
    return Promise.race([q, new Promise((ok) => setTimeout(ok, 400, list))]);
  }

  function mk(tag, cls, parent, html) {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- Dialogo con capitulos ----------
  let dlg, box, stage, vid, ttl, desc, rail, ol, spin, err, xbtn, opener, track, key = '';
  let cands = [], idx = 0, cues = [], act = -1, want = false, down = false, ready = Promise.resolve();
  const sync = () => { spin.hidden = !(want && vid.readyState < 3 && err.hidden); };

  function build() {
    dlg = mk('dialog', 'vdlg dark', D.body,
      '<div class="vdlg-box"><div class="vdlg-head"><h2 class="vdlg-t" id="vdlg-t"></h2>' +
      '<button type="button" class="vdlg-x" aria-label="Cerrar el video"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      '<div class="vdlg-stage"><video controls playsinline preload="none"></video>' +
      '<span class="vspin" hidden><span class="sr-only">Cargando el video</span></span><p class="vdlg-err" role="alert" hidden></p></div>' +
      '<p class="sr-only" id="vdlg-d"></p><nav class="vdlg-ch" aria-label="Capítulos del video" hidden><ol></ol></nav></div>');
    dlg.setAttribute('aria-labelledby', 'vdlg-t');
    [box, stage, vid, ttl, desc, rail, ol, spin, err, xbtn] = ['.vdlg-box', '.vdlg-stage', 'video', 'h2', '#vdlg-d', 'nav', 'ol', '.vspin', '.vdlg-err', '.vdlg-x'].map((s) => dlg.querySelector(s));
    vid.playsInline = true;
    xbtn.addEventListener('click', () => dlg.close());
    // tocar el fondo cierra; arrastrar desde adentro hacia afuera no
    dlg.addEventListener('pointerdown', (e) => { down = e.target !== dlg; });
    dlg.addEventListener('click', (e) => { if (e.target === dlg && !down) dlg.close(); down = false; });
    dlg.addEventListener('close', () => {
      vid.pause(); want = false; sync();
      H.classList.remove('vlock'); H.style.removeProperty('--vsb');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    });
    ol.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) seek(+b.getAttribute('data-i')); });
    vid.addEventListener('play', () => { want = true; sync(); });
    vid.addEventListener('pause', () => { want = false; sync(); });
    ['waiting', 'playing', 'canplay', 'loadstart', 'seeking', 'seeked', 'emptied'].forEach((t) => vid.addEventListener(t, sync));
    vid.addEventListener('timeupdate', mark);
    // una fuente fallo (404, codec): sigue la proxima desde el mismo segundo
    vid.addEventListener('error', () => {
      if (!vid.getAttribute('src')) return;
      if (++idx >= cands.length) return fail();
      const t = vid.currentTime;
      vid.src = cands[idx].src;
      if (t) vid.currentTime = t;
      if (want) vid.play().catch(noop);
    });
    // girar el telefono con el dialogo abierto: cambia de version en el mismo segundo
    PORT.addEventListener('change', () => {
      if (!dlg.open || !opener.hasAttribute('data-sources-portrait')) return;
      const t = vid.currentTime, p = playing(vid);
      setup(opener);
      ready.then(() => { if (t) vid.currentTime = t; if (p) go(); });
    });
  }

  function fail() {
    want = false;
    vid.removeAttribute('src'); vid.load(); vid.controls = false;
    err.textContent = ERR; err.hidden = false;
    sync();
  }

  function setup(o) {
    const port = PORT.matches && o.hasAttribute('data-sources-portrait');
    const a = (n) => o.getAttribute('data-' + n + (port ? '-portrait' : ''));
    const k = port + a('sources'), ch = o.getAttribute('data-chapters'), img = o.querySelector('img');
    stage.classList.toggle('is-p', port);
    if (k === key) return;
    key = k; want = false; act = -1;
    vid.pause(); vid.removeAttribute('src'); vid.load();
    vid.controls = true; err.hidden = true;
    vid.muted = !o.hasAttribute('data-audio');
    vid.poster = a('poster') || (!port && img && (img.currentSrc || img.src)) || '';
    stage.style.aspectRatio = a('ratio') || (port ? '9/16' : '16/9');
    // capitulos: pista oculta cuyos cues arman la barra; su lugar queda reservado para no mover el video
    if (!track || track.getAttribute('src') !== ch) {
      if (track) track.remove();
      track = null; cues = []; ol.textContent = '';
      rail.hidden = !ch; box.classList.toggle('has-ch', !!ch);
      if (ch) {
        track = mk('track', '', vid);
        Object.assign(track, { kind: 'chapters', srclang: 'es', label: 'Capítulos', src: ch });
        track.addEventListener('load', chapters);
        track.addEventListener('error', () => { rail.hidden = true; box.classList.remove('has-ch'); });
        track.track.mode = 'hidden';
      }
    }
    const list = pick(parse(a('sources')));
    cands = []; idx = 0;
    if (!list.length) { ready = Promise.resolve(); return fail(); }
    ready = efficient(list, port).then((l) => { cands = l; vid.src = l[0].src; });
  }

  function chapters() {
    cues = Array.from(track.track.cues || []);
    ol.textContent = '';
    cues.forEach((c, i) => {
      const t = Math.floor(c.startTime);
      const b = mk('button', 'vch', mk('li', '', ol), '<b>' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') + '</b><span></span><i aria-hidden="true"></i>');
      b.type = 'button'; b.setAttribute('data-i', i);
      b.querySelector('span').textContent = c.text;
    });
    rail.hidden = !cues.length;
    act = -1; mark();
  }

  // capitulo activo (aria-current) y avance dentro de cada uno (--p, la barrita de abajo)
  function mark() {
    if (!cues.length) return;
    const t = vid.currentTime, bs = ol.querySelectorAll('.vch');
    let a = 0;
    cues.forEach((c, i) => {
      bs[i].style.setProperty('--p', Math.min(1, Math.max(0, (t - c.startTime) / ((c.endTime - c.startTime) || 1))).toFixed(3));
      if (t >= c.startTime) a = i;
    });
    if (a === act) return;
    if (bs[act]) bs[act].removeAttribute('aria-current');
    bs[act = a].setAttribute('aria-current', 'true');
    // queda a la vista dentro de la barra (fila en telefonos, columna en escritorio)
    const li = bs[a].parentNode, o = { behavior: RM.matches ? 'auto' : 'smooth' };
    if (ol.scrollWidth > ol.clientWidth + 1) o.left = li.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2;
    if (ol.scrollHeight > ol.clientHeight + 1) o.top = li.offsetTop - (ol.clientHeight - li.offsetHeight) / 2;
    if ('left' in o || 'top' in o) ol.scrollTo(o);
  }

  function go() {
    ready.then(() => {
      if (!cands.length || !dlg.open) return;
      want = true; sync();
      vid.play().catch((e) => { if (e.name === 'NotAllowedError') { want = false; sync(); } });
    });
  }

  function seek(i) {
    ready.then(() => {
      if (!cands.length || !cues[i]) return;
      vid.currentTime = cues[i].startTime;
      mark(); go();
    });
  }

  // la caja nace desde la miniatura (mouse y movimiento permitido); en tactil solo sube y aparece
  function morph(o) {
    if (RM.matches || !box.animate) return;
    const e = { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' };
    const a = (o.querySelector('img') || o).getBoundingClientRect(), b = stage.getBoundingClientRect(), c = box.getBoundingClientRect();
    if (FINE.matches && a.width > 80 && a.bottom > 0 && a.top < W.innerHeight && Math.abs(a.width / a.height - b.width / b.height) < 0.2) {
      const s = a.width / b.width;
      box.animate([{ transformOrigin: '0 0', opacity: 0.35, transform: 'translate(' + (a.left - c.left - s * (b.left - c.left)) + 'px,' + (a.top - c.top - s * (b.top - c.top)) + 'px) scale(' + s + ')' }, { transformOrigin: '0 0', opacity: 1, transform: 'none' }], e);
    } else {
      e.duration = 260;
      box.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], e);
    }
  }

  function open(o) {
    if (!o) return;
    if (!dlg) build();
    if (dlg.open) dlg.close();
    pauseAll();
    opener = o;
    ttl.textContent = o.getAttribute('data-title') || o.getAttribute('aria-label') || o.textContent.trim().replace(/\s+/g, ' ');
    vid.setAttribute('aria-label', ttl.textContent);
    desc.textContent = o.getAttribute('data-desc') || '';
    dlg[desc.textContent ? 'setAttribute' : 'removeAttribute']('aria-describedby', 'vdlg-d');
    setup(o);
    // la pagina no se desplaza detras; se compensa el ancho de la barra para que nada salte
    const sb = W.innerWidth - H.clientWidth;
    if (sb > 0) H.style.setProperty('--vsb', sb + 'px');
    H.classList.add('vlock');
    dlg.showModal();
    xbtn.focus();
    morph(o);
    if (!RM.matches) go();
  }

  D.addEventListener('click', (e) => {
    const o = e.target.closest && e.target.closest('[data-video="dialog"]');
    if (!o || e.defaultPrevented || (o.tagName === 'A' && (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))) return;
    e.preventDefault();
    open(o);
  });

  // ---------- Vista previa ----------
  // s.mode: 'hover' (arranco el mouse: al salir pausa) o 'click' (arranco un clic/toque/tecla: sigue hasta pausar)
  const P = new WeakMap(), all = [];
  let nearIO, seeIO;

  function state(s) {
    const on = playing(s.v);
    s.f.classList.toggle('is-on', on);
    s.f.classList.toggle('is-wait', !!s.want && !on && s.v.readyState < 3);
    if (s.btn) s.btn.setAttribute('aria-label', on ? s.off : s.lab);
  }

  function attach(s, pre) {
    if (!s.list.length) return;
    if (!s.v) {
      const v = s.v = D.createElement('video');
      v.muted = v.defaultMuted = v.loop = v.playsInline = true;
      ['muted', 'loop', 'playsinline', 'disablepictureinpicture', 'disableremoteplayback'].forEach((a) => v.setAttribute(a, ''));
      v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1; v.preload = 'none';
      s.img ? s.img.after(v) : s.f.prepend(v);
      ['playing', 'pause', 'waiting', 'canplay'].forEach((t) => v.addEventListener(t, () => state(s)));
      v.addEventListener('playing', () => s.f.classList.add('is-v'));
      v.addEventListener('error', () => {
        if (!v.getAttribute('src')) return;
        if (++s.i >= s.list.length) return fail2(s);
        v.src = s.list[s.i].src;
        if (s.want) v.play().catch(noop);
      });
    }
    if (pre) s.v.preload = 'auto';
    if (!s.v.getAttribute('src')) s.v.src = s.list[s.i].src;
  }

  function fail2(s) {
    s.want = false;
    if (s.v) { s.v.removeAttribute('src'); s.v.load(); state(s); }
    s.f.classList.add('is-err');
    if (!s.msg) { s.msg = mk('p', 'vmsg', s.img ? s.img.parentNode : s.f); s.msg.setAttribute('role', 'alert'); s.msg.textContent = ERR; }
  }

  function start(s, mode) {
    if (!s.list.length) return fail2(s);
    all.forEach((o) => { if (o !== s && (playing(o.v) || o.want)) halt(o); });
    Object.assign(s, { mode, want: true, back: false, at: performance.now() });
    attach(s); state(s);
    s.v.play().then(() => state(s), (e) => { if (e.name === 'NotAllowedError') { s.want = false; s.mode = ''; state(s); } });
  }

  // back = pausa por salir de pantalla u ocultar la pestaña: al volver sigue (si lo arranco un clic)
  function halt(s, back) {
    s.want = false; s.back = !!back;
    if (!back) s.mode = '';
    if (s.v) { s.v.pause(); state(s); }
  }

  function preview(f) {
    if (P.has(f)) return;
    const btn = f.querySelector('.vpreview-btn') || f.querySelector('button');
    const s = {
      f, btn, img: f.querySelector('img'), v: null, i: 0, mode: '', list: pick(parse(f.getAttribute('data-sources'))),
      lab: (btn && btn.getAttribute('aria-label')) || 'Reproducir el adelanto', off: f.getAttribute('data-label-pause') || 'Pausar el adelanto'
    };
    P.set(f, s); all.push(s);
    if (btn) {
      btn.setAttribute('aria-label', s.lab);
      btn.addEventListener('click', () => {
        // recien arrancado por el mouse (entrar y hacer clic): el clic lo deja fijo en vez de pausarlo
        if (s.mode === 'hover' && performance.now() - s.at < 700) s.mode = 'click';
        else if (playing(s.v) || s.want) { halt(s); s.stop = true; } else start(s, 'click');
      });
    }
    f.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && FINE.matches && auto() && !s.mode && !s.stop) start(s, 'hover');
    });
    f.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      s.stop = false;
      if (s.mode === 'hover') halt(s);
    });
    nearIO.observe(f); seeIO.observe(f);
  }

  const resume = (s) => { if (s.back && s.seen && !D.hidden && !RM.matches) start(s, 'click'); };

  function init(root) {
    if (!('IntersectionObserver' in W)) return;
    if (!nearIO) {
      // cerca de la pantalla y con buena conexion: se precarga para que el mouse arranque al instante
      nearIO = new IntersectionObserver((es) => es.forEach((e) => {
        const s = P.get(e.target);
        if ((s.near = e.isIntersecting) && good()) attach(s, true);
      }), { rootMargin: '400px 0px' });
      seeIO = new IntersectionObserver((es) => es.forEach((e) => {
        const s = P.get(e.target);
        s.seen = e.isIntersecting && e.intersectionRatio >= 0.2;
        if (!s.seen && playing(s.v)) halt(s, s.mode === 'click'); else resume(s);
      }), { threshold: [0, 0.2] });
    }
    const r = root || D;
    r.querySelectorAll('[data-video="preview"]').forEach(preview);
    r.querySelectorAll('[data-video="dialog"]').forEach((o) => o.setAttribute('aria-haspopup', 'dialog'));
  }

  function pauseAll() { all.forEach((s) => { if (playing(s.v) || s.want) halt(s); }); }

  D.addEventListener('visibilitychange', () => all.forEach((s) => { if (!D.hidden) resume(s); else if (playing(s.v)) halt(s, s.mode === 'click'); }));
  // si pasa a movimiento reducido, lo que arranco el mouse se detiene
  RM.addEventListener('change', () => { if (RM.matches) all.forEach((s) => { if (s.mode === 'hover') halt(s); }); });
  W.addEventListener('load', () => { loaded = true; if (good()) all.forEach((s) => { if (s.near) attach(s, true); }); }, { once: true });

  init();
  W.VIDEO = { open, init, pauseAll, auto, pick: (l) => pick(typeof l === 'string' ? parse(l) : l), close: () => { if (dlg && dlg.open) dlg.close(); } };
})();
