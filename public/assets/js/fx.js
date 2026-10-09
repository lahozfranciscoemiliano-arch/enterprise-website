document.documentElement.classList.add('fx');
/* Enterprise SOC: efectos declarativos (fx), version 16.
   Cada componente se activa con data-fx="nombre" y se pueden combinar ("blur-in glow-card").
   Implementacion propia, sin dependencias; inspirada en componentes de 21st.dev (ver /assets/CREDITOS.txt).
   Reglas:
   - Nada se arma hasta que el elemento se acerca (IntersectionObserver) y se arma en tandas de 6 ms.
   - Los bucles se pausan fuera de pantalla, con la pestaña oculta y con FX.pause().
   - Movimiento reducido: estado final y ningun bucle; se escucha el cambio en vivo.
   - Lo que se mueve solo y lleva informacion se detiene solo en 5 s o tiene pausa; lo ambiental es sutil y aria-hidden.
   - Sin JS nada queda oculto: los estados ocultos viven bajo html.fx y fx.css tiene un failsafe.
   API (window.FX): init(raiz), play(el), camera(el, opciones), pause(), resume().
   Eventos: 'fx:play' y 'fx:camera' (entrada, detail = opciones); 'fx:done' y 'fx:camera-end' (salida). */
(function () {
  'use strict';

  var D = document, H = D.documentElement, W = window;
  if (!('IntersectionObserver' in W) || !W.CSS || !CSS.supports) { H.classList.remove('fx'); return; }
  var mq = function (q) { return W.matchMedia(q); };
  var RM = mq('(prefers-reduced-motion: reduce)'), FINE = mq('(hover: hover) and (pointer: fine)');
  var reduced = RM.matches, held = false;
  var C = {}, all = [], S = new WeakMap(), queue = [], uid = 0;
  var nearIO, seeIO, ro, roFn = new WeakMap();
  var NS = 'http://www.w3.org/2000/svg', EASE = 'cubic-bezier(.22,1,.36,1)', INOUT = 'cubic-bezier(.65,0,.35,1)';
  // alto de la ventana en cache, tomado de los IntersectionObserver (rootBounds): leer innerHeight en el
  // arranque o dentro de un callback puede forzar un layout completo de la pagina
  var VH = 0;
  W.addEventListener('resize', function () { VH = W.innerHeight; }, { passive: true });
  var now = function () { return performance.now(); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var arr = function (l) { return Array.prototype.slice.call(l); };
  function num(el, k, d) { var v = parseFloat(el.getAttribute('data-' + k)); return isNaN(v) ? d : v; }
  function attr(el, k, d) { var v = el.getAttribute('data-' + k); return v == null ? d : v; }
  function mk(tag, cls, parent, text) {
    var e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function hide(e) { e.setAttribute('aria-hidden', 'true'); return e; }
  function emit(el, name, detail) { el.dispatchEvent(new CustomEvent('fx:' + name, { bubbles: true, detail: detail })); }
  // Posicion de diagramacion (sin transforms: no la mueven las entradas .r ni el tilt)
  function off(n) { var x = 0, y = 0; for (; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return [x, y]; }
  function svgEl(cls) { var s = D.createElementNS(NS, 'svg'); s.setAttribute('class', cls); return hide(s); }

  // Un solo nombre accesible: aria-label en titulos, enlaces y botones; copia oculta (sr-only) en el resto
  function label(el, text) {
    text = text.replace(/\s+/g, ' ').trim();
    if (/^(H[1-6]|A|BUTTON)$/.test(el.tagName)) { if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text); return; }
    el.insertBefore(mk('span', 'sr-only', null, text), el.firstChild);
  }
  // Reemplaza cada palabra de los nodos de texto por wrap(palabra, i); respeta <em>, <b>, etc.
  function words(el, wrap) {
    var w = D.createTreeWalker(el, NodeFilter.SHOW_TEXT), list = [], n, i = 0;
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (t) {
      var f = D.createDocumentFragment();
      t.nodeValue.split(/(\s+)/).forEach(function (p) {
        if (p) f.appendChild(/^\s+$/.test(p) ? D.createTextNode(p) : wrap(p, i++));
      });
      t.parentNode.replaceChild(f, t);
    });
    return i;
  }

  // ---------- Ciclo de vida ----------
  // prep: arma el DOM (cerca de la pantalla). go: entrada (a la vista). run(st, on): bucle on/off.
  // fin: estado final sin animar. play: repetir. loop:1 = no queda terminado por el movimiento reducido.
  // pre:1 = si ya estaba a la vista cuando se armo (la pagina ya se pinto), va directo al estado final.
  function init(root) {
    root = root || D;
    var list = arr(root.querySelectorAll('[data-fx]'));
    if (root.nodeType === 1 && root.matches('[data-fx]')) list.unshift(root);
    if (!list.length) return;
    if (!nearIO) {
      nearIO = new IntersectionObserver(onNear, { rootMargin: '60% 0px' });
      // Umbrales finos: un elemento mas alto que la pantalla nunca llega a una proporcion alta, y su
      // entrada depende de la parte de la pantalla que ocupa. Con saltos de 1,5x como maximo siempre hay
      // un aviso entre t/x y 1/x (x = alto del elemento / alto de pantalla, t ≤ 0,6), asi que arranca.
      seeIO = new IntersectionObserver(onSee, { threshold: [0, 0.01, 0.015, 0.02, 0.03, 0.045, 0.065, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6] });
    }
    var blur = [];
    list.forEach(function (el) {
      var mine = S.get(el) || [];
      el.getAttribute('data-fx').split(/\s+/).forEach(function (k) {
        if (!C[k] || mine.some(function (s) { return s.k === k; })) return;
        var st = { el: el, c: C[k], k: k };
        mine.push(st); all.push(st);
        if (k === 'blur-in') blur.push(el);
      });
      S.set(el, mine);
      nearIO.observe(el);
    });
    // Si la pagina ya se pinto, la grilla que esta a la vista no se esconde para volver a entrar
    if (blur.length && performance.getEntriesByType('paint').length) {
      var vh = innerHeight;
      blur.filter(function (el) { var r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0; })
        .forEach(function (el) { el.classList.add('in', 'fx-done'); });
    }
  }
  function onNear(es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      nearIO.unobserve(e.target);
      if (e.rootBounds) VH = e.rootBounds.height / 2.2; // rootMargin 60% arriba y abajo
      var r = e.boundingClientRect, first = r.top < (VH || innerHeight) && r.bottom > 0;
      (S.get(e.target) || []).forEach(function (st) { st.first = first; queue.push(st); });
    });
    pump();
  }
  var pumping = false;
  function pump() {
    if (pumping) return;
    var t0 = now();
    while (queue.length && now() - t0 < 6) setup(queue.shift());
    if (queue.length) { pumping = true; setTimeout(function () { pumping = false; pump(); }, 0); }
  }
  function setup(st) {
    try {
      if (st.c.prep) st.c.prep(st);
      st.ready = 1;
      if (reduced || (st.first && st.c.pre)) rest(st);
      seeIO.observe(st.el);
    } catch (err) {
      st.ready = 0; st.done = 1;
      st.el.classList.add('in', 'fx-done');
      if (W.console) console.warn('fx:', st.k, err);
    }
  }
  function onSee(es) {
    es.forEach(function (e) {
      var el = e.target, vis = e.isIntersecting, rb = e.rootBounds;
      if (rb) VH = rb.height;
      var amt = vis ? Math.max(e.intersectionRatio, e.intersectionRect.height / (VH || innerHeight)) : 0;
      el.classList.toggle('fx-off', !vis);
      (S.get(el) || []).forEach(function (st) {
        if (!st.ready) return;
        st.vis = vis;
        if (vis && !st.seen) {
          if (amt >= (st.c.t == null ? 0.15 : st.c.t)) enter(st);
          // red de seguridad: si queda a la vista sin llegar al umbral, la entrada arranca igual a los 2,5 s
          else if (!st.lz && !st.done && st.c.go) st.lz = setTimeout(function () { st.lz = 0; if (st.vis && !st.seen) enter(st); }, 2500);
        } else if (!vis && st.lz) { clearTimeout(st.lz); st.lz = 0; }
        sync(st);
      });
    });
  }
  function enter(st) {
    st.seen = 1;
    clearTimeout(st.lz); st.lz = 0;
    // si una entrada falla, el elemento queda en su estado final (nunca oculto)
    if (!st.done && st.c.go) try { st.c.go(st); } catch (err) { rest(st); st.el.classList.add('in'); }
  }
  function sync(st) {
    if (!st.c.run || !st.ready) return;
    var on = !!(st.vis && !D.hidden && !reduced && !held && !st.done && !st.hold);
    if (on !== !!st.on) { st.on = on; st.c.run(st, on); }
  }
  // Estado final inmediato, sin transiciones (fx-now las corta por dos cuadros)
  function rest(st) {
    if (!st.c.loop) st.done = 1;
    clearTimeout(st.tm);
    if (st.c.fin) {
      st.el.classList.add('fx-now');
      st.c.fin(st);
      requestAnimationFrame(function () { requestAnimationFrame(function () { st.el.classList.remove('fx-now'); }); });
    }
    sync(st);
  }
  function finish(st) { st.done = 1; sync(st); emit(st.el, 'done', st.k); }
  function later(st, fn, ms) { clearTimeout(st.tm); st.tm = setTimeout(fn, ms); }

  D.addEventListener('visibilitychange', function () { all.forEach(sync); });
  RM.addEventListener('change', function () {
    reduced = RM.matches;
    all.forEach(function (st) {
      if (!st.ready) return;
      if (reduced) rest(st); else if (st.c.wake) st.c.wake(st);
      sync(st);
    });
  });

  // Bucle comun de los lienzos: un solo requestAnimationFrame, cada uno con su tope de cuadros por segundo
  var loops = [], raf = 0;
  function tick(t) {
    raf = 0;
    for (var i = 0; i < loops.length; i++) {
      var st = loops[i];
      if (t - st.last >= st.iv - 4) { var dt = st.last ? Math.min(t - st.last, 200) : 16; st.last = t; st.draw(st, t, dt); }
    }
    if (loops.length) raf = requestAnimationFrame(tick);
  }
  function loop(st, on) {
    var i = loops.indexOf(st);
    if (on && i < 0) { st.last = 0; loops.push(st); } else if (!on && i >= 0) loops.splice(i, 1);
    if (loops.length && !raf) raf = requestAnimationFrame(tick);
  }
  // Efectos atados al scroll: una lectura por elemento y despues todas las escrituras
  var scrollers = [], sRaf = 0;
  function onScroll() { if (!sRaf) sRaf = requestAnimationFrame(scrollTick); }
  function scrollTick() {
    sRaf = 0;
    var vh = VH || innerHeight, rs = scrollers.map(function (st) { return st.el.getBoundingClientRect(); });
    scrollers.forEach(function (st, i) { st.c.upd(st, rs[i], vh); });
  }
  function scroller(st, on) {
    var i = scrollers.indexOf(st);
    if (on && i < 0) {
      scrollers.push(st);
      if (scrollers.length === 1) { W.addEventListener('scroll', onScroll, { passive: true }); W.addEventListener('resize', onScroll); }
      onScroll();
    } else if (!on && i >= 0) {
      scrollers.splice(i, 1);
      if (!scrollers.length) { W.removeEventListener('scroll', onScroll); W.removeEventListener('resize', onScroll); }
    }
  }
  function onResize(el, fn) {
    if (!W.ResizeObserver) { fn(); return; }
    if (!ro) ro = new ResizeObserver(function (es) { es.forEach(function (e) { (roFn.get(e.target) || []).forEach(function (f) { f(e); }); }); });
    var l = roFn.get(el) || [];
    l.push(fn); roFn.set(el, l); ro.observe(el);
  }

  // ---------- blur-in: la grilla entra en secuencia (se suma a .r / [data-reveal]) ----------
  C['blur-in'] = {
    prep: function (st) {
      arr(st.el.children).forEach(function (c, i) { c.style.setProperty('--i', Math.min(i, 12)); });
    },
    go: function (st) {
      st.el.classList.add('in');
      later(st, function () { st.el.classList.add('fx-done'); }, Math.min(st.el.children.length, 13) * 60 + 800);
    },
    fin: function (st) { st.el.classList.add('in', 'fx-done'); }
  };

  // ---------- cut: palabras o letras que suben desde una mascara ----------
  C.cut = {
    pre: 1,
    prep: function (st) {
      var el = st.el, chars = attr(el, 'split', 'words') === 'chars', from = attr(el, 'from', 'first'), pieces = [];
      var text = el.textContent;
      words(el, function (w) {
        var m = hide(mk('span', 'fx-m'));
        if (chars) Array.from(w).forEach(function (ch) { pieces.push(mk('span', 'fx-p', m, ch)); });
        else pieces.push(mk('span', 'fx-p', m, w));
        return m;
      });
      label(el, text);
      var n = pieces.length, gap = num(el, 'stagger', chars ? 22 : 45);
      pieces.forEach(function (p, i) {
        var k = from === 'center' ? Math.abs(i - (n - 1) / 2) : from === 'last' ? n - 1 - i : i;
        p.style.transitionDelay = Math.round(k * gap) + 'ms';
      });
      st.ms = n * gap + 900;
    },
    go: function (st) { st.el.classList.add('in'); later(st, function () { finish(st); }, st.ms); },
    fin: function (st) { st.el.classList.add('in'); }
  };

  // ---------- scramble: decodifica el texto al entrar (≤ 0,8 s); se repite al pasar el mouse ----------
  function scramble(st) {
    if (reduced || st.run || !st.v) return;
    var txt = st.txt, dur = Math.min(num(st.el, 'duration', 700), 800), cs = attr(st.el, 'chars', 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_');
    var t0 = now(), last = 0;
    st.run = 1;
    (function f(t) {
      var p = Math.min(1, (t - t0) / dur);
      if (t - last > 40 || p === 1) {
        last = t;
        var k = Math.floor(p * txt.length), out = '';
        for (var i = 0; i < txt.length; i++) out += i < k || /[\s.,:;·\-–()]/.test(txt[i]) ? txt[i] : cs[Math.random() * cs.length | 0];
        st.v.textContent = out;
      }
      if (p < 1) st.raf = requestAnimationFrame(f); else st.run = 0;
    })(t0);
  }
  C.scramble = {
    t: 0.5,
    prep: function (st) {
      var el = st.el;
      if (el.children.length) return; // solo hojas de texto (no rompe relojes ni iconos)
      st.txt = el.textContent;
      el.textContent = '';
      label(el, st.txt);
      st.v = hide(mk('span', 'fx-sc', el, st.txt));
      if (FINE.matches && attr(el, 'hover', 'on') !== 'off') el.addEventListener('pointerenter', function () { scramble(st); });
    },
    go: scramble, play: scramble,
    fin: function (st) { cancelAnimationFrame(st.raf); st.run = 0; if (st.v) st.v.textContent = st.txt; }
  };

  // ---------- rotate: una palabra que cambia letra por letra; una vuelta y se queda en la primera ----------
  // La caja mide lo que la palabra mas larga (el parrafo no se rearma en cada cambio: CLS 0). Por eso
  // conviene usarlo al final de la oracion: en el medio, una palabra corta deja un hueco antes del resto.
  C.rotate = {
    t: 0.5, loop: 1,
    prep: function (st) {
      var el = st.el, ws = attr(el, 'words', '').split('|').map(function (w) { return w.trim(); }).filter(Boolean);
      if (ws.length < 2) return;
      el.textContent = '';
      label(el, attr(el, 'label', ws.slice(0, -1).join(', ') + ' y ' + ws[ws.length - 1]));
      var box = hide(mk('span', 'fx-rot', el));
      st.w = ws.map(function (w, i) {
        var s = mk('span', 'fx-rw' + (i ? '' : ' on'), box);
        Array.from(w).forEach(function (ch, j) { mk('i', '', s, ch === ' ' ? ' ' : ch).style.setProperty('--i', j); });
        return s;
      });
      st.i = 0; st.r = 0;
    },
    run: function (st, on) {
      clearTimeout(st.tm);
      if (on && st.w) st.tm = setTimeout(function () { rotStep(st); }, num(st.el, 'interval', 2400));
    },
    fin: function (st) {
      if (!st.w) return;
      st.w.forEach(function (w, i) { w.className = 'fx-rw' + (i ? '' : ' on'); });
      st.i = 0;
    }
  };
  function rotStep(st) {
    var n = st.w.length, prev = st.w[(st.i + n - 1) % n], a = st.w[st.i];
    st.i = (st.i + 1) % n;
    prev.classList.remove('out');
    a.classList.remove('on'); a.classList.add('out');
    st.w[st.i].classList.add('on');
    if (st.i === 0 && ++st.r >= num(st.el, 'rounds', 1)) { finish(st); return; }
    st.on = false; sync(st);
  }

  // ---------- scroll-words: las palabras se encienden con el scroll ----------
  C['scroll-words'] = {
    t: 0, loop: 1,
    prep: function (st) {
      // ya a la vista al armarse: el texto queda como esta (no se apaga texto ya pintado ni se rearma el parrafo)
      if (st.first) { st.skip = 1; return; }
      var el = st.el, n = words(el, function (w, i) { var s = mk('span', 'fx-sw', null, w); s.style.setProperty('--i', i); return s; });
      el.style.setProperty('--n', n);
      st.nat = CSS.supports('animation-timeline: view()');
      el.classList.add(st.nat ? 'fx-swn' : 'fx-swj');
      if (!st.nat) el.style.setProperty('--fx-p', 0);
      st.p = -1;
    },
    run: function (st, on) { if (!st.nat && !st.skip) scroller(st, on); },
    upd: function (st, r, vh) {
      // mismo rango que la version CSS: cover 12% a cover 52%
      var p = clamp(((vh - r.top) / (vh + r.height) - 0.12) / 0.4, 0, 1);
      if (Math.abs(p - st.p) > 0.004) { st.p = p; st.el.style.setProperty('--fx-p', p.toFixed(3)); }
    },
    fin: function (st) { if (!st.skip) st.el.style.setProperty('--fx-p', 1); }
  };

  // ---------- odometer: columnas de digitos que ruedan hasta el valor (el texto final queda para lectores) ----------
  // Sin saltos de diagramacion (CLS 0): la caja ocupa el ancho del valor final; las columnas que sobran al principio
  // van a la izquierda, fuera del flujo, y todo se corre con transform mientras se apagan. Las unidades quedan fijas.
  C.odometer = {
    pre: 1, t: 0.6,
    prep: function (st) {
      var el = st.el, raw = parseFloat(el.textContent.replace(/[^\d-]/g, ''));
      var to = num(el, 'to', num(el, 'count', isNaN(raw) ? 0 : raw)), from = num(el, 'from', 0), sep = attr(el, 'sep', '.');
      // miles con punto (es-AR) sin Intl: la primera llamada a toLocaleString carga datos y tarda decenas de ms en un celular
      var f = function (v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep); };
      var a = f(from), b = f(to), n = Math.max(a.length, b.length);
      a = a.padStart(n); b = b.padStart(n);
      el.textContent = '';
      label(el, b.trim());
      var box = hide(mk('span', 'fx-od', el)), lead = mk('span', 'fx-ol', box);
      st.cols = [];
      for (var i = 0; i < n; i++) {
        var x = a[i], y = b[i], dig = !/[^\d ]/.test(x + y);
        var col = mk('span', 'fx-oc' + (x === ' ' ? ' fx-z' : ''), y === ' ' ? lead : box);
        var sp = mk('span', dig ? 'fx-os' : 'fx-ox', col, dig ? '0\n1\n2\n3\n4\n5\n6\n7\n8\n9' : x === ' ' ? y : x);
        if (dig) sp.style.setProperty('--d', +x || 0);
        col.style.transitionDelay = sp.style.transitionDelay = i * 70 + 'ms';
        st.cols.push([col, sp, +y || 0]);
      }
      st.box = box;
      // Lecturas despues del layout (ResizeObserver, antes de pintar): sin layout forzado en el arranque
      onResize(box, function () {
        var cs = getComputedStyle(el), src = el, bg = 'none';
        // texto con degrade (background-clip:text): las columnas reciben el mismo fondo, linea por linea
        for (var j = 0; cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' && j < 4 && src && bg === 'none'; j++) { bg = getComputedStyle(src).backgroundImage; if (bg === 'none') src = src.parentElement; }
        if (bg !== 'none') { box.style.setProperty('--fx-bg', bg); if (src === el) el.style.backgroundImage = 'none'; }
        // corrimiento inicial: el numero largo arranca en el mismo borde que el final (segun la alineacion)
        var lw = lead.offsetWidth, al = cs.textAlign;
        if (st.rolled || !lw) return;
        box.style.transition = 'none';
        box.style.transform = 'translateX(' + (al === 'center' ? lw / 2 : al === 'right' || al === 'end' ? 0 : lw) + 'px)';
      });
    },
    go: function (st) {
      st.el.classList.add('fx-roll');
      odoSet(st);
      later(st, function () { st.el.classList.remove('fx-roll'); finish(st); }, 1900 + st.cols.length * 70);
    },
    fin: function (st) { if (st.cols) odoSet(st); st.el.classList.remove('fx-roll'); }
  };
  function odoSet(st) {
    st.rolled = 1;
    st.cols.forEach(function (c) { c[0].classList.toggle('fx-z', c[0].parentNode !== st.box); c[1].style.setProperty('--d', c[2]); });
    st.box.style.transition = st.box.style.transform = '';
  }

  // ---------- glow-card: luz que sigue al mouse por el borde; en tactil, un barrido al entrar ----------
  var sweepIO;
  C['glow-card'] = {
    t: 0.3,
    prep: function (st) {
      var el = st.el, cards = attr(el, 'glow', '') === 'self' ? [el] : arr(el.children);
      cards.forEach(function (c) { c.classList.add('fx-gc'); });
      if (FINE.matches) {
        var ev = null, rq = 0;
        el.addEventListener('pointermove', function (e) {
          ev = e;
          if (rq) return;
          rq = requestAnimationFrame(function () {
            rq = 0;
            var c = ev.target.closest && ev.target.closest('.fx-gc');
            if (!c || !el.contains(c)) return;
            var r = c.getBoundingClientRect();
            c.style.setProperty('--mx', Math.round(ev.clientX - r.left) + 'px');
            c.style.setProperty('--my', Math.round(ev.clientY - r.top) + 'px');
          });
        }, { passive: true });
      } else if (!reduced) {
        if (!sweepIO) sweepIO = new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            if (!e.isIntersecting || reduced) return;
            sweepIO.unobserve(e.target);
            e.target.classList.add('fx-sweep');
          });
        }, { threshold: 0.6 });
        cards.forEach(function (c) { sweepIO.observe(c); });
      }
    }
  };

  // ---------- beam-border: un tramo de luz cobre recorre el borde (una vuelta, se repite al acercarse) ----------
  var OFFSET_RECT = CSS.supports('offset-path', 'rect(0 auto auto 0 round 4px)');
  function beamBorder(st) {
    if (reduced || !st.b || !OFFSET_RECT) return;
    if (st.a && st.a.playState === 'running') return;
    var loops = attr(st.el, 'loops', '1');
    st.a = st.b.animate([
      { offsetDistance: '0%', opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.94 }, { offsetDistance: '100%', opacity: 0 }
    ], { duration: num(st.el, 'duration', 4200), iterations: loops === 'inf' ? Infinity : +loops || 1, easing: 'linear' });
  }
  C['beam-border'] = {
    t: 0.4,
    prep: function (st) {
      var el = st.el, s = hide(mk('span', 'fx-bb', el));
      // el radio se lee con el layout ya hecho (sin recalculo forzado en el arranque)
      onResize(el, function () { s.style.setProperty('--fx-r', getComputedStyle(el).borderTopLeftRadius); });
      st.b = mk('i', '', s);
      if (FINE.matches) el.addEventListener('pointerenter', function () { beamBorder(st); });
      el.addEventListener('focusin', function () { beamBorder(st); });
    },
    go: beamBorder, play: beamBorder,
    run: function (st, on) { var s = st.a && st.a.playState; if (on && s === 'paused') st.a.play(); else if (!on && s === 'running') st.a.pause(); },
    fin: function (st) { if (st.a) st.a.cancel(); }
  };

  // ---------- magnetic: el boton se acerca al cursor hasta 6 px (solo mouse; propiedad translate, sin tocar el DOM) ----------
  C.magnetic = {
    t: 0,
    prep: function (st) {
      var el = st.el;
      if (!FINE.matches) return;
      var r, x = 0, y = 0, tx = 0, ty = 0, rq = 0;
      var step = function () {
        x += (tx - x) * 0.2; y += (ty - y) * 0.2;
        if (Math.abs(tx - x) < 0.05 && Math.abs(ty - y) < 0.05) { x = tx; y = ty; rq = 0; } else rq = requestAnimationFrame(step);
        el.style.translate = x || y ? x.toFixed(2) + 'px ' + y.toFixed(2) + 'px' : '';
      };
      var go = function () { if (!rq) rq = requestAnimationFrame(step); };
      el.addEventListener('pointerenter', function () { r = el.getBoundingClientRect(); });
      el.addEventListener('pointermove', function (e) {
        if (reduced || !r) return;
        var m = num(el, 'strength', 6);
        tx = clamp((e.clientX - r.left - r.width / 2) * 0.25, -m, m);
        ty = clamp((e.clientY - r.top - r.height / 2) * 0.35, -m, m);
        go();
      });
      el.addEventListener('pointerleave', function () { tx = ty = 0; r = null; go(); });
    }
  };

  // ---------- tilt: la captura se inclina hacia el cursor (propiedad rotate: no pisa el transform del scroll) ----------
  C.tilt = {
    t: 0,
    prep: function (st) {
      var el = st.el;
      if (!FINE.matches) return;
      el.classList.add('fx-tilt');
      if (!el.parentNode.classList.contains('tilt-wrap')) el.parentNode.style.perspective = '1400px';
      var r, x = 0, y = 0, tx = 0, ty = 0, rq = 0, max = num(el, 'max', 5);
      var step = function () {
        x += (tx - x) * 0.12; y += (ty - y) * 0.12;
        if (Math.abs(tx - x) < 0.01 && Math.abs(ty - y) < 0.01) { x = tx; y = ty; rq = 0; } else rq = requestAnimationFrame(step);
        var a = Math.sqrt(x * x + y * y);
        el.style.rotate = a < 0.01 ? '' : (x / a).toFixed(4) + ' ' + (y / a).toFixed(4) + ' 0 ' + a.toFixed(3) + 'deg';
      };
      var go = function () { if (!rq) rq = requestAnimationFrame(step); };
      el.addEventListener('pointerenter', function () { r = el.getBoundingClientRect(); });
      el.addEventListener('pointermove', function (e) {
        if (reduced || !r) return;
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        tx = (0.5 - py) * 2 * max; ty = (px - 0.5) * 2 * max;
        el.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        go();
      });
      el.addEventListener('pointerleave', function () { tx = ty = 0; r = null; go(); });
    }
  };

  // ---------- Lienzos (stars, grid): DPR ≤ 1,5, tope de cuadros, pausa fuera de pantalla ----------
  function canvas(st, fps, setup) {
    var el = st.el, cv = el.tagName === 'CANVAS' ? el : el.insertBefore(D.createElement('canvas'), el.firstChild);
    cv.classList.add('fx-cv'); hide(cv);
    st.ctx = cv.getContext('2d'); st.iv = 1000 / fps;
    onResize(cv, function (e) {
      var w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height), d = Math.min(W.devicePixelRatio || 1, 1.5);
      if (!w || !h || (w === st.w && h === st.h)) return;
      st.w = w; st.h = h; cv.width = Math.round(w * d); cv.height = Math.round(h * d);
      st.ctx.setTransform(d, 0, 0, d, 0, 0);
      setup(st);
      st.draw(st, now(), 0, reduced);
      cv.classList.add('fx-cv-on');
    });
  }
  C.stars = {
    t: 0, loop: 1,
    prep: function (st) {
      st.draw = drawStars;
      canvas(st, 20, function (s) {
        var n = Math.min(220, Math.round(s.w * s.h / num(s.el, 'density', 6500))), a = [];
        for (var i = 0; i < n; i++) {
          a.push({ x: Math.random() * s.w, y: Math.random() * s.h, r: Math.random() < 0.12 ? rnd(1.1, 1.6) : rnd(0.5, 1), a: rnd(0.25, 0.8), f: rnd(0.5, 1.6), p: rnd(0, 6.3), c: Math.random() < 0.11 ? '#E9A86F' : '#E2E8F0' });
        }
        s.stars = a; s.sh = null; s.next = now() + rnd(1200, 3200);
      });
    },
    run: loop,
    fin: function (st) { st.sh = null; if (st.w) drawStars(st, 0, 0, true); }
  };
  function drawStars(st, t, dt, still) {
    var x = st.ctx, s = st.stars, i, k;
    x.clearRect(0, 0, st.w, st.h);
    for (i = 0; i < s.length; i++) {
      k = s[i];
      x.globalAlpha = still ? k.a : k.a * (0.6 + 0.4 * Math.sin(t / 1000 * k.f + k.p));
      x.fillStyle = k.c;
      if (k.r > 1.05) { x.beginPath(); x.arc(k.x, k.y, k.r, 0, 6.283); x.fill(); } else x.fillRect(k.x, k.y, k.r * 1.4, k.r * 1.4);
    }
    x.globalAlpha = 1;
    if (still) return;
    var m = st.sh;
    if (!m && t > st.next) m = st.sh = { x: rnd(0.3, 1.05) * st.w, y: rnd(-0.05, 0.3) * st.h, a: rnd(2.6, 2.85), v: rnd(0.5, 0.75), l: rnd(90, 150), d: 0 };
    if (!m) return;
    m.d += dt * m.v;
    var cx = Math.cos(m.a), cy = Math.sin(m.a), hx = m.x + cx * m.d, hy = m.y + cy * m.d, tx = hx - cx * m.l, ty = hy - cy * m.l;
    var g = x.createLinearGradient(hx, hy, tx, ty);
    g.addColorStop(0, 'rgba(255,236,220,.9)'); g.addColorStop(1, 'rgba(233,168,111,0)');
    x.strokeStyle = g; x.lineWidth = 1.3; x.lineCap = 'round';
    x.beginPath(); x.moveTo(hx, hy); x.lineTo(tx, ty); x.stroke();
    if (tx < 0 || ty > st.h) { st.sh = null; st.next = t + rnd(2500, 6500); }
  }

  var RGB = { copper: '224,123,58', slate: '100,116,139', ok: '52,211,153' };
  C.grid = {
    t: 0, loop: 1,
    prep: function (st) {
      st.draw = drawGrid;
      canvas(st, 15, function (s) {
        var co = mq('(pointer: coarse)').matches, cell = num(s.el, 'cell', co ? 3 : 4), step = cell + num(s.el, 'gap', co ? 8 : 6);
        var cols, rows;
        do { cols = Math.ceil(s.w / step); rows = Math.ceil(s.h / step); step += 2; } while (cols * rows > 9000);
        var n = cols * rows, lv = new Uint8Array(n), max = num(s.el, 'max', 0.24), rgb = RGB[attr(s.el, 'color', 'copper')] || RGB.copper;
        for (var i = 0; i < n; i++) lv[i] = Math.random() < 0.5 ? 0 : 1 + (Math.random() * 5 | 0);
        s.g = { cell: cell, step: step - 2, cols: cols, n: n, lv: lv, cs: [0, 1, 2, 3, 4, 5].map(function (k) { return 'rgba(' + rgb + ',' + (max * k / 5).toFixed(3) + ')'; }), ok: 'rgba(' + RGB.ok + ',' + (max * 1.3).toFixed(3) + ')' };
        s.full = 1;
      });
    },
    run: loop,
    fin: function (st) { if (st.g) { st.full = 1; drawGrid(st, 0, 0); } }
  };
  function drawGrid(st, t, dt) {
    var g = st.g, x = st.ctx, i, k, j;
    if (st.full) {
      st.full = 0;
      x.clearRect(0, 0, st.w, st.h);
      for (k = 1; k < 6; k++) {
        x.fillStyle = g.cs[k];
        for (i = 0; i < g.n; i++) if (g.lv[i] === k) x.fillRect((i % g.cols) * g.step, (i / g.cols | 0) * g.step, g.cell, g.cell);
      }
      return;
    }
    // cada cuadrado cambia con probabilidad 0,35 por segundo; solo se repintan los que cambian
    var m = Math.round(g.n * 0.35 * dt / 1000);
    for (j = 0; j < m; j++) {
      i = Math.random() * g.n | 0;
      k = Math.random() < 0.55 ? 0 : 1 + (Math.random() * 5 | 0);
      if (k === g.lv[i]) continue;
      g.lv[i] = k;
      var px = (i % g.cols) * g.step, py = (i / g.cols | 0) * g.step;
      x.clearRect(px, py, g.cell, g.cell);
      if (k) { x.fillStyle = k === 5 && Math.random() < 0.03 ? g.ok : g.cs[k]; x.fillRect(px, py, g.cell, g.cell); }
    }
  }

  // ---------- beams: curvas finas con un cometa cobre que sale hacia afuera (solo CSS) ----------
  function seeded(s) { return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; }; }
  C.beams = {
    t: 0,
    prep: function (st) {
      var el = st.el, r = seeded(num(el, 'seed', 7) * 7919 + 1), n = num(el, 'count', mq('(max-width: 640px)').matches ? 5 : 9), id = 'fxg' + (++uid);
      var o = attr(el, 'origin', '-.02 .92').split(/\s+/).map(parseFloat), ox = o[0] * 1200, oy = o[1] * 600;
      var s = '<defs><linearGradient id="' + id + '"><stop offset=".08" stop-color="#E07B3A" stop-opacity="0"/><stop offset=".6" stop-color="#E07B3A"/><stop offset="1" stop-color="#F2B27A"/></linearGradient><linearGradient id="' + id + 'h"><stop offset=".1" stop-color="#FCE2C8" stop-opacity="0"/><stop offset=".45" stop-color="#FCE2C8"/></linearGradient></defs>';
      for (var i = 0; i < n; i++) {
        var y = -60 + 720 * (i + 0.5 + (r() - 0.5) * 0.6) / n;
        var d = 'M' + ox + ' ' + oy + 'C' + Math.round(ox + 250 + r() * 200) + ' ' + Math.round(oy + (y - oy) * 0.15) + ' ' + Math.round(650 + r() * 250) + ' ' + Math.round(y + (r() - 0.5) * 80) + ' 1260 ' + Math.round(y);
        var du = 7 + r() * 7, sty = ' style="--d:' + du.toFixed(1) + 's;--l:-' + (r() * du).toFixed(1) + 's;--s:' + Math.round(du * 30) + '" d="' + d + '"/>';
        s += '<path class="fx-bm-b" d="' + d + '"/><path class="fx-bm-t" pathLength="1" stroke="url(#' + id + ')"' + sty + '<path class="fx-bm-h" pathLength="1" stroke="url(#' + id + 'h)"' + sty;
      }
      var svg = svgEl('fx-beams');
      svg.setAttribute('viewBox', '0 0 1200 600'); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      svg.innerHTML = s;
      el.insertBefore(svg, el.firstChild);
    }
  };

  // ---------- trace: una linea de luz que avanza con el scroll y enciende cada paso ----------
  // La linea une las marcas (data-marks, por defecto .num) si estan en una sola fila o columna; si son
  // anchas (titulos) va por el margen izquierdo. En una grilla de 2x2 no hay linea: solo se encienden.
  C.trace = {
    t: 0, loop: 1,
    prep: function (st) {
      var el = st.el, r = hide(mk('span', 'fx-tr'));
      st.r = r; mk('i', '', r); mk('b', '', r);
      st.marks = arr(el.querySelectorAll(attr(el, 'marks', '.num')));
      st.p = -1;
      onResize(el, function () {
        // el riel va primero (debajo de los pasos posicionados); si eso mueve al primer hijo (reglas :first-child), va al final.
        // Se hace aca, con el layout ya calculado, para no forzar un layout en el arranque.
        if (!r.parentNode) {
          var f = el.firstElementChild, y0 = f && off(f)[1];
          el.insertBefore(r, el.firstChild);
          if (f && off(f)[1] !== y0) el.appendChild(r);
        }
        traceGeo(st);
      });
    },
    run: function (st, on) { scroller(st, on); },
    upd: function (st, R, vh) {
      var g = st.g;
      if (!g) return;
      traceSet(st, clamp(g.ax === 'y' ? (vh * 0.62 - R.top - g.s) / (g.e - g.s) : (vh * 0.88 - R.top) / (vh * 0.5), 0, 1));
    },
    fin: function (st) { if (st.g) traceSet(st, 1); }
  };
  function traceGeo(st) {
    var el = st.el, o = off(el), h = el.offsetHeight, g;
    var pts = st.marks.map(function (m) { var p = off(m); return [p[0] - o[0] + m.offsetWidth / 2, p[1] - o[1] + m.offsetHeight / 2]; });
    // marcas anchas (titulos de una lectura): la linea va por el margen izquierdo, de arriba abajo
    var gutter = num(el, 'x', -Math.min(28, Math.max(10, el.getBoundingClientRect().left - 8)));
    if (pts.length && st.marks[0].offsetWidth > 80) g = { ax: 'y', s: 0, e: h, c: gutter, m: pts.map(function (p) { return p[1]; }) };
    else if (pts.length > 1) {
      var a = pts[0], b = pts[pts.length - 1], ax = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 0 : 1;
      // la linea necesita los pasos en una sola fila o columna; en una grilla (2x2) no hay linea
      // y cada numero se enciende cuando su fila llega a la misma altura de lectura
      if (!pts.every(function (p) { return Math.abs(p[1 - ax] - a[1 - ax]) < 8; })) g = { ax: 'y', s: 0, e: h, c: 0, m: pts.map(function (p) { return p[1]; }), no: 1 };
      else g = { ax: ax ? 'y' : 'x', s: a[ax], e: b[ax], c: a[1 - ax], m: pts.map(function (p) { return p[ax]; }) };
    } else g = { ax: 'y', s: 0, e: h, c: gutter, m: [] };
    var len = Math.max(1, g.e - g.s), r = st.r;
    st.g = g; r.hidden = !!g.no;
    r.className = 'fx-tr fx-tr-' + g.ax;
    // posicion con transform (no cuenta como salto de diagramacion si cambia al redimensionar)
    r.style.cssText = 'transform:translate(' + (g.ax === 'x' ? g.s + 'px,' + g.c : g.c + 'px,' + g.s) + 'px);' + (g.ax === 'x' ? 'width:' : 'height:') + len + 'px;--fx-l:' + len + 'px';
    // borde de la linea de 1 px, medido desde el borde del contenedor: la pagina puede poner sus marcas
    // con left:var(--fx-x) (o top:var(--fx-y)) y centrar una marca de 9 px con margin-left:-4px
    if (!g.no) el.style.setProperty(g.ax === 'x' ? '--fx-y' : '--fx-x', g.c + 'px');
    st.p = -1;
    if (reduced) traceSet(st, 1); else onScroll();
  }
  function traceSet(st, p) {
    if (Math.abs(p - st.p) < 0.002) return;
    st.p = p;
    var g = st.g, at = g.s + p * (g.e - g.s);
    st.r.style.setProperty('--fx-p', p.toFixed(4));
    st.marks.forEach(function (m, i) { m.classList.toggle('fx-lit', at >= g.m[i] - 2); });
  }

  // ---------- stack: tarjetas que se apilan (sticky); con scroll-timeline la de atras se achica ----------
  C.stack = {
    t: 0,
    prep: function (st) {
      var kids = arr(st.el.children), tl = CSS.supports('view-timeline-name: --a') && CSS.supports('timeline-scope: --a'), names = [];
      kids.forEach(function (c, i) {
        c.style.setProperty('--i', i);
        if (!tl) return;
        names.push('--fx-s' + i);
        c.style.setProperty('view-timeline-name', '--fx-s' + i);
        if (i) kids[i - 1].style.setProperty('animation-timeline', '--fx-s' + i);
      });
      if (tl) { st.el.style.setProperty('timeline-scope', names.join(',')); st.el.classList.add('fx-stk'); }
    }
  };

  // ---------- marquee: cinta infinita a velocidad constante, con boton de pausa ----------
  C.marquee = {
    t: 0,
    prep: function (st) {
      var el = st.el, tr = el.querySelector('[data-track]') || el.querySelector('.ticker-track') || el.firstElementChild;
      tr.classList.add('fx-mq-t');
      var kids = arr(tr.children), cl = kids.filter(function (k) { return k.getAttribute('aria-hidden') === 'true'; });
      if (!cl.length) cl = kids.map(function (k) { var c = hide(k.cloneNode(true)); tr.appendChild(c); return c; });
      cl.forEach(function (c) { c.inert = true; c.classList.add('fx-cl'); });
      onResize(tr, function (e) { el.style.setProperty('--fx-dur', (e.contentRect.width / 2 / num(el, 'speed', 40)).toFixed(1) + 's'); });
      if (attr(el, 'pause', 'on') === 'off') return;
      var b = mk('button', 'fx-mq-b', el), names = attr(el, 'pause-label', 'Pausar la cinta|Reanudar la cinta').split('|');
      b.type = 'button';
      b.innerHTML = '<span aria-hidden="true"></span>';
      var set = function (stop) { el.classList.toggle('fx-stop', stop); b.setAttribute('aria-label', names[stop ? 1 : 0]); };
      set(false);
      b.addEventListener('click', function () { set(!el.classList.contains('fx-stop')); });
    }
  };

  // ---------- beam-graph: nodos HTML unidos por curvas SVG con luz que viaja (se recalcula al cambiar el tamaño) ----------
  function beamPlay(st) {
    if (reduced || !st.ls) return;
    var it = attr(st.el, 'loops', '2');
    (st.an || []).forEach(function (a) { a.cancel(); });
    st.an = st.ls.map(function (p, i) {
      return p.animate([{ strokeDashoffset: 0.16 }, { strokeDashoffset: -1 }], { duration: 1700 + (i % 3) * 260, delay: i * 160, iterations: it === 'inf' ? Infinity : +it || 2, easing: 'cubic-bezier(.45,0,.4,1)', fill: 'backwards' });
    });
  }
  C['beam-graph'] = {
    t: 0.25,
    prep: function (st) {
      var el = st.el, svg = svgEl('fx-bg'), id = 'fxm' + (++uid), s = '';
      st.links = attr(el, 'links', '').split(/[\s,;]+/).filter(Boolean).map(function (x) {
        var p = x.split('>');
        return { a: el.querySelector('[data-node="' + p[0] + '"]'), b: el.querySelector('[data-node="' + p[1] + '"]') };
      }).filter(function (l) { return l.a && l.b; });
      st.links.forEach(function () { s += '<path class="fx-bg-b" marker-end="url(#' + id + ')"/><path class="fx-bg-l" pathLength="1"/>'; });
      svg.innerHTML = '<defs><marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z"/></marker></defs>' + s;
      el.insertBefore(svg, el.firstChild);
      st.svg = svg;
      st.bs = arr(svg.querySelectorAll('.fx-bg-b'));
      st.ls = arr(svg.querySelectorAll('.fx-bg-l'));
      onResize(el, function () { graph(st); });
      if (FINE.matches) el.addEventListener('pointerenter', function () { if (st.seen && !(st.an || []).some(function (a) { return a.playState === 'running'; })) beamPlay(st); });
    },
    go: beamPlay, play: beamPlay,
    run: function (st, on) { (st.an || []).forEach(function (a) { if (on && a.playState === 'paused') a.play(); else if (!on && a.playState === 'running') a.pause(); }); },
    fin: function (st) { (st.an || []).forEach(function (a) { a.cancel(); }); }
  };
  function graph(st) {
    var o = off(st.el), W0 = st.el.offsetWidth, H0 = st.el.offsetHeight, box = function (n) {
      var p = off(n), l = p[0] - o[0], t = p[1] - o[1], w = n.offsetWidth, h = n.offsetHeight;
      return { l: l, t: t, r: l + w, b: t + h, x: l + w / 2, y: t + h / 2 };
    };
    // lado de salida y de llegada de cada enlace; los que comparten lado se reparten a lo largo del borde
    var ends = [], sides = {};
    st.links.forEach(function (l, i) {
      var a = box(l.a), b = box(l.b), h = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) * 0.8;
      var sa = h ? (b.x > a.x ? 'r' : 'l') : (b.y > a.y ? 'b' : 't'), sb = { r: 'l', l: 'r', b: 't', t: 'b' }[sa];
      ends.push([a, b, sa, sb, h]);
      [[l.a, sa, b, 0], [l.b, sb, a, 1]].forEach(function (q) {
        var k = (q[0].getAttribute('data-node')) + q[1];
        (sides[k] = sides[k] || []).push({ i: i, end: q[3], o: h ? q[2].y : q[2].x });
      });
    });
    var fr = {};
    Object.keys(sides).forEach(function (k) {
      var g = sides[k].sort(function (p, q) { return p.o - q.o; });
      g.forEach(function (p, j) { fr[p.i + '-' + p.end] = (j + 1) / (g.length + 1); });
    });
    var pt = function (bx, side, f) {
      return side === 'r' ? [bx.r, bx.t + (bx.b - bx.t) * f] : side === 'l' ? [bx.l, bx.t + (bx.b - bx.t) * f] : side === 'b' ? [bx.l + (bx.r - bx.l) * f, bx.b] : [bx.l + (bx.r - bx.l) * f, bx.t];
    };
    st.svg.setAttribute('viewBox', '0 0 ' + W0 + ' ' + H0);
    ends.forEach(function (e, i) {
      var p0 = pt(e[0], e[2], fr[i + '-0']), p1 = pt(e[1], e[3], fr[i + '-1']);
      // la flecha queda a 3 px del nodo de llegada
      p1[e[4] ? 0 : 1] += { r: 3, l: -3, b: 3, t: -3 }[e[3]];
      var m = e[4] ? (p1[0] - p0[0]) / 2 : (p1[1] - p0[1]) / 2, f = function (v) { return v.toFixed(1); };
      var d = 'M' + f(p0[0]) + ' ' + f(p0[1]) + 'C' + (e[4] ? f(p0[0] + m) + ' ' + f(p0[1]) + ' ' + f(p1[0] - m) + ' ' + f(p1[1]) : f(p0[0]) + ' ' + f(p0[1] + m) + ' ' + f(p1[0]) + ' ' + f(p1[1] - m)) + ' ' + f(p1[0]) + ' ' + f(p1[1]);
      st.bs[i].setAttribute('d', d); st.ls[i].setAttribute('d', d);
    });
  }

  // ---------- arcs: mapa del AMBA; arcos desde la central, un paquete por sede y sonar (≈ 4,5 s) ----------
  C.arcs = {
    t: 0.3,
    prep: function (st) {
      var svg = st.el.tagName.toLowerCase() === 'svg' ? st.el : st.el.querySelector('svg');
      var sites = arr(svg.querySelectorAll('.site[data-x]')), hub = svg.querySelector('.site.hub') || sites[0];
      var hx = +hub.getAttribute('data-x'), hy = +hub.getAttribute('data-y'), k = num(st.el, 'curve', 0.14), max = 1, s = '', list = [];
      sites.forEach(function (g) {
        if (g === hub) return;
        var x = +g.getAttribute('data-x'), y = +g.getAttribute('data-y'), dist = Math.hypot(x - hx, y - hy);
        max = Math.max(max, dist);
        // misma curva que los enlaces de "pasar la guardia" (sections.js), asi el cobre se dibuja encima
        list.push([x, y, dist, 'M' + hx + ' ' + hy + 'Q' + ((hx + x) / 2 + (y - hy) * k).toFixed(1) + ' ' + ((hy + y) / 2 - (x - hx) * k).toFixed(1) + ' ' + x + ' ' + y]);
      });
      list.forEach(function (a) {
        var dl = ' style="--dl:' + (a[2] / max * 0.9).toFixed(2) + 's" ';
        s += '<path class="fx-a" pathLength="1"' + dl + 'd="' + a[3] + '"/><path class="fx-k" pathLength="1"' + dl + 'd="' + a[3] + '"/><circle class="fx-ar"' + dl + 'cx="' + a[0] + '" cy="' + a[1] + '" r="5"/>';
      });
      s += '<circle class="fx-sn" cx="' + hx + '" cy="' + hy + '" r="9"/><circle class="fx-sn fx-sn2" cx="' + hx + '" cy="' + hy + '" r="9"/>';
      var g = D.createElementNS(NS, 'g');
      g.setAttribute('class', 'fx-arcs'); hide(g);
      g.innerHTML = s;
      svg.insertBefore(g, svg.querySelector('.links') || svg.querySelector('.sites'));
      st.g = g;
    },
    go: function (st) { st.g.classList.add('fx-go'); later(st, function () { emit(st.el, 'done', 'arcs'); }, 4600); },
    play: function (st) {
      if (reduced) return;
      if (!st.g.classList.contains('fx-go')) { C.arcs.go(st); return; }
      st.g.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); a.play(); });
    },
    fin: function (st) { st.g.classList.remove('fx-go'); }
  };

  // ---------- terminal: escribe los comandos y despues muestra cada linea (la transcripcion esta en el HTML) ----------
  C.terminal = {
    pre: 1, t: 0.35,
    prep: function (st) {
      var el = st.el;
      st.lines = arr(el.querySelectorAll(attr(el, 'lines', '[data-cmd], li'))).map(function (l) {
        var t = [];
        if (l.hasAttribute('data-cmd')) {
          var w = D.createTreeWalker(l, NodeFilter.SHOW_TEXT), n;
          while ((n = w.nextNode())) if (n.nodeValue.trim() && !n.parentNode.closest('.cursor')) t.push([n, n.nodeValue]);
        }
        return { l: l, t: t };
      });
      st.lines.forEach(function (x) { x.l.classList.add('fx-tl'); });
    },
    go: function (st) {
      var i = 0, speed = num(st.el, 'speed', 26);
      var next = function () {
        if (i >= st.lines.length) { finish(st); return; }
        var x = st.lines[i++];
        x.l.classList.add('fx-on');
        if (!x.t.length) { later(st, next, rnd(220, 380)); return; }
        var q = 0, c = 0, typing = !x.l.querySelector('.cursor');
        x.t.forEach(function (p) { p[0].nodeValue = ''; });
        if (typing) x.l.classList.add('fx-typing');
        (function type() {
          var p = x.t[q];
          if (!p) { x.l.classList.remove('fx-typing'); later(st, next, 320); return; }
          p[0].nodeValue = p[1].slice(0, ++c);
          if (c >= p[1].length) { q++; c = 0; }
          later(st, type, speed * rnd(0.6, 1.5));
        })();
      };
      next();
    },
    fin: function (st) {
      st.lines.forEach(function (x) { x.l.classList.add('fx-on'); x.l.classList.remove('fx-typing'); x.t.forEach(function (p) { p[0].nodeValue = p[1]; }); });
    }
  };

  // ---------- feed: avisos que llegan de a uno arriba (alto fijo, maximo 4, una vuelta) ----------
  // Sin saltos de diagramacion (CLS 0): los avisos van en posicion absoluta y se mueven solo con transform.
  C.feed = {
    pre: 1, t: 0.35,
    prep: function (st) {
      var el = st.el, items = arr(el.children), max = Math.min(num(el, 'max', 4), items.length);
      if (st.first) return; // ya estaba a la vista: queda la lista completa, sin cambiar el alto
      st.max = max; st.n = items.length;
      // se mide en el ResizeObserver (layout ya hecho): alto fijo para max avisos, alto de cada aviso, margenes
      onResize(el, function () {
        var cs = getComputedStyle(el);
        if (!st.items) {
          var R = el.getBoundingClientRect(), last = items[max - 1].getBoundingClientRect();
          st.H = Math.ceil(last.bottom - R.top + (parseFloat(cs.paddingBottom) || 0));
          el.style.height = st.H + 'px';
          st.gap = parseFloat(cs.rowGap) || 0;
          st.items = items;
          st.list = st.done ? items.slice(0, max) : [];
          st.hs = items.map(function (it) { return it.offsetHeight; });
          st.S = feedSum(st);
          ['Top', 'Left', 'Right'].forEach(function (k) { el.style.setProperty('--fx-p' + k[0], cs['padding' + k]); });
          el.classList.add('fx-feed', 'fx-now');
          items.forEach(function (it) { it.classList.toggle('fx-fi', st.list.indexOf(it) < 0); });
          feedPlace(st);
          requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove('fx-now'); }); });
          st.on = false; sync(st);
        } else {
          // cambio de ancho: se vuelven a medir los avisos visibles y el alto fijo acompaña
          st.hs = st.items.map(function (it, i) { return it.offsetHeight || st.hs[i]; });
          el.style.height = st.H + feedSum(st) - st.S + 'px';
          feedPlace(st);
        }
      });
      if (FINE.matches) {
        el.addEventListener('pointerenter', function () { st.hold = 1; sync(st); });
        el.addEventListener('pointerleave', function () { st.hold = 0; sync(st); });
      }
    },
    go: function (st) { st.go = 1; st.on = false; sync(st); },
    run: function (st, on) {
      clearTimeout(st.tm);
      if (on && st.go && st.items) st.tm = setTimeout(function () { feedStep(st); }, st.n === st.items.length ? 250 : num(st.el, 'interval', 1100));
    },
    fin: function (st) {
      if (!st.items) return;
      st.list = st.items.slice(0, st.max);
      st.items.forEach(function (it) { it.getAnimations().forEach(function (a) { a.cancel(); }); it.classList.toggle('fx-fi', st.list.indexOf(it) < 0); });
      feedPlace(st);
    }
  };
  function feedSum(st) { return st.hs.slice(0, st.max).reduce(function (a, b) { return a + b; }, 0); }
  function feedPlace(st) {
    var y = 0;
    st.list.forEach(function (it) { it.style.transform = 'translateY(' + y + 'px)'; y += st.hs[st.items.indexOf(it)] + st.gap; });
  }
  function feedStep(st) {
    var it = st.items[--st.n], l = st.list;
    l.unshift(it);
    it.classList.remove('fx-fi');
    it.animate([{ opacity: 0, transform: 'translateY(-12px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE, composite: 'add' });
    feedPlace(st);
    if (l.length > st.max) {
      var old = l.pop();
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).onfinish = function (e) { old.classList.add('fx-fi'); e.target.cancel(); };
    }
    if (st.n <= 0) finish(st); else { st.on = false; sync(st); }
  }

  // ---------- camera: paneo y zoom (Web Animations) sobre una captura, hacia sus marcas ----------
  var cams = new WeakMap();
  function camTarget(el) {
    if (el.querySelector(':scope > img')) return el;
    var on = el.querySelector('.shot.on') || arr(el.querySelectorAll('.shot')).filter(function (s) { return !s.hidden; })[0];
    return on || el;
  }
  function camera(el, o) {
    o = o || {};
    var t = camTarget(el), img = t.querySelector('img');
    var prev = cams.get(t);
    if (prev) prev.forEach(function (a) { a.cancel(); });
    cams.delete(t);
    if (!img || o.stop || reduced) return Promise.resolve(false);
    var pins = t.querySelector('.pins'), pinEls = pins ? arr(pins.querySelectorAll('.pin')) : [];
    var z0 = parseFloat(attr(t, 'cam', '').split(/\s+/)[2]) || 1.22, z = o.zoom || z0, pts = [];
    if (o.x != null) pts.push([o.x, o.y]);
    else if (t.getAttribute('data-cam')) { var c = t.getAttribute('data-cam').split(/\s+/).map(parseFloat); pts.push([c[0], c[1]]); }
    else if (pins) arr(pins.children).slice(0, o.max || 3).forEach(function (p) {
      var f = function (k) { return parseFloat(p.style[k]) / 100 || 0; };
      pts.push(p.classList.contains('box') ? [f('left') + f('width') / 2, f('top') + f('height') / 2] : [f('left'), f('top')]);
    });
    if (!pts.length) pts.push([0.5, 0.5]);
    var move = o.dur || 1300, hold = o.hold || 900, back = o.back !== false;
    var total = pts.length * (move + hold) + (back ? move : 0), at = 0, kf = [{ transform: 'none', offset: 0, easing: INOUT }], ks = [{ scale: 1, offset: 0, easing: INOUT }];
    var put = function (tr, sc, ms) { at += ms; var off = Math.min(1, at / total); kf.push({ transform: tr, offset: off, easing: INOUT }); ks.push({ scale: sc, offset: off, easing: INOUT }); };
    pts.forEach(function (p) {
      var tx = clamp(0.5 - z * p[0], 1 - z, 0) * 100, ty = clamp(0.5 - z * p[1], 1 - z, 0) * 100;
      var tr = 'translate(' + tx.toFixed(2) + '%,' + ty.toFixed(2) + '%) scale(' + z + ')';
      put(tr, 1 / z, move); put(tr, 1 / z, hold);
    });
    if (back) put('none', 1, move);
    var opt = { duration: total, fill: back ? 'none' : 'forwards' };
    var list = [img].concat(pins ? [pins] : []).map(function (n) { n.style.transformOrigin = '0 0'; return n.animate(kf, opt); });
    pinEls.forEach(function (p) { p.style.transformOrigin = '0 0'; list.push(p.animate(ks, opt)); });
    cams.set(t, list);
    return list[0].finished.then(function () { emit(t, 'camera-end', o); return true; }, function () { return false; });
  }
  C.camera = {
    t: 0.5,
    go: function (st) { if (st.el.hasAttribute('data-cam-auto')) camera(st.el); },
    play: function (st) { camera(st.el); },
    fin: function (st) { camera(st.el, { stop: true }); }
  };

  // ---------- spotlight: un barrido de luz lento detras del titulo (una vez) ----------
  C.spotlight = {
    t: 0,
    prep: function (st) { st.el.insertBefore(hide(mk('span', 'fx-sl')), st.el.firstChild); },
    go: function (st) { st.el.classList.add('fx-go'); },
    fin: function (st) { st.el.classList.add('fx-go'); }
  };
  C['spotlight-hero'] = C.spotlight;

  // ---------- API publica ----------
  function play(el) {
    (S.get(el) || []).forEach(function (st) {
      if (!st.ready || reduced) return;
      if (st.c.play) st.c.play(st); else if (st.c.go) st.c.go(st);
    });
  }
  function pause(on) {
    held = on;
    H.classList.toggle('fx-hold', on);
    all.forEach(sync);
  }
  D.addEventListener('fx:play', function (e) { play(e.target); });
  D.addEventListener('fx:camera', function (e) { camera(e.target, e.detail); });
  W.FX = {
    init: init,
    play: play,
    camera: camera,
    pause: function () { pause(true); },
    resume: function () { pause(false); }
  };
  // fx-ready recien cuando termino el primer init: si algo falla antes, el failsafe de fx.css muestra todo a los 3 s
  var start = function () { init(); H.classList.add('fx-ready'); };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
})();
