// @vitest-environment jsdom
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  CANVAS_SKELETON_DELAY_MS,
  FileCanvasPreview,
} from "@plugins/builtin/files/renderer/file-canvas-preview.tsx";
import { projectLiveRootId } from "@shared/contracts/live-modules.ts";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeModuleDataUrl(body: string): string {
  return `data:text/javascript,${encodeURIComponent(body)}`;
}

function createContext(liveModules: {
  compile: ReturnType<typeof vi.fn>;
  getUrl?: ReturnType<typeof vi.fn>;
  onChanged: ReturnType<typeof vi.fn>;
  registerRoot: ReturnType<typeof vi.fn>;
  unregisterRoot?: ReturnType<typeof vi.fn>;
}): RendererPluginContext {
  return {
    liveModules: {
      compile: liveModules.compile,
      getUrl: liveModules.getUrl ?? vi.fn(),
      onChanged: liveModules.onChanged,
      registerRoot: liveModules.registerRoot,
      unregisterRoot:
        liveModules.unregisterRoot ??
        vi.fn(async (rootId: string) => ({ rootId })),
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
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Reload" }).click();
    });
    await waitFor(() => {
      expect(
        document.querySelector("[data-test-canvas='reloaded']")
      ).toBeTruthy();
    });
    expect(compile).toHaveBeenCalledTimes(2);
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
});
