// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { partitionPeerTargets } from "../../../packages/plugin-api/src/peer-sync/index.ts";
import { detectPeerAvailability } from "../../../packages/plugin-api/src/peer-sync/main.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { force: true, recursive: true });
    dir = "";
  }
});

describe("detectPeerAvailability", () => {
  it("reports all peers unavailable in an empty home", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    expect(detectPeerAvailability({ homeDir: dir, pathEnv: dir })).toEqual({
      omp: false,
      opencode: false,
      pi: false,
    });
  });

  it("detects opencode via config, pi via home, and omp only with agent.db", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    const opencodeConfigDir = join(dir, ".config", "opencode");
    await mkdir(opencodeConfigDir, { recursive: true });
    await writeFile(join(opencodeConfigDir, "opencode.json"), "{}");
    await mkdir(join(dir, ".pi", "agent"), { recursive: true });
    await mkdir(join(dir, ".omp", "agent"), { recursive: true });

    expect(detectPeerAvailability({ homeDir: dir, pathEnv: dir })).toEqual({
      omp: false,
      opencode: true,
      pi: true,
    });

    await writeFile(join(dir, ".omp", "agent", "agent.db"), "");
    expect(detectPeerAvailability({ homeDir: dir, pathEnv: dir })).toEqual({
      omp: true,
      opencode: true,
      pi: true,
    });
  });

  it("detects binaries on PATH without creating home dirs", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-peer-availability-"));
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "opencode"), "");
    await writeFile(join(bin, "pi"), "");

    expect(
      detectPeerAvailability({
        homeDir: join(dir, "home"),
        pathEnv: bin,
      })
    ).toEqual({
      omp: false,
      opencode: true,
      pi: true,
    });
  });
});

describe("partitionPeerTargets", () => {
  it("keeps unavailable targets out of the default selection set", () => {
    const { available, unavailable } = partitionPeerTargets(
      ["opencode", "pi", "omp"],
      { omp: false, opencode: true, pi: false }
    );
    expect(available).toEqual(["opencode"]);
    expect(unavailable).toEqual(["pi", "omp"]);
  });

  it("returns empty available when no peer tools are installed", () => {
    const { available, unavailable } = partitionPeerTargets(
      ["opencode", "pi", "omp"],
      { omp: false, opencode: false, pi: false }
    );
    expect(available).toEqual([]);
    expect(unavailable).toEqual(["opencode", "pi", "omp"]);
  });
});
