# OT operations, investigations and handover

This guide describes the expanded OT workflow in the candidate source. Deployment is a separate qualification step: check the runtime contract and release identity before treating a candidate feature as available on a hosted site. The [incremental baseline map](ot-workflow-map.md) records what the preceding candidate supported.

## Where to work

| Question | Starting point | Evidence and next step |
| --- | --- | --- |
| What needs attention in this factory? | Overview, beside the factory floor | Severity-ranked open incidents. A named live factory applies membership before sorting and limiting. Open the incident to inspect the source, verified condition, acknowledgement and review separately. |
| Can I trust this reading? | Monitoring or the item workspace | Source connection, sample time, evidence mode, quality and configured validity. On-change values show whether they are held, expired or unverified. A keepalive never changes a measurement timestamp. |
| Is this alarm still physically active? | Alerts and incident investigation | Current source condition, last verified source evidence and acknowledgement are distinct from the investigation review and follow-up status. Unknown evidence stays unknown. |
| What happened in this window? | A single-source observation chart or incident | **Ask about this window** and **Investigate with Assistant** carry the source, signal, scope, incident and bounded time window to the Assistant. |
| What happened during this shift? | Overview → Operations and handover | Configured site timezone and shifts, production calculations, loss inputs and this/previous-shift notes. Current outstanding actions remain explicitly labelled as current work. |
| Why did production or utility intensity change? | Analytics → Operations and handover → Inputs and losses | Recorded production periods, product ideal-cycle inputs, overlapping stop treatment and meter boundaries. Cards open their inputs rather than implying a cause. |
| What should the next shift do? | Operations and handover → Handover | Append a finding and next step, link equipment or incidents, and review existing incident action owners/dates/outcomes. |

The process floor remains a spatial navigation surface. Numerical source evidence and accountable work remain available in adjacent panels and item workspaces. The plan view remains usable when WebGL is unavailable.

## Alarm condition and acknowledgement

`0037_ot_alarm_conditions` adds condition evidence without rewriting historical alerts as healthy or active. Existing events begin with an unknown source condition unless there is trustworthy new evidence.

A new condition evaluation requires a matching source, asset attribution and canonical metric, a reviewed threshold rule, eligible provenance, proper sample ordering and usable units. The evaluated rule is retained with the event. A trustworthy in-range measurement can record clearance for that event. A later re-breach after verified clearance creates a new event.

The UI distinguishes:

| Current condition | Acknowledgement | Meaning |
| --- | --- | --- |
| Active | Unacknowledged | The verified condition is active and has not been acknowledged. |
| Active | Acknowledged | Someone has acknowledged the event; the source condition remains active. |
| Cleared | Unacknowledged | Source evidence returned within the evaluated rule, but the event still needs acknowledgement. |
| Cleared | Acknowledged | The source condition cleared and the event was acknowledged. |
| Unknown | Either | Available evidence cannot establish the current condition. The last verified event evidence remains available. |

Acknowledgement, resolving an investigation, completing an action and writing a handover do not clear a physical alarm. Open queues include verified active events even if their investigation was manually resolved. Historical source-condition filters are labelled **last verified condition**; they do not claim that an expired observation is current.

Missing, bad-quality, retained, stale and out-of-order observations cannot manufacture clearance. Expired value validity, changed commissioning or changed threshold rules invalidate a current claim. An observed source/gateway disconnect interrupts continuity; a later communication heartbeat alone cannot restore the earlier value. A newer valid measurement is required. The evidence timestamp remains the actual observation time.

These rules describe software evidence. The application does not claim that a threshold event establishes the physical root cause.

## Cyclic and on-change acquisition

Commissioning supports cyclic and on-change acquisition. An engineer selecting on-change acquisition must configure a maximum held-value age, from 5 seconds to 24 hours. Communication freshness and value age remain separate settings.

A value can remain a valid held value while the source reports no change, within that configured age and without an observed continuity break. The UI preserves the original sample time. The API does not insert a new measurement for a heartbeat or silently renew held-value validity. After expiry or an observed interruption, the previous value remains historical evidence.

Transport and source-quality evidence are still required. Configuring an acquisition policy is not physical commissioning and does not create calibration, hardware feedback or a producer guarantee that was never supplied.

## Configured operations and production evidence

Operations can be configured for the installation or a named live factory. Engineer/admin users can select the shared IANA timezone directly from **Overview → Operations and handover**; the change applies to shift boundaries and dashboard chart times, including daylight saving. It does not configure the production boundary or approve the provisional shift schedule. Complete those settings, including shift starts, output unit, ideal cycle and meter boundary, before recording production. Existing timestamps remain unchanged; CSV exports and explicitly labelled UTC entry fields continue to use UTC.

