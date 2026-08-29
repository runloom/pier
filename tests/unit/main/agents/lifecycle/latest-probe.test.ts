import { afterEach, describe, expect, it, vi } from "vitest";

const fetchLatestVersionMock = vi.hoisted(() => vi.fn());
const enumerateInstallsMock = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../../../src/main/services/agents/lifecycle/latest.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../../src/main/services/agents/lifecycle/latest.ts")
      >();
    return {
      ...actual,
      fetchLatestVersion: fetchLatestVersionMock,
    };
  }
);

vi.mock(
  "../../../../../src/main/services/agents/lifecycle/sources/path-enum.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../../src/main/services/agents/lifecycle/sources/path-enum.ts")
      >();
    return {
      ...actual,
      enumerateInstalls: enumerateInstallsMock,
    };
  }
);

import { probeOneAgent } from "../../../../../src/main/services/agents/lifecycle/probe.ts";

afterEach(() => {
  fetchLatestVersionMock.mockReset();
  enumerateInstallsMock.mockReset();
});

describe("probeOneAgent latestCheckFailed", () => {
  it("is true when fetchLatestVersion returns null", async () => {
    enumerateInstallsMock.mockResolvedValue([]);
    fetchLatestVersionMock.mockResolvedValue(null);
    const probe = await probeOneAgent(
      "claude",
      { PATH: "/usr/bin" },
      {
        checkLatest: true,
        deep: false,
        envDegraded: false,
        host: "posix",
      }
    );
    expect(probe.latestCheckFailed).toBe(true);
    expect(probe.latestVersion).toBeNull();
    expect(fetchLatestVersionMock).toHaveBeenCalled();
  });

  it("is false when fetchLatestVersion returns a version", async () => {
    enumerateInstallsMock.mockResolvedValue([]);
    fetchLatestVersionMock.mockResolvedValue("2.1.251");
    const probe = await probeOneAgent(
      "claude",
      { PATH: "/usr/bin" },
      {
        checkLatest: true,
        deep: false,
        envDegraded: false,
        host: "posix",
      }
    );
    expect(probe.latestCheckFailed).toBe(false);
    expect(probe.latestVersion).toBe("2.1.251");
  });
});
