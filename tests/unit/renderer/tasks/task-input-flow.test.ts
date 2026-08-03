import type { TaskSpawnResult } from "@shared/contracts/tasks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { spawnTaskWithInputResolution } from "@/lib/actions/task-input-flow.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";

describe("spawnTaskWithInputResolution missing dependencies", () => {
  beforeEach(async () => {
    await initI18n();
    resetAppDialogForTests();
    useCommandPaletteController.getState().close();
  });

  it("confirms and retries with skipMissingDependencies", async () => {
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({
        message: "任务 verify 依赖不存在: missing",
        missingDependencies: ["missing"],
        status: "missing-dependencies",
        taskLabel: "verify",
      } satisfies TaskSpawnResult)
      .mockResolvedValueOnce({
        panelIds: ["t1"],
        primaryPanelId: "t1",
        runId: "run-1",
        status: "started",
      } satisfies TaskSpawnResult);

    const pending = spawnTaskWithInputResolution(spawn);
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current?.kind).toBe("confirm");
    });
    const dialog = useAppDialogStore.getState().current;
    expect(dialog?.kind).toBe("confirm");
    if (dialog?.kind !== "confirm") {
      return;
    }
    expect(dialog.confirmLabel).toMatch(
      /跳过缺失依赖并继续|Continue without missing dependencies/
    );
    expect(dialog.body).toMatch(/verify/);
    expect(dialog.body).toMatch(/missing/);
    // Localized body must not inject the main-process Chinese error string.
    expect(dialog.body).not.toContain("任务 verify 依赖不存在");
    dialog.resolve(true);

    await expect(pending).resolves.toMatchObject({
      runId: "run-1",
      status: "started",
    });
    expect(spawn).toHaveBeenNthCalledWith(1, undefined);
    expect(spawn).toHaveBeenNthCalledWith(2, {
      skipMissingDependencies: true,
    });
  });

  it("returns null when the user declines to run without dependencies", async () => {
    const spawn = vi.fn().mockResolvedValue({
      message: "任务 verify 依赖不存在: missing",
      missingDependencies: ["missing"],
      status: "missing-dependencies",
      taskLabel: "verify",
    } satisfies TaskSpawnResult);

    const pending = spawnTaskWithInputResolution(spawn);
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current?.kind).toBe("confirm");
    });
    const dialog = useAppDialogStore.getState().current;
    if (dialog?.kind !== "confirm") {
      return;
    }
    dialog.resolve(false);

    await expect(pending).resolves.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("preserves collected inputs across missing-deps skip retry", async () => {
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({
        inputs: [
          {
            default: "web",
            description: "Target package",
            id: "pkg",
            type: "promptString",
          },
        ],
        status: "requires-input",
      } satisfies TaskSpawnResult)
      .mockResolvedValueOnce({
        message: "任务 verify 依赖不存在: missing",
        missingDependencies: ["missing"],
        status: "missing-dependencies",
        taskLabel: "verify",
      } satisfies TaskSpawnResult)
      .mockResolvedValueOnce({
        panelIds: ["t1"],
        primaryPanelId: "t1",
        runId: "run-skip",
        status: "started",
      } satisfies TaskSpawnResult);

    const pending = spawnTaskWithInputResolution(spawn);
    await vi.waitFor(() => {
      expect(
        useCommandPaletteController.getState().quickPick?.onAcceptQuery
      ).toBeTypeOf("function");
    });
    await useCommandPaletteController
      .getState()
      .quickPick?.onAcceptQuery?.("renderer");

    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current?.kind).toBe("confirm");
    });
    const dialog = useAppDialogStore.getState().current;
    if (dialog?.kind !== "confirm") {
      return;
    }
    dialog.resolve(true);

    await expect(pending).resolves.toMatchObject({
      runId: "run-skip",
      status: "started",
    });
    expect(spawn).toHaveBeenNthCalledWith(1, undefined);
    expect(spawn).toHaveBeenNthCalledWith(2, {
      inputs: { pkg: "renderer" },
    });
    expect(spawn).toHaveBeenNthCalledWith(3, {
      inputs: { pkg: "renderer" },
      skipMissingDependencies: true,
    });
  });
});
