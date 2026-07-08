import { describe, expect, it } from "vitest";
import { rejectFailedManagedPluginOperation } from "@/pages/settings/components/managed-plugin-rows.tsx";

describe("managed plugin row operations", () => {
  it("rejects resolved managed operation failures so toast.promise uses the error path", async () => {
    await expect(
      rejectFailedManagedPluginOperation(
        Promise.resolve({
          error: {
            code: "not_found",
            message: "no install source for plugin: pier.codex",
          },
          ok: false,
        })
      )
    ).rejects.toThrow("no install source for plugin: pier.codex");
  });

  it("preserves successful managed operation results", async () => {
    await expect(
      rejectFailedManagedPluginOperation(
        Promise.resolve({
          ok: true,
          pluginId: "pier.codex",
          requiresRestart: true,
          version: "1.0.1",
        })
      )
    ).resolves.toMatchObject({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: true,
      version: "1.0.1",
    });
  });
});
