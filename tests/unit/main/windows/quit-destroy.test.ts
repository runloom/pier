import { nativeTerminalProcesses } from "@main/ipc/terminal/process/registry.ts";
import { destroyAppWindowForQuit } from "@main/windows/quit-destroy.ts";
import { expect, it, vi } from "vitest";

vi.mock("@main/ipc/terminal/index.ts", () => ({
  getTerminalAddon: () => ({ detachWindow: vi.fn() }),
}));
vi.mock("@main/windows/identity.ts", () => ({
  findWindowContext: () => null,
}));

it("closes physical ownership without reading an already destroyed Electron window", () => {
  let destroyed = false;
  const process = nativeTerminalProcesses.begin("123::quit-regression");
  nativeTerminalProcesses.created(process);
  const window = {
    get id() {
      if (destroyed) throw new Error("Object has been destroyed");
      return 123;
    },
    isDestroyed: () => destroyed,
    getNativeWindowHandle: () => Buffer.alloc(8),
    destroy: () => {
      destroyed = true;
    },
  };
  expect(() => destroyAppWindowForQuit(window as never)).not.toThrow();
  expect(process).toMatchObject({ closed: true, exited: false });
});
