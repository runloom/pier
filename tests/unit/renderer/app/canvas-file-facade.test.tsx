// @vitest-environment jsdom

import { LiveModuleCanvasFileScopeProvider } from "@plugins/api/live-module-canvas-file.tsx";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  type CanvasFileApi,
  useCanvasFile,
} from "@/lib/live-modules/canvas-file-facade.ts";

const CANVAS_PATH = ".pier/canvases/demo/hello.canvas.tsx";
const PROJECT_ROOT = "/Users/dev/app";

function installFilesApi(overrides: {
  invoke?: ReturnType<typeof vi.fn>;
  readDocument?: ReturnType<typeof vi.fn>;
  watch?: ReturnType<typeof vi.fn>;
  writeDocument?: ReturnType<typeof vi.fn>;
}) {
  const readDocument =
    overrides.readDocument ??
    vi.fn(() =>
      Promise.resolve({
        contents: "{}",
        kind: "text",
        revision: "rev-1",
      })
    );
  const writeDocument =
    overrides.writeDocument ??
    vi.fn(() => Promise.resolve({ kind: "written", revision: "rev-2" }));
  const watch = overrides.watch ?? vi.fn(() => () => undefined);
  const invoke =
    overrides.invoke ??
    vi.fn(() => Promise.resolve({ kind: "started", runId: "run-1" }));
  window.pier = {
    canvasHost: { invoke },
    files: { readDocument, watch, writeDocument },
  } as never;
  return { invoke, readDocument, watch, writeDocument };
}

/** Render `useCanvasFile()` and hand the API back for direct assertions. */
function mountHook(withScope: boolean): CanvasFileApi {
  let api: CanvasFileApi | null = null;
  function Probe() {
    api = useCanvasFile();
    return null;
  }
  const tree: ReactNode = withScope ? (
    <LiveModuleCanvasFileScopeProvider
      scope={{
        directory: ".pier/canvases/demo",
        path: CANVAS_PATH,
        root: PROJECT_ROOT,
      }}
    >
      <Probe />
    </LiveModuleCanvasFileScopeProvider>
  ) : (
    <Probe />
  );
  render(tree);
  if (!api) {
    throw new Error("useCanvasFile did not produce an API");
  }
  return api;
}

