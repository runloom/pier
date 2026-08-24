import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID,
  FILES_PLUGIN_MANIFEST,
} from "@plugins/builtin/files/manifest.ts";
import { createFilesEditorPrefsActions } from "@plugins/builtin/files/renderer/editor/actions.ts";
import { FILES_EDITOR_WORD_WRAP_SETTING_KEY } from "@plugins/builtin/files/settings.ts";
import { describe, expect, it, vi } from "vitest";

function createContext(initialWordWrap: boolean): {
  context: RendererPluginContext;
  setCalls: { key: string; value: boolean }[];
  configurationGet: ReturnType<typeof vi.fn>;
} {
  let stored = initialWordWrap;
  const setCalls: { key: string; value: boolean }[] = [];
  const configurationGet = vi.fn(
    <T>(key: string): T =>
      key === FILES_EDITOR_WORD_WRAP_SETTING_KEY
        ? (stored as T)
        : (undefined as T)
  );
  const configuration = {
    get: configurationGet,
    onDidChange: () => () => undefined,
    reset: vi.fn(),
    set: vi.fn(async (key: string, value: unknown) => {
      setCalls.push({ key, value: value as boolean });
      stored = value as boolean;
    }),
  };
  const t = vi.fn(
    (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
  );
  const context = {
    configuration,
    i18n: { t },
  } as unknown as RendererPluginContext;
  return { context, setCalls, configurationGet };
}

function findToggleAction(context: RendererPluginContext) {
  return createFilesEditorPrefsActions(context).find(
    (candidate) => candidate.id === FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID
  );
}

describe("files editor toggle word wrap action", () => {
  it("is declared in the plugin manifest command list", () => {
    const ids = FILES_PLUGIN_MANIFEST.commands?.map((command) => command.id);
    expect(ids).toContain(FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID);
  });

  it("declares no file permissions (pure configuration write)", () => {
    const command = FILES_PLUGIN_MANIFEST.commands?.find(
      (candidate) => candidate.id === FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID
    );
    expect(command?.permissions).toEqual([]);
  });

  it("surfaces on the editor context menu and command palette", () => {
    const { context } = createContext(false);
    const action = findToggleAction(context);
    expect(action?.surfaces).toEqual(["command-palette", "files/editor"]);
  });

  it("writes the toggled value back to the global wordWrap setting", async () => {
    const { context, setCalls } = createContext(false);
    const action = findToggleAction(context);
    expect(action).toBeDefined();
    await action!.handler();
    expect(setCalls).toEqual([
      { key: FILES_EDITOR_WORD_WRAP_SETTING_KEY, value: true },
    ]);
  });

  it("turns wrap off when currently on", async () => {
    const { context, setCalls } = createContext(true);
    const action = findToggleAction(context);
    await action!.handler();
    expect(setCalls).toEqual([
      { key: FILES_EDITOR_WORD_WRAP_SETTING_KEY, value: false },
    ]);
  });

  it("title reflects the current on state", () => {
    const { context, configurationGet } = createContext(true);
    const action = findToggleAction(context);
    expect(action!.title()).toBe("Word Wrap: On");
    expect(configurationGet).toHaveBeenCalledWith(
      FILES_EDITOR_WORD_WRAP_SETTING_KEY
    );
  });

  it("title reflects the current off state", () => {
    const { context } = createContext(false);
    const action = findToggleAction(context);
    expect(action!.title()).toBe("Word Wrap: Off");
  });
});
