#!/usr/bin/env bash
# Enable certificate issuance only after the DNS-only A record reaches this server.
set -euo pipefail
server_ipv4=$(ip -4 -o addr show scope global | awk 'NR == 1 {split($4, a, "/"); print a[1]}')
if ! getent ahostsv4 pdf-linode.app.do | awk '{print $1}' | grep -Fxq "$server_ipv4"; then
  exit 0
fi
cd /opt/url-to-pdf-api
caddy validate --config deploy/Caddyfile
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
systemctl disable --now pdf-https-ready.timer
