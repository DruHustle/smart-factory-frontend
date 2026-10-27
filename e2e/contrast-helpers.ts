import { expect, type Page } from "@playwright/test";
/** WCAG relative luminance from the actual resolved application theme tokens. */
export async function measureThemeContrast(page: Page) {
  const values = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      [
        "background",
        "foreground",
        "card",
        "card-foreground",
        "muted-foreground",
        "primary",
        "primary-foreground",
        "accent",
        "accent-foreground",
        "success",
        "warning",
        "destructive",
        "info",
        "chart-1",
        "chart-2",
        "input",
        "ring",
      ].map((k) => [k, s.getPropertyValue("--" + k).trim()]),
    );
  });
  const luminance = (hex: string) => {
    const c = hex.replace("#", "");
    if (!/^[a-f\d]{6}$/i.test(c))
      throw Error("Expected resolved sRGB theme token: " + hex);
    const v = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratios: Record<string, number> = {};
  for (const [front, back, min] of [
    ["foreground", "background", 4.5],
    ["card-foreground", "card", 4.5],
    ["muted-foreground", "card", 4.5],
    ["primary-foreground", "primary", 4.5],
    ["accent-foreground", "accent", 4.5],
    ["primary", "card", 4.5],
    ["success", "card", 4.5],
    ["warning", "card", 4.5],
    ["destructive", "card", 4.5],
    ["info", "card", 4.5],
    ["chart-1", "card", 3],
    ["chart-2", "card", 3],
    ["ring", "card", 3],
    ["input", "card", 3],
  ] as const) {
    const a = luminance(values[front]),
      b = luminance(values[back]),
      ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    ratios[front + "/" + back] = ratio;
    expect(ratio, front + "/" + back).toBeGreaterThanOrEqual(min);
  }
  return {
    method: "WCAG sRGB relative luminance of resolved rendered theme tokens",
    values,
    ratios,
  };
}
