# Enterprise SOC: sitio web

Sitio de [enterprisesoc.lat](https://enterprisesoc.lat). Cada cambio que llega a `main` se publica solo en el hosting (Spaceship) por SFTP con llave SSH.

## Qué hay en el repositorio

| Ruta | Qué es |
|---|---|
| `public/` | El sitio tal como se sirve: páginas, `assets/` (CSS, JS, fuentes, imágenes) y `contact.php`. Es lo único que se sube al hosting. |
| `scripts/check.mjs` | Revisión previa: links y recursos internos que no existen, hash CSP del script en línea y llaves commiteadas por error. |
| `scripts/deploy.sh` | Subida por SFTP con `lftp`. Sube primero `assets/` y después las páginas. Nunca borra nada del servidor. |
| `.github/workflows/check.yml` | Corre la revisión en cada pull request. |
| `.github/workflows/deploy.yml` | En cada push a `main`: revisa, sube y verifica que lo publicado sea igual a `public/`. |

## Cómo se trabaja

1. Los cambios se hacen en una rama y se abre un pull request. Ahí corre **Revisar sitio**.
2. Al hacer merge a `main`, **Publicar en el hosting** sube el sitio y compara cada página publicada con `public/`. Si algo no coincide, el workflow falla.
3. También se puede publicar a mano: **Actions → Publicar en el hosting → Run workflow**. La opción *Solo probar* se conecta y muestra qué subiría, sin subir nada.

## Configuración, una sola vez

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Valor |
|---|---|
| `SSH_HOST` | Servidor SFTP del hosting. |
| `SSH_PORT` | Puerto SSH. Si es 22 se puede omitir. |
| `SSH_USER` | Usuario SSH/SFTP del hosting. |
| `SSH_PRIVATE_KEY` | La llave privada completa, desde `-----BEGIN ...-----` hasta `-----END ...-----`. Tiene que ser sin contraseña. |
| `REMOTE_PATH` | Carpeta del sitio en el servidor, por ejemplo `/home/usuario/public_html`. Tiene que existir: si está mal escrita, el deploy falla en vez de crear otra carpeta. |
| `SSH_KNOWN_HOSTS` | Opcional, recomendado. Es la salida de `ssh-keyscan -p PUERTO HOST` y fija la identidad del servidor. Sin esto se acepta la que el servidor muestre en cada deploy. |

Los valores son los mismos que usa `_tools/deploy.sh` en la carpeta del proyecto de tu PC.

**Recomendado: una llave solo para GitHub.** En vez de copiar tu llave personal, creá una nueva y autorizala en el panel del hosting (sección de acceso SSH):

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions enterprisesoc" -f github_deploy
# github_deploy.pub -> se agrega en el panel del hosting como llave autorizada
# github_deploy     -> se pega en el secret SSH_PRIVATE_KEY y después se borra de la PC
```

Si algún día hay que cortarle el acceso a GitHub, se revoca esa llave sin tocar la tuya.

Para probar la configuración: **Actions → Publicar en el hosting → Run workflow**, con *Solo probar* tildado.

## Cosas a tener en cuenta al editar

- **`.htaccess` vive solo en el servidor.** Tiene el Content-Security-Policy y las cabeceras de seguridad que genera el build de tu PC. El deploy no lo toca. Si lo querés versionar, copiá el `.htaccess` que genera el build de tu PC a `public/.htaccess`: desde ese momento se sube con cada deploy y `check.mjs` lee el CSP de ahí.
- **Script en línea de la portada (prueba A/B del título).** El CSP lo permite por su hash sha256. Si se modifica ese script, `check.mjs` falla hasta que el hash nuevo esté en el CSP del `.htaccess` del servidor y en `CSP_HASHES_SERVIDOR` de `scripts/check.mjs`. Sin ese cambio el navegador lo bloquearía.
- **Caché.** CSS, JS e imágenes se piden con `?v=15`. Si cambia alguno, subí el número en todas las páginas y en `site.css`:
  `grep -rl '?v=15' public | xargs sed -i 's/?v=15/?v=16/g'`
- **Formulario.** `contact.php` envía cada pedido de demo a `contacto@enterprisesoc.lat`. Para verificarlo sin mandar mails: un GET responde 405 y un POST incompleto responde 422.
- **Origen de los archivos.** `public/` es la salida del build que estaba en la PC (`_site/build.mjs`). Desde ahora la fuente es este repositorio. Si se vuelve a generar el sitio en la PC, hay que copiar esa salida a `public/` antes de commitear, o el próximo deploy pisa los cambios hechos acá.
- **Saltos de línea.** Los archivos de `public/` se guardan y se suben byte por byte, sin conversión de saltos de línea (ver `.gitattributes`).
