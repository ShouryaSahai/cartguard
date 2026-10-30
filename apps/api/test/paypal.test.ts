import { describe, expect, it } from "vitest";
import { assertSandboxBaseUrl, createPaypalOrdersFromEnv, SANDBOX_BASE_URL } from "../src/paypal.js";

describe("paypal sandbox guard (PRD acceptance criteria)", () => {
  it("accepts the sandbox URL", () => {
    expect(() => assertSandboxBaseUrl(SANDBOX_BASE_URL)).not.toThrow();
  });

  it("accepts an unset base URL (defaults to sandbox)", () => {
    expect(() => assertSandboxBaseUrl(undefined)).not.toThrow();
  });

  it("refuses the LIVE PayPal URL at startup", () => {
    expect(() => assertSandboxBaseUrl("https://api-m.paypal.com")).toThrow(/sandbox/i);
  });

  it("refuses any lookalike non-sandbox URL", () => {
    for (const hostile of [
      "https://api-m.paypal.com/v1",
      "https://api-m.sandbox.paypal.com.evil.example",
      "http://localhost:8090",
      "",
    ]) {
      if (hostile === "") continue;
      expect(() => assertSandboxBaseUrl(hostile)).toThrow();
    }
  });

  it("refuses to construct a client without credentials", () => {
    expect(() => createPaypalOrdersFromEnv({})).toThrow(/PAYPAL_CLIENT_ID/);
  });

  it("refuses to construct a client pointed at the live environment", () => {
    expect(() =>
      createPaypalOrdersFromEnv({
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        PAYPAL_API_BASE: "https://api-m.paypal.com",
      }),
    ).toThrow(/sandbox/i);
  });
});
