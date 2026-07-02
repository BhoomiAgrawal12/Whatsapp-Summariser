#!/usr/bin/env bash
# Deploy (or re-deploy) the WhatsApp Summarizer from this laptop to the server.
#
# Usage:
#   ./deploy/deploy.sh <server-ip>                # push code, build, (re)start
#   ./deploy/deploy.sh <server-ip> --with-state   # ALSO copy auth/ + data/ + .env
#                                                 # (first deploy: avoids re-pairing)
#
# Assumes: SSH key access as 'ubuntu' user (Oracle default), and that
# deploy/oracle-setup.sh has been run on the server once.
#
# NOTE ON SECRETS: --with-state copies your local .env (API key) and WhatsApp
# session (auth/) to the server over SSH. They land chmod-600, owner-only.

set -euo pipefail

SERVER_IP="${1:-}"
WITH_STATE="${2:-}"
SSH_USER="${SSH_USER:-ubuntu}"
REMOTE_DIR="wa-summarizer"

if [[ -z "$SERVER_IP" ]]; then
  echo "Usage: ./deploy/deploy.sh <server-ip> [--with-state]" >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${SSH_USER}@${SERVER_IP}"

echo "==> Pushing source to ${REMOTE}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude auth --exclude data --exclude .env \
  "$PROJECT_DIR/" "${REMOTE}:${REMOTE_DIR}/"

if [[ "$WITH_STATE" == "--with-state" ]]; then
  echo "==> Copying state: auth/ (WhatsApp session), data/ (DB+media), .env"
  for item in auth data; do
    if [[ -d "$PROJECT_DIR/$item" ]]; then
      rsync -az "$PROJECT_DIR/$item/" "${REMOTE}:${REMOTE_DIR}/$item/"
    else
      echo "    (skipping $item/ — not present locally)"
    fi
  done
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    rsync -az "$PROJECT_DIR/.env" "${REMOTE}:${REMOTE_DIR}/.env"
  else
    echo "    (skipping .env — not present locally; create it on the server)"
  fi
  ssh "$REMOTE" "chmod -R go-rwx ${REMOTE_DIR}/auth ${REMOTE_DIR}/.env 2>/dev/null || true"
fi

echo "==> Installing deps + building on the server (native modules must compile there)"
ssh "$REMOTE" "cd ${REMOTE_DIR} && npm ci && npm run build"

echo "==> (Re)starting under pm2"
ssh "$REMOTE" "cd ${REMOTE_DIR} \
  && (pm2 restart wa-summarizer --update-env 2>/dev/null || pm2 start dist/index.js --name wa-summarizer) \
  && pm2 save \
  && sudo env PATH=\$PATH pm2 startup systemd -u ${SSH_USER} --hp /home/${SSH_USER} >/dev/null"

echo
echo "Deployed ✓   Useful commands:"
echo "  ssh ${REMOTE} 'pm2 logs wa-summarizer --lines 50'   # logs (QR appears here on first pairing)"
echo "  ssh ${REMOTE} 'pm2 status'                           # is it running?"
echo "  ssh -L 8790:localhost:8790 ${REMOTE}                 # then open http://localhost:8790 (dashboard)"
