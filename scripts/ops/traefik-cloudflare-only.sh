#!/bin/bash
# Writes a Traefik file-provider middleware that only admits Cloudflare edge IPs.
# Applied to the hearted.music router only, so direct-to-origin hosts stay reachable.
set -eu
v4=$(curl -s -m 15 https://www.cloudflare.com/ips-v4)
v6=$(curl -s -m 15 https://www.cloudflare.com/ips-v6)
[ -n "$v4" ] && [ -n "$v6" ] || { echo "could not fetch Cloudflare IP ranges"; exit 1; }
{
  echo "# Generated $(date -u +%FT%TZ) from https://www.cloudflare.com/ips-v4 and ips-v6."
  echo "# Only the hearted.music router references this; see docs/ops/app-server-vps.md."
  echo "http:"
  echo "  middlewares:"
  echo "    cloudflare-only:"
  echo "      ipAllowList:"
  echo "        sourceRange:"
  for ip in $v4 $v6; do echo "          - \"$ip\""; done
} | sudo tee /data/coolify/proxy/dynamic/cloudflare-only.yaml >/dev/null
sudo tail -n +1 /data/coolify/proxy/dynamic/cloudflare-only.yaml | head -12
echo "ranges: $(grep -c '^          - ' /data/coolify/proxy/dynamic/cloudflare-only.yaml)"
sleep 3
sudo docker logs coolify-proxy --since 20s 2>&1 | grep -i -E "cloudflare-only|error" | tail -5
