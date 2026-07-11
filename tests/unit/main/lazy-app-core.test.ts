import { createLazyAppCore } from "@main/app-core/lazy-app-core.ts";
import { describe, expect, it, vi } from "vitest";

describe("createLazyAppCore", () => {
  it("constructs only on first property access and reuses the instance", () => {
    const factory = vi.fn(() => ({ value: 42 }));
    const core = createLazyAppCore(factory);

    expect(factory).not.toHaveBeenCalled();
    expect(core.value).toBe(42);
    expect(core.value).toBe(42);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("caches construction failure instead of repeating partial startup", () => {
    const failure = new Error("core construction failed");
    const factory = vi.fn(() => {
      throw failure;
    });
    const core = createLazyAppCore<{ value: number }>(factory);

    expect(() => core.value).toThrow(failure);
    expect(() => core.value).toThrow(failure);
    expect(factory).toHaveBeenCalledOnce();
  });
});
