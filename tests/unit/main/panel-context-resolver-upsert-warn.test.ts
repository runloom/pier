import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => {
      throw new Error("simulated disk failure");
    },
  },
}));

/**
 * 回归覆盖：`upsertProjectFromPath` 失败时的 30s throttle。
 * 一次性 flag 换成时间窗口后，第 2 次以内的 fail 不 log；30s 后再 fail 才 log。
 */
describe("panel-context-resolver upsertProjectFromPath warn throttle", () => {
  let repo: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    const { _resetUpsertWarnForTests } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    _resetUpsertWarnForTests();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    repo = await mkdtemp(join(tmpdir(), "pier-upsert-warn-"));
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(repo, { force: true, recursive: true });
  });

  it("warns once within a 30s window, then again after the window elapses", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    let clock = 1_772_000_000_000;
    const now = () => clock;

    // 第 1 次失败 → warn
    await resolvePanelContextForPath(repo, { now });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[panel-context] upsertProjectFromPath failed:",
      expect.any(String)
    );

    // 5s 后再失败 → 仍在窗口内, 不 warn
    clock += 5000;
    await resolvePanelContextForPath(repo, { now });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // 25s 后（累计 30s）→ 刚过窗口, 再 warn 一次
    clock += 25_000;
    await resolvePanelContextForPath(repo, { now });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
