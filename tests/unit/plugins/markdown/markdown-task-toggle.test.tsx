import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { MarkdownPreview } from "@plugins/builtin/files/renderer/markdown/preview.tsx";
import type { MarkdownRuntime } from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { paginateMarkdownDocument } from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function immediateRuntime(): MarkdownRuntime {
  return {
    closeSession: vi.fn(),
    dispose: vi.fn(),
    parse: vi.fn(async (input) => {
      const document = parseMarkdownToIr(input.source);
      return {
        document,
        pagination: paginateMarkdownDocument(document),
        revision: input.revision,
        status: "parsed" as const,
      };
    }),
    setSessionVisible: vi.fn(),
  };
}

const onToggleTask = vi.fn();

function renderPreview() {
  return render(
    <MarkdownPreview
      onToggleTask={onToggleTask}
      openExternal={vi.fn()}
      runtime={immediateRuntime()}
      sessionId="task-1"
      source={{ kind: "disk" as const, path: "/t.md", root: "/t" }}
      value="- [ ] alpha"
    />
  );
}

describe("preview task checkbox", () => {
  it("is interactive and dispatches range patch request", async () => {
    renderPreview();
    const box = await screen.findByRole("checkbox", {
      name: "Incomplete task",
    });
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    expect(onToggleTask).toHaveBeenCalledWith({
      rangeStart: 0,
      rangeEnd: 11,
      checked: true,
    });
  });

  it("reflects optimistic checked state immediately", async () => {
    renderPreview();
    const box = await screen.findByRole("checkbox", {
      name: "Incomplete task",
    });
    fireEvent.click(box);
    expect(box).toHaveAttribute("data-state", "checked");
  });
});
