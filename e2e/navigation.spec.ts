import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { setTheme } from "./experience-helpers";

type Persona = { role: string; demo: boolean };
const personas: Persona[] = [
  ...["user", "viewer", "operator", "engineer", "admin"].map((role) => ({
    role,
    demo: false,
  })),
  ...["Viewer", "Operator", "Engineer", "Admin"].map((role) => ({
    role,
    demo: true,
  })),
];
const evidence =
  process.env.NAVIGATION_EVIDENCE_DIR ?? "test-results/navigation/screenshots";

async function login(page: Page, persona: Persona) {
  await page.goto("/#/login");
  if (persona.demo) {
    await page
      .getByRole("button", { name: `Demo ${persona.role}`, exact: true })
      .click();
  } else {
    await page
      .getByLabel("Email")
      .fill(`security-${persona.role}@example.test`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-security-only-2026!");
  }
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

async function checkLayout(
  nav: Locator,
  collapsed = false,
  infrastructure = false,
) {
  await expect(nav.locator("[data-sidebar=menu-button]").first()).toHaveCSS(
    "height",
    collapsed ? "32px" : "40px",
  );
  if (collapsed) await expect(nav).toHaveCSS("width", "48px");
  const headings = nav.locator("[data-navigation-heading]");
  await expect(headings).toHaveCount(infrastructure ? 6 : 5);
  const rows = await nav
    .locator("[data-navigation-layout]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const label = node.querySelector<HTMLElement>(
          "[data-navigation-label]",
        )!;
        const icons = node.querySelectorAll<SVGElement>(
          "[data-navigation-icon]",
        );
        const icon = icons[0];
        const style = getComputedStyle(label);
        const box = icon.getBoundingClientRect();
        const row = node.closest("a,button")!;
        const rowStyle = getComputedStyle(row);
        const bounds = row.getBoundingClientRect();
        return {
          text: label.textContent,
          heading: label.hasAttribute("data-navigation-heading"),
          count: icons.length,
          width: box.width,
          height: box.height,
          x: box.x,
          labelX: label.getBoundingClientRect().x,
          rowWidth: bounds.width,
          rowHeight: bounds.height,
          paddingLeft: rowStyle.paddingLeft,
          font: style.fontSize,
          weight: style.fontWeight,
          spacing: style.letterSpacing,
          line: style.lineHeight,
          casing: style.textTransform,
          stroke: icon.getAttribute("stroke-width"),
          fill: icon.getAttribute("fill"),
          labelPosition: style.position,
        };
      }),
    );
  const baseX = rows.find((row) => row.text === "Overview")!.x;
  for (const row of rows) {
    expect(row.count, `${row.text} must have one configured icon`).toBe(1);
    expect(row.width).toBe(16);
    expect(row.height).toBe(16);
    expect(row.stroke).toBe("1.75");
    expect(row.fill).toBe("none");
    expect(row.font).toBe("12px");
    expect(row.weight).toBe("500");
    expect(row.line).toBe("16px");
    // Chromium serializes zero tracking as the CSS keyword "normal".
    expect(row.spacing).toBe("normal");
    expect(row.casing).toBe(row.heading ? "uppercase" : "none");
    expect(row.x - baseX, `${row.text} icon alignment`).toBe(
      collapsed || row.heading ? 0 : 12,
    );
    expect(row.paddingLeft).toBe("8px");
    expect(row.rowHeight).toBe(
      collapsed &&
        ![
          "Operations",
          "Insights",
          "Infrastructure",
          "Tools & settings",
        ].includes(row.text!)
        ? 32
        : 40,
    );
    if (collapsed) expect(row.labelPosition).toBe("absolute");
    else
      expect(
        row.labelX - row.x,
        `${row.text} fixed icon column and spacing`,
      ).toBe(27);
  }
}

