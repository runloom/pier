// @vitest-environment node
import type { FSWatcher } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLiveModuleGraphTracker,
  isLiveModuleGraphRecoveryFileName,
  LIVE_MODULE_WATCH_DEBOUNCE_MS,
  type LiveModuleDirWatch,
} from "../../../../src/main/services/live-modules/graph.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createFakeDirWatch(): {
  emit: (filename: string | Buffer | null) => void;
  watch: LiveModuleDirWatch;
} {
  let listener:
    | ((event: string, filename: string | Buffer | null) => void)
    | null = null;
  return {
    emit(filename) {
      listener?.("change", filename);
    },
    watch: (_dir, callback) => {
      listener = callback;
      const watcher: Pick<FSWatcher, "close" | "on"> = {
        close: () => {
          listener = null;
        },
        on() {
          return watcher as FSWatcher;
        },
      };
      return watcher;
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for graph watch event");
    }
    await wait(40);
  }
}

describe("isLiveModuleGraphRecoveryFileName", () => {
  it("accepts compilable siblings and rejects canvas data files", () => {
    expect(isLiveModuleGraphRecoveryFileName("dep.ts")).toBe(true);
    expect(isLiveModuleGraphRecoveryFileName("notes.canvas.tsx")).toBe(true);
    expect(isLiveModuleGraphRecoveryFileName("styles.css")).toBe(true);
    expect(isLiveModuleGraphRecoveryFileName("board.json")).toBe(false);
    expect(isLiveModuleGraphRecoveryFileName("instance.json")).toBe(false);
    expect(isLiveModuleGraphRecoveryFileName("state/board.json")).toBe(false);
    expect(isLiveModuleGraphRecoveryFileName("notes.md")).toBe(false);
  });
});

describe("createLiveModuleGraphTracker", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops) {
      stop();
    }
    stops.length = 0;
  });

  it("does not stale-compile when a useCanvasFile sibling json is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-graph-data-"));
    const canvas = join(dir, "notes.canvas.tsx");
    await writeFile(canvas, "export default function K() { return null; }\n");
    const fake = createFakeDirWatch();
    const tracker = createLiveModuleGraphTracker({ watch: fake.watch });
    const events: Array<{ moduleId: string; rootId: string }> = [];
    stops.push(
      tracker.watch((batch) => {
        events.push(...batch);
      })
    );
    tracker.setModuleGraph("root", "notes.canvas.tsx", [canvas]);
    await writeFile(join(dir, "board.json"), '{"cards":[]}\n');
    // Deliver only the data write: macOS can otherwise report the earlier
    // canvas creation after the fixed settling delay under coverage load.
    fake.emit("board.json");
    await wait(LIVE_MODULE_WATCH_DEBOUNCE_MS + 50);
    expect(events).toEqual([]);
  });

  it("emits when a graph file changes and when a source sibling appears", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-graph-src-"));
    const canvas = join(dir, "notes.canvas.tsx");
    await writeFile(canvas, "export default function K() { return null; }\n");
    const tracker = createLiveModuleGraphTracker();
    const events: Array<{ moduleId: string; rootId: string }> = [];
    stops.push(
      tracker.watch((batch) => {
        events.push(...batch);
      })
    );
    tracker.setModuleGraph("root", "notes.canvas.tsx", [canvas]);
    await wait(LIVE_MODULE_WATCH_DEBOUNCE_MS + 150);
    events.length = 0;
    await writeFile(
      canvas,
      "export default function Edited() { return null; }\n"
    );
    await waitUntil(() => events.length > 0);
    expect(events).toEqual([{ moduleId: "notes.canvas.tsx", rootId: "root" }]);
    events.length = 0;
    await writeFile(join(dir, "dep.ts"), "export const n = 1;\n");
    await waitUntil(() => events.length > 0);
    expect(events).toEqual([{ moduleId: "notes.canvas.tsx", rootId: "root" }]);
  });

  it("does not stale-compile when a nameless watch event leaves graph files unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-graph-unnamed-"));
    const canvas = join(dir, "notes.canvas.tsx");
    await writeFile(canvas, "export default function K() { return null; }\n");
    const fake = createFakeDirWatch();
    const tracker = createLiveModuleGraphTracker({ watch: fake.watch });
    const events: Array<{ moduleId: string; rootId: string }> = [];
    stops.push(
      tracker.watch((batch) => {
        events.push(...batch);
      })
    );
    tracker.setModuleGraph("root", "notes.canvas.tsx", [canvas]);
    fake.emit(null);
    await wait(LIVE_MODULE_WATCH_DEBOUNCE_MS + 50);
    expect(events).toEqual([]);
    await writeFile(join(dir, "board.json"), '{"cards":[]}\n');
    fake.emit(null);
    await wait(LIVE_MODULE_WATCH_DEBOUNCE_MS + 50);
    expect(events).toEqual([]);
  });

  it("stale-compiles when a nameless watch event matches a graph file mtime change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-graph-mtime-"));
    const canvas = join(dir, "notes.canvas.tsx");
    await writeFile(canvas, "export default function K() { return null; }\n");
    const fake = createFakeDirWatch();
    const tracker = createLiveModuleGraphTracker({ watch: fake.watch });
    const events: Array<{ moduleId: string; rootId: string }> = [];
    stops.push(
      tracker.watch((batch) => {
        events.push(...batch);
      })
    );
    tracker.setModuleGraph("root", "notes.canvas.tsx", [canvas]);
    await writeFile(
      canvas,
      "export default function Edited() { return null; }\n"
    );
    fake.emit(null);
    await waitUntil(() => events.length > 0);
    expect(events).toEqual([{ moduleId: "notes.canvas.tsx", rootId: "root" }]);
  });
});
