import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import {
  dispatchKeybindingAction,
  invocationFromKeybindingScope,
  resolveKeybindingAction,
} from "@/lib/keybindings/use-registry.ts";
import {
  readTerminalInputRoutingTraceSnapshot,
  resetTerminalInputRoutingTraceForTests,
} from "@/lib/terminal-debug/input-routing-trace.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";

const WEB_COMMAND = "pier.input-routing-trace.web";
const INPUT_COMMAND = "pier.input-routing-trace.text-input";
const OVERLAY_COMMAND = "pier.input-routing-trace.overlay";
const DISABLED_COMMAND = "pier.input-routing-trace.disabled";
const MISSING_COMMAND = "pier.input-routing-trace.missing";
const REJECTED_COMMAND = "pier.input-routing-trace.rejected";

function chord(code: string, cmdOrCtrl = true) {
  return { alt: false, cmdOrCtrl, code, ctrl: false, shift: false };
}

function registerAction(
  id: string,
  handler: Action["handler"] = vi.fn(),
  enabled?: () => boolean
) {
  actionRegistry.register({
    category: "test",
    ...(enabled ? { enabled } : {}),
    handler,
    id,
    title: () => id,
  });
  return handler;
}

describe("keybinding input-routing trace", () => {
  beforeEach(() => {
    actionRegistry.clearForTests();
    keybindingRegistry.loadUserKeymap([]);
    resetTerminalInputRoutingTraceForTests();
    useKeybindingScope.setState({
      activePanelComponent: "terminal",
      activePanelId: "terminal-1",
      activePanelKind: "terminal",
      overlayStack: [],
    });
  });

  afterEach(() => {
    actionRegistry.clearForTests();
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
  });

  it("builds a panel invocation from the keybinding scope", () => {
    useKeybindingScope.setState({
      activePanelComponent: "pier.files.searchPanel",
      activePanelId: "search-1",
      activePanelKind: "web",
      overlayStack: ["overlay:command-palette"],
    });
    expect(invocationFromKeybindingScope()).toEqual({
      sourcePanelComponent: "pier.files.searchPanel",
      sourcePanelId: "search-1",
    });
  });

  it("records the native-forward route when a registered command dispatches", () => {
    const handler = registerAction(WEB_COMMAND);
    keybindingRegistry.registerDefaults([
      { commandId: WEB_COMMAND, keys: "Mod+KeyY" },
    ]);

    const action = resolveKeybindingAction(
      chord("KeyY"),
      null,
      "native-forward"
    );
    if (!action) {
      throw new Error("expected a registered command");
    }
    dispatchKeybindingAction(action, "native-forward");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      sourcePanelComponent: "terminal",
      sourcePanelId: "terminal-1",
    });
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "dispatched",
        commandId: WEB_COMMAND,
        route: "native-forward",
        source: "keybinding",
      })
    );
  });

  it("records text-input suppression for a command that otherwise resolves", () => {
    registerAction(INPUT_COMMAND);
    keybindingRegistry.registerDefaults([
      { commandId: INPUT_COMMAND, keys: "KeyY" },
    ]);
    const input = document.createElement("input");

    const action = resolveKeybindingAction(
      chord("KeyY", false),
      input,
      "web-keydown"
    );

    expect(action).toBeNull();
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "text-input-suppressed",
        commandId: INPUT_COMMAND,
        route: "web-keydown",
      })
    );
  });

  it("records a known command blocked by the active overlay", () => {
    registerAction(OVERLAY_COMMAND);
    keybindingRegistry.registerDefaults([
      { commandId: OVERLAY_COMMAND, keys: "Mod+KeyU" },
    ]);
    useKeybindingScope.setState({ overlayStack: ["app-dialog"] });

    const action = resolveKeybindingAction(chord("KeyU"), null, "web-keydown");

    expect(action).toBeNull();
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "overlay-blocked",
        commandId: OVERLAY_COMMAND,
        route: "web-keydown",
      })
    );
  });

  it("blames text input rather than the overlay while typing in an overlay field", () => {
    registerAction(OVERLAY_COMMAND);
    keybindingRegistry.registerDefaults([
      { commandId: OVERLAY_COMMAND, keys: "KeyU" },
    ]);
    useKeybindingScope.setState({ overlayStack: ["app-dialog"] });
    const input = document.createElement("input");

    const action = resolveKeybindingAction(
      chord("KeyU", false),
      input,
      "web-keydown"
    );

    expect(action).toBeNull();
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "text-input-suppressed",
        commandId: OVERLAY_COMMAND,
        route: "web-keydown",
      })
    );
  });

  it("records a resolved binding whose action is unavailable", () => {
    keybindingRegistry.registerDefaults([
      { commandId: MISSING_COMMAND, keys: "Mod+KeyM" },
    ]);

    const action = resolveKeybindingAction(chord("KeyM"), null, "web-keydown");

    expect(action).toBeNull();
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "missing-action",
        commandId: MISSING_COMMAND,
        route: "web-keydown",
      })
    );
  });

  it("records disabled and rejected command outcomes without raw key fields", async () => {
    registerAction(DISABLED_COMMAND, vi.fn(), () => false);
    const rejected = registerAction(
      REJECTED_COMMAND,
      vi.fn(async () => Promise.reject(new Error("expected")))
    );
    keybindingRegistry.registerDefaults([
      { commandId: DISABLED_COMMAND, keys: "Mod+KeyI" },
      { commandId: REJECTED_COMMAND, keys: "Mod+KeyO" },
    ]);

    const disabledAction = resolveKeybindingAction(
      chord("KeyI"),
      null,
      "web-keydown"
    );
    if (!disabledAction) {
      throw new Error("expected disabled action");
    }
    expect(disabledAction.id).toBe(DISABLED_COMMAND);
    dispatchKeybindingAction(disabledAction, "web-keydown");
    const action = resolveKeybindingAction(chord("KeyO"), null, "web-keydown");
    if (!action) {
      throw new Error("expected rejected action");
    }
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    dispatchKeybindingAction(action, "web-keydown");
    await vi.waitFor(() =>
      expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
        expect.objectContaining({
          action: "handler-rejected",
          commandId: REJECTED_COMMAND,
        })
      )
    );
    consoleError.mockRestore();

    expect(rejected).toHaveBeenCalledOnce();
    const events = readTerminalInputRoutingTraceSnapshot().events;
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "disabled",
        commandId: DISABLED_COMMAND,
      })
    );
    expect(events.every((event) => !("key" in event))).toBe(true);
    expect(events.every((event) => !("chars" in event))).toBe(true);
  });
});
