#!/usr/bin/env bash
# One-time server bootstrap for the WhatsApp Summarizer on Oracle Cloud
# (Ubuntu 22.04/24.04, x86 or ARM/Ampere — both work).
#
# Run ON THE SERVER as the default 'ubuntu' user:
#   bash oracle-setup.sh
#
# Installs: Node.js 22, build tools (for better-sqlite3), pm2 (with boot autostart).
# Also sets the timezone so /schedule HH:MM means YOUR local time.

set -euo pipefail

TIMEZONE="${TIMEZONE:-Asia/Kolkata}"

echo "==> Updating system packages"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Installing build tools (needed to compile better-sqlite3)"
sudo apt-get install -y build-essential python3 git rsync

echo "==> Installing Node.js 22 (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> Installing pm2 (process manager, restarts on crash & on boot)"
sudo npm install -g pm2

echo "==> Setting timezone to ${TIMEZONE} (scheduler uses local time)"
sudo timedatectl set-timezone "${TIMEZONE}"

echo "==> Preparing app directory"
mkdir -p "$HOME/wa-summarizer"

echo
echo "Server is ready ✓"
echo "Next: from your LAPTOP run   ./deploy/deploy.sh <server-ip> --with-state"
