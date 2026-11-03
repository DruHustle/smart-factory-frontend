#!/usr/bin/env bash
# Prepare an isolated, loopback-only broker. Does not change any existing MQTT
# clients, CloudAMQP, firewall rules or deployed application containers.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source_dir=${1:?Pass the reviewed broker package directory}
target=/opt/smart-factory-mqtt
image='eclipse-mosquitto:2.1.2-alpine@sha256:860aeb5d63ce509508f6dcfb2bc8a1c1dd2bc60555b562b45ce90e52d8dabb0f'
[[ ! -e $target ]] || { echo 'Broker directory already exists; inspect it rather than overwriting.' >&2; exit 1; }
for file in compose.yaml mosquitto.conf acl sync-certificate.sh smart-factory-mqtt-cert.service smart-factory-mqtt-cert.timer; do
  [[ -f $source_dir/$file && ! -L $source_dir/$file ]] || { echo "Missing reviewed package file: $file" >&2; exit 1; }
done
if ss -lnt | awk 'NR>1 {print $4}' | grep -Eq '(^|:)8883$'; then
  echo 'Port 8883 is already in use; nothing was changed.' >&2; exit 1
fi
umask 077
install -d -m 0755 "$target"
install -d -o root -g 1883 -m 0750 "$target/secrets"
install -d -o root -g root -m 0700 "$target/credentials"
for file in compose.yaml mosquitto.conf acl; do install -o root -g root -m 0644 "$source_dir/$file" "$target/$file"; done
install -o root -g root -m 0755 "$source_dir/sync-certificate.sh" "$target/sync-certificate.sh"
install -o 1883 -g 1883 -m 0444 /etc/ssl/certs/ca-certificates.crt "$target/secrets/ca.crt"
for user in sf-gateway sf-worker sf-control sf-health; do
  openssl rand -hex 32 > "$target/credentials/$user"
  printf '%s:' "$user" >> "$target/secrets/passwords"
  cat "$target/credentials/$user" >> "$target/secrets/passwords"
done
# Convert the transient root-only password file in place without passing any
# credentials in the Docker command line or logs.
docker run --rm --user 0:0 -v "$target/secrets:/work" --entrypoint mosquitto_passwd "$image" -U /work/passwords >/dev/null
chown 1883:1883 "$target/secrets/passwords"
chmod 0400 "$target/secrets/passwords"
install -o 1883 -g 1883 -m 0400 "$target/credentials/sf-health" "$target/secrets/health-password"
"$target/sync-certificate.sh"
printf 'MQTT_SECRET_DIR=%s\nMQTT_BIND_ADDRESS=127.0.0.1\nMQTT_PORT=8883\n' "$target/secrets" > "$target/.env"
chmod 0600 "$target/.env"
docker compose --env-file "$target/.env" -f "$target/compose.yaml" up -d --wait
install -o root -g root -m 0644 "$source_dir/smart-factory-mqtt-cert.service" /etc/systemd/system/smart-factory-mqtt-cert.service
install -o root -g root -m 0644 "$source_dir/smart-factory-mqtt-cert.timer" /etc/systemd/system/smart-factory-mqtt-cert.timer
systemctl daemon-reload
systemctl enable --now smart-factory-mqtt-cert.timer >/dev/null
printf '%s\n' 'Broker staged on loopback with TLS, distinct credentials, persistent storage and certificate renewal. Existing clients were not changed.'
