import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";

const createWindow = vi.fn(async () => ({
  recordId: "record-new",
  windowId: "w-1",
}));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  createWindow,
}));

describe("panel window actions", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
    resetAppDialogForTests();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    resetAppDialogForTests();
    await i18next.changeLanguage("en");
  });

  it("creates windows through the public fresh-window entrypoint", async () => {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );

    const dispose = registerPanelActions();
    try {
      await actionRegistry.get("pier.window.newWindow")?.handler();

      expect(createWindow).toHaveBeenCalledWith();
    } finally {
      dispose();
    }
  });

  it("exposes new window in the command palette and create-menu surfaces", async () => {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );

    const dispose = registerPanelActions();
    try {
      const action = actionRegistry.get("pier.window.newWindow");
      expect(action?.surfaces).toEqual(["command-palette", "create-menu"]);
    } finally {
      dispose();
    }
  });

  it("shows window creation failures with localized title and raw detail", async () => {
    createWindow.mockRejectedValueOnce(new Error("window detail"));
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );

    const dispose = registerPanelActions();
    try {
      const pending = actionRegistry.get("pier.window.newWindow")?.handler();
      await vi.waitFor(() => {
        expect(useAppDialogStore.getState().current).toMatchObject({
          body: "window detail",
          kind: "alert",
          title: "Couldn’t create window",
        });
      });

      resetAppDialogForTests();
      await pending;
    } finally {
      dispose();
    }
  });
});
