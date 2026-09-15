#!/usr/bin/env bash
# Run as root after extracting this repository into /opt/url-to-pdf-api.
set -euo pipefail
cd /opt/url-to-pdf-api
systemctl stop pdf-renderer 2>/dev/null || true
chown -R pdf-renderer:pdf-renderer /opt/url-to-pdf-api
sudo -u pdf-renderer env PUPPETEER_CACHE_DIR=/var/cache/pdf-renderer npm ci --omit=dev
sudo -u pdf-renderer env PUPPETEER_CACHE_DIR=/var/cache/pdf-renderer npx puppeteer browsers install chrome
install -m 644 deploy/apparmor-pdf-chrome /etc/apparmor.d/pdf-chrome
apparmor_parser -r /etc/apparmor.d/pdf-chrome
install -m 644 deploy/nftables.conf /etc/nftables.conf
nft -c -f /etc/nftables.conf
systemctl enable --now nftables
systemctl reload nftables
install -m 644 deploy/Caddyfile.pending /etc/caddy/Caddyfile
install -m 644 deploy/pdf-https-ready.service /etc/systemd/system/pdf-https-ready.service
install -m 644 deploy/pdf-https-ready.timer /etc/systemd/system/pdf-https-ready.timer
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
install -m 644 deploy/pdf-renderer.service /etc/systemd/system/pdf-renderer.service
systemctl daemon-reload
systemctl enable --now pdf-https-ready.timer
bash deploy/activate-https.sh
test -s /etc/pdf-renderer.env
systemctl enable --now pdf-renderer
