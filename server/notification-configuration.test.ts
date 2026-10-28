import { afterEach, describe, expect, it } from "vitest";
import { notificationConfiguration } from "./notifications";

const keys = ["EMAIL_PROVIDER", "EMAIL_DELIVERY_CONFIGURED", "SMTP_USERNAME", "SMTP_FROM"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("notification configuration", () => {
  it("does not require the SMTP password in the API process", () => {
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_USERNAME = "smartfactory.notifications@gmail.com";
    process.env.SMTP_FROM = "Smart Factory <smartfactory.notifications@gmail.com>";
    delete process.env.EMAIL_DELIVERY_CONFIGURED;
    expect(notificationConfiguration()[0]).toMatchObject({ provider: "Gmail SMTP", emailConfigured: true });
  });

  it("honors an explicit worker-delivery status override", () => {
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_USERNAME = "smartfactory.notifications@gmail.com";
    process.env.SMTP_FROM = "Smart Factory <smartfactory.notifications@gmail.com>";
    process.env.EMAIL_DELIVERY_CONFIGURED = "false";
    expect(notificationConfiguration()[0].emailConfigured).toBe(false);
  });
});
