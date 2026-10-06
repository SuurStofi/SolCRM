#!/usr/bin/env bash
# Install the SolCRM nginx vhost and make it reachable on solcrm.tech.
#
# Run on the server as root:
#   sudo bash ~/solcrm/deploy/prod/install-nginx-site.sh
#
# Idempotent: re-running it re-copies the config and reloads nginx without
# duplicating anything.
set -euo pipefail

DOMAIN=solcrm.tech
APP_PORT=8137
SRC=/home/nekudev/solcrm/solcrm.tech.conf
SSL_DIR=/etc/nginx/ssl

if [[ $EUID -ne 0 ]]; then
  echo "This script needs root: sudo bash $0" >&2
  exit 1
fi

echo "==> checking the app is actually up on 127.0.0.1:${APP_PORT}"
if ! curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/"; then
  echo "SolCRM is not responding on 127.0.0.1:${APP_PORT}. Start it first:" >&2
  echo "  sudo -u nekudev bash -lc 'pm2 start solcrm'" >&2
  exit 1
fi
echo "    app responds"

# A certificate must exist before nginx will load a vhost that references one.
# This self-signed pair is a placeholder so nginx starts; certbot replaces it
# below. Browsers will warn until that happens.
mkdir -p "$SSL_DIR"
if [[ ! -f "${SSL_DIR}/${DOMAIN}.crt" ]]; then
  echo "==> generating a temporary self-signed cert for ${DOMAIN}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -keyout "${SSL_DIR}/${DOMAIN}.key" \
    -out "${SSL_DIR}/${DOMAIN}.crt" \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  chmod 600 "${SSL_DIR}/${DOMAIN}.key"
  echo "    placeholder cert written (replace with certbot below)"
else
  echo "==> cert already present, leaving it alone"
fi

echo "==> installing vhost"
cp "$SRC" "/etc/nginx/sites-available/${DOMAIN}"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

echo "==> testing nginx config"
nginx -t

echo "==> reloading nginx"
systemctl reload nginx

echo
echo "Done. ${DOMAIN} now proxies to 127.0.0.1:${APP_PORT}."
echo
echo "Next, once DNS for ${DOMAIN} points at this server:"
echo "  sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo "That swaps the self-signed placeholder for a real certificate."
