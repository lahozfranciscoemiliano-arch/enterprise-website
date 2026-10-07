// Copia public/assets/css/site.css dentro del <style> de cada pagina de public/.
// Las paginas no cargan site.css: llevan el CSS en linea para pintar sin esperar otro pedido.
// site.css es la fuente; despues de editarlo hay que correr:  node scripts/build.mjs
// Con --check no escribe nada y sale con error si alguna pagina quedo desactualizada.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Misma transformacion que usaba el build original: sin comentarios, rutas absolutas,
// lineas sin sangria y sin lineas vacias.
export function inlineCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\.\.\/(fonts|img)\//g, '/assets/$1/')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const STYLE = /<style>[\s\S]*?<\/style>/g;

// Devuelve las paginas cuyo <style> no coincide con site.css (y las actualiza si write=true).
export function syncPages(root = 'public', { write = false } = {}) {
  const css = inlineCss(readFileSync(join(root, 'assets/css/site.css'), 'utf8'));
  const out = [];
  for (const f of readdirSync(root).filter((f) => f.endsWith('.html')).sort()) {
    const path = join(root, f);
    const html = readFileSync(path, 'utf8');
    const n = (html.match(STYLE) || []).length;
    if (n !== 1) throw new Error(`${f}: se esperaba un solo <style>, hay ${n}`);
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
  const changed = syncPages(root, { write: !check });
  if (check && changed.length) {
    console.error(`CSS desactualizado en: ${changed.join(', ')}. Corre: node scripts/build.mjs`);
    process.exit(1);
  }
  console.log(changed.length ? `CSS actualizado en: ${changed.join(', ')}` : 'CSS en linea al dia en todas las paginas.');
}
