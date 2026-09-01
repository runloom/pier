import { describe, expect, it } from "vitest";
import { appletChrome } from "../../../../packages/plugin-tasks/applets/chrome.ts";

describe("task applet chrome", () => {
  it("defaults list and dag to island cards and maps embedded to panel", () => {
    expect(appletChrome({}, "island")).toBe("island");
    expect(appletChrome({ chrome: "panel" }, "island")).toBe("panel");
    expect(appletChrome({ embedded: true }, "island")).toBe("panel");
    expect(appletChrome({ chrome: "island", embedded: true }, "panel")).toBe(
      "island"
    );
  });
});
