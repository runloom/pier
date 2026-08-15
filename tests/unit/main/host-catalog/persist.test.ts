import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentInventoryPath,
  createDomainSnapshotStore,
} from "../../../../src/main/services/host-catalog/persist.ts";

describe("host-catalog persist", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    dirs.length = 0;
  });

  it("writes agent inventory to a dedicated file and reads it back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-catalog-"));
    dirs.push(dir);
    const filePath = agentInventoryPath(dir);
    const store = createDomainSnapshotStore(filePath, "agent-cli");
    const snapshot = {
      ...emptyDomainSnapshot("agent-cli"),
      items: [
        {
          details: { version: "1.2.3" },
          domain: "agent-cli" as const,
          id: "claude",
          label: "Claude",
          localVersion: "1.2.3",
          presence: "present" as const,
          remoteVersion: null,
          updateOffered: false,
        },
      ],
      localProbedAt: 42,
      revision: 4,
    };

    await store.write(snapshot);
    await store.flush();

    const raw = JSON.parse(await readFile(filePath, "utf8")) as {
      domain: string;
    };
    expect(raw.domain).toBe("agent-cli");

    const other = createDomainSnapshotStore(filePath, "agent-cli");
    await expect(other.read()).resolves.toMatchObject({
      localProbedAt: 42,
      revision: 4,
    });
  });

  it("returns an empty snapshot when the file is corrupt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-catalog-"));
    const filePath = join(dir, "agent-inventory.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "{not-json", "utf8");

    const store = createDomainSnapshotStore(filePath, "agent-cli");
    await expect(store.read()).resolves.toEqual(
      emptyDomainSnapshot("agent-cli")
    );
  });
});
