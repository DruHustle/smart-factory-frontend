import { expect, type Page } from "@playwright/test";

export async function selectSection(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name, exact: typeof name === "string" });
  const select = page.getByRole("combobox", {
    name: /^(Item sections|Cybersecurity sections|Inventory views)$/,
  });
  await expect(tab.or(select).filter({ visible: true }).first()).toBeVisible();
  if (await tab.isVisible()) {
    await tab.click();
    return;
  }
  const pattern =
    typeof name === "string"
      ? new RegExp(
          "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: \\(.*\\))?$",
        )
      : name;
  const value = await select
    .locator("option")
    .filter({ hasText: pattern })
    .getAttribute("value");
  expect(value, `Section ${name} must be available`).not.toBeNull();
  await select.selectOption(value!);
}

export async function setTheme(page: Page, theme: "light" | "dark" | "system") {
  await page.getByRole("button", { name: /^Theme settings,/ }).click();
  await page
    .getByRole("menuitemradio", {
      name: theme[0].toUpperCase() + theme.slice(1),
      exact: true,
    })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Theme settings, ${theme}`, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  if (theme !== "system")
    await expect
      .poll(
        () =>
          page.evaluate(
            () => getComputedStyle(document.documentElement).colorScheme,
          ),
        // Software rendering can hold a DevTools style read for several seconds.
        // Assert the saved preference above and the actual computed scheme here.
        { timeout: 15000 },
      )
      .toBe(theme);
}
