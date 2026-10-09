// Copia el CSS del sitio dentro del <style> de cada pagina de public/.
// Las paginas no cargan archivos .css: llevan el CSS en linea para pintar sin esperar otro pedido.
// Fuentes, en este orden (las que no existan se saltean):
//   assets/css/site.css   base y responsive
//   assets/css/hero.css   portada (escena, video y su diagramacion)
//   assets/css/fx.css     efectos y animaciones (assets/js/fx.js)
//   assets/css/video.css  reproductores de video (assets/js/video.js)
//   assets/css/pages/*.css  ajustes de una pagina puntual (orden alfabetico)
// Un archivo cuyo primer comentario dice "paginas: a.html b.html" va solo en esas paginas;
// sin esa linea va en todas.
// Despues de editar cualquiera hay que correr:  node scripts/build.mjs
// Con --check no escribe nada y sale con error si alguna pagina quedo desactualizada.
// Con --only=pagina.html (repetible) toca solo esas paginas.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Misma transformacion que usaba el build original: sin comentarios, rutas absolutas,
// lineas sin sangria y sin lineas vacias.
export function inlineCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?:\.\.\/)+(fonts|img|video)\//g, '/assets/$1/')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const STYLE = /<style>[\s\S]*?<\/style>/g;

export function cssSources(root = 'public') {
  const dir = join(root, 'assets/css');
  const list = ['site.css', 'hero.css', 'fx.css', 'video.css'].map((f) => join(dir, f));
  const pages = join(dir, 'pages');
  if (existsSync(pages)) {
    list.push(...readdirSync(pages).filter((f) => f.endsWith('.css')).sort().map((f) => join(pages, f)));
  }
  return list.filter((f) => existsSync(f));
}

// Paginas a las que se limita un archivo CSS (null = todas), segun "paginas: ..." en su primer comentario.
export function cssPages(text) {
  const m = /^\s*\/\*[\s\S]*?\*\//.exec(text);
  const d = m && /paginas:\s*([^\n*]+)/i.exec(m[0]);
  return d ? d[1].split(/[\s,]+/).filter((x) => x.endsWith('.html')) : null;
}

export function cssFor(root, page) {
  return inlineCss(cssSources(root).map((f) => readFileSync(f, 'utf8'))
    .filter((t) => { const pages = cssPages(t); return !pages || pages.includes(page); })
    .join('\n'));
}

// Devuelve las paginas cuyo <style> no coincide con las fuentes (y las actualiza si write=true).
export function syncPages(root = 'public', { write = false, only = null } = {}) {
  const out = [];
  for (const f of readdirSync(root).filter((f) => f.endsWith('.html') && (!only || only.includes(f))).sort()) {
    const path = join(root, f);
    const html = readFileSync(path, 'utf8');
    const n = (html.match(STYLE) || []).length;
    if (n !== 1) throw new Error(`${f}: se esperaba un solo <style>, hay ${n}`);
    const css = cssFor(root, f);
    const next = html.replace(STYLE, () => `<style>${css}</style>`);
    if (next !== html) {
      out.push(f);
      if (write) writeFileSync(path, next);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const root = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'public';
  const only = process.argv.filter((a) => a.startsWith('--only=')).map((a) => a.slice(7));
  const changed = syncPages(root, { write: !check, only: only.length ? only : null });
  if (check && changed.length) {
    console.error(`CSS desactualizado en: ${changed.join(', ')}. Corre: node scripts/build.mjs`);
    process.exit(1);
  }
  console.log(changed.length ? `CSS actualizado en: ${changed.join(', ')}` : 'CSS en linea al dia en todas las paginas.');
}
