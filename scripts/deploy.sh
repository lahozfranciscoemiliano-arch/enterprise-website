#!/usr/bin/env bash
# Sube public/ al hosting por SFTP con llave SSH (lo usa .github/workflows/deploy.yml).
# Solo sube y reemplaza: nunca borra archivos del servidor (por ejemplo el .htaccess).
# REMOTE_PATH tiene que existir: si esta mal escrito falla en vez de crear otra carpeta.
# Sube primero assets/ y despues las paginas, para que una pagina nueva no apunte
# a un CSS o JS que todavia no llego.
#
# Variables:
#   SSH_HOST, SSH_USER, SSH_PRIVATE_KEY, REMOTE_PATH   obligatorias
#   SSH_PORT          por defecto 22
#   SSH_KNOWN_HOSTS   linea(s) de known_hosts del servidor; si falta se usa ssh-keyscan
#   SRC               carpeta local, por defecto public
#   DRY_RUN=1         muestra que subiria sin subir nada
set -euo pipefail

falta=()
for v in SSH_HOST SSH_USER SSH_PRIVATE_KEY REMOTE_PATH; do
  [ -n "${!v:-}" ] || falta+=("$v")
done
if [ ${#falta[@]} -gt 0 ]; then
  echo "Faltan los secrets: ${falta[*]}. Cargalos en GitHub > Settings > Secrets and variables > Actions." >&2
  exit 1
fi
SSH_PORT="${SSH_PORT:-22}"
SRC="${SRC:-public}"
REMOTE_PATH="${REMOTE_PATH%/}"
command -v lftp >/dev/null || { echo "Falta lftp (apt-get install lftp)." >&2; exit 1; }
[ -d "$SRC/assets" ] || { echo "No existe $SRC/assets" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
key="$tmp/key"
kh="$tmp/known_hosts"
printf '%s\n' "$SSH_PRIVATE_KEY" | tr -d '\r' > "$key"
chmod 600 "$key"

if [ -n "${SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$SSH_KNOWN_HOSTS" | tr -d '\r' > "$kh"
else
  echo "Aviso: no hay SSH_KNOWN_HOSTS; se acepta la llave que el servidor muestre ahora (ssh-keyscan)."
  ssh-keyscan -p "$SSH_PORT" "$SSH_HOST" > "$kh" 2>/dev/null || true
  [ -s "$kh" ] || { echo "ssh-keyscan no pudo leer la llave de $SSH_HOST:$SSH_PORT" >&2; exit 1; }
fi

dry=""
[ "${DRY_RUN:-0}" = "1" ] && dry="--dry-run" && echo "Modo prueba: no se sube nada."

lftp -c "
set cmd:fail-exit yes
set net:timeout 30
set net:max-retries 3
set net:reconnect-interval-base 5
set sftp:auto-confirm no
set sftp:connect-program 'ssh -a -x -i $key -o UserKnownHostsFile=$kh -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o BatchMode=yes'
open -u '$SSH_USER,' -p $SSH_PORT sftp://$SSH_HOST
cd '$REMOTE_PATH'
mirror --reverse --no-perms --parallel=4 --verbose=1 $dry '$SRC/assets' assets
mirror --reverse --no-perms --parallel=4 --verbose=1 $dry --exclude ^assets/ '$SRC' .
"
echo "Listo: $SRC/ subido a $SSH_HOST:$REMOTE_PATH"
