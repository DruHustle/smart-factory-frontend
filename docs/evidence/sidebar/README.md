# Shared sidebar verification

Every destination and group requires a Lucide outline icon in `client/src/lib/navigation.ts`. `NavigationLabel` renders every entry with a fixed 16px icon column, 1.75 stroke, 11px gap and 12px/16px medium text. Primary destinations and group headings share uppercase typography; subtopics retain their existing casing. Submenus use one 12px indentation. Active styles change colour and background without changing icon or text dimensions. Brand theme tokens are unchanged.

The desktop rail retains group icons and accessible labels when collapsed. A collapsed desktop preference does not hide mobile drawer labels. Selecting a destination closes the drawer and focuses main content; Escape restores focus to the navigation trigger. Sidebar transitions respect reduced motion.

## Rendered evidence

These captures use the actual application and isolated, read-only synthetic showcase records. They do not represent live factory state. Capture metadata and source hashes are in [capture.json](capture.json).

| Surface | Light | Dark |
| --- | --- | --- |
| Desktop, 1440px | [Screenshot](desktop-light.png) | [Screenshot](desktop-dark.png) |
| Collapsed desktop | [Screenshot](collapsed-light.png) | [Screenshot](collapsed-dark.png) |
| Mobile drawer, 360px | [Screenshot](drawer-360-light.png) | [Screenshot](drawer-360-dark.png) |
| Mobile drawer, 390px | [Screenshot](drawer-390-light.png) | [Screenshot](drawer-390-dark.png) |

## Checks

`e2e/navigation.spec.ts` checks all five individual roles (including legacy `user`) on the private fixture and all four shared demo roles on the public fixture, in both themes. It measures every heading and destination, verifies role-filtered entries, active route transitions, exact icon geometry/stroke, fixed spacing, submenu indentation, collapsed tooltips, mobile labels after desktop collapse, drawer keyboard focus and document overflow at 360/390/768/1024/1440px.

Run both scopes; each intentionally skips accounts belonging to the other deployment policy:

```sh
pnpm e2e:workspace --config=playwright.navigation.config.ts
pnpm e2e:public-demo --config=playwright.navigation.config.ts
pnpm check
pnpm build
```

The dedicated Sidebar roles and responsive layout CI job runs both scopes and retains isolated browser evidence.
