# Factory troubleshooting

## Missing readings or offline gateway

For a **local** dashboard, first verify that the Pi and TelemetryService use the same upstream broker. The local Docker RabbitMQ MQTT listener is bound to `127.0.0.1:1883` on the development computer, so a physical Pi on another machine cannot reach it directly. `127.0.0.1` in the Pi's `MQTT_HOST` also means the Pi itself, not the development computer. A Pi connected to its Wrover over the Pi-local broker can still appear Offline in the dashboard when its upstream MQTT target differs. Check the Pi's `DEVICE_ID` against the gateway ID shown in Devices; the repository's ignored local simulator `.env.local` is not evidence of the physical Pi's settings. A simulator needs its own explicitly registered identity. Unknown incoming IDs are quarantined for review and never create operational inventory automatically. Do not mark a gateway Online by hand or publish synthetic data under a physical gateway's ID to diagnose a production connection.

1. Open **Monitoring**, identify the gateway, and compare **Last seen** with the telemetry sample timestamp. An old stored sample does not prove equipment is running now.
2. Open the asset's **AAS** as an engineer and confirm the gateway, protocol, endpoint and mappings match the commissioned equipment. Each reading must identify the correct AAS asset.
3. On the Pi, inspect `journalctl -u smart-factory-edge --since '15 minutes ago'`. Check broker DNS, clock, CA trust, credentials and topic ACLs; do not disable TLS verification.
4. Check TelemetryService readiness, database connectivity and the dashboard ingestion bridge. Confirm that the broker shows an MQTT connection for the Pi and that TelemetryService subscribes to both `/telemetry` and `/heartbeat`. A successful MQTT publish is only broker acceptance. A heartbeat updates gateway connectivity without creating a sensor reading; a non-demo gateway is shown Offline after two minutes without a report.
5. Verify that a new timestamp and the expected asset-specific values reach Monitoring and Analytics. A communication fault alone does not confirm factory downtime.

## Critical temperature, vibration, pressure or power incident

1. Open **Alerts** and click the event row. Inspect its error code, measured metric, reported value, configured threshold and timestamp.
2. Compare the engineering units and scaling with the equipment manual. A threshold breach is evidence to investigate; it is not a diagnosed root cause.
3. Acknowledge as an operator or higher. An engineer/admin can assign an engineer account using **Assign technician**. Viewers and operators must request engineering access.
4. Follow the site's equipment isolation and maintenance procedure. The assigned technician/admin records **Record downtime start** only when an outage is confirmed.
5. Confirm recovery with fresh telemetry and the commissioned equipment checks, then choose **Resolve incident**. Acknowledgement leaves the incident open.

## Technician assignment and permission error

Open the event details from **Alerts**. Assignment requires engineer or admin access and an engineer-role technician account. Administrators manage roles in **User Access**. The assigned technician or an administrator can record downtime and resolve an open incident. If a role recently changed, refresh the session. A forbidden API response must never be worked around by changing browser state.

## Unexpected analytics or no samples

Select the asset and the relevant time range in **Analytics**. Check whether its AAS identifier is stored on readings; sharing a gateway must not mix machine samples. Verify sample timestamps, mapping units and scaling before comparing equipment. Missing values remain unavailable, rather than zero. Broader requests can exceed the sample limit; choose fewer assets or a shorter range. Trends are descriptive comparisons, not failure predictions. OEE needs planned production and good/total counts; energy needs time-integrated metering; MTBF needs a complete failure and operating-time history.

## Device control request without confirmed movement

An ADA031 jog requires engineer/admin access, a live asset with an `ada031_v4_serial` profile, a locally allowlisted asset ID and a non-retained command that has not expired. Check the Pi acknowledgement and serial permissions. **Serial write accepted** confirms a byte write, not physical movement; the stock controller provides no position feedback. Never retry a motion blindly or use application controls as an emergency stop. Follow the commissioned bench procedure in the edge repository.

## Firmware or OTA update unavailable

This release has no verified remote firmware updater. **OTA Updates** displays inventory and unconfirmed legacy records; deployment and rollback requests are rejected without changing a device. Use the edge repository's staged Pi deployment or USB firmware upload procedure. A production OTA path must verify signed compatible artifacts, installation and boot acknowledgements, staged rollout and recovery on the actual target hardware before it is enabled.
