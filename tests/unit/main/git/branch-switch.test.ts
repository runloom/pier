import { switchFromRemoteTracking } from "@main/services/git/branch-switch.ts";
import { localNameFromRemoteTracking } from "@shared/git-branch-names.ts";
import { describe, expect, it } from "vitest";

describe("localNameFromRemoteTracking", () => {
  it("strips the first remote segment", () => {
    expect(localNameFromRemoteTracking("origin/feature/x")).toBe("feature/x");
    expect(localNameFromRemoteTracking("upstream/main")).toBe("main");
  });

  it("rejects names without a remote prefix", () => {
    expect(localNameFromRemoteTracking("main")).toBeNull();
    expect(localNameFromRemoteTracking("")).toBeNull();
  });
});

describe("switchFromRemoteTracking", () => {
  it("creates a tracking branch when local is missing", async () => {
    const calls: Array<readonly string[]> = [];
    await switchFromRemoteTracking(
      async (args) => {
        calls.push(args);
        if (
          args[0] === "show-ref" &&
          args.includes("refs/remotes/origin/feature/x")
        ) {
          return "";
        }
        if (args[0] === "show-ref" && args.includes("refs/heads/feature/x")) {
          throw new Error("missing");
        }
        return "";
      },
      "/repo",
      "origin/feature/x",
      60_000
    );

    expect(
      calls.some(
        (c) =>
          c[0] === "switch" &&
          c.includes("-c") &&
          c.includes("feature/x") &&
          c.includes("--track") &&
          c.includes("origin/feature/x")
      )
    ).toBe(true);
  });

  it("switches to an existing local branch without claiming tracking", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await switchFromRemoteTracking(
      async (args) => {
        calls.push(args);
        return "";
      },
      "/repo",
      "origin/feature/x",
      60_000
    );

    expect(result).toEqual({
      localName: "feature/x",
      mode: "switched-existing",
      remoteRef: "origin/feature/x",
    });
    expect(calls.some((c) => c.join(" ") === "switch feature/x")).toBe(true);
    expect(calls.some((c) => c.includes("-c"))).toBe(false);
  });
});
