import { formatDevSingleInstanceLockFailure } from "@main/startup-diagnostics.ts";
import { describe, expect, it } from "vitest";

describe("startup diagnostics", () => {
  it("explains dev single-instance lock failures with the profile context", () => {
    const message = formatDevSingleInstanceLockFailure({
      profile: "pier-80345b16",
      rendererUrl: "http://127.0.0.1:5176",
      userDataDir:
        "/Users/example/Library/Application Support/Pier-dev/pier-80345b16",
    });

    expect(message).toContain(
      "[startup] another Pier instance already owns this dev profile"
    );
    expect(message).toContain("profile: pier-80345b16");
    expect(message).toContain("renderer: http://127.0.0.1:5176");
    expect(message).toContain(
      "userData: /Users/example/Library/Application Support/Pier-dev/pier-80345b16"
    );
    expect(message).toContain("Stop the existing Pier/Electron process");
  });
});
