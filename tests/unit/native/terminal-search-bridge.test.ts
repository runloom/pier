import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GHOSTTY_BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const NATIVE_ADDON_PATH = join(process.cwd(), "native/src/addon.mm");
const CALLBACK_BRIDGE_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/InMemory/TerminalCallbackBridge.swift"
);
const SURFACE_DELEGATE_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Surface/TerminalSurfaceViewDelegate.swift"
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("native terminal search bridge", () => {
  it("surfaces Ghostty search result callbacks through the vendored delegate", () => {
    const delegateSource = read(SURFACE_DELEGATE_PATH);
    const callbackSource = read(CALLBACK_BRIDGE_PATH);

    expect(delegateSource).toContain("TerminalSurfaceSearchDelegate");
    expect(delegateSource).toContain("terminalDidUpdateSearchTotal");
    expect(delegateSource).toContain("terminalDidUpdateSearchSelected");
    expect(callbackSource).toContain("GHOSTTY_ACTION_SEARCH_TOTAL");
    expect(callbackSource).toContain("GHOSTTY_ACTION_SEARCH_SELECTED");
    expect(callbackSource).toContain("terminalDidUpdateSearchTotal");
    expect(callbackSource).toContain("terminalDidUpdateSearchSelected");
  });

  it("forwards search state from Swift to the N-API addon", () => {
    const bridgeSource = read(GHOSTTY_BRIDGE_PATH);
    const addonSource = read(NATIVE_ADDON_PATH);

    expect(bridgeSource).toContain("TerminalSurfaceSearchDelegate");
    expect(bridgeSource).toContain("forwardSearchCallback");
    expect(bridgeSource).toContain(
      '@_cdecl("ghostty_bridge_set_search_forward_callback")'
    );
    expect(addonSource).toContain("ghostty_bridge_set_search_forward_callback");
    expect(addonSource).toContain("SearchForwardPayload");
    expect(addonSource).toContain("JsSetSearchForwardCallback");
    expect(addonSource).toContain('exports.Set("setSearchForwardCallback"');
  });
});
