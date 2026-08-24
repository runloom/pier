// @vitest-environment jsdom
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileCanvasPreview } from "@plugins/builtin/files/renderer/preview/canvas.tsx";
import {
  getCanvasChromeState,
  requestCanvasReload,
  unmarkCanvasActive,
} from "@plugins/builtin/files/renderer/preview/canvas-chrome-store.ts";
import { CANVAS_SKELETON_DELAY_MS } from "@plugins/builtin/files/renderer/preview/canvas-compile-state.ts";
import { projectLiveRootId } from "@shared/contracts/live-modules.ts";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeModuleDataUrl(body: string): string {
  return `data:text/javascript,${encodeURIComponent(body)}`;
}

function createContext(
  liveModules: {
    compile: ReturnType<typeof vi.fn>;
    getUrl?: ReturnType<typeof vi.fn>;
    onChanged: ReturnType<typeof vi.fn>;
    registerRoot: ReturnType<typeof vi.fn>;
    unregisterRoot?: ReturnType<typeof vi.fn>;
    success?: ReturnType<typeof vi.fn>;
  },
  options?: {
    confirm?: ReturnType<typeof vi.fn>;
    trusted?: boolean;
  }
): RendererPluginContext {
  return {
    ...(options?.confirm
      ? {
          dialogs: { confirm: options.confirm },
        }
      : {}),
    liveModules: {
      compile: liveModules.compile,
      getUrl: liveModules.getUrl ?? vi.fn(),
      onChanged: liveModules.onChanged,
      registerRoot: liveModules.registerRoot,
      unregisterRoot:
        liveModules.unregisterRoot ??
        vi.fn(async (rootId: string) => ({ rootId })),
      // Tests exercise the already-trusted path unless stated otherwise.
      trustStatus: vi.fn(async () => ({
        grantedAt: options?.trusted ? "2026-01-01T00:00:00.000Z" : null,
        trusted: options?.trusted ?? true,
      })),
      grantTrust: vi.fn(async () => undefined),
      revokeTrust: vi.fn(async () => undefined),
    },
    notifications: {
      success: liveModules.success ?? vi.fn(),
    },
  } as unknown as RendererPluginContext;
}

const t = (key: string, fallback?: string) => fallback ?? key;

const CANVAS_PATH = ".pier/canvases/smoke/hello.canvas.tsx";
const PROJECT_ROOT = "/proj";

