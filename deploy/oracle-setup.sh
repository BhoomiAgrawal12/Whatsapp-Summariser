#!/usr/bin/env bash
# One-time server bootstrap for the WhatsApp Summarizer on Oracle Cloud
# (Ubuntu 22.04/24.04/26.04, x86 or ARM/Ampere — all work).
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

# A 1 GB always-free VM (E2.1.Micro) cannot link better-sqlite3 without swap —
# node-gyp gets OOM-killed part-way through with a confusing error.
if [[ "$(free -m | awk '/^Swap:/{print $2}')" -lt 512 ]]; then
  echo "==> Adding 2G swap (RAM is $(free -m | awk '/^Mem:/{print $2}')MB)"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Installing Node.js >= 22"
# Prefer the distro's own package when it is new enough: NodeSource publishes per
# Ubuntu codename and lags fresh releases (on 26.04 "resolute" its repo 404s),
# which used to take this script down on exactly the images Oracle offers today.
node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }

if [[ -n "$(node_major)" ]] && (( $(node_major) >= 22 )); then
  echo "    node $(node -v) already present"
else
  distro_node="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/{print $2}')"
  distro_major="$(echo "$distro_node" | sed 's/^\([0-9]*\).*/\1/')"

  if [[ -n "$distro_major" && "$distro_major" != "none" ]] && (( distro_major >= 22 )); then
    echo "    using Ubuntu's nodejs ${distro_node}"
    sudo apt-get install -y nodejs npm
  else
    . /etc/os-release
    if curl -fsI "https://deb.nodesource.com/node_22.x/dists/${VERSION_CODENAME}/Release" >/dev/null 2>&1; then
      echo "    using NodeSource for ${VERSION_CODENAME}"
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      echo "ERROR: no Node >= 22 available." >&2
      echo "  Ubuntu offers: ${distro_node:-none}; NodeSource has no repo for '${VERSION_CODENAME}'." >&2
      echo "  Recreate the VM on Ubuntu 24.04 LTS, or install Node 22 manually." >&2
      exit 1
    fi
  fi
fi

command -v npm >/dev/null || sudo apt-get install -y npm
echo "    node $(node -v), npm $(npm -v)"

echo "==> Installing pm2 (process manager, restarts on crash & on boot)"
sudo npm install -g pm2

echo "==> Setting timezone to ${TIMEZONE} (scheduler uses local time)"
sudo timedatectl set-timezone "${TIMEZONE}"

echo "==> Preparing app directory"
mkdir -p "$HOME/wa-summarizer"

echo
echo "Server is ready ✓"
echo "Next: from your LAPTOP run   ./deploy/deploy.sh <server-ip> --with-state"
