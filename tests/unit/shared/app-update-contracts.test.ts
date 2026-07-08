import { appUpdateSnapshotSchema } from "@shared/contracts/app-update.ts";
import { describe, expect, it } from "vitest";

describe("app update contracts", () => {
  it("accepts update snapshots for disabled, available, progress, and error states", () => {
    expect(
      appUpdateSnapshotSchema.parse({
        currentVersion: "0.1.0",
        state: "disabled",
      }).state
    ).toBe("disabled");
    expect(
      appUpdateSnapshotSchema.parse({
        availableVersion: "0.2.0",
        currentVersion: "0.1.0",
        state: "available",
      }).availableVersion
    ).toBe("0.2.0");
    expect(
      appUpdateSnapshotSchema.parse({
        currentVersion: "0.1.0",
        progress: { percent: 42 },
        state: "downloading",
      }).progress?.percent
    ).toBe(42);
    expect(
      appUpdateSnapshotSchema.parse({
        currentVersion: "0.1.0",
        error: "network unavailable",
        state: "error",
      }).error
    ).toBe("network unavailable");
  });
});
