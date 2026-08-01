import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_EDITOR_GO_TO_LINE_COMMAND_ID } from "@plugins/builtin/files/manifest.ts";
import { createFilesEditorActions } from "@plugins/builtin/files/renderer/editor/actions.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { describe, expect, it, vi } from "vitest";

function createHarness(result: "applied" | "queued" | "rejected") {
  const notificationsError = vi.fn();
  const context = {
    dialogs: { prompt: vi.fn(async () => "12:3") },
    i18n: {
      t: vi.fn(
        (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
      ),
    },
    notifications: { error: notificationsError },
    panels: { getActiveInstanceId: vi.fn(() => "panel-1") },
  } as unknown as RendererPluginContext;
  const goToLine = vi.fn(() => false);
  const goToLineResult = vi.fn(() => result);
  const showSourceMode = vi.fn();
  const controller = {
    currentLineForSession: vi.fn(() => null),
    documentIdForPanel: vi.fn(() => "document-1"),
    goToLine,
    goToLineResult,
    showSourceMode,
  } as unknown as FileEditorController;
  const action = createFilesEditorActions(context, controller).find(
    (candidate) => candidate.id === FILES_EDITOR_GO_TO_LINE_COMMAND_ID
  );
  return {
    action,
    goToLine,
    goToLineResult,
    notificationsError,
    showSourceMode,
  };
}

describe("Files Go to Line action", () => {
  it("accepts navigation queued while a preview or diff remounts source", async () => {
    const harness = createHarness("queued");

    await harness.action?.handler(undefined);

    expect(harness.showSourceMode).toHaveBeenCalledWith("panel-1");
    expect(harness.goToLineResult).toHaveBeenCalledWith(
      JSON.stringify(["panel-1"]),
      "document-1",
      12,
      3
    );
    expect(harness.showSourceMode.mock.invocationCallOrder[0]).toBeLessThan(
      harness.goToLineResult.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY
    );
    expect(harness.notificationsError).not.toHaveBeenCalled();
  });

  it("reports navigation rejected for the target document", async () => {
    const harness = createHarness("rejected");

    await harness.action?.handler(undefined);

    expect(harness.notificationsError).toHaveBeenCalledWith(
      "Unable to jump to that line."
    );
  });
});
