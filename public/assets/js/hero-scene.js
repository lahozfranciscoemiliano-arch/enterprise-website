/* Enterprise SOC: portada "Guardia nocturna sobre Buenos Aires".
   Desde el espacio hasta el AMBA: globo de noche con contornos reales (Natural Earth),
   ciudades reales, nubes con volumen y luz de luna, y la red de 12 sedes en Buenos Aires.
   Mundo en km, proyeccion ortografica centrada en CABA (la misma de geo-data.js).
   WebGL: suelo + luces + nubes (a media resolucion) | Canvas 2D: rotulos, mira, red, gotas. */
(function () {
  'use strict';

  // El mismo archivo corre en la pagina (WebGL) y como worker (texturas y luces, sin trabar la pagina).
  const IS_WORKER = typeof document === 'undefined' && typeof importScripts === 'function';
  const G = IS_WORKER ? self : window;
  const SELF_URL = !IS_WORKER && document.currentScript ? document.currentScript.src : '';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

  // ---------- Proyeccion (identica a _geo/build-geo.mjs) ----------
  const LAT0 = -34.6037, LON0 = -58.3816, RE = 6371, D2R = Math.PI / 180;
  const sinP0 = Math.sin(LAT0 * D2R), cosP0 = Math.cos(LAT0 * D2R);
  function proj(lat, lon) {
    const p = lat * D2R, dl = (lon - LON0) * D2R;
    return [RE * Math.cos(p) * Math.sin(dl), RE * (cosP0 * Math.sin(p) - sinP0 * Math.cos(p) * Math.cos(dl))];
  }

  // ---------- Camara ----------
  const H0 = 14000;                 // alto visible al empezar (km): el globo entero, con aire
  const HC = 1500, HC2 = 330;       // capa de nubes principal y jirones bajos
  const START = [5600, 900];        // centro inicial (km): la Tierra queda a la izquierda y el texto de la portada, a la derecha, sobre el espacio
  function ease(p) { return 0.5 - 0.5 * Math.cos(Math.PI * clamp(p, 0, 1)); }
  // Borde izquierdo del bloque de texto de la portada (px CSS).
  function textLeftPx(W) {
    const gutter = clamp(W * 0.05, 20, 72), bandW = Math.min(600, W - 2 * gutter);
    return W - gutter - bandW;
  }
  // Encuadre final: la red entera (Pilar a La Plata) a la izquierda del bloque de texto,
  // con lugar para los rotulos. Se aleja lo justo segun el ancho disponible.
  function endFrame(aspect, W) {
    W = W || 1440;
    const textLeft = textLeftPx(W) / W;
    const avail = Math.max(0.2, textLeft - 0.05 - 140 / W);
    const h = Math.max(112, 92 / (aspect * avail));
    const su = 0.025 + 64 / W + 50 / (h * aspect);
    return { h, su, sv: 0.47 };
  }
  // Encuadre por caja: la red entera (con lugar para los rotulos de los extremos) dentro de
  // fr.box = [x0, y0, x1, y1] (fraccion del lienzo). Lo usan el video y las pantallas verticales.
  const LBL_L = 64, LBL_R = 86, LBL_V = 14;   // PILAR a la izquierda, LA PLATA a la derecha
  function fitFrame(box, aspect, W) {
    const H = W / aspect;
    const aw = Math.max(40, (box[2] - box[0]) * W - LBL_L - LBL_R), ah = Math.max(40, (box[3] - box[1]) * H - 2 * LBL_V);
    const k = Math.min(aw / (NET[2] - NET[0]), ah / (NET[3] - NET[1]));     // px por km
    const cx = (box[0] * W + LBL_L + box[2] * W - LBL_R) / 2, cy = (box[1] + box[3]) / 2 * H;
    return { h: H / k, su: (cx - (NET[0] + NET[2]) / 2 * k) / W, sv: (cy + (NET[1] + NET[3]) / 2 * k) / H };
  }
  // Pantallas verticales sin encuadre propio: la red arriba (debajo de la barra) y la Tierra entera al empezar.
  function portraitFrame(aspect, W) {
    const H = W / aspect, top = 76 / H;
    return { box: [0.01, top, 0.99, Math.min(0.95, top + 0.6 * W / H)], start: [0.5, top + 0.3 * W / H] };
  }
  function frameFor(fr, aspect, W) {
    W = W || 1440;
    if (fr && fr.box) return fr;
    return aspect < 1 ? portraitFrame(aspect, W) : null;
  }
  function camera(p, aspect, W, fr) {
    const e = ease(p);
    fr = frameFor(fr, aspect, W);
    const end = fr ? fitFrame(fr.box, aspect, W || 1440) : endFrame(aspect, W);
    // en vertical el globo entero tiene que entrar a lo ancho
    const h0 = H0 * Math.max(1, 0.92 / aspect);
    const h = Math.exp(lerp(Math.log(h0), Math.log(end.h), e));
    // CABA recorre la pantalla en linea recta mientras la escala baja en forma logaritmica
    let s0u = 0.5 - START[0] / (H0 * aspect), s0v = 0.5 + START[1] / H0;
    if (fr && fr.start) { s0u = fr.start[0]; s0v = fr.start[1]; }
    else if (fr) { s0u = 0.5; s0v = (fr.box[1] + fr.box[3]) / 2; }
    const su = lerp(s0u, end.su, e), sv = lerp(s0v, end.sv, e);
    const rot = 0.16 * Math.pow(1 - e, 2.2);
    // centro de camara tal que CABA (0,0) caiga en (su, sv) con la rotacion aplicada
    const ox = (su - 0.5) * h * aspect, oy = -(sv - 0.5) * h;
    const c = Math.cos(rot), s = Math.sin(rot);
    const x = -(c * ox - s * oy), y = -(s * ox + c * oy);
    return { x, y, h, e, rot };
  }

  // ---------- Datos: sedes (AMBA real) y ciudades ----------
  const HUB = { name: 'CABA', label: 'CENTRAL · CABA', ll: [-34.6037, -58.3816] };
  const SEDES = [
    ['TIGRE', -34.4260, -58.5796], ['SAN ISIDRO', -34.4708, -58.5276], ['ESCOBAR', -34.3487, -58.7969],
    ['PILAR', -34.4587, -58.9139], ['MORENO', -34.6503, -58.7896], ['MORÓN', -34.6534, -58.6195],
    ['SAN JUSTO', -34.6828, -58.5634], ['EZEIZA', -34.8546, -58.5244], ['LOMAS', -34.7600, -58.3988],
    ['QUILMES', -34.7206, -58.2546], ['LA PLATA', -34.9214, -57.9545],
  ].map(([name, lat, lon]) => ({ name, w: proj(lat, lon) }));
  // caja de la red en km [x0, y0, x1, y1] (con la central)
  const NET = SEDES.reduce((b, s) => [Math.min(b[0], s.w[0]), Math.min(b[1], s.w[1]), Math.max(b[2], s.w[0]), Math.max(b[3], s.w[1])], [0, 0, 0, 0]);

  // [lat, lon, poblacion en miles]
  const CITIES = [
    [-31.42, -64.19, 1500], [-32.95, -60.65, 1300], [-32.89, -68.84, 1100], [-26.82, -65.22, 900], [-38.00, -57.56, 650],
    [-24.78, -65.41, 600], [-31.63, -60.70, 500], [-31.54, -68.53, 500], [-27.46, -58.98, 400], [-27.79, -64.26, 400],
    [-27.47, -58.83, 350], [-27.37, -55.90, 350], [-38.95, -68.06, 350], [-38.72, -62.27, 300], [-24.19, -65.30, 300],
    [-31.73, -60.53, 270], [-26.18, -58.17, 230], [-33.30, -66.34, 200], [-33.12, -64.35, 160], [-45.86, -67.48, 180],
    [-28.47, -65.78, 170], [-29.41, -66.86, 180], [-31.39, -58.02, 150], [-34.62, -68.33, 120], [-36.62, -64.29, 110],
    [-37.32, -59.13, 120], [-41.13, -71.31, 110], [-43.25, -65.31, 100], [-42.77, -65.04, 90], [-51.62, -69.22, 100],
    [-54.80, -68.30, 80], [-40.81, -63.00, 60], [-32.41, -63.24, 80], [-31.25, -61.49, 100], [-33.33, -60.22, 130],
    [-33.89, -60.57, 100], [-34.59, -60.95, 90], [-36.89, -60.32, 90], [-38.55, -58.74, 90], [-34.57, -59.11, 100],
    [-34.10, -59.03, 200], [-33.01, -58.52, 110], [-32.48, -58.24, 75], [-33.75, -61.97, 80], [-53.79, -67.70, 90],
    [-46.44, -67.53, 70], [-36.78, -59.86, 60], [-34.90, -60.02, 60],
    // vecinos
    [-34.90, -56.16, 1400], [-34.47, -57.84, 30], [-34.91, -54.95, 90], [-31.38, -57.96, 100], [-32.32, -58.08, 80],
    [-33.45, -70.67, 6500], [-33.05, -71.62, 900], [-36.83, -73.05, 950], [-38.74, -72.60, 300], [-41.47, -72.94, 250],
    [-29.90, -71.25, 450], [-23.65, -70.40, 400], [-34.17, -70.74, 250], [-35.43, -71.66, 220], [-53.16, -70.91, 130],
    [-25.26, -57.58, 2200], [-25.51, -54.61, 300], [-30.03, -51.23, 4000], [-31.77, -52.34, 350], [-27.60, -48.55, 1000],
    [-25.43, -49.27, 3500], [-23.55, -46.63, 21000], [-22.91, -43.17, 12000], [-29.68, -53.81, 280], [-29.17, -51.18, 500],
    [-26.30, -48.85, 600], [-19.92, -43.94, 6000], [-15.79, -47.88, 4500], [-20.47, -54.62, 900], [-15.60, -56.10, 900],
    [-17.78, -63.18, 1700], [-16.50, -68.15, 1900], [-17.39, -66.16, 1200], [-21.53, -64.73, 250], [-12.05, -77.04, 10000],
    [-22.88, -47.06, 3000], [-21.18, -47.81, 700], [-20.82, -49.38, 450], [-22.32, -49.07, 400], [-23.31, -51.16, 600],
  ];
  // Rutas nacionales (tramos aproximados entre ciudades), para los hilos de luz a media altura
  const ROUTES = [
    [[-34.60, -58.38], [-34.10, -59.03], [-33.33, -60.22], [-32.95, -60.65], [-32.41, -63.24], [-31.42, -64.19]],
    [[-34.60, -58.38], [-34.59, -60.95], [-34.62, -64.29], [-33.30, -66.34], [-32.89, -68.84], [-33.45, -70.67]],
    [[-34.60, -58.38], [-35.58, -58.02], [-36.95, -57.75], [-38.00, -57.56]],
    [[-34.60, -58.38], [-36.78, -59.86], [-38.72, -62.27], [-40.81, -63.00], [-42.77, -65.04], [-45.86, -67.48]],
    [[-32.95, -60.65], [-31.63, -60.70], [-29.15, -59.65], [-27.46, -58.98], [-26.18, -58.17], [-25.26, -57.58]],
    [[-31.42, -64.19], [-29.41, -66.86], [-28.47, -65.78], [-26.82, -65.22], [-24.78, -65.41], [-24.19, -65.30]],
    [[-34.60, -58.38], [-33.01, -58.52], [-31.39, -58.02], [-29.76, -57.09], [-27.37, -55.90]],
    [[-38.95, -68.06], [-38.72, -62.27]], [[-38.95, -68.06], [-41.13, -71.31]],
    [[-34.90, -56.16], [-34.47, -57.84]], [[-34.90, -56.16], [-34.91, -54.95]],
  ];
  // Corredores del AMBA (autopistas y avenidas troncales reales, trazado aproximado)
  const CORRIDORS = [
    [[-34.6037, -58.3816], [-34.545, -58.47], [-34.505, -58.50], [-34.470, -58.528], [-34.426, -58.580]],
    [[-34.545, -58.47], [-34.490, -58.600], [-34.430, -58.690], [-34.349, -58.797]],
    [[-34.490, -58.600], [-34.480, -58.730], [-34.459, -58.914]],
    [[-34.6037, -58.3816], [-34.640, -58.540], [-34.653, -58.620], [-34.665, -58.730], [-34.650, -58.790], [-34.570, -59.110]],
    [[-34.6037, -58.3816], [-34.682, -58.563], [-34.770, -58.630], [-34.850, -58.680]],
    [[-34.6037, -58.3816], [-34.720, -58.490], [-34.855, -58.524], [-34.920, -58.530]],
    [[-34.6037, -58.3816], [-34.660, -58.370], [-34.700, -58.390], [-34.760, -58.399], [-34.860, -58.380], [-34.890, -58.380]],
    [[-34.660, -58.370], [-34.721, -58.255], [-34.760, -58.210], [-34.810, -58.150], [-34.870, -58.050], [-34.921, -57.955]],
    [[-34.570, -58.540], [-34.540, -58.710], [-34.520, -58.770]],
    // General Paz (limite de CABA) y Camino de Cintura
    [[-34.538, -58.464], [-34.560, -58.500], [-34.590, -58.530], [-34.620, -58.530], [-34.640, -58.528], [-34.660, -58.505], [-34.690, -58.470], [-34.705, -58.460]],
    [[-34.470, -58.528], [-34.540, -58.650], [-34.650, -58.680], [-34.760, -58.600], [-34.800, -58.450], [-34.780, -58.300]],
  ].map((pl) => pl.map(([la, lo]) => proj(la, lo)));

  // ---------- Texturas de tierra (rasterizadas desde geo-data.js) ----------
  // R: tierra  G: Argentina (con Malvinas)  B: Chile difuminado (zona de los Andes)
  const LEVELS = [
    { name: 'far', box: [-6450, -6450, 6450, 6450], size: [1024, 1024] },
    { name: 'mid', box: [-2600, -2700, 1700, 1500], size: [1536, 1500] },
    { name: 'reg', box: [-680, -620, 640, 600], size: [1536, 1420] },
    { name: 'near', box: [-190, -170, 200, 170], size: [2048, 1786] },
  ];
  const RIVERS = [
    [[-31.70, -60.62], [-32.40, -60.75], [-32.95, -60.63], [-33.33, -60.20], [-33.68, -59.65], [-34.08, -59.00], [-34.25, -58.82], [-34.35, -58.62]],
    [[-31.38, -57.97], [-31.80, -58.05], [-32.48, -58.20], [-33.05, -58.33], [-33.65, -58.42], [-34.00, -58.40]],
  ];
  function geoRings(levelName) {
    const L = G.GEO && (levelName === 'reg' ? G.GEO.mid : G.GEO[levelName === 'mid' ? 'mid' : levelName]);
    if (!L) return [];
    return L.rings.map(([tag, flat]) => {
      const pts = []; let x = 0, y = 0;
      for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; pts.push([x / L.q, y / L.q]); }
      return { tag, pts };
    });
  }
  function rasterize(level) {
    const [W, H] = level.size, [x0, y0, x1, y1] = level.box;
    const sx = W / (x1 - x0), sy = H / (y1 - y0);
    const mk = () => { const c = IS_WORKER ? new OffscreenCanvas(W, H) : document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d', { willReadFrequently: true }); return c; };
    const draw = (ctx, rings, pick, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const r of rings) {
        if (!pick(r)) continue;
        r.pts.forEach(([x, y], i) => { const px = (x - x0) * sx, py = (y1 - y) * sy; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.closePath();
      }
      ctx.fill();
    };
    const rings = geoRings(level.name);
    const land = mk(), lc = land.getContext('2d');
    draw(lc, rings, (r) => !r.tag.endsWith('h'), '#fff');
    draw(lc, rings, (r) => r.tag.endsWith('h'), '#000');
    // rios Parana y Uruguay como agua (solo se notan de cerca)
    if (level.name !== 'far') {
      lc.strokeStyle = '#000'; lc.lineCap = 'round'; lc.lineJoin = 'round';
      lc.lineWidth = Math.max(1, 1.6 * sx);
      for (const rv of RIVERS) {
        lc.beginPath();
        rv.forEach(([la, lo], i) => { const [x, y] = proj(la, lo); const px = (x - x0) * sx, py = (y1 - y) * sy; i ? lc.lineTo(px, py) : lc.moveTo(px, py); });
        lc.stroke();
      }
    }
    const arg = mk(), ac = arg.getContext('2d');
    draw(ac, rings, (r) => r.tag[0] === 'A' && !r.tag.endsWith('h'), '#fff');
    const chi = mk(), cc = chi.getContext('2d');
    if (level.name === 'far' || level.name === 'mid') {
      cc.filter = `blur(${Math.max(2, 70 * sx)}px)`;
      draw(cc, rings, (r) => r.tag[0] === 'C', '#fff');
    }
    // suavizado de bordes: la tierra con 1.2 px, Argentina un poco mas (para el contorno luminoso)
    const out = mk(), oc = out.getContext('2d');
    oc.filter = 'blur(1.2px)'; oc.drawImage(land, 0, 0);
    const R = oc.getImageData(0, 0, W, H).data;
    oc.filter = 'none'; oc.clearRect(0, 0, W, H); oc.filter = 'blur(1.6px)'; oc.drawImage(arg, 0, 0);
    const G = oc.getImageData(0, 0, W, H).data;
    const B = (level.name === 'far' || level.name === 'mid') ? cc.getImageData(0, 0, W, H).data : null;
    const px = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { px[i * 4] = R[i * 4]; px[i * 4 + 1] = G[i * 4]; px[i * 4 + 2] = B ? B[i * 4] : 0; px[i * 4 + 3] = 255; }
    return { W, H, px, landData: R };
  }

  // ---------- Luces: AMBA, ciudades, rutas ----------
  function distToPolyline(x, y, pl) {
    let best = 1e9, along = 0, acc = 0;
    for (let i = 1; i < pl.length; i++) {
      const [ax, ay] = pl[i - 1], [bx, by] = pl[i];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      const seg = Math.sqrt(L2);
      if (d < best) { best = d; along = acc + t * seg; }
      acc += seg;
    }
    return [best, along];
  }

  function buildLights(nearLand) {
    const r = rng(20261003);
    const pos = [], col = [], sb = [], ph = [];
    const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += r(); return (u - 2) / 2; };
    const sodium = () => [1.0, lerp(0.62, 0.78, r()), lerp(0.3, 0.46, r())];
    const led = () => [lerp(0.82, 0.95, r()), lerp(0.88, 0.96, r()), 1.0];
    const add = (x, y, size, b, c) => { pos.push(x, y); col.push(...c); sb.push(size, b); ph.push(r()); };
    const nb = LEVELS[3].box, [nW, nH] = LEVELS[3].size;
    const isLand = (x, y) => {
      if (!nearLand || x < nb[0] || x > nb[2] || y < nb[1] || y > nb[3]) return true;
      const px = Math.floor((x - nb[0]) / (nb[2] - nb[0]) * nW), py = Math.floor((nb[3] - y) / (nb[3] - nb[1]) * nH);
      return nearLand[(py * nW + px) * 4] > 128;
    };

    // AMBA: densidad que cae desde CABA y se estira por los corredores
    const blobs = [[proj(-34.9214, -57.9545), 7, 0.9], [proj(-34.57, -59.11), 3, 0.7], [proj(-34.4587, -58.9139), 4, 0.75], [proj(-34.3487, -58.7969), 3.5, 0.7], [proj(-34.426, -58.5796), 4, 0.8]];
    const step = 0.3;
    for (let gx = -62; gx < 52; gx += step) {
      for (let gy = -48; gy < 34; gy += step) {
        const x = gx + (r() - 0.5) * step, y = gy + (r() - 0.5) * step;
        const rr = Math.hypot(x, y);
        let d = 1.05 * (1 - smooth(9, 26, rr));
        for (const pl of CORRIDORS) { const [dd, s] = distToPolyline(x, y, pl); d += 0.7 * Math.exp(-((dd / 3.2) ** 2)) * Math.exp(-s / 80); }
        for (const [[bx, by], br, bk] of blobs) { const q = Math.hypot(x - bx, y - by); d += bk * Math.exp(-((q / br) ** 2)); }
        d = Math.min(1, d) * (0.82 + 0.36 * r());
        if (r() > d * 0.92 || d < 0.04) continue;
        if (!isLand(x, y)) continue;
        const core = rr < 9;
        add(x, y, lerp(0.15, 0.24, r()), lerp(0.38, 0.95, r()) * (core ? 1 : 0.85), core && r() < 0.45 ? led() : sodium());
      }
    }
    // autopistas: hilos de luz mas brillantes
    for (const pl of CORRIDORS) {
      for (let i = 1; i < pl.length; i++) {
        const [ax, ay] = pl[i - 1], [bx, by] = pl[i];
        const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 0.14);
        for (let k = 0; k < n; k++) {
          const t = k / n, x = ax + (bx - ax) * t + gauss() * 0.03, y = ay + (by - ay) * t + gauss() * 0.03;
          if (isLand(x, y)) add(x, y, 0.15, lerp(0.45, 0.75, r()), r() < 0.5 ? led() : [1, 0.8, 0.5]);
        }
      }
    }
    // Colonia del Sacramento, enfrente
    const col0 = proj(-34.4711, -57.8442);
    for (let i = 0; i < 260; i++) { const x = col0[0] + gauss() * 1.6, y = col0[1] + gauss() * 1.2; if (isLand(x, y)) add(x, y, 0.16, lerp(0.4, 0.9, r()), sodium()); }

    // ciudades
    const halos = [[0, 0, 26, 1.0]];
    for (const [la, lo, pop] of CITIES) {
      const [cx, cy] = proj(la, lo);
      if (Math.hypot(cx, cy) > RE * 0.995) continue;
      const rad = 0.9 * Math.pow(pop, 0.4);
      const n = Math.round(clamp(Math.pow(pop, 0.78) * 2.4, 30, 3200));
      const arms = 3 + Math.floor(r() * 4), armA = r() * Math.PI;
      for (let i = 0; i < n; i++) {
        let x, y;
        if (r() < 0.35) { const a = armA + Math.floor(r() * arms) * Math.PI / arms, t = gauss() * rad * 1.3; x = cx + Math.cos(a) * t + gauss() * rad * 0.06; y = cy + Math.sin(a) * t + gauss() * rad * 0.06; }
        else { const a = r() * Math.PI * 2, t = Math.abs(gauss()) * rad * 0.8; x = cx + Math.cos(a) * t; y = cy + Math.sin(a) * t; }
        add(x, y, lerp(0.2, 0.34, r()) * Math.sqrt(rad / 8), lerp(0.3, 0.8, r()), r() < 0.3 ? led() : sodium());
      }
      if (halos.length < 24 && pop >= 250) halos.push([cx, cy, rad * 1.9, clamp(Math.log10(pop) / 4, 0.3, 1)]);
    }
    // rutas nacionales
    for (const route of ROUTES) {
      const pts = route.map(([la, lo]) => proj(la, lo));
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 2.2);
        for (let k = 1; k < n; k++) { const t = k / n; add(ax + (bx - ax) * t + gauss() * 0.4, ay + (by - ay) * t + gauss() * 0.4, 0.3, lerp(0.15, 0.4, r()), sodium()); }
      }
    }
    return { pos: new Float32Array(pos), col: new Float32Array(col), sb: new Float32Array(sb), ph: new Float32Array(ph), count: pos.length / 2, halos };
  }

  // ---------- Shaders ----------
  const VS_QUAD = `attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;
  const COMMON = `precision highp float;
  varying vec2 vUv;
  uniform vec2 uRes;uniform vec2 uCam;uniform float uViewH;uniform float uRot;uniform float uTime;
  vec2 worldAt(vec2 uv,float h){float a=uRes.x/uRes.y;vec2 o=(uv-.5)*vec2(h*a,h);float c=cos(uRot),s=sin(uRot);return uCam+vec2(c*o.x-s*o.y,s*o.x+c*o.y);}
  vec2 hash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.+2.*fract(sin(p)*43758.5453);}
  float hash1(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  float gnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*f*(f*(f*6.-15.)+10.);
    return mix(mix(dot(hash2(i),f),dot(hash2(i+vec2(1.,0.)),f-vec2(1.,0.)),u.x),mix(dot(hash2(i+vec2(0.,1.)),f-vec2(0.,1.)),dot(hash2(i+vec2(1.,1.)),f-vec2(1.,1.)),u.x),u.y);}
  // fbm con nivel de detalle: las octavas mas chicas que un pixel se desvanecen y se cortan
  float fbmL(vec2 q,float pix,int oct){float v=0.,a=.5,f=1.;mat2 m=mat2(.8,.6,-.6,.8);
    for(int i=0;i<12;i++){if(i>=oct)break;float fade=1.-smoothstep(.25,.55,f*pix);if(fade<=0.)break;v+=a*fade*gnoise(q);q=m*q*2.03+vec2(1.7,9.2);f*=2.03;a*=.5;}return v;}
  `;

  const FS_GROUND = COMMON + `
  uniform sampler2D uT0,uT1,uT2,uT3;uniform vec4 uB0,uB1,uB2,uB3;uniform vec4 uLW;
  uniform vec4 uHalo[24];uniform float uArg;
  vec2 tuv(vec2 w,vec4 b){return vec2((w.x-b.x)/(b.z-b.x),(b.w-w.y)/(b.w-b.y));}
  float inBox(vec2 t){vec2 e=smoothstep(0.,.02,t)*smoothstep(1.,.98,t);return e.x*e.y;}
  vec4 landAt(vec2 w){
    vec4 v=texture2D(uT0,tuv(w,uB0));
    vec2 t;
    t=tuv(w,uB1);v=mix(v,texture2D(uT1,t),inBox(t)*uLW.y);
    t=tuv(w,uB2);v=mix(v,texture2D(uT2,t),inBox(t)*uLW.z);
    t=tuv(w,uB3);v=mix(v,texture2D(uT3,t),inBox(t)*uLW.w);
    return v;
  }
  void main(){
    vec2 w=worldAt(vUv,uViewH);
    float pix=uViewH/uRes.y;
    float dc=length(w);
    // espacio: estrellas y atmosfera
    if(dc>6371.){
      vec2 sp=floor(vUv*uRes/1.6);
      float st=step(.9972,hash1(sp))*(.35+.65*hash1(sp+3.1));
      st*=.75+.25*sin(uTime*(1.+3.*hash1(sp+7.))+hash1(sp)*30.);
      float glow=exp(-(dc-6371.)/140.)*.55;
      vec3 col=vec3(.006,.01,.022)+vec3(.85,.9,1.)*st*.8+vec3(.16,.32,.62)*glow;
      gl_FragColor=vec4(col,1.);return;
    }
    vec4 L=landAt(w);
    float det=fbmL(w/18.,pix/18.,7)*.5+fbmL(w/2.2,pix/2.2,5)*.25;
    float land=smoothstep(.5-.08,.5+.08,L.r+det*.35*smoothstep(.02,.98,L.r)*(1.-smoothstep(.02,.98,L.r))*4.);
    // mar: azul profundo, oleaje y destello de luna
    vec2 glintC=vec2(1300.,-1150.);
    float g=exp(-dot(w-glintC,w-glintC)/(900.*900.));
    float swell=fbmL(w/6.+vec2(uTime*.02,0.),pix/6.,6);
    vec3 sea=vec3(.007,.019,.044)+vec3(.01,.018,.03)*swell;
    float spark=pow(max(0.,gnoise(w/.9+vec2(uTime*.4,uTime*.25))),6.)*smoothstep(.0,.3,g+.15)*(1.-smoothstep(.5,2.,pix));
    sea+=vec3(.18,.24,.34)*g*(.6+.4*swell)+vec3(.7,.78,.9)*spark*.6;
    // tierra de noche, con relieve suave y nieve de luna en los Andes
    float rel=fbmL(w/60.,pix/60.,8);
    float moon=smoothstep(500.,5000.,uViewH);
    vec3 ground=mix(vec3(.03,.04,.052),vec3(.07,.08,.094),.5+rel)+vec3(.035,.04,.05)*moon;
    float lat=-34.6+w.y/111.;
    float andes=smoothstep(.06,.55,L.b)*smoothstep(.0,.3,L.g+L.b);
    float snow=smoothstep(-.15,.45,gnoise(w/140.)+.5*gnoise(w/45.))*smoothstep(-21.,-29.,lat);
    float ice=smoothstep(-45.5,-48.,lat)*smoothstep(-52.,-50.,lat);
    ground+=vec3(.36,.4,.48)*andes*(snow*.16+ice*.22);
    vec3 col=mix(sea,ground,land);
    // costa iluminada por la luna
    float edge=1.-abs(L.r-.5)*2.;
    col+=vec3(.25,.31,.42)*smoothstep(.55,1.,edge)*(.15+.25*smoothstep(400.,40.,pix*900.));
    // contorno de Argentina (lejos), muy sutil
    float ag=1.-abs(L.g-.5)*2.;
    col+=vec3(.95,.56,.3)*smoothstep(.5,1.,ag)*uArg*.22;
    // resplandor de las ciudades sobre el suelo y el aire
    vec3 glow=vec3(0.);
    for(int i=0;i<24;i++){vec4 h=uHalo[i];if(h.z<=0.)continue;vec2 q=w-h.xy;glow+=vec3(1.,.58,.26)*h.w*exp(-dot(q,q)/(h.z*h.z));}
    col+=glow*mix(.05,.12,land);
    // borde del globo: oscurecimiento y bruma azul
    float limb=smoothstep(4800.,6371.,dc);
    col=mix(col,vec3(.07,.14,.28),limb*.55);
    gl_FragColor=vec4(col,1.);
  }`;

  const VS_LIGHTS = `precision highp float;
  attribute vec2 aPos;attribute vec3 aCol;attribute vec2 aSB;attribute float aPh;
  uniform vec2 uCam;uniform float uViewH;uniform float uRot;uniform vec2 uRes;uniform float uTime;uniform float uGain;uniform float uMaxPt;
  varying vec3 vCol;varying float vB;
  void main(){
    float aspect=uRes.x/uRes.y;
    vec2 o=aPos-uCam;float c=cos(-uRot),s=sin(-uRot);o=vec2(c*o.x-s*o.y,s*o.x+c*o.y);
    gl_Position=vec4(o/(vec2(uViewH*aspect,uViewH)*.5),0.,1.);
    float px=aSB.x*uRes.y/uViewH;
    float size=max(px,1.25);
    gl_PointSize=min(size*3.,uMaxPt);
    float energy=min(1.,(px*px)/(1.25*1.25));
    float tw=.9+.1*sin(uTime*(.6+aPh*1.9)+aPh*40.);
    vB=aSB.y*tw*max(energy,.006)*uGain;
    vCol=aCol;
  }`;
  const FS_LIGHTS = `precision mediump float;varying vec3 vCol;varying float vB;
  void main(){float d=length(gl_PointCoord-.5)*2.;float a=(smoothstep(.36,0.,d)+exp(-d*d*5.)*.4)*vB;gl_FragColor=vec4(vCol*a,a);}`;

  const FS_CLOUDS = COMMON + `
  uniform float uH;uniform vec4 uHalo[24];
  float gGlow;
  float coverage(vec2 w){
    // sistemas de nubes: frente sobre la Patagonia y el Pacifico, nubes sueltas sobre la pampa
    float big=gnoise(w/2600.+vec2(3.,1.))*.5+gnoise(w/1100.+vec2(7.,2.))*.3;
    float front=exp(-pow((w.y+1700.+w.x*.45)/520.,2.))*.35;
    float ba=exp(-dot(w,w)/(140.*140.));
    return big+front-ba*.05;
  }
  vec4 slab(float hc,float cov,float amax,float sc,vec2 off){
    float rel=uH-hc;
    if(rel<=.5)return vec4(0.);
    vec2 w=worldAt(vUv,rel)+off+vec2(uTime*.9,uTime*.35);
    float pix=rel/uRes.y;
    vec2 q=w/sc;
    vec2 wq=q+.55*vec2(fbmL(q*.5,pix/sc*.5,4),fbmL(q*.5+vec2(5.2,1.3),pix/sc*.5,4));
    float n=fbmL(wq,pix/sc,11);
    float fill=1.-smoothstep(0.,hc*.45,rel);
    float lo=cov-coverage(w)*.45-.35*fill;
    float d=smoothstep(lo,lo+.28,n);
    // luz de luna desde el noroeste: lado iluminado mas claro, base mas oscura
    vec2 ld=normalize(vec2(-.6,.8));
    float n2=fbmL(wq+ld*.06,pix/sc,4);
    float lit=clamp(.55+(n2-n)*-9.,0.,1.);
    vec3 col=mix(vec3(.11,.135,.19),vec3(.53,.59,.7),clamp(lit*.75+d*.25,0.,1.));
    // nubes iluminadas desde abajo por las ciudades (resplandor calculado una vez por pixel)
    col+=vec3(1.,.55,.25)*gGlow*.35*(1.-lit*.5);
    float a=d*amax*smoothstep(0.,hc*.02,rel);
    float aspect=uRes.x/uRes.y;
    float wisp=.5+fbmL((vUv-.5)*vec2(aspect,1.)*(1.6+5.*fill)+off*.001+vec2(uTime*.06,log(uH)*2.5),.003,5)*1.6;
    a=mix(a,amax*clamp(wisp,.15,1.),fill*fill*.92);
    col*=mix(1.,.8+.4*wisp,fill);
    return vec4(col*a,a);
  }
  void main(){
    vec4 c=vec4(0.);
    float hc=${HC.toFixed(1)};
    vec2 wg=worldAt(vUv,max(uH-hc,1.));
    gGlow=0.;
    for(int i=0;i<24;i++){vec4 h=uHalo[i];if(h.z<=0.)continue;vec2 qq=wg-h.xy;gGlow+=h.w*exp(-dot(qq,qq)/(h.z*h.z*2.5));}
    // de adelante hacia atras: si una capa ya tapa todo, las de abajo no se calculan
    if(uH>hc*.82){
      c=slab(hc*1.16,.12,.88,1150.,vec2(0.));
      if(c.a<.97){vec4 s=slab(hc*1.05,.16,.62,950.,vec2(70.,-230.));c+=s*(1.-c.a);}
      if(uH<hc*2.5){
        if(c.a<.97){vec4 s=slab(hc*.95,.18,.6,820.,vec2(-120.,190.));c+=s*(1.-c.a);}
        if(c.a<.97){vec4 s=slab(hc*.86,.2,.55,700.,vec2(310.,40.));c+=s*(1.-c.a);}
      }
    }
    if(uH>${HC2.toFixed(1)}*.9){vec4 s=slab(${HC2.toFixed(1)},.34,.42,150.,vec2(17.,-9.));c=c+s*(1.-c.a);}
    float lr=log(uH/hc);
    float fog=exp(-pow(lr/.16,2.))*.62+exp(-pow(log(uH/${HC2.toFixed(1)})/.12,2.))*.14;
    fog*=.45+1.1*(.5+fbmL((vUv-.5)*vec2(uRes.x/uRes.y,1.)*2.2+vec2(uTime*.05,log(uH)*3.),.004,5));
    vec3 fogCol=vec3(.2,.25,.34);
    gl_FragColor=vec4(fogCol*fog+c.rgb*(1.-fog),fog+c.a*(1.-fog));
  }`;

  const FS_COPY = `precision mediump float;varying vec2 vUv;uniform sampler2D uTex;void main(){gl_FragColor=texture2D(uTex,vUv);}`;

  // ---------- Utilidades GL ----------
  function startProgram(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    return { p, v, f };
  }
  function finishProgram(gl, prog) {
    const { p, v, f } = prog;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getShaderInfoLog(v) || gl.getShaderInfoLog(f) || gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  // ---------- Gotas en el lente ----------
  const DROPS = (() => { const r = rng(99); return Array.from({ length: 14 }, () => ({ x: 0.45 + r() * 0.55, y: r() * 0.85, rad: lerp(3, 11, r()), slide: lerp(20, 90, r()), t0: lerp(0.4, 0.46, r()) })); })();

  // ---------- Escena ----------
  // create(canvasGL, canvas2D, onReady, onFail, opts): los shaders y las texturas se preparan
  // en segundo plano; render() no dibuja hasta que todo esta listo.
  function create(glCanvas, overlay, onReady, onFail, opts) {
    const gl = glCanvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl || !G.GEO) return null;
    const ctx = overlay.getContext('2d');
    const onlyNear = !!(opts && opts.onlyNear);
    const inset = (opts && opts.bottomInset) || 0;
    // opts.frame = { box: [x0, y0, x1, y1], start: [u, v] } (fracciones): encuadre fijo para el video.
    // opts.caption = false: sin el rotulo "EJEMPLO" pintado (la pagina lo pone como texto).
    const frame = (opts && opts.frame) || null;
    const caption = !(opts && opts.caption === false);

    const par = gl.getExtension('KHR_parallel_shader_compile');
    const pending = [startProgram(gl, VS_QUAD, FS_GROUND), startProgram(gl, VS_QUAD, FS_CLOUDS), startProgram(gl, VS_LIGHTS, FS_LIGHTS), startProgram(gl, VS_QUAD, FS_COPY)];
    let ground, clouds, lights, copy, ready = false;
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;

    // texturas: se rasterizan de a una, entre cuadros, para no congelar la pagina
    const texs = [], boxes = [];
    let world = null, bufs = null, halos = new Float32Array(96);
    const order = [3, 0, 1, 2];
    let built = 0, full = false, building = false, wantFull = !onlyNear;
    function makeTex(data) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, data.W, data.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.px);
      return t;
    }
    const blank = makeTex({ W: 1, H: 1, px: new Uint8Array([0, 0, 0, 255]) });
    for (let i = 0; i < 4; i++) { texs[i] = blank; boxes[i] = LEVELS[i].box; }
    let nearLand = null;
    function buildNext() {
      building = true;
      if (built >= order.length) { building = false; full = true; if (ready) onReady && onReady(true); return; }
      if (built >= 1 && !wantFull) { building = false; return; }
      const li = order[built];
      const lv = LEVELS[li];
      if (Math.max(...lv.size) > maxTex) lv.size = lv.size.map((s) => Math.floor(s * maxTex / Math.max(...lv.size)));
      const data = rasterize(lv);
      texs[li] = makeTex(data);
      built++;
      if (li === 3) { nearLand = data.px; buildWorld(); }
      setTimeout(() => { try { buildNext(); } catch (e) { onFail && onFail(e); } }, 0);
    }
    function ensureFull() { wantFull = true; if (worker) return; if (!building && !full) buildNext(); }
    function buildWorld() { setWorld(buildLights(nearLand)); }
    function setWorld(w) {
      world = w;
      world.halos.slice(0, 24).forEach((h, i) => halos.set(h, i * 4));
      const buf = (d) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); return b; };
      bufs = { pos: buf(world.pos), col: buf(world.col), sb: buf(world.sb), ph: buf(world.ph) };
      waitShaders();
    }
    function waitShaders() {
      if (par && !pending.every((pr) => gl.getProgramParameter(pr.p, par.COMPLETION_STATUS_KHR))) { setTimeout(waitShaders, 40); return; }
      try {
        [ground, clouds, lights, copy] = pending.map((pr) => finishProgram(gl, pr));
        ready = true;
        onReady && onReady(full);
      } catch (e) { onFail && onFail(e); }
    }
    let worker = null;
    function mainThread() { if (worker) { worker.terminate(); worker = null; } built = 0; setTimeout(() => { try { buildNext(); } catch (e) { onFail && onFail(e); } }, 0); }
    function startWorker() {
      const geoEl = document.querySelector('script[src*="geo-data"]');
      if (!SELF_URL || !geoEl || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
      try { worker = new Worker(SELF_URL); } catch (e) { worker = null; return false; }
      const sizes = LEVELS.map((lv) => { const m = Math.max(...lv.size); return m > maxTex ? lv.size.map((v) => Math.floor(v * maxTex / m)) : lv.size; });
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'tex') { texs[d.i] = makeTex(d); built++; if (built >= order.length) { full = true; worker.terminate(); worker = null; if (ready) onReady && onReady(true); } }
        else if (d.type === 'world') setWorld(d);
        else if (d.type === 'error') mainThread();
      };
      worker.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); mainThread(); };
      worker.postMessage({ type: 'build', geo: geoEl.src, order, sizes });
      return true;
    }
    if (!startWorker()) mainThread();

    // framebuffer a media resolucion para las nubes (son suaves: no se nota y rinde el doble)
    let fbo = null, fboTex = null, fW = 0, fH = 0;
    function ensureFbo() {
      const w = Math.max(2, Math.round(W * 0.5)), h = Math.max(2, Math.round(H * 0.5));
      if (fbo && w === fW && h === fH) return;
      fW = w; fH = h;
      if (!fbo) { fbo = gl.createFramebuffer(); fboTex = gl.createTexture(); }
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fW, fH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    let W = 0, H = 0, cssW = 0, cssH = 0, scale = 1, dpr = 1;
    let layKey = '', lay = null, layInfo = null;   // lugar de los rotulos de la red (ver labelLayout)
    function resize(quality) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = glCanvas.clientWidth; cssH = glCanvas.clientHeight;
      scale = Math.min(dpr, 1.5) * 0.8 * (quality || 1);
      W = Math.max(2, Math.round(cssW * scale)); H = Math.max(2, Math.round(cssH * scale));
      if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; }
      layKey = '';
      const ow = Math.round(cssW * dpr), oh = Math.round(cssH * dpr);
      if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
    }
    function attrib(prog, name, b, size) {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    function drawQuad(prog) { attrib(prog, 'aPos', quad, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    function camUniforms(pr, cam, h) {
      gl.uniform2f(pr.u.uRes, W, H); gl.uniform2f(pr.u.uCam, cam.x, cam.y);
      if (pr.u.uViewH) gl.uniform1f(pr.u.uViewH, h); gl.uniform1f(pr.u.uRot, cam.rot);
    }

    // pesos de cada nivel de textura segun el tamano del pixel en km
    function levelWeights(pixKm) {
      const tex = LEVELS.map((l) => (l.box[2] - l.box[0]) / l.size[0]);
      return [1, ...[1, 2, 3].map((i) => smooth(tex[i] * 3.2, tex[i] * 1.2, pixKm))];
    }

    function render(p, time) {
      if (!ready) return;
      if (!W) resize();
      const aspect = cssW / cssH;
      const cam = camera(p, aspect, cssW, frame);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);

      // suelo
      gl.useProgram(ground.p);
      camUniforms(ground, cam, cam.h);
      gl.uniform1f(ground.u.uTime, time);
      ['uT0', 'uT1', 'uT2', 'uT3'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texs[i]); gl.uniform1i(ground.u[n], i); });
      ['uB0', 'uB1', 'uB2', 'uB3'].forEach((n, i) => gl.uniform4fv(ground.u[n], boxes[i]));
      const lw = full ? levelWeights(cam.h / H) : [1, 0, 0, 1];
      gl.uniform4fv(ground.u.uLW, lw);
      gl.uniform4fv(ground.u.uHalo, halos);
      gl.uniform1f(ground.u.uArg, smooth(900, 3500, cam.h));
      drawQuad(ground.p);

      // luces
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(lights.p);
      camUniforms(lights, cam, cam.h);
      gl.uniform1f(lights.u.uTime, time);
      gl.uniform1f(lights.u.uGain, lerp(1.6, 1.15, cam.e));
      gl.uniform1f(lights.u.uMaxPt, maxPt);
      attrib(lights.p, 'aPos', bufs.pos, 2); attrib(lights.p, 'aCol', bufs.col, 3); attrib(lights.p, 'aSB', bufs.sb, 2); attrib(lights.p, 'aPh', bufs.ph, 1);
      gl.drawArrays(gl.POINTS, 0, world.count);
      ['aCol', 'aSB', 'aPh'].forEach((n) => { const l = gl.getAttribLocation(lights.p, n); if (l >= 0) gl.disableVertexAttribArray(l); });

      // nubes a media resolucion y composicion
      if (full && cam.h > HC2 * 0.85) {
        ensureFbo();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, fW, fH);
        gl.disable(gl.BLEND);
        gl.useProgram(clouds.p);
        gl.uniform2f(clouds.u.uRes, fW, fH); gl.uniform2f(clouds.u.uCam, cam.x, cam.y); gl.uniform1f(clouds.u.uRot, cam.rot);
        gl.uniform1f(clouds.u.uH, cam.h); gl.uniform1f(clouds.u.uTime, time); gl.uniform4fv(clouds.u.uHalo, halos);
        drawQuad(clouds.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(copy.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTex); gl.uniform1i(copy.u.uTex, 0);
        drawQuad(copy.p);
      }
      drawOverlay(p, time, cam, aspect);
    }

    // mundo a pantalla (px CSS), con la rotacion de camara
    function toScreen(wx, wy, cam, aspect) {
      const c = Math.cos(-cam.rot), s = Math.sin(-cam.rot);
      const ox = wx - cam.x, oy = wy - cam.y;
      const rx = c * ox - s * oy, ry = s * ox + c * oy;
      return [(rx / (cam.h * aspect) + 0.5) * cssW, (0.5 - ry / cam.h) * cssH];
    }
    const MONO = '500 11px "Martian Mono", ui-monospace, monospace';
    function label(text, x, y, a, align, color) {
      ctx.font = MONO; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(8,14,26,${0.55 * a})`;
      const w = ctx.measureText(text).width, pad = 6;
      const bx = align === 'right' ? x - w - pad : align === 'center' ? x - w / 2 - pad : x - pad;
      ctx.fillRect(bx, y - 10, w + pad * 2, 20);
      ctx.fillStyle = color ? color.replace('A', a) : `rgba(214,226,240,${a})`;
      ctx.fillText(text, x, y + 0.5);
    }

    // Zona donde pueden ir los rotulos de la red (px CSS): la caja del encuadre o, en escritorio,
    // a la izquierda del bloque de texto, debajo de la barra y arriba de la cinta.
    function labelRegion(aspect) {
      const fr = frameFor(frame, aspect, cssW);
      if (fr) return [fr.box[0] * cssW + 4, fr.box[1] * cssH, fr.box[2] * cssW - 4, fr.box[3] * cssH];
      return [8, 74, Math.max(cssW * 0.3, textLeftPx(cssW) - 12), cssH - inset - 8];
    }
    // Lugar de cada rotulo, calculado una vez por tamano sobre el cuadro final (asi no saltan mientras
    // se arma la red). Obstaculos: los anillos, la central con su rotulo y los rotulos ya puestos.
    // Se prueba del lado de afuera y luego del otro, cada vez mas lejos; si no hay lugar, el rotulo no va.
    function labelLayout(aspect) {
      const key = cssW + 'x' + cssH;
      if (key === layKey) return lay;
      const cam = camera(1, aspect, cssW, frame);
      const reg = labelRegion(aspect);
      ctx.font = MONO;
      const pts = SEDES.map((s) => toScreen(s.w[0], s.w[1], cam, aspect));
      const [hx, hy] = toScreen(0, 0, cam, aspect);
      const tw = (t) => ctx.measureText(t).width;
      const obst = pts.map(([x, y], i) => [x - 11, y - 11, x + 11, y + 11, i]);
      obst.push([hx - 21, hy - 21, hx + 21, hy + 21, -1], [hx + 20, hy - 33, hx + 33 + tw(HUB.label), hy - 11, -1]);
      const fits = (b, i) => b[0] >= reg[0] && b[2] <= reg[2] && b[1] >= reg[1] && b[3] <= reg[3] &&
        !obst.some((q) => q[4] !== i && b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      const byDist = SEDES.map((s, i) => i).sort((a, b) => Math.hypot(SEDES[b].w[0], SEDES[b].w[1]) - Math.hypot(SEDES[a].w[0], SEDES[a].w[1]));
      const out = [];
      for (const i of byDist) {
        const [sx, sy] = pts[i], w = tw(SEDES[i].name), pref = sx < hx ? -1 : 1;
        out[i] = null;
        search: for (const set of [[0, 14, -14], [26, -26, 38, -38], [50, -50, 62, -62]]) {
          for (const side of [pref, -pref]) {
            for (const dy of set) {
              const lx = sx + side * 16, y = sy + dy;
              const b = side < 0 ? [lx - w - 6, y - 10, lx + 6, y + 10] : [lx - 6, y - 10, lx + w + 6, y + 10];
              if (fits(b, i)) { out[i] = { side, dy }; obst.push([b[0] - 3, b[1] - 2, b[2] + 3, b[3] + 2, -2]); break search; }
            }
          }
        }
      }
      layKey = key; lay = out;
      layInfo = { region: reg, hub: [hx, hy], sites: SEDES.map((s, i) => {
        const L = out[i], [sx, sy] = pts[i], w = tw(s.name), lx = L ? sx + L.side * 16 : 0, y = L ? sy + L.dy : 0;
        return { name: s.name, ring: [sx, sy], label: L ? (L.side < 0 ? [lx - w - 6, y - 10, lx + 6, y + 10] : [lx - 6, y - 10, lx + w + 6, y + 10]) : null };
      }) };
      return out;
    }

    function drawOverlay(p, time, cam, aspect) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const [bx, by] = toScreen(0, 0, cam, aspect);

      // mira sobre Buenos Aires al principio
      const ta = 1 - smooth(0.12, 0.21, p);
      if (ta > 0.01) {
        const r0 = 26 + 6 * Math.sin(time * 1.6);
        ctx.strokeStyle = `rgba(236,146,84,${0.9 * ta})`; ctx.lineWidth = 1.4;
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.PI / 4;
          const cx = bx + Math.cos(a) * r0, cy = by + Math.sin(a) * r0;
          ctx.beginPath();
          ctx.moveTo(cx - Math.sign(Math.cos(a)) * 9, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy - Math.sign(Math.sin(a)) * 9);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(236,146,84,${ta})`;
        ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, Math.PI * 2); ctx.fill();
        label('BUENOS AIRES', bx - r0 - 16, by - 10, ta, 'right', 'rgba(236,146,84,A)');
        label('34°36′S · 58°22′O', bx - r0 - 16, by + 12, ta * 0.85, 'right');
      }
      // rotulos del mapa a media altura
      const ma = smooth(0.21, 0.27, p) * (1 - smooth(0.38, 0.45, p));
      if (ma > 0.01) {
        const names = [['ARGENTINA', -38.5, -65.5], ['URUGUAY', -32.6, -55.9], ['CHILE', -31.5, -71.2], ['CÓRDOBA', -31.42, -64.19], ['ROSARIO', -32.95, -60.65], ['MENDOZA', -32.89, -68.84], ['MONTEVIDEO', -34.90, -56.16]];
        const reg = frame ? labelRegion(aspect) : [20, 70, cssW - 20, cssH - 20];
        ctx.font = MONO;
        const used = [];   // si dos nombres se pisan (pantallas angostas), queda el primero de la lista
        for (const [n, la, lo] of names) {
          const [x, y] = toScreen(...proj(la, lo), cam, aspect);
          const w = ctx.measureText(n).width, b = [x + 2, y - 10, x + w + 14, y + 10];
          if (x < reg[0] || y < reg[1] + (frame ? 10 : 0) || y > reg[3] - (frame ? 10 : 0) || (frame && b[2] > reg[2])) continue;
          if (used.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
          used.push(b);
          label(n, x + 8, y, ma * (n === 'ARGENTINA' ? 1 : 0.75));
        }
      }
      // gotas en el lente durante el cruce de nubes
      const dropA = smooth(0.4, 0.46, p) * (1 - smooth(0.54, 0.64, p));
      if (dropA > 0.01) {
        for (const d of DROPS) {
          const a = dropA * smooth(d.t0, d.t0 + 0.03, p);
          if (a < 0.01) continue;
          const x = d.x * cssW, y = d.y * cssH + (p - d.t0) * d.slide * 4;
          const g = ctx.createRadialGradient(x - d.rad * 0.3, y - d.rad * 0.3, d.rad * 0.1, x, y, d.rad);
          g.addColorStop(0, `rgba(210,222,240,${0.04 * a})`); g.addColorStop(0.75, `rgba(170,188,215,${0.08 * a})`); g.addColorStop(1, `rgba(225,233,246,${0.26 * a})`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, d.rad, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,255,255,${0.38 * a})`; ctx.beginPath(); ctx.arc(x - d.rad * 0.35, y - d.rad * 0.4, d.rad * 0.15, 0, Math.PI * 2); ctx.fill();
        }
      }
      // red de sedes al llegar
      const k = smooth(0.8, 0.97, p);
      if (k <= 0) return;
      const order = SEDES.map((s, i) => ({ s, i, d: Math.hypot(s.w[0], s.w[1]) })).sort((a, b) => a.d - b.d);
      ctx.lineCap = 'round';
      const lay = labelLayout(aspect);
      ctx.font = MONO;
      // despues de la llegada: una sede se pone en ambar, la central responde y vuelve a la normalidad
      const CYC = 9.5, life = p >= 0.999 ? time : -1;
      const ph = life >= 0 ? (life % CYC) / CYC : 1, act = life >= 0 ? order[Math.floor(life / CYC) % order.length].i : -1;
      const mixc = (a, b, t) => a.map((v, j) => Math.round(v + (b[j] - v) * t));
      order.forEach((o, n) => {
        const t = clamp((k - n * 0.04) / 0.5, 0, 1);
        if (t <= 0) return;
        const [sx, sy] = toScreen(o.s.w[0], o.s.w[1], cam, aspect);
        const mx = (bx + sx) / 2 + (sy - by) * 0.14, my = (by + sy) / 2 - (sx - bx) * 0.14;
        const pt = (u) => [(1 - u) * (1 - u) * bx + 2 * (1 - u) * u * mx + u * u * sx, (1 - u) * (1 - u) * by + 2 * (1 - u) * u * my + u * u * sy];
        ctx.beginPath();
        for (let j = 0; j <= 32 * t; j++) { const q = pt(j / 32); j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.strokeStyle = 'rgba(236,146,84,0.2)'; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,236,218,0.82)'; ctx.lineWidth = 1.2; ctx.stroke();
        if (t >= 1 && o.i === act && ph > 0.12 && ph < 0.28) {
          const q = pt((ph - 0.12) / 0.16);
          ctx.fillStyle = 'rgba(255,214,170,0.25)'; ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,244,232,0.95)'; ctx.beginPath(); ctx.arc(q[0], q[1], 2.6, 0, Math.PI * 2); ctx.fill();
        }
        if (t >= 1) {
          const u = (time * 0.2 + o.i * 0.37) % 1, q = pt(u);
          ctx.fillStyle = `rgba(255,206,160,${0.9 * Math.sin(u * Math.PI)})`;
          ctx.beginPath(); ctx.arc(q[0], q[1], 1.9, 0, Math.PI * 2); ctx.fill();
        }
        const ring = smooth(0.8, 1, t);
        if (ring > 0) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 1.4 + o.i);
          const al = o.i === act ? smooth(0, 0.03, ph) * (1 - smooth(0.24, 0.3, ph)) : 0;
          const okf = o.i === act ? smooth(0.27, 0.3, ph) * (1 - smooth(0.36, 0.48, ph)) : 0;
          const rc = mixc(mixc([236, 146, 84], [251, 191, 36], al), [52, 211, 153], okf).join(',');
          if (al > 0.01) {
            const pp = (time * 1.4) % 1;
            ctx.strokeStyle = `rgba(251,191,36,${0.7 * al * (1 - pp)})`; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(sx, sy, 10 + pp * 18, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.strokeStyle = `rgba(${rc},${0.9 * ring})`; ctx.lineWidth = 1.5 + al * 0.6;
          ctx.beginPath(); ctx.arc(sx, sy, 8 * (0.6 + 0.4 * ring), 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = `rgba(236,146,84,${0.24 * ring * pulse})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(sx, sy, 12 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
          const L = lay[o.i];
          if (L) {
            const lx = sx + L.side * 16, ly = sy + L.dy;
            if (Math.abs(L.dy) > 2) {
              ctx.strokeStyle = `rgba(150,172,206,${0.35 * ring})`; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(sx + L.side * 9, sy); ctx.lineTo(lx - L.side * 4, ly); ctx.stroke();
            }
            label(o.s.name, lx, ly, ring * 0.92, L.side < 0 ? 'right' : 'left', al > 0.3 ? 'rgba(251,191,36,A)' : okf > 0.3 ? 'rgba(110,231,183,A)' : undefined);
          }
        }
      });
      const ha = smooth(0, 0.25, k);
      ctx.strokeStyle = `rgba(236,146,84,${0.95 * ha})`; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(236,146,84,${0.35 * ha})`;
      ctx.beginPath(); ctx.arc(bx, by, 19, 0, Math.PI * 2); ctx.stroke();
      label(HUB.label, bx + 26, by - 22, ha, 'left', 'rgba(236,146,84,A)');
      const ea = smooth(0.9, 1, p);
      if (caption && ea > 0.01) label('EJEMPLO · 12 SEDES EN EL AMBA', 24, cssH - 28 - inset, ea * 0.8);
    }

    // _labels(): cajas de los rotulos del cuadro final (px CSS), para las pruebas
    return { render, resize, ensureFull, isReady: () => ready, isFull: () => full, siteCount: SEDES.length + 1, _labels: () => layInfo };
  }

  if (IS_WORKER) {
    self.onmessage = (e) => {
      const d = e.data;
      if (!d || d.type !== 'build') return;
      try {
        importScripts(d.geo);
        for (const li of d.order) {
          const lv = LEVELS[li];
          lv.size = d.sizes[li];
          const data = rasterize(lv);
          if (li === 3) {
            const w = buildLights(data.px);
            self.postMessage({ type: 'world', pos: w.pos, col: w.col, sb: w.sb, ph: w.ph, count: w.count, halos: w.halos }, [w.pos.buffer, w.col.buffer, w.sb.buffer, w.ph.buffer]);
          }
          self.postMessage({ type: 'tex', i: li, W: data.W, H: data.H, px: data.px }, [data.px.buffer]);
        }
      } catch (err) { self.postMessage({ type: 'error', message: String(err) }); }
    };
    return;
  }

  window.HeroScene = { create, camera, proj, SEDES, HUB, _debug: { rasterize, LEVELS } };
})();
