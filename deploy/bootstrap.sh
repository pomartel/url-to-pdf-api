#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl xz-utils unzip caddy nftables sudo unattended-upgrades \
  fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-color-emoji \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libdrm2 \
  libgbm1 libgtk-3-0t64 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libxkbcommon0
id po >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo po
install -d -m 700 -o po -g po /home/po/.ssh
install -m 600 -o po -g po /root/.ssh/authorized_keys /home/po/.ssh/authorized_keys
printf 'po ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/po
chmod 440 /etc/sudoers.d/po
printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/00-pdf.conf
sshd -t
systemctl reload ssh
id pdf-renderer >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/pdf-renderer --shell /usr/sbin/nologin pdf-renderer
install -d -o pdf-renderer -g pdf-renderer /opt/url-to-pdf-api /var/cache/pdf-renderer
NODE_VERSION=22.23.2
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
grep " node-v$NODE_VERSION-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
tar -xJf "node-v$NODE_VERSION-linux-x64.tar.xz" --strip-components=1 -C /usr/local
curl -fsSL https://raw.githubusercontent.com/debitoor/heroku-buildpack-converter-fonts/fd57654fa73dedaf8d4910e34880ed8e5af818d3/fonts.tar.gz -o fonts.tar.gz
mkdir -p /usr/local/share/fonts/heroku
tar -xzf fonts.tar.gz -C /usr/local/share/fonts/heroku
fc-cache -f
printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-pdf.conf
sysctl --system
