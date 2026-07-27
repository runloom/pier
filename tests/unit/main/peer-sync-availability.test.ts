// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  effectivePeerAvailabilityForKind,
  partitionPeerTargets,
} from "../../../packages/plugin-api/src/peer-sync/index.ts";
import {
  detectPeerAvailability,
  isPiVersionAtLeast,
  parsePiVersion,
} from "../../../packages/plugin-api/src/peer-sync/main.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { force: true, recursive: true });
    dir = "";
  }
});

describe("parsePiVersion / isPiVersionAtLeast", () => {
  it("parses the first semver triple from pi --version output", () => {
    expect(parsePiVersion("0.82.1\n")).toEqual({
      major: 0,
      minor: 82,
      patch: 1,
    });
    expect(parsePiVersion("pi 0.80.8")).toEqual({
      major: 0,
      minor: 80,
      patch: 8,
    });
    expect(parsePiVersion("not-a-version")).toBeNull();
  });

  it("compares versions for the xAI OAuth minimum", () => {
    const min = { major: 0, minor: 80, patch: 8 };
    expect(isPiVersionAtLeast({ major: 0, minor: 80, patch: 8 }, min)).toBe(
      true
    );
    expect(isPiVersionAtLeast({ major: 0, minor: 80, patch: 7 }, min)).toBe(
      false
    );
    expect(isPiVersionAtLeast({ major: 0, minor: 81, patch: 0 }, min)).toBe(
      true
    );
    expect(isPiVersionAtLeast({ major: 1, minor: 0, patch: 0 }, min)).toBe(
      true
    );
  });
});

describe("detectPeerAvailability", () => {
  it("reports all peers unavailable in an empty home", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    expect(detectPeerAvailability({ homeDir: dir, pathEnv: dir })).toEqual({
      omp: false,
      opencode: false,
      pi: false,
      piOauthCapable: false,
    });
  });

  it("detects opencode via config, pi via home, and omp only with agent.db", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    const opencodeConfigDir = join(dir, ".config", "opencode");
    await mkdir(opencodeConfigDir, { recursive: true });
    await writeFile(join(opencodeConfigDir, "opencode.json"), "{}");
    await mkdir(join(dir, ".pi", "agent"), { recursive: true });
    await mkdir(join(dir, ".omp", "agent"), { recursive: true });

    // Agent dir alone cannot verify oauth capability.
    expect(detectPeerAvailability({ homeDir: dir, pathEnv: dir })).toEqual({
      omp: false,
      opencode: true,
      pi: true,
      piOauthCapable: false,
    });

    await writeFile(join(dir, ".omp", "agent", "agent.db"), "");
    expect(detectPeerAvailability({ homeDir: dir, pathEnv: dir })).toEqual({
      omp: true,
      opencode: true,
      pi: true,
      piOauthCapable: false,
    });
  });

  it("detects binaries on PATH without creating home dirs", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "opencode"), "");
    await writeFile(join(bin, "pi"), "");

    // Empty stub binary cannot report a version → oauth not capable.
    expect(
      detectPeerAvailability({
        homeDir: join(dir, "home"),
        pathEnv: bin,
      })
    ).toEqual({
      omp: false,
      opencode: true,
      pi: true,
      piOauthCapable: false,
    });
  });

  it("marks pi oauth-capable when version probe reports >= 0.80.8", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    await mkdir(join(dir, ".pi", "agent"), { recursive: true });

    expect(
      detectPeerAvailability({
        homeDir: dir,
        pathEnv: dir,
        piVersionProbe: () => "0.80.8",
      })
    ).toMatchObject({ pi: true, piOauthCapable: true });

    expect(
      detectPeerAvailability({
        homeDir: dir,
        pathEnv: dir,
        piVersionProbe: () => "0.80.7",
      })
    ).toMatchObject({ pi: true, piOauthCapable: false });

    expect(
      detectPeerAvailability({
        homeDir: dir,
        pathEnv: dir,
        piVersionProbe: () => null,
      })
    ).toMatchObject({ pi: true, piOauthCapable: false });
  });
});

describe("partitionPeerTargets", () => {
  it("keeps unavailable targets out of the default selection set", () => {
    const { available, unavailable } = partitionPeerTargets(
      ["opencode", "pi", "omp"],
      { omp: false, opencode: true, pi: false, piOauthCapable: false }
    );
    expect(available).toEqual(["opencode"]);
    expect(unavailable).toEqual(["pi", "omp"]);
  });

  it("returns empty available when no peer tools are installed", () => {
    const { available, unavailable } = partitionPeerTargets(
      ["opencode", "pi", "omp"],
      { omp: false, opencode: false, pi: false, piOauthCapable: false }
    );
    expect(available).toEqual([]);
    expect(unavailable).toEqual(["opencode", "pi", "omp"]);
  });
});

describe("effectivePeerAvailabilityForKind", () => {
  it("hides pi for OIDC when oauth is not capable, keeps pi for API keys", () => {
    const base = {
      omp: true,
      opencode: true,
      pi: true,
      piOauthCapable: false,
    };
    expect(effectivePeerAvailabilityForKind("api_key", base).pi).toBe(true);
    expect(effectivePeerAvailabilityForKind("oidc", base).pi).toBe(false);
    expect(
      effectivePeerAvailabilityForKind("oidc", {
        ...base,
        piOauthCapable: true,
      }).pi
    ).toBe(true);
  });
});
