import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defaultSession = {
  setDisplayMediaRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
  setPermissionRequestHandler: vi.fn(),
};
const appOn = vi.fn();
const commandLine = {
  appendSwitch: vi.fn(),
  getSwitchValue: vi.fn(() => ""),
};

vi.mock("electron", () => ({
  app: { commandLine, on: appOn },
  session: { defaultSession },
}));

function fakeSession() {
  return {
    setDisplayMediaRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  };
}

describe("display-capture policy", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    defaultSession.setDisplayMediaRequestHandler.mockClear();
    defaultSession.setPermissionCheckHandler.mockClear();
    defaultSession.setPermissionRequestHandler.mockClear();
    appOn.mockClear();
    commandLine.appendSwitch.mockClear();
    commandLine.getSwitchValue.mockReturnValue("");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("denies capture permissions and empty display-media streams", async () => {
    const { applyDisplayCapturePolicy } = await import(
      "../../../src/main/display-capture-policy.ts"
    );
    const target = fakeSession();
    applyDisplayCapturePolicy(target as never);

    const check = target.setPermissionCheckHandler.mock.calls[0]?.[0] as (
      webContents: unknown,
      permission: string
    ) => boolean;
    const request = target.setPermissionRequestHandler.mock.calls[0]?.[0] as (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void;
    const displayMedia = target.setDisplayMediaRequestHandler.mock
      .calls[0]?.[0] as (
      request: unknown,
      callback: (streams: object) => void
    ) => void;

    expect(check(null, "display-capture")).toBe(false);
    expect(check(null, "media")).toBe(false);
    expect(check(null, "deprecated-sync-clipboard-read")).toBe(false);
    expect(check(null, "clipboard-read")).toBe(true);

    const denied = vi.fn();
    request(null, "media", denied);
    expect(denied).toHaveBeenCalledWith(false);

    const allowed = vi.fn();
    request(null, "clipboard-sanitized-write", allowed);
    expect(allowed).toHaveBeenCalledWith(true);

    const streams = vi.fn();
    displayMedia({}, streams);
    expect(streams).toHaveBeenCalledWith({});
    expect(
      target.setDisplayMediaRequestHandler.mock.calls[0]?.[1]
    ).toBeUndefined();
  });

  it("covers the default session and every later partition", async () => {
    const { installDisplayCapturePolicy } = await import(
      "../../../src/main/display-capture-policy.ts"
    );
    installDisplayCapturePolicy();
    expect(defaultSession.setPermissionCheckHandler).toHaveBeenCalled();
    expect(defaultSession.setPermissionRequestHandler).toHaveBeenCalled();
    expect(defaultSession.setDisplayMediaRequestHandler).toHaveBeenCalled();
    expect(appOn).toHaveBeenCalledWith("session-created", expect.any(Function));

    const created = fakeSession();
    const onCreated = appOn.mock.calls[0]?.[1] as (session: unknown) => void;
    onCreated(created);
    expect(created.setPermissionCheckHandler).toHaveBeenCalled();
    expect(created.setPermissionRequestHandler).toHaveBeenCalled();
    expect(created.setDisplayMediaRequestHandler).toHaveBeenCalled();
  });

  it("disables unused ScreenCaptureKit features before ready on macOS", async () => {
    const { disableUnusedScreenCaptureFeatures } = await import(
      "../../../src/main/display-capture-policy.ts"
    );
    commandLine.getSwitchValue.mockReturnValue("FooFeature");
    disableUnusedScreenCaptureFeatures();
    expect(commandLine.appendSwitch).toHaveBeenCalledWith(
      "disable-features",
      expect.stringMatching(/^FooFeature,ScreenCaptureKitPickerScreen/)
    );
  });

  it("does not touch Chromium flags off macOS", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "linux",
    });
    const { disableUnusedScreenCaptureFeatures } = await import(
      "../../../src/main/display-capture-policy.ts"
    );
    disableUnusedScreenCaptureFeatures();
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
