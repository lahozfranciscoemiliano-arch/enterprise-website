// Revisa public/ antes de publicar. Sale con error si algo se romperia en el hosting:
//  1. Links y recursos internos (href, src, srcset, og:image, url() del CSS) que no existen.
//  2. Scripts en linea cuyo hash no esta en el CSP del servidor (el navegador los bloquearia).
//  3. Llaves privadas o archivos de llaves dentro de public/.
//  4. Paginas cuyo CSS en linea no coincide con assets/css/site.css.
// Uso: node scripts/check.mjs [carpeta]   (por defecto public)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname, posix } from 'node:path';
import { syncPages } from './build.mjs';

const ROOT = process.argv[2] || 'public';
const SITE = 'https://enterprisesoc.lat';

// Hashes de script-src del CSP que hoy sirve el .htaccess del servidor.
// Si public/.htaccess existe, se leen de ahi y esta lista no se usa.
const CSP_HASHES_SERVIDOR = ['sha256-wPiFWGoZJJ8JuJ+WPMSWAocl5LNbayE5mSlixY1k9Ck='];

const errores = [];
const err = (archivo, msg) => errores.push(`${archivo}: ${msg}`);

function archivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? archivos(p) : [p];
  });
}

if (!existsSync(ROOT)) {
  console.error(`No existe la carpeta ${ROOT}`);
  process.exit(1);
}
const todos = archivos(ROOT);

// Rutas del sitio: "/" -> index.html, "/demo" -> demo.html, "/assets/x.css?v=1" -> assets/x.css
function existeRuta(url, desde) {
  let p = url.split('#')[0].split('?')[0];
  if (p === '') return true; // solo ancla o solo query
  if (p.startsWith(SITE)) p = p.slice(SITE.length) || '/';
  if (!p.startsWith('/')) p = posix.join('/', posix.dirname(desde), p);
  p = decodeURIComponent(p);
  const candidatos = p.endsWith('/') ? [p + 'index.html'] : [p, extname(p) ? null : p + '.html'];
  return candidatos.some((c) => {
    if (!c) return false;
    const f = join(ROOT, c);
    return existsSync(f) && statSync(f).isFile();
  });
}

const esInterna = (u) => u.startsWith('/') && !u.startsWith('//') || u.startsWith(SITE);
const esRelativa = (u) => !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(u) && u !== '';

function hashesPermitidos() {
  const ht = join(ROOT, '.htaccess');
  if (!existsSync(ht)) return { origen: 'scripts/check.mjs (CSP_HASHES_SERVIDOR)', hashes: CSP_HASHES_SERVIDOR };
  const m = readFileSync(ht, 'utf8').match(/script-src([^;"]*)/);
  return { origen: 'public/.htaccess', hashes: m ? [...m[1].matchAll(/'(sha(?:256|384|512)-[^']+)'/g)].map((x) => x[1]) : [] };
}
const csp = hashesPermitidos();

for (const f of todos) {
  const rel = relative(ROOT, f).split('\\').join('/');
  const ext = extname(f).toLowerCase();

  if (/(^|\/)(id_(rsa|ed25519|ecdsa|dsa)|.*\.(pem|key|ppk))$/i.test(rel)) err(rel, 'parece un archivo de llave; no debe estar en public/');
  if (['.html', '.php', '.js', '.css', '.txt', '.xml', '.svg', '.json'].includes(ext) && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(readFileSync(f, 'utf8'))) {
    err(rel, 'contiene una llave privada');
  }

  if (ext === '.html') {
    const html = readFileSync(f, 'utf8');
    const refs = [];
    for (const m of html.matchAll(/\s(?:href|src|action)="([^"]+)"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) refs.push(...m[1].split(',').map((s) => s.trim().split(/\s+/)[0]));
    for (const m of html.matchAll(/<meta[^>]+content="(https:\/\/enterprisesoc\.lat\/[^"]+)"/g)) refs.push(m[1]);
    for (const u of refs) {
      if ((esInterna(u) || esRelativa(u)) && !existeRuta(u, rel)) err(rel, `no existe ${u}`);
    }

    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/type="application\/(ld\+)?json"/.test(m[1])) continue; // datos, no los ejecuta el navegador
      const h = 'sha256-' + createHash('sha256').update(m[2], 'utf8').digest('base64');
      if (!csp.hashes.includes(h)) {
        err(rel, `script en linea con hash ${h} no permitido por el CSP (${csp.origen}). ` +
          'Si el cambio es a proposito, agrega el hash al Content-Security-Policy del .htaccess del servidor y aca.');
      }
    }
  }

  if (ext === '.css') {
    const css = readFileSync(f, 'utf8');
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const u = m[1];
      if (u.startsWith('data:')) continue;
      if ((esInterna(u) || esRelativa(u)) && !existeRuta(u, rel)) err(rel, `no existe ${u}`);
    }
  }
}

// 4. El CSS en linea de cada pagina tiene que ser el de assets/css/site.css (ver scripts/build.mjs).
try {
  const viejas = syncPages(ROOT);
  if (viejas.length) err(viejas.join(', '), 'el <style> no coincide con las fuentes de assets/css; corre node scripts/build.mjs');
} catch (e) {
  err('assets/css/site.css', e.message);
}

if (errores.length) {
  console.error(`Revision con ${errores.length} problema(s):\n- ` + errores.join('\n- '));
  process.exit(1);
}
console.log(`OK: ${todos.length} archivos revisados en ${ROOT}/ (CSP desde ${csp.origen}).`);