describe("useCanvasFile", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    window.pier = undefined as never;
  });

  it("writes a sibling file against the canvas root and revision", async () => {
    const { writeDocument } = installFilesApi({});
    const api = mountHook(true);

    expect(api.available).toBe(true);
    expect(api.directory).toBe(".pier/canvases/demo");
    await expect(api.write("data.json", "{}\n", "rev-1")).resolves.toEqual({
      kind: "written",
      revision: "rev-2",
    });
    expect(writeDocument).toHaveBeenCalledWith({
      contents: "{}\n",
      eol: "lf",
      expected: { kind: "revision", revision: "rev-1" },
      format: { bom: false, encoding: "utf8" },
      path: ".pier/canvases/demo/data.json",
      root: PROJECT_ROOT,
    });
  });

  it("treats a null expected revision as 'must not exist yet'", async () => {
    const { writeDocument } = installFilesApi({});
    await mountHook(true).write("notes.md", "hi\n", null);
    expect(writeDocument).toHaveBeenCalledWith(
      expect.objectContaining({ expected: { kind: "absent" } })
    );
  });

  it("reports a stale revision as a conflict instead of overwriting", async () => {
    installFilesApi({
      writeDocument: vi.fn(() =>
        Promise.resolve({ kind: "conflict", reason: "revision-mismatch" })
      ),
    });
    const result = await mountHook(true).write("data.json", "{}\n", "rev-old");
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" && result.message.length > 0).toBe(true);
  });

  it("surfaces a not-writable target as a failure with the host message", async () => {
    installFilesApi({
      writeDocument: vi.fn(() =>
        Promise.resolve({ kind: "not-writable", message: "read-only volume" })
      ),
    });
    const result = await mountHook(true).write("data.json", "{}\n", "rev-1");
    expect(result).toEqual({ kind: "failed", message: "read-only volume" });
  });

  it("refuses names outside the canvas directory before any IPC", async () => {
    const { writeDocument } = installFilesApi({});
    const api = mountHook(true);
    const result = await api.write("../escape.json", "{}\n", "rev-1");
    expect(result.kind).toBe("failed");
    expect(writeDocument).not.toHaveBeenCalled();
    await expect(api.read("../escape.json")).rejects.toThrow();
  });

  it("is unavailable without a canvas file scope", async () => {
    installFilesApi({});
    const api = mountHook(false);
    expect(api.available).toBe(false);
    const result = await api.write("data.json", "{}\n", "rev-1");
    expect(result.kind).toBe("failed");
  });

  it("reads a sibling document and returns its revision", async () => {
    const { readDocument } = installFilesApi({});
    await expect(mountHook(true).read("data.json")).resolves.toEqual({
      contents: "{}",
      revision: "rev-1",
    });
    expect(readDocument).toHaveBeenCalledWith({
      path: ".pier/canvases/demo/data.json",
      root: PROJECT_ROOT,
    });
  });

  it("rejects a binary sibling instead of returning bytes as text", async () => {
    installFilesApi({
      readDocument: vi.fn(() =>
        Promise.resolve({ kind: "binary", revision: "rev-1" })
      ),
    });
    await expect(mountHook(true).read("logo.png")).rejects.toThrow();
  });

  it("writes a file one folder down from the canvas", async () => {
    const { writeDocument } = installFilesApi({});
    await mountHook(true).write("state/data.json", "{}\n", "rev-1");
    expect(writeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".pier/canvases/demo/state/data.json",
      })
    );
  });

  it("watches the sibling path and ignores other files", () => {
    let listener:
      | ((event: {
          changes: readonly {
            kind: "changed" | "created" | "deleted";
            path: string;
          }[];
          root: string;
        }) => void)
      | undefined;
    const unsubscribe = vi.fn();
    const watch = vi.fn((_root: string, callback: typeof listener) => {
      listener = callback;
      return unsubscribe;
    });
    installFilesApi({ watch });
    const onEvent = vi.fn();
    const stop = mountHook(true).watch("data.json", onEvent);

    expect(watch).toHaveBeenCalledWith(PROJECT_ROOT, expect.any(Function));
    listener?.({
      changes: [
        { kind: "changed", path: ".pier/canvases/demo/other.json" },
        { kind: "changed", path: ".pier/canvases/demo/data.json" },
      ],
      root: PROJECT_ROOT,
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      kind: "changed",
      path: ".pier/canvases/demo/data.json",
    });
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("watches a one-folder nested sibling", () => {
    let listener:
      | ((event: {
          changes: readonly { kind: "created"; path: string }[];
          root: string;
        }) => void)
      | undefined;
    installFilesApi({
      watch: vi.fn((_root: string, callback: typeof listener) => {
        listener = callback;
        return () => undefined;
      }),
    });
    const onEvent = vi.fn();
    mountHook(true).watch("state/positions.json", onEvent);
    listener?.({
      changes: [
        {
          kind: "created",
          path: ".pier/canvases/demo/state/positions.json",
        },
      ],
      root: PROJECT_ROOT,
    });
    expect(onEvent).toHaveBeenCalledWith({
      kind: "created",
      path: ".pier/canvases/demo/state/positions.json",
    });
  });

  it("refuses watch names outside the canvas folder", () => {
    const { watch } = installFilesApi({});
    const api = mountHook(true);
    expect(() => api.watch("../escape.json", () => undefined)).toThrow();
    expect(() => api.watch("a/b/c.json", () => undefined)).toThrow();
    expect(watch).not.toHaveBeenCalled();
  });

  it("is a no-op watch without a canvas file scope", () => {
    const { watch } = installFilesApi({});
    const stop = mountHook(false).watch("data.json", () => undefined);
    expect(watch).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("invokes a declared canvas command through canvasHost", async () => {
    const { invoke } = installFilesApi({});
    await expect(mountHook(true).invokeCommand("refresh")).resolves.toEqual({
      kind: "started",
      runId: "run-1",
    });
    expect(invoke).toHaveBeenCalledWith({
      payload: {
        canvasPath: CANVAS_PATH,
        key: "refresh",
        projectRootPath: PROJECT_ROOT,
      },
      type: "canvasCommand.invoke",
    });
  });

  it("returns cancelled when the host confirms a decline", async () => {
    installFilesApi({
      invoke: vi.fn(() => Promise.resolve({ kind: "cancelled" })),
    });
    await expect(mountHook(true).invokeCommand("refresh")).resolves.toEqual({
      kind: "cancelled",
    });
  });

  it("surfaces an invoke failure without a canvas file scope", async () => {
    installFilesApi({});
    const result = await mountHook(false).invokeCommand("refresh");
    expect(result.kind).toBe("failed");
  });
});
