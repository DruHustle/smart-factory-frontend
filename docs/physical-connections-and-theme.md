# 3D wires and pipes; stable login and navigation

The **Floor plan** retains its schematic connection lines and registered endpoints. The **3D floor** instead renders wires/cables and pipes as shaded tube meshes with endpoint couplings. These are visual representations of registered links, not proof of installed wiring, surveyed pipework or commissioned connectivity. Process links initially use pipe styling; acquisition, gateway and FX links initially use cable styling. Change the representation when another visual type is appropriate.

## Configure a route

Open **3D wires & pipes** above the 3D canvas and select a connection. Choose **Wire / cable** or **Pipe**, and then **Straight**, **Rounded elbows**, **Curved**, or **Custom points**. Adjust route height, diameter, bend radius/rise and colour. Numeric values use metres and are committed when leaving the field or pressing Enter. Invalid or unbounded values are rejected without applying them.

For a custom shape, add up to twelve ordered bend points. X is left/right, Y is height and Z is front/back in the factory coordinate system. Each point can be edited, moved earlier/later, or removed. The endpoints follow the equipment when it moves or rotates; custom intermediate points stay at their configured world coordinates. The Fit control includes route bounds. Routes are illustrative and are **not collision-checked** against machinery or buildings.

**Reset this route** restores the visual defaults for that connection only. None of these controls changes an operational connection, equipment position, device configuration or floor-plan line. Existing click-and-hold pan, opt-in hover rotation, equipment selection/dragging, zoom and fullscreen remain available.

## Persistence and recovery

Routing appearance is stored in the current browser, separated by account, data workspace and factory/layout scope. Named factories use their stable factory identity; personal layout studies use the layout name. Renaming a personal study selects a different routing scope. Appearance settings are not yet part of team-shared account layout saves or layout JSON exports; another browser does not receive them automatically.

Stored values are validated before use. Unreadable routing is retained and defaults are displayed with a warning; only the explicit **Reset unreadable 3D routing** control replaces it. If browser storage is unavailable or full, changes remain usable for the current view with a warning that they were not saved. Clearing site data removes these browser-local appearance preferences.

## Theme boundaries

The login page retains its industrial photograph, dark overlay and dark form regardless of the workspace theme. The left navigation, collapsed rail, mobile navigation drawer, account menu and loading skeleton retain the dark brand palette. The main workspace still supports **Light**, **Dark** and **System**, and its saved preference is not changed when displaying the login or navigation surfaces.

## Automated acceptance

`server/factory-connections.test.ts` checks finite tube geometry, endpoint attachment, route bounds, stable identities, storage validation, selection isolation, caching and disposal. `e2e/factory-connections-theme.spec.ts` exercises routing controls and persistence, unchanged floor-plan lines and equipment positions, mobile/fullscreen presentation, invalid/corrupt storage handling, and login/navigation theme isolation. These browser checks run in the existing required overview-contract CI job, alongside the unchanged overview and layout regressions.