Production periods are explicitly **manual production evidence**. They are separate from automatic process telemetry and its provenance controls. Enter the observed period, product, total/good output, ideal cycle, meter counter values, boundary and evidence description. Record planned and unplanned downtime with start, end and reason. The application does not claim an automatic MES or utility-meter integration.

The analysis uses the selected window, with a maximum of seven days for this workflow:

- Availability is operating time divided by planned production time.
- Performance is the sum of each product's ideal cycle multiplied by its total count, divided by operating time.
- Quality is good output divided by total output. OEE is availability × performance × quality.
- Overlapping stop intervals are counted once. Planned shutdown has precedence; overlapping unplanned reasons use the earliest onset, so the loss breakdown does not double-count time.
- Energy per good unit requires aligned meter/production boundaries, valid counter deltas and good-output evidence. A decreasing meter counter is a reset/invalid delta, not negative consumption.
- Recorded coverage is coverage of the entered production periods, not physical sensor availability. Partial periods, gaps, inconsistent rates and missing inputs expose calculation limitations. The application does not replace unknowns with zero or cap implausible performance into a plausible percentage.

Cards open **Inputs and losses**, which exposes A/P/Q, the downtime breakdown and the original records. Arbitrary cropped intervals cannot prorate aggregate counts into invented production. Before/after comparisons are meaningful only when boundaries, product mix and input completeness are comparable; the UI does not assert causal attribution.

Configuration writes use an expected version. Concurrent changes fail visibly instead of overwriting another engineer's settings. Production records are appended with their author and evidence, with overlap controls and transactional checks.

## Shift handover and follow-up

Shift boundaries use the configured site timezone, including explicit daylight-saving gap/fold handling. Previous/current/next-shift controls use those boundaries. Handover records retain the shift name, timezone and start/end that applied when written, so later schedule changes do not relabel historical work.

Operators, engineers and administrators can append a handover finding and next step in an operational workspace. Viewers can read it. Demo mode remains read-only. Equipment links and incident links are checked against current visibility and the selected factory. Notes are append-only and attributed to the writer.

The handover view shows notes for the current and previous shift, plus **outstanding actions now**. Action due dates and completion outcomes remain on their originating incidents. It is a deliberate distinction: an outstanding action is not a historical measurement for the selected shift.

## Assistant investigation handoff

The `assistant.askInContext` procedure validates the full investigation context server-side. A normal observation handoff includes a single asset or device, metric, evidence scope and start/end. An incident handoff can default to the bounded period around its recorded event. Windows are at most 24 hours.

The server checks source visibility, asset/device/incident consistency and named-factory membership. It queries the selected range, retains missing buckets and returns a bounded immutable snapshot with citations. Latest/current records are separately identified and do not become measurements from an earlier window.

Changing equipment, incident, scope or time window starts a new conversation evidence generation. Previous unrelated turns are not sent as follow-up context. An explicit investigation prevents automatic inference from replacing its source. Malformed or unsupported handoffs show a visible error instead of silently broadening to the factory.

The local Assistant fallback uses the same validated evidence without requiring an external provider. Provider responses receive the selected investigation and the distinction between observation, hypothesis and confirmed cause. The Assistant remains read-only.

## Recorded scenarios

Demo mode provides six named recorded scenarios: healthy operation, pump warning, utility-related production loss, gateway outage, planned maintenance and recovery. `otScenario` plus the selected UTC window travels through the scenario evidence, equipment links, Analytics and Assistant.

Scenario signals and aggregate calculations share the same deterministic inputs. Equipment/gateway references come from the installed showcase identity. The scenario panel labels itself **Recorded simulation — separate from baseline telemetry**; it does not rewrite stored process readings, acknowledge real incidents or create operational actions. The gateway-outage case retains gaps and unknown equipment state. Utility-loss wording records correlation and a hypothesis, not a confirmed diagnosis. Recovery retains a next-shift verification note.

## Runtime capabilities and rollback

The expanded API advertises `ot-alarm-conditions-v1`, `ot-operations-v1` and `ot-investigation-context-v1` alongside the existing review/actions capabilities. Controls are capability-gated. A previous compatible API can continue its existing workflows without silently accepting a new context it does not understand.

`0037_ot_alarm_conditions` adds alarm fields and permitted activity kinds. `0038_ot_operations` adds operations configuration, production periods, shift handover and audit tables. Application rollback retains these additive records; do not drop or reverse their tables as ordinary rollback. Older-API activity cannot falsely renew newer condition evidence.

Follow the existing [API-first Oracle/Vercel runbook](../deploy/oracle/README.md). Qualify the exact candidate and retained fallback, upgrade the API and singleton worker, verify actual migration digest/companion identities/worker compatibility, then promote the UI. See the [qualification record](ot-operations-qualification.md) for this implementation's measured results and limits.
