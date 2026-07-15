import {
  createManagedPluginDevRuntimeWatchRegistry,
  isManagedPluginDevRuntimeFile,
} from "@main/app-core/managed-plugin-dev-runtime-watch.ts";
import { describe, expect, it, vi } from "vitest";

describe("managed plugin dev runtime watch", () => {
  it("only treats runtime entry files and plugin manifest as hot-reload triggers", () => {
    expect(isManagedPluginDevRuntimeFile("plugin.json")).toBe(true);
    expect(isManagedPluginDevRuntimeFile("dist/main.js")).toBe(true);
    expect(isManagedPluginDevRuntimeFile("dist/renderer.js")).toBe(true);

    expect(
      isManagedPluginDevRuntimeFile("src/renderer/accounts-widget.tsx")
    ).toBe(false);
    expect(isManagedPluginDevRuntimeFile("dist-pkg/pier.codex-1.0.0.tgz")).toBe(
      false
    );
    expect(isManagedPluginDevRuntimeFile(null)).toBe(false);
  });

  it("owns one watcher per plugin and disposes every watcher exactly once", () => {
    const codexDispose = vi.fn();
    const grokDispose = vi.fn();
    const start = vi.fn((options: { packageDir: string }) => ({
      dispose:
        options.packageDir === "packages/plugin-codex"
          ? codexDispose
          : grokDispose,
    }));
    const registry = createManagedPluginDevRuntimeWatchRegistry(start);
    const refreshRuntimeSources = vi.fn(async () => undefined);

    registry.ensure("pier.codex", {
      packageDir: "packages/plugin-codex",
      refreshRuntimeSources,
    });
    registry.ensure("pier.codex", {
      packageDir: "packages/plugin-codex",
      refreshRuntimeSources,
    });
    registry.ensure("pier.grok", {
      packageDir: "packages/plugin-grok",
      refreshRuntimeSources,
    });

    expect(start).toHaveBeenCalledTimes(2);

    registry.dispose();
    registry.dispose();

    expect(codexDispose).toHaveBeenCalledTimes(1);
    expect(grokDispose).toHaveBeenCalledTimes(1);
  });

  it("does not start a watcher when ensure is called after disposal", () => {
    const start = vi.fn(() => ({ dispose: vi.fn() }));
    const registry = createManagedPluginDevRuntimeWatchRegistry(start);

    registry.dispose();
    registry.ensure("pier.grok", {
      packageDir: "packages/plugin-grok",
      refreshRuntimeSources: vi.fn(async () => undefined),
    });

    expect(start).not.toHaveBeenCalled();
    expect(() => registry.dispose()).not.toThrow();
  });

  it("rethrows one disposal error exactly and remains terminal and empty", () => {
    const disposalError = new Error("close failed");
    const dispose = vi.fn(() => {
      throw disposalError;
    });
    const start = vi.fn(() => ({ dispose }));
    const registry = createManagedPluginDevRuntimeWatchRegistry(start);
    const options = {
      packageDir: "packages/plugin-grok",
      refreshRuntimeSources: vi.fn(async () => undefined),
    };
    registry.ensure("pier.grok", options);

    let caught: unknown;
    try {
      registry.dispose();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(disposalError);
    registry.ensure("pier.codex", options);
    expect(start).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => registry.dispose()).not.toThrow();
  });

  it("disposes all watchers, clears the registry, and aggregates failures", () => {
    const codexError = new Error("codex close failed");
    const grokError = new Error("grok close failed");
    const codexDispose = vi.fn(() => {
      throw codexError;
    });
    const grokDispose = vi.fn(() => {
      throw grokError;
    });
    const start = vi
      .fn()
      .mockReturnValueOnce({ dispose: codexDispose })
      .mockReturnValueOnce({ dispose: grokDispose });
    const registry = createManagedPluginDevRuntimeWatchRegistry(start);
    const options = {
      packageDir: "packages/plugin",
      refreshRuntimeSources: vi.fn(async () => undefined),
    };

    registry.ensure("pier.codex", options);
    registry.ensure("pier.grok", options);

    let disposalError: unknown;
    try {
      registry.dispose();
    } catch (error) {
      disposalError = error;
    }

    expect(codexDispose).toHaveBeenCalledTimes(1);
    expect(grokDispose).toHaveBeenCalledTimes(1);
    expect(disposalError).toBeInstanceOf(AggregateError);
    expect((disposalError as AggregateError).errors).toEqual([
      codexError,
      grokError,
    ]);
    expect(() => registry.dispose()).not.toThrow();
    expect(codexDispose).toHaveBeenCalledTimes(1);
    expect(grokDispose).toHaveBeenCalledTimes(1);
  });
});
