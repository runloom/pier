import {
  notifyFilesDiskPathOpened,
  resetFilesDiskPathOpenedForTests,
} from "@plugins/api/files-disk-path-opened.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { registerFilesDiskOpenLineReveal } from "@plugins/builtin/files/renderer/tree/open-disk-line.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("registerFilesDiskOpenLineReveal", () => {
  const showSourceMode = vi.fn();
  const documentId = vi.fn(() => "doc:1");
  const goToLineResult = vi.fn(
    (): "applied" | "queued" | "rejected" => "applied"
  );
  const error = vi.fn();
  const t = vi.fn(
    (_key: string, _values: unknown, fallback: string) => fallback
  );

  const controller = {
    showSourceMode,
    documentId,
    goToLineResult,
  };

  const context = {
    i18n: { t },
    notifications: { error },
  } as unknown as RendererPluginContext;

  let dispose: (() => void) | undefined;

  beforeEach(() => {
    resetFilesDiskPathOpenedForTests();
    showSourceMode.mockClear();
    documentId.mockClear();
    goToLineResult.mockClear();
    goToLineResult.mockReturnValue("applied");
    error.mockClear();
    t.mockClear();
    dispose = registerFilesDiskOpenLineReveal(controller as never, context);
  });

  afterEach(() => {
    dispose?.();
    resetFilesDiskPathOpenedForTests();
  });

  it("ignores opens without a positive line", () => {
    notifyFilesDiskPathOpened({
      instanceId: "panel-1",
      path: "src/a.ts",
      root: "/repo",
    });
    notifyFilesDiskPathOpened({
      instanceId: "panel-1",
      line: 0,
      path: "src/a.ts",
      root: "/repo",
    });
    expect(goToLineResult).not.toHaveBeenCalled();
  });

  it("calls showSourceMode and goToLineResult for a valid line", () => {
    notifyFilesDiskPathOpened({
      instanceId: "panel-1",
      line: 18,
      path: "src/a.ts",
      root: "/repo",
    });
    expect(showSourceMode).toHaveBeenCalledWith("panel-1");
    expect(documentId).toHaveBeenCalledWith({
      kind: "disk",
      path: "src/a.ts",
      root: "/repo",
    });
    expect(goToLineResult).toHaveBeenCalledWith(
      expect.stringContaining("panel-1"),
      "doc:1",
      18,
      undefined
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("toasts when goToLineResult is rejected", () => {
    goToLineResult.mockReturnValue("rejected");
    notifyFilesDiskPathOpened({
      instanceId: "panel-1",
      line: 99,
      path: "src/a.ts",
      root: "/repo",
    });
    expect(error).toHaveBeenCalledWith("Unable to jump to that line.");
  });
});
