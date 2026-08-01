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
  readDocument?: ReturnType<typeof vi.fn>;
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
  window.pier = { files: { readDocument, writeDocument } } as never;
  return { readDocument, writeDocument };
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
});
