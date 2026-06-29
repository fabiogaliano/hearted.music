#!/usr/bin/env bash
# Keep supavisor's downstream TLS cert in sync with the Let's Encrypt cert that
# Traefik/Coolify manages for the pooler domain.
#
# WHY: the CF Worker (edge) reaches Postgres through the supavisor session pooler
# over TLS, and the Cloudflare Workers runtime validates the server cert against
# public CAs — it will NOT accept supavisor's default self-signed cert. supavisor
# regenerates that self-signed cert whenever its container is recreated, and LE
# certs rotate ~every 60 days, so this script re-installs the real cert and
# reloads supavisor whenever the two diverge. Run it from cron on the VPS.
#
#   sudo bash sync-pooler-cert.sh            # install/refresh if changed
#   sudo bash sync-pooler-cert.sh --force    # reinstall + restart unconditionally
#
# Safe to run often: it only restarts supavisor when the cert actually differs.

set -euo pipefail

DOMAIN="${POOLER_CERT_DOMAIN:-supabase.hearted.music}"
SVC="${SUPAVISOR_CONTAINER:-supabase-supavisor-fcuhypd724cwmn4dhx74qqja}"
ACME="${ACME_JSON:-/data/coolify/proxy/acme.json}"
CRT_PATH=/etc/ssl/server.crt
KEY_PATH=/etc/ssl/server.key
FORCE="${1:-}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

[ -f "$ACME" ] || { log "ERROR: $ACME not found"; exit 1; }
docker inspect "$SVC" >/dev/null 2>&1 || { log "ERROR: container $SVC not found"; exit 1; }

tmp_crt=$(mktemp); tmp_key=$(mktemp)
trap 'rm -f "$tmp_crt" "$tmp_key"' EXIT

# acme.json nests certs under a resolver key; walk all objects that carry a
# Certificates array and pick the entry whose main domain matches.
jq -r --arg d "$DOMAIN" '[.. | objects | select(has("Certificates")) | .Certificates[]] | map(select(.domain.main==$d)) | .[0].certificate' "$ACME" | base64 -d > "$tmp_crt"
jq -r --arg d "$DOMAIN" '[.. | objects | select(has("Certificates")) | .Certificates[]] | map(select(.domain.main==$d)) | .[0].key'         "$ACME" | base64 -d > "$tmp_key"

[ -s "$tmp_crt" ] && [ -s "$tmp_key" ] || { log "ERROR: no cert/key for $DOMAIN in acme.json"; exit 1; }

new_fp=$(openssl x509 -in "$tmp_crt" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)
cur_fp=$(docker exec "$SVC" openssl x509 -in "$CRT_PATH" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || true)

if [ "$FORCE" != "--force" ] && [ -n "$cur_fp" ] && [ "$new_fp" = "$cur_fp" ]; then
  log "cert unchanged ($new_fp) — nothing to do"
  exit 0
fi

log "installing LE cert for $DOMAIN (new=$new_fp old=${cur_fp:-none})"
docker cp "$tmp_crt" "$SVC:$CRT_PATH"
docker cp "$tmp_key" "$SVC:$KEY_PATH"
docker exec -u 0 "$SVC" sh -lc "chmod 644 $CRT_PATH; chmod 640 $KEY_PATH" || true
docker restart "$SVC" >/dev/null
log "supavisor restarted with refreshed cert"
