import { afterEach, expect, it, vi } from "vitest";
import { openReportPreview } from "../client/src/lib/report-preview";
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const order: string[] = [];
  const button = { style: {}, onclick: undefined as undefined | (() => void) };
  const preview = {
    opener: {},
    closed: false,
    document: {
      title: "",
      body: { textContent: "", appendChild: vi.fn() },
      open: vi.fn(),
      write: vi.fn(() => order.push("write")),
      close: vi.fn(),
      createElement: vi.fn(() => button),
    },
    close: vi.fn(),
    print: vi.fn(),
  };
  const open = vi.fn(() => {
    order.push("open");
    return preview;
  });
  vi.stubGlobal("window", { open });
  return { order, preview, open, button };
}

it("opens during user activation before asynchronous report generation and isolates the opener", async () => {
  const { order, preview, button } = fixture();
  await openReportPreview(async () => {
    order.push("generate");
    await Promise.resolve();
    return { html: "<h1>Report</h1>" };
  });
  expect(order).toEqual(["open", "generate", "write"]);
  expect(preview.opener).toBeNull();
  expect(preview.document.write).toHaveBeenCalledWith("<h1>Report</h1>");
  button.onclick!();
  expect(preview.print).toHaveBeenCalledOnce();
});

it("does not generate a report when the popup is blocked", async () => {
  vi.stubGlobal("window", { open: () => null });
  const generate = vi.fn();
  await expect(openReportPreview(generate)).rejects.toThrow("Allow popups");
  expect(generate).not.toHaveBeenCalled();
});

it("closes the placeholder if generation fails and surfaces the actionable error", async () => {
  const { preview } = fixture();
  await expect(
    openReportPreview(async () => {
      throw Error("Your session expired");
    }),
  ).rejects.toThrow("Your session expired");
  expect(preview.close).toHaveBeenCalledOnce();
  expect(preview.document.write).not.toHaveBeenCalled();
});
