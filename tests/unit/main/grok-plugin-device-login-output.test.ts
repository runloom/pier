import { describe, expect, it } from "vitest";
import { parseDeviceLoginOutput } from "../../../packages/plugin-grok/src/main/device-login-output.ts";

describe("parseDeviceLoginOutput", () => {
  it("parses the classic device-auth shape (url + dashed code)", () => {
    const output = [
      "Attempting device authorization...",
      "Visit https://accounts.x.ai/activate to sign in.",
      "Enter code: ABCD-1234",
    ].join("\n");
    expect(parseDeviceLoginOutput(output)).toEqual({
      deviceVerificationUrl: "https://accounts.x.ai/activate",
      deviceCode: "ABCD-1234",
    });
  });

  it("trims trailing prose punctuation from the URL", () => {
    const output = "Open https://x.ai/device, then enter WXYZ-7890.";
    expect(parseDeviceLoginOutput(output)).toEqual({
      deviceVerificationUrl: "https://x.ai/device",
      deviceCode: "WXYZ-7890",
    });
  });

  it("falls back to labeled codes without a dash", () => {
    const output = "Go to https://x.ai/activate and enter the code A1B2C3";
    expect(parseDeviceLoginOutput(output)).toEqual({
      deviceVerificationUrl: "https://x.ai/activate",
      deviceCode: "A1B2C3",
    });
  });

  it("never mistakes URL fragments for the user code", () => {
    const output = "Visit https://accounts.x.ai/device-activate?code=ignored";
    const info = parseDeviceLoginOutput(output);
    expect(info.deviceVerificationUrl).toBe(
      "https://accounts.x.ai/device-activate?code=ignored"
    );
    expect(info.deviceCode).toBeUndefined();
  });

  it("returns empty info for unrelated output", () => {
    expect(parseDeviceLoginOutput("Checking for updates...")).toEqual({});
  });

  it("parses url-only output (code printed later)", () => {
    const info = parseDeviceLoginOutput("Open https://x.ai/activate\n");
    expect(info.deviceVerificationUrl).toBe("https://x.ai/activate");
    expect(info.deviceCode).toBeUndefined();
  });
});