async function capture(page: Page, name: string) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/${name}.png`,
    animations: "disabled",
  });
}

for (const persona of personas)
  for (const theme of ["light", "dark"] as const) {
    test(`${persona.demo ? "shared demo" : "individual"} ${persona.role}: aligned desktop, collapsed and mobile navigation (${theme})`, async ({
      page,
    }) => {
      test.skip(
        persona.demo
          ? process.env.PUBLIC_DEMO_E2E !== "true"
          : process.env.WORKSPACE_E2E !== "true",
        "Individual roles use the private installation fixture; shared roles use the public demo fixture.",
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await login(page, persona);
      await setTheme(page, theme);
      const nav = page.getByRole("navigation", { name: "Primary navigation" });
      const engineering =
        persona.demo || ["engineer", "admin"].includes(persona.role);
      const infrastructure = persona.demo || persona.role === "admin";
      const expected = [
        "Overview",
        "Assets & devices",
        "Monitoring",
        "FX & TSN",
        "Alerts",
        ...(engineering ? ["Firmware & updates"] : []),
        "Cybersecurity",
        "Analytics",
        ...(infrastructure ? ["Service health"] : []),
        "Assistant",
        "Factory layouts",
        ...(persona.demo ? ["Editable demo", "Demo guide"] : []),
        ...(engineering ? ["Administration"] : []),
      ];
      await expect(nav.locator("[data-sidebar=menu-button]")).toHaveCount(
        expected.length,
      );
      for (const name of expected)
        await expect(
          nav.getByRole("link", { name, exact: true }),
        ).toBeVisible();
      if (!engineering) {
        await expect(
          nav.getByRole("link", { name: "Administration", exact: true }),
        ).toHaveCount(0);
        await expect(
          nav.getByRole("link", { name: "Firmware & updates", exact: true }),
        ).toHaveCount(0);
      }
      if (!infrastructure)
        await expect(
          nav.getByRole("link", { name: "Service health", exact: true }),
        ).toHaveCount(0);
      await checkLayout(nav, false, infrastructure);

      // Visit every configured destination in the widest role state. Active styling
      // is checked after real route transitions, including a nested item workspace.
      for (const name of persona.role.toLowerCase() === "admin"
        ? expected
        : ["Assets & devices", "Monitoring"]) {
        const link = nav.getByRole("link", { name, exact: true });
        await link.click();
        await expect(link).toHaveAttribute("aria-current", "page");
        await checkLayout(nav, false, infrastructure);
      }
      await nav
        .getByRole("link", { name: "Assets & devices", exact: true })
        .click();
      const record = persona.demo && persona.role === "Engineer";
      if (record) await capture(page, `desktop-${theme}`);

      await nav
        .getByRole("button", { name: "Toggle navigation", exact: true })
        .click();
      await expect(page.locator('[data-collapsible="icon"]')).toHaveAttribute(
        "data-state",
        "collapsed",
      );
      await checkLayout(nav, true, infrastructure);
      await nav.getByRole("link", { name: "Monitoring", exact: true }).hover();
      await expect(
        page.getByRole("tooltip", { name: "Monitoring", exact: true }),
      ).toBeVisible();
      if (record) await capture(page, `collapsed-${theme}`);

      // Resize while desktop remains collapsed: mobile must still show all labels.
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const trigger = page.locator('[data-sidebar="trigger"]');
        await trigger.click();
        const drawer = page.getByRole("dialog");
        await expect(drawer).toBeVisible();
        await checkLayout(drawer, false, infrastructure);
        for (const name of expected)
          await expect(
            drawer.getByRole("link", { name, exact: true }),
          ).toBeVisible();
        if (record) await capture(page, `drawer-${width}-${theme}`);
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await trigger.click();
        await drawer
          .getByRole("link", { name: "Monitoring", exact: true })
          .click();
        await expect(drawer).not.toBeVisible();
        await expect(page.locator("#dashboard-main")).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 768, height: 1000 });
      await nav
        .getByRole("button", { name: "Toggle navigation", exact: true })
        .click();
      for (const width of [768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await checkLayout(nav, false, infrastructure);
      }
      expect(errors).toEqual([]);
    });
  }
