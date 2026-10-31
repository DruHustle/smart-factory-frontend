import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

async function fixture(fragment: string) {
  vi.resetModules();
  let url = new URL(`https://factory.example/${fragment}`);
  const history = {
    state: null,
    replaceState: vi.fn((_state: unknown, _unused: string, next: string) => {
      url = new URL(next, url);
    }),
  };
  vi.stubGlobal("window", {
    get location() {
      return url;
    },
    history,
  });
  return {
    link: await import("../client/src/lib/password-recovery-link"),
    current: () => url,
    history,
    navigate: (fragment: string) => {
      url.hash = fragment;
    },
  };
}

it("removes a reset credential from the address bar while keeping it only for the form", async () => {
  const token = "a".repeat(43);
  const { link, current } = await fixture(`#/reset-password?token=${token}`);
  link.capturePasswordResetToken();
  expect(current().href).toBe("https://factory.example/#/reset-password");
  expect(link.passwordResetToken()).toBe(token);
  link.clearPasswordResetToken();
  expect(link.passwordResetToken()).toBeNull();
});

it("notifies an existing form when a replacement link arrives in the same tab", async () => {
  const first = "a".repeat(43),
    second = "b".repeat(43);
  const { link, navigate, current } = await fixture(
    `#/reset-password?token=${first}`,
  );
  const changed = vi.fn();
  const unsubscribe = link.subscribePasswordResetLink(changed);
  link.capturePasswordResetToken();
  const revision = link.passwordResetSnapshot().revision;
  navigate(`#/reset-password?token=${second}`);
  link.capturePasswordResetToken();
  expect(link.passwordResetSnapshot()).toEqual({
    token: second,
    revision: revision + 1,
  });
  expect(changed).toHaveBeenCalledTimes(2);
  expect(current().hash).toBe("#/reset-password");
  unsubscribe();
});

it("keeps filtering analytics across navigation and delayed recovery events", async () => {
  const { link, navigate } = await fixture("#/inventory");
  const normal = {
    url: "https://factory.example/#/inventory",
    type: "pageview",
  };
  expect(link.filterPasswordRecoveryAnalytics(normal)).toBe(normal);
  navigate("#/reset-password");
  expect(link.filterPasswordRecoveryAnalytics(normal)).toBeNull();
  navigate("#/inventory");
  expect(
    link.filterPasswordRecoveryAnalytics({
      url: "https://factory.example/#/reset-password?token=redacted",
      type: "pageview",
    }),
  ).toBeNull();
});

it("redacts malformed recovery links without accepting their credentials", async () => {
  const { link, current } = await fixture(
    "#/reset-password?token=malformed&tracking=ignored",
  );
  link.capturePasswordResetToken();
  expect(current().hash).toBe("#/reset-password");
  expect(link.passwordResetToken()).toBeNull();
});

it("does not treat other workspace query parameters as recovery credentials", async () => {
  const { link, current, history } = await fixture(
    "#/inventory?token=unrelated",
  );
  link.capturePasswordResetToken();
  expect(current().hash).toBe("#/inventory?token=unrelated");
  expect(link.passwordResetToken()).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
});
