# Telemetry identity, route and transport contract

## Canonical identity

Device, gateway, site and line identifiers use 1-64 ASCII characters: an initial letter or digit, followed by letters, digits, underscore, hyphen, dot or colon. Examples: `sensor.temp:01`, `sensor-01`, `legacy_01`. MQTT wildcards, slashes, percent signs and control characters are not canonical identities. Asset/AAS identities are a separate documented field and are not inferred from device IDs.

Registration, Node, .NET, edge and firmware independently enforce this grammar. Previously accepted canonical identities remain unchanged. Existing source links and commissioned routes are explicit; telemetry cannot rename or reparent records. Unknown identifiers enter bounded reviewable quarantine rather than becoming operational inventory.

## mqtt-topic-v1

Payload identity and transport routing are separate. RabbitMQ translates MQTT slash-separated topics to dot-separated AMQP routing keys, so raw dots inside a topic level are ambiguous. The transport codec replaces each literal dot with `%2E` in site, line and device levels. Other canonical characters are unchanged. The receiver reverses only this escape and validates the resulting canonical identity against the payload.

```text
Canonical deviceId: sensor.temp:01
MQTT topic: factory/site:01/line%2E01/sensor%2Etemp:01/telemetry
Payload: {"deviceId":"sensor.temp:01", ...}
```

The same codec applies to heartbeat, gateway commands and software acknowledgements. Percent-encoded slashes/wildcards, nested percent escapes and invalid canonical identities are rejected. Raw dotted local topics remain readable on brokers that preserve them; the Pi normalizes them before cloud forwarding. Old valid spool entries are encoded during publication without rewriting their stored acquisition evidence or canonical identity.

The complete encoded route must fit the broker's 255-byte routing bound. Standard `factory-a` / `line-1` scope supports every accepted 64-character device ID. For longer configured site/line scopes, validate the complete route and shorten the scope if needed; do not rename a registered device silently. Firmware rejects invalid/oversized configured routes before networking.

A broker ACL must authorize the encoded topic literally. Updating an identity record does not update existing publisher firmware, broker credentials or ACLs. Review these commissioning changes explicitly; this release does not mutate factory broker configuration.

Primary protocol/provider references: [RabbitMQ topic separator limitations](https://www.rabbitmq.com/docs/mqtt#topic-level-separator-and-wildcards), [OASIS MQTT 5](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html).

## Delivery and current observations

The singleton .NET worker and Pi-local subscriber use MQTT 5 persistent sessions with Retain As Published subscriptions. MQTT 3.1.1 publishers remain supported through the broker. Actual SUBACK verification establishes transport context. Retained delivery cannot be cleared by a publisher's payload assertion.

Pre-verification deliveries and old outbox records without verified flags remain historical. The worker preserves an upstream false/unknown context for gateway children rather than upgrading it to verified current evidence. Mode, quality, allowed lateness, clock skew, read errors and monotonic state are independently checked. Historical original live acquisitions are not relabelled as replay merely because delivery was delayed.

Acquisition time, gateway receipt, server receipt and queue acceptance remain distinct. Duplicates do not create new current effects. Source units and raw values, canonical conversions, mapping version and quality remain inspectable. Unknown legacy units are not guessed.

## Qualification

The disposable trusted-path runner uses real Pi-local Mosquitto ingress, edge durable publication, separate RabbitMQ or Mosquitto cloud routing, .NET 10, Node and PostgreSQL. It checks punctuation and legacy IDs, unit conversions, mixed scopes, retained and unverified transport, restarts, permanent route/identity quarantine and identity-preserving backup/restore. These tests use synthetic inputs and do not establish a hosted broker, hardware or production backup outcome.