describe("FileCanvasPreview", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows delayed skeleton on first open, then mounts content", async () => {
    const url = makeModuleDataUrl(`
      export function mount(el) {
        el.setAttribute("data-test-canvas", "ready");
        el.textContent = "canvas-ready";
        return () => { el.textContent = ""; };
      }
      export default function App() { return null; }
    `);
    let resolveCompile!: (value: {
      graph: string[];
      moduleId: string;
      ok: true;
      url: string;
    }) => void;
    const compile = vi.fn(
      () =>
        new Promise<{
          graph: string[];
          moduleId: string;
          ok: true;
          url: string;
        }>((resolve) => {
          resolveCompile = resolve;
        })
    );
    const onChanged = vi.fn(() => () => undefined);
    const registerRoot = vi.fn(async () => undefined);

    vi.useFakeTimers();
    render(
      <FileCanvasPreview
        context={createContext({ compile, onChanged, registerRoot })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CANVAS_SKELETON_DELAY_MS);
    });
    expect(screen.getByRole("status")).toBeTruthy();

    await act(async () => {
      resolveCompile({
        graph: [],
        moduleId: "smoke/hello.canvas.tsx",
        ok: true,
        url,
      });
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(document.querySelector("[data-test-canvas='ready']")).toBeTruthy();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("skips skeleton when compile finishes under delay", async () => {
    const url = makeModuleDataUrl(`
      export function mount(el) {
        el.setAttribute("data-test-canvas", "fast");
        return () => {};
      }
      export default function App() { return null; }
    `);
    const compile = vi.fn(async () => ({
      graph: [],
      moduleId: "smoke/hello.canvas.tsx",
      ok: true as const,
      url,
    }));
    render(
      <FileCanvasPreview
        context={createContext({
          compile,
          onChanged: vi.fn(() => () => undefined),
          registerRoot: vi.fn(async () => undefined),
        })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(document.querySelector("[data-test-canvas='fast']")).toBeTruthy();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows error UI with multi diagnostics and reload", async () => {
    const okUrl = makeModuleDataUrl(`
      export function mount(el) {
        el.setAttribute("data-test-canvas", "reloaded");
        return () => {};
      }
      export default function App() { return null; }
    `);
    const compile = vi
      .fn()
      .mockResolvedValueOnce({
        diagnostics: [
          { message: "first error", severity: "error" as const },
          { message: "second error", severity: "error" as const },
        ],
        ok: false as const,
      })
      .mockResolvedValueOnce({
        graph: [],
        moduleId: "smoke/hello.canvas.tsx",
        ok: true as const,
        url: okUrl,
      });

    render(
      <FileCanvasPreview
        context={createContext({
          compile,
          onChanged: vi.fn(() => () => undefined),
          registerRoot: vi.fn(async () => undefined),
        })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Couldn’t compile canvas")).toBeTruthy();
    });
    expect(
      document.querySelector("[data-slot='file-canvas-diagnostics']")
    ).toBeTruthy();
    expect(screen.getAllByText("first error").length).toBeGreaterThan(0);
    expect(screen.getByText("second error")).toBeTruthy();
    const reloadButtons = screen.getAllByRole("button", { name: "Reload" });
    expect(reloadButtons.length).toBeGreaterThan(0);

    await act(async () => {
      reloadButtons[0]?.click();
    });
    await waitFor(() => {
      expect(
        document.querySelector("[data-test-canvas='reloaded']")
      ).toBeTruthy();
    });
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("runtime crash uses full Empty (not soft Alert banner)", async () => {
    // Prefer React default export (no `mount`) so LiveModuleErrorBoundary fires.
    const compile = vi.fn(async () => ({
      graph: [],
      moduleId: "smoke/hello.canvas.tsx",
      ok: true as const,
      url: makeModuleDataUrl(`
        export default function App() {
          throw new Error("Cannot read properties of undefined (reading 'filter')");
        }
      `),
    }));

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <FileCanvasPreview
        context={createContext({
          compile,
          onChanged: vi.fn(() => () => undefined),
          registerRoot: vi.fn(async () => undefined),
        })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(
        document.querySelector("[data-slot='file-canvas-error-empty']")
      ).toBeTruthy();
    });
    expect(screen.getByText("Canvas crashed while rendering")).toBeTruthy();
    expect(
      screen.getByText("Cannot read properties of undefined (reading 'filter')")
    ).toBeTruthy();
    // Soft Alert banner is only for hot-reload compile while content is kept.
    expect(
      document.querySelector("[data-slot='file-canvas-soft-error']")
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();

    consoleError.mockRestore();
  });

  it("hot reload compile failure keeps previous mount (soft error)", async () => {
    let generation = 0;
    const compile = vi.fn(async () => {
      generation += 1;
      if (generation === 1) {
        return {
          graph: [],
          moduleId: "smoke/hello.canvas.tsx",
          ok: true as const,
          url: makeModuleDataUrl(`
            export function mount(el) {
              el.setAttribute("data-test-canvas", "kept");
              return () => {};
            }
            export default function App() { return null; }
          `),
        };
      }
      return {
        diagnostics: [
          { message: "syntax error after edit", severity: "error" as const },
        ],
        ok: false as const,
      };
    });

    let staleCb:
      | ((event: { moduleId: string; rootId: string; type: "stale" }) => void)
      | null = null;
    const onChanged = vi.fn((cb: typeof staleCb) => {
      staleCb = cb;
      return () => {
        staleCb = null;
      };
    });

    render(
      <FileCanvasPreview
        context={createContext({
          compile,
          onChanged,
          registerRoot: vi.fn(async () => ({ rootId: "x" })),
        })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(document.querySelector("[data-test-canvas='kept']")).toBeTruthy();
    });

    await act(async () => {
      staleCb?.({
        moduleId: "smoke/hello.canvas.tsx",
        rootId: projectLiveRootId(PROJECT_ROOT),
        type: "stale",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(document.querySelector("[data-test-canvas='kept']")).toBeTruthy();
    expect(screen.getByText(/syntax error after edit/u)).toBeTruthy();
  });

  it("hot reload keeps previous content (no skeleton) until new mount", async () => {
    let generation = 0;
    const compile = vi.fn(async () => {
      generation += 1;
      const g = generation;
      const url = makeModuleDataUrl(`
        export function mount(el) {
          el.setAttribute("data-test-canvas", "gen-${g}");
          el.textContent = "gen-${g}";
          return () => { el.textContent = ""; };
        }
        export default function App() { return null; }
      `);
      if (g === 2) {
        await new Promise((r) => setTimeout(r, 80));
      }
      return {
        graph: [],
        moduleId: "smoke/hello.canvas.tsx",
        ok: true as const,
        url,
      };
    });

    let staleCb:
      | ((event: { moduleId: string; rootId: string; type: "stale" }) => void)
      | null = null;
    const onChanged = vi.fn((cb: typeof staleCb) => {
      staleCb = cb;
      return () => {
        staleCb = null;
      };
    });

    render(
      <FileCanvasPreview
        context={createContext({
          compile,
          onChanged,
          registerRoot: vi.fn(async () => undefined),
        })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(document.querySelector("[data-test-canvas='gen-1']")).toBeTruthy();
    });

    await act(async () => {
      staleCb?.({
        moduleId: "smoke/hello.canvas.tsx",
        rootId: projectLiveRootId(PROJECT_ROOT),
        type: "stale",
      });
    });

    // Still showing gen-1 while recompile runs; no status skeleton.
    expect(document.querySelector("[data-test-canvas='gen-1']")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();

    await waitFor(() => {
      expect(document.querySelector("[data-test-canvas='gen-2']")).toBeTruthy();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("registers canvases under the project live root id and reloads on stale", async () => {
    const baseId = projectLiveRootId(PROJECT_ROOT);
    const url = makeModuleDataUrl(`
      export function mount(el) {
        el.setAttribute("data-test-canvas", "canvases");
        return () => {};
      }
      export default function App() { return null; }
    `);
    const compile = vi.fn(async () => ({
      graph: [],
      moduleId: "smoke/hello.canvas.tsx",
      ok: true as const,
      url,
    }));
    let staleCb:
      | ((event: { moduleId: string; rootId: string; type: "stale" }) => void)
      | null = null;
    const onChanged = vi.fn((cb: typeof staleCb) => {
      staleCb = cb;
      return () => {
        staleCb = null;
      };
    });
    const registerRoot = vi.fn(async (spec: { id: string }) => ({
      rootId: spec.id,
    }));

    render(
      <FileCanvasPreview
        context={createContext({ compile, onChanged, registerRoot })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(
        document.querySelector("[data-test-canvas='canvases']")
      ).toBeTruthy();
    });
    expect(registerRoot).toHaveBeenCalled();
    const registeredId = (
      registerRoot.mock.calls[0]?.[0] as { id: string } | undefined
    )?.id;
    expect(registeredId).toBe(baseId);

    await act(async () => {
      staleCb?.({
        moduleId: "smoke/hello.canvas.tsx",
        rootId: baseId,
        type: "stale",
      });
    });

    await waitFor(() => {
      expect(compile.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("publishes chrome state and recompiles on toolbar reload request", async () => {
    const url = makeModuleDataUrl(`
      export function mount(el) {
        el.setAttribute("data-test-canvas", "chrome");
        return () => {};
      }
      export default function App() { return null; }
    `);
    let resolveCompile:
      | ((value: {
          graph: string[];
          moduleId: string;
          ok: true;
          url: string;
        }) => void)
      | undefined;
    const compile = vi.fn(
      () =>
        new Promise<{
          graph: string[];
          moduleId: string;
          ok: true;
          url: string;
        }>((resolve) => {
          resolveCompile = resolve;
        })
    );
    const onChanged = vi.fn(() => () => undefined);
    const registerRoot = vi.fn(async (spec: { id: string }) => ({
      rootId: spec.id,
    }));
    const success = vi.fn();

    // Reset module-level store for this module so the test sees fresh state.
    act(() => {
      unmarkCanvasActive("smoke/hello.canvas.tsx");
    });

    const { unmount } = render(
      <FileCanvasPreview
        context={createContext({ compile, onChanged, registerRoot, success })}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(compile).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      resolveCompile?.({
        graph: [],
        moduleId: "smoke/hello.canvas.tsx",
        ok: true,
        url,
      });
    });
    await waitFor(() => {
      expect(
        document.querySelector("[data-test-canvas='chrome']")
      ).toBeTruthy();
    });
    // Preview marked its module active for the toolbar.
    expect(
      getCanvasChromeState().activeByModule["smoke/hello.canvas.tsx"]
    ).toBeGreaterThan(0);
    const callsBeforeReload = compile.mock.calls.length;

    // Toolbar Reload bumps the store: busy in flight, preview recompiles.
    act(() => {
      requestCanvasReload("smoke/hello.canvas.tsx");
    });
    await waitFor(() => {
      expect(compile.mock.calls.length).toBeGreaterThan(callsBeforeReload);
    });
    expect(getCanvasChromeState().busyByModule["smoke/hello.canvas.tsx"]).toBe(
      true
    );

    // Settling the reload generation clears busy; no success toast.
    await act(async () => {
      resolveCompile?.({
        graph: [],
        moduleId: "smoke/hello.canvas.tsx",
        ok: true,
        url,
      });
    });
    await waitFor(() => {
      expect(
        getCanvasChromeState().busyByModule["smoke/hello.canvas.tsx"]
      ).toBe(false);
    });
    expect(success).not.toHaveBeenCalled();

    unmount();
    // Unmount deactivates the module so other panels don't show stale chrome.
    expect(
      getCanvasChromeState().activeByModule["smoke/hello.canvas.tsx"]
    ).toBeUndefined();
  });

  it("stops before compiling when the project trust is declined", async () => {
    const compile = vi.fn(async () => {
      throw new Error("must not compile");
    });
    const onChanged = vi.fn(() => () => undefined);
    const registerRoot = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => false);

    render(
      <FileCanvasPreview
        context={createContext(
          { compile, onChanged, registerRoot },
          { confirm, trusted: false }
        )}
        path={CANVAS_PATH}
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
    });
    expect(compile).not.toHaveBeenCalled();
    expect(registerRoot).not.toHaveBeenCalled();
    expect(screen.getByText(/canvases aren’t trusted/i)).toBeTruthy();
  });
});
