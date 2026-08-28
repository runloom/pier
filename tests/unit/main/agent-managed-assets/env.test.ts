import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  memoryStoreEnvPatch,
  mergeMemoryStoreEnv,
  PIER_MEMORY_STORE_ENV,
} from "@main/services/agent-managed-assets/env.ts";
import { resolveProjectIdentity } from "@main/services/agent-managed-assets/project-identity.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return realpathSync(dir);
}

describe("memory store env injection", () => {
  it("derives the store path with the reconciler identity, converging subdirs", async () => {
    const repo = tmp("pier-mem-env-repo-");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const sub = join(repo, "packages", "app");
    mkdirSync(sub, { recursive: true });
    const identity = await resolveProjectIdentity(repo);
    const expected = {
      [PIER_MEMORY_STORE_ENV]: join(
        "/home-x",
        ".pier",
        "memory",
        identity.key,
        "memory.jsonl"
      ),
    };
    await expect(memoryStoreEnvPatch(repo, "/home-x")).resolves.toEqual(
      expected
    );
    // 子目录终端与项目根收敛到同一 store(commonDir 身份)。
    await expect(memoryStoreEnvPatch(sub, "/home-x")).resolves.toEqual(
      expected
    );
  });

  it("gives non-git registered projects a deterministic identity too", async () => {
    const plain = tmp("pier-mem-env-plain-");
    const identity = await resolveProjectIdentity(plain);
    await expect(memoryStoreEnvPatch(plain, "/h")).resolves.toEqual({
      [PIER_MEMORY_STORE_ENV]: join(
        "/h",
        ".pier",
        "memory",
        identity.key,
        "memory.jsonl"
      ),
    });
  });

  it("returns an empty patch when cwd is missing or unresolvable", async () => {
    await expect(memoryStoreEnvPatch(undefined, "/h")).resolves.toEqual({});
    await expect(
      memoryStoreEnvPatch("/definitely/not/a/real/dir", "/h")
    ).resolves.toEqual({});
  });

  it("never clobbers an explicitly set env value", () => {
    expect(
      mergeMemoryStoreEnv(
        { [PIER_MEMORY_STORE_ENV]: "/explicit.jsonl", PATH: "/usr/bin" },
        { [PIER_MEMORY_STORE_ENV]: "/derived.jsonl" }
      )
    ).toEqual({ [PIER_MEMORY_STORE_ENV]: "/explicit.jsonl", PATH: "/usr/bin" });
  });
});
