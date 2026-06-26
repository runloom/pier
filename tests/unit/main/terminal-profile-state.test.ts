import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteTerminalProfile,
  readTerminalProfile,
  readTerminalProfiles,
  upsertTerminalProfile,
} from "@main/state/terminal-profile-state.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function profileFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-terminal-profiles-"));
  tempDirs.push(dir);
  return join(dir, "terminal-profiles.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("terminal profile state", () => {
  it("persists profile upsert and delete operations", async () => {
    const filePath = await profileFile();

    await expect(readTerminalProfiles(filePath)).resolves.toEqual({
      profiles: {},
    });
    await expect(
      upsertTerminalProfile(
        "codex",
        {
          command: "codex",
          cwd: "/tmp/pier",
          env: { PIER_MODE: "dev" },
        },
        filePath
      )
    ).resolves.toEqual({
      command: "codex",
      cwd: "/tmp/pier",
      env: { PIER_MODE: "dev" },
    });
    await expect(readTerminalProfile("codex", filePath)).resolves.toEqual({
      command: "codex",
      cwd: "/tmp/pier",
      env: { PIER_MODE: "dev" },
    });

    await expect(deleteTerminalProfile("codex", filePath)).resolves.toBe(true);
    await expect(readTerminalProfile("codex", filePath)).resolves.toBeNull();
    await expect(deleteTerminalProfile("codex", filePath)).resolves.toBe(false);
  });
});
