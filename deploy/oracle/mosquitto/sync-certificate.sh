#!/usr/bin/env bash
# Copy only the existing Smart Factory API certificate into the broker's
# protected directory and reload after Caddy renews it. Run as root.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source_dir=/var/lib/docker/volumes/smart-factory-basyx_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/api.152-70-22-84.sslip.io
secret_dir=/opt/smart-factory-mqtt/secrets
certificate="$source_dir/api.152-70-22-84.sslip.io.crt"
private_key="$source_dir/api.152-70-22-84.sslip.io.key"
[[ -d $secret_dir && -f $certificate && -f $private_key ]] || { echo 'Certificate or protected broker directory unavailable.' >&2; exit 1; }
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$certificate" -verify_hostname api.152-70-22-84.sslip.io "$certificate" >/dev/null
openssl x509 -in "$certificate" -noout -checkend 86400 >/dev/null
cert_pub=$(openssl x509 -in "$certificate" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_pub=$(openssl pkey -in "$private_key" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[[ $cert_pub == "$key_pub" ]] || { echo 'Certificate and private key do not match.' >&2; exit 1; }
if cmp -s "$certificate" "$secret_dir/server.crt" && cmp -s "$private_key" "$secret_dir/server.key"; then exit 0; fi
umask 077
install -o 1883 -g 1883 -m 0400 "$certificate" "$secret_dir/server.crt.new"
install -o 1883 -g 1883 -m 0400 "$private_key" "$secret_dir/server.key.new"
mv -f "$secret_dir/server.crt.new" "$secret_dir/server.crt"
mv -f "$secret_dir/server.key.new" "$secret_dir/server.key"
if docker inspect smart-factory-mqtt-broker-1 >/dev/null 2>&1; then
  docker kill --signal HUP smart-factory-mqtt-broker-1 >/dev/null
fi
