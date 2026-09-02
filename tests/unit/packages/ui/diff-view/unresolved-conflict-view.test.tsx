import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderUnresolvedConflictAnnotation } from "@pier/ui/diff-view/unresolved-conflict/host.tsx";
import { PierUnresolvedConflictView } from "@pier/ui/diff-view/unresolved-conflict/index.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs/react", () => ({
  File: (props: {
    readonly file: { readonly name: string };
    readonly options?: { readonly disableFileHeader?: boolean };
  }) => (
    <div
      data-disable-file-header={String(
        props.options?.disableFileHeader === true
      )}
      data-testid="pierre-file"
    >
      {props.file.name}
    </div>
  ),
  UnresolvedFile: (props: {
    readonly file: { readonly name: string };
    readonly options?: { readonly disableFileHeader?: boolean };
  }) => (
    <div
      data-disable-file-header={String(
        props.options?.disableFileHeader === true
      )}
      data-testid="pierre-unresolved-file"
    >
      {props.file.name}
    </div>
  ),
}));

const appearance = {
  codeFontFamily: "monospace",
  codeFontSize: "13px",
  codeThemes: { dark: "dark", light: "light" },
  colorMode: "dark" as const,
};

const labels = {
  acceptBoth: "Accept Both",
  acceptCurrent: "Accept Current",
  acceptIncoming: "Accept Incoming",
  currentChange: "current",
  incomingChange: "incoming",
  openFile: "Open File",
  resolving: "Resolving…",
};

const stages = {
  baseOid: null,
  oursOid: null,
  theirsOid: null,
};

const markerContents = [
  "<<<<<<< HEAD\n",
  "ours\n",
  "=======\n",
  "theirs\n",
  ">>>>>>> other\n",
].join("");

describe("PierUnresolvedConflictView", () => {
  it("renders UnresolvedFile for markers-text", () => {
    const { container } = render(
      <PierUnresolvedConflictView
        appearance={appearance}
        conflict={{
          contents: markerContents,
          contentsDigest: "sha256:markers",
          presentation: "markers-text",
          stages,
          xy: "UU",
        }}
        labels={labels}
        path="src/conflict.ts"
      />
    );

    expect(container.querySelector("[data-pier-unresolved-conflict]")).not.toBe(
      null
    );
    expect(
      container.querySelector("[data-pier-unresolved-conflict]")?.className
    ).not.toMatch(/overflow-auto/u);
    expect(screen.getByTestId("pierre-unresolved-file")).toHaveTextContent(
      "src/conflict.ts"
    );
    expect(container.querySelector("[data-pier-file-level-conflict]")).toBe(
      null
    );
  });

  it("renders nothing for file-level without contents", () => {
    const { container } = render(
      <PierUnresolvedConflictView
        appearance={appearance}
        conflict={{
          contents: null,
          contentsDigest: "sha256:dd",
          presentation: "file-level",
          stages,
          xy: "DD",
        }}
        labels={labels}
        path="src/gone.ts"
      />
    );

    expect(container.querySelector("[data-pier-unresolved-conflict]")).toBe(
      null
    );
    expect(container.querySelector("[data-pier-file-level-conflict]")).toBe(
      null
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Pierre File for marker-free worktree text", () => {
    const { container } = render(
      <PierUnresolvedConflictView
        appearance={appearance}
        conflict={{
          contents: "already resolved\n",
          contentsDigest: "sha256:file",
          presentation: "file-level",
          stages,
          xy: "UU",
        }}
        labels={labels}
        path="src/resolved.ts"
      />
    );

    expect(container.querySelector("[data-pier-conflict-file]")).not.toBe(null);
    expect(screen.getByTestId("pierre-file")).toHaveTextContent(
      "src/resolved.ts"
    );
    expect(screen.queryByTestId("pierre-unresolved-file")).toBeNull();
  });

  it("keeps file-level resolve actions when worktree text is present", () => {
    const renderFileLevel = vi.fn(() => (
      <div data-testid="file-level-actions">actions</div>
    ));
    const { container } = render(
      renderUnresolvedConflictAnnotation(
        {
          conflict: {
            contents: "keep me\n",
            contentsDigest: "sha256:file",
            presentation: "file-level",
            stages,
            xy: "UD",
          },
          kind: "unresolved-conflict",
          path: "src/keep.ts",
        },
        {
          appearance,
          host: {
            labels,
            onWriteResolved: () => undefined,
            renderFileLevel,
          },
          itemId: "section:conflict",
        }
      )
    );

    expect(screen.getByTestId("pierre-file")).toHaveTextContent("src/keep.ts");
    expect(screen.getByTestId("file-level-actions")).toHaveTextContent(
      "actions"
    );
    expect(container.querySelector("[data-pier-conflict-file]")).not.toBe(null);
    expect(renderFileLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "section:conflict",
        path: "src/keep.ts",
      })
    );
  });

  it("hides Pierre file chrome when nested in CodeView", () => {
    render(
      <PierUnresolvedConflictView
        appearance={appearance}
        conflict={{
          contents: markerContents,
          contentsDigest: "sha256:markers",
          presentation: "markers-text",
          stages,
          xy: "UU",
        }}
        embedInCodeView
        labels={labels}
        path="src/conflict.ts"
      />
    );

    expect(screen.getByTestId("pierre-unresolved-file")).toHaveAttribute(
      "data-disable-file-header",
      "true"
    );
  });

  it("does not import FileLevelConflictCard", async () => {
    const dir = join(
      process.cwd(),
      "packages/ui/src/diff-view/unresolved-conflict"
    );
    const host = await readFile(join(dir, "index.tsx"), "utf8");
    const annotationHost = await readFile(join(dir, "host.tsx"), "utf8");
    const markers = await readFile(join(dir, "markers-body.tsx"), "utf8");
    const fileBody = await readFile(join(dir, "file-body.tsx"), "utf8");
    expect(host).not.toContain("FileLevelConflictCard");
    expect(annotationHost).not.toContain("FileLevelConflictCard");
    expect(markers).not.toContain("FileLevelConflictCard");
    expect(fileBody).not.toContain("FileLevelConflictCard");
  });
});
