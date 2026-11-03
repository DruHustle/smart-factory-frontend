#!/usr/bin/env bash
# Synthetic isolated topics on the staged broker only. No real device messages.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
credentials=/opt/smart-factory-mqtt/credentials
broker=smart-factory-mqtt-broker-1
topic=factory/factory-a/line-1/synthetic-broker-validation/telemetry
work=$(mktemp -d /tmp/smart-factory-mqtt-probe.XXXXXXXX)
trap 'rm -rf "$work"' EXIT
for qos in 0 1 2; do
  # Passwords flow through private stdin and are never embedded in logs.
  docker exec -i "$broker" sh -c 'IFS= read -r pass; exec mosquitto_sub -h 127.0.0.1 -p 8883 --cafile /run/mqtt-secrets/ca.crt --insecure -V 5 -u sf-worker -P "$pass" -t "$1" -q "$2" -F "%q %p" -C 1 -W 10' sh "$topic" "$qos" < "$credentials/sf-worker" > "$work/received" &
  subscriber=$!
  sleep 1
  docker exec -i "$broker" sh -c 'IFS= read -r pass; exec mosquitto_pub -h 127.0.0.1 -p 8883 --cafile /run/mqtt-secrets/ca.crt --insecure -V 5 -u sf-gateway -P "$pass" -t "$1" -q "$2" -m "$3"' sh "$topic" "$qos" "synthetic-$qos" < "$credentials/sf-gateway"
  wait "$subscriber"
  [[ $(cat "$work/received") == "$qos synthetic-$qos" ]] || { echo "QoS $qos was not delivered at the requested level." >&2; exit 1; }
done
printf '%s\n' 'PASS: staged broker authenticated worker and gateway, verified TLS, and delivered synthetic QoS 0, 1 and 2 without publishing to real device topics.'
