import { describe, expect, it, vi } from "vitest";
import {
  serializeTerminalCreate,
  serializeTerminalOperation,
} from "../../../../../src/main/ipc/terminal/creation/serial.ts";
import { createNativeProcessRegistry } from "../../../../../src/main/ipc/terminal/process/registry.ts";

describe("terminal creation and close serialization", () => {
  it("cannot resurrect a panel with a create queued during close", async () => {
    const registry = createNativeProcessRegistry();
    let release: () => void = () => undefined;
    const close = serializeTerminalOperation("close-race", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      registry.cancelCreation("close-race");
    });
    await Promise.resolve();
    const create = vi.fn(async () => ({ ok: true }));
    const pending = serializeTerminalCreate(
      "close-race",
      registry.creationGuard("close-race"),
      create
    );
    release();
    await close;
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
    await expect(
      serializeTerminalCreate(
        "close-race",
        registry.creationGuard("close-race"),
        create
      )
    ).resolves.toEqual({ ok: true });
  });
});
