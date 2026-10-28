# Smart Factory UI and backend review — 28 October 2026

This review covers the React application, its Express/tRPC API, the .NET companion
services and the Raspberry Pi gateway. Changes in this review are in the frontend
repository, which also owns the application API. The companion services and edge
code were reviewed and tested without source changes.

## Reviewed baseline

| Source | Revision |
| --- | --- |
| Frontend repository and deployed UI | `770ccf37de9eb414caad29f00a2c945ea1e3070a` |
| Backend repository | `f2c7702162952d872527cf1bc9aaf0bd8be94029` |
| Edge repository | `913bafdad3299a16b12b9dbb6474bd5382834753` |
| Deployed application API | `a88cadd6d7b4bb19f23e1c3872389cd9c47ee726` |
| Deployed .NET companion source | `d26dc027929fe4c35b1f42611c90f1fbcdc43136` |
| Deployed edge qualification source | `ba75382254f6a37095a44b69ff3bb6d0ef2d04bf` |

The public `release.json`, API runtime contract and Oracle `/health/ready` returned
HTTP 200 during review. The API reported schema `0030_infrastructure_monitor`
ready, a fresh compatible worker and the required capability contract. These are
observations of the baseline, not deployment evidence for the changes below.

## Corrected findings

| Priority | Gap | Correction and regression evidence |
| --- | --- | --- |
| High | Sign-in throttling read unbatched inputs although the browser uses single-operation tRPC batches. Encoded and nested procedure paths could also miss the limiter. Multiple credential checks shared one charge. | The limiter now follows the adapter's final path segment and decoding rules, reads the actual batch envelope and first URL query value, rejects mixed/repeated credential batches and preserves shared hashed IP/account counters. HTTP tests exercise the real tRPC client, rotating source IPs, encoded paths, duplicate query keys, fail-closed storage and actionable 429 responses. |
| Medium | Browser-origin/CORS middleware was registered after export and operating-evidence routes. Approved separate UI origins could not read those responses, and earlier routes did not share the mutation-origin boundary. | Install the same policy before all API registrations. An HTTP regression verifies credentialed export headers, preflight handling, denied-origin containment and existing service callers. Each endpoint retains its independent authentication. |
| Medium | Assistant evidence used the legacy stored `online` field while the rest of the UI reported observed state. This contradiction was visible in the deployed Assistant. | Supply observed status, with unknown fallback, to both provider context and grounded prose. Regressions cover live, stale, offline and unknown observations against a stored online flag. |
| Medium | SQL inventory/monitoring counts accepted freshness metadata outside the commissioned bounds, while displayed device rows rejected it. Future offline receipts were also classified in a different order. | Share bounded metadata interpretation across the two SQL projections and device rendering, and align future-receipt handling. Unit coverage checks invalid policies; a disposable PostgreSQL regression compares counts, filters and displayed states across all three paths. |
| Medium | Each Assistant provider/model attempt had its own timeout; successive slow failures could exhaust an API request before local fallback. | All remote attempts now share a 24-second budget while retaining the existing per-request timeout. An abort regression verifies that remote work stops and local fallback remains available. |
| Medium | A render failure appeared as an unfinished “Coming Soon” feature. Its home action used a router outside the application's hash-routing context, and retrying a rejected lazy import did not reload its cached failure. | Present a themed, accessible error screen with real reload and hash-based Overview recovery. Production error details remain hidden. |
| Medium | Custom Analytics inputs relied on a nonempty From parameter to stay visible. Invalid or partially edited dates could also silently fall back to a preset; fractional aggregation links reached integer-only API validation. | Retain explicit custom-range state, require both valid UTC dates, reject invalid calendar dates and unsupported ranges, normalize aggregation choices and avoid requests for incomplete ranges. Unit regressions cover malformed links; the existing responsive journey now clears and restores a custom date. |
| Medium | PDF preview opened only after the report request finished, losing the original click's browser popup activation. | Reserve the preview synchronously, isolate its opener, show preparation state and close it on failed generation. Blocked popups avoid unnecessary generation; actionable errors reach the user. Three regressions verify ordering and failure recovery. |
| Low | The renderer requested a removed Three.js shadow mode, producing warnings on Overview and model inspection. | Use the supported PCF shadow mode already selected by Three.js's compatibility fallback. |
| Low | Notifications and password management displayed the generic “Factory workspace” page title. | Name these destinations consistently in the header and browser title. |

No database schema migration is required. Multiple credential mutations in a
single HTTP batch are now deliberately rejected; the application's single-operation
auth client remains supported. Other query and mutation batching is unchanged.

## Coverage and evidence

Live UI inspection used the existing shared engineer demonstration. It covered
Overview, inventory, monitoring, alerts, Analytics, Assistant, notifications,
Service health, cybersecurity, firmware, demonstration administration, the model
catalogue and an installed equipment workspace. A 390×844 viewport was used for
the main mobile workspaces; those checked pages had no document horizontal
overflow. The model catalogue and equipment workspace loaded interactive models.
The removed-shadow warning was reproduced in the deployed baseline.

Source review also covered role/session boundaries, public registration,
commissioning/ingestion/provenance, telemetry aggregation, AAS import/proxying,
report generation, notification delivery, infrastructure probes, runtime identity,
worker readiness and gateway queue/retry contracts. Existing regressions for
those paths were run where their dependencies were available. Private administrator
workflows were assessed through source and tests; the live walkthrough does not
grant private account or operational access.

| Local check | Result |
| --- | --- |
| TypeScript | Passed |
| Production Vite build | Passed; the existing lazy-loaded renderer remains the largest chunk |
| Frontend/application API tests | 393 passed; 102 database-dependent tests skipped without disposable PostgreSQL |
| .NET companion unit tests | 241 passed with `Category!=Postgres` |
| Raspberry Pi gateway tests | 78 passed |
| Oracle/Vercel deployment configuration check | Passed |
| Diff whitespace validation | Passed |
| Full documentation rendering | Blocked locally by Chromium's unavailable Unix socket support; requires the existing CI job |
| Disposable PostgreSQL and full browser journeys | Require the existing isolated CI services; not claimed as locally passed |

The build and TypeScript checks use the installed dependency set matching the
repository lock. Physical hardware was not commanded, flashed or commissioned;
the review did not send email or change live operational records.

## Promotion and remaining operating acceptance

The production API and UI must receive the same reviewed changes. Follow the
[Oracle API-first qualification and promotion runbook](../deploy/oracle/README.md),
including immutable source identities, the singleton worker, compatible rollback,
required schema/capabilities and public-artifact verification. A passing UI build
alone does not qualify an API image. CI and deployment results must be checked
against the final commit; the baseline health responses above do not qualify this
candidate.

Native OTA remains correctly disabled until a verified update service and receiver
exist. Physical commissioning, an independently verified production restore, and
external Onesa consumer acceptance remain operating acceptance items described in
the [operating guide](operations.md), not outcomes established by this review.
