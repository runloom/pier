import { createTaskOutputBuffer } from "@main/services/tasks/task-output-buffer.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("task output buffer", () => {
  afterEach(() => vi.useRealTimers());

  it("batches live updates while retaining a bounded snapshot", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const output = createTaskOutputBuffer({
      maxChars: 8,
      maxChunks: 2,
      onChanged: changed,
    });
    output.start({ runId: "run-1", taskId: "build", windowId: "main" });

    output.append("run-1", "build", "stdout", "first\n");
    output.append("run-1", "build", "stderr", "second\n");
    output.append("run-1", "build", "stdout", "third\n");
    vi.advanceTimersByTime(32);

    const snapshot = output.snapshot("run-1", "build");
    expect(snapshot).toMatchObject({
      chunks: [{ sequence: 3, stream: "stdout", text: "third\n" }],
      firstSequence: 3,
      truncated: true,
      version: 3,
    });
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ firstSequence: 3, version: 3 }),
      "main"
    );
  });

  it("trims a single oversized chunk before publishing it", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const output = createTaskOutputBuffer({ maxChars: 4, onChanged: changed });
    output.start({ runId: "run-1", taskId: "build" });
    output.append("run-1", "build", "stdout", "123456");
    output.flush("run-1", "build");

    expect(output.snapshot("run-1", "build")?.chunks[0]?.text).toBe("3456");
    expect(changed.mock.calls[0]?.[0].chunks[0]?.text).toBe("3456");
  });
});
