import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PierUnresolvedConflictView } from "@pier/ui/diff-view/unresolved-conflict/index.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs/react", () => ({
  UnresolvedFile: (props: { readonly file: { readonly name: string } }) => (
    <div data-testid="pierre-unresolved-file">{props.file.name}</div>
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
    expect(screen.getByTestId("pierre-unresolved-file")).toHaveTextContent(
      "src/conflict.ts"
    );
    expect(container.querySelector("[data-pier-file-level-conflict]")).toBe(
      null
    );
  });

  it("renders nothing for non-marker presentations", () => {
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

  it("does not import FileLevelConflictCard", async () => {
    const dir = join(
      process.cwd(),
      "packages/ui/src/diff-view/unresolved-conflict"
    );
    const host = await readFile(join(dir, "index.tsx"), "utf8");
    const markers = await readFile(join(dir, "markers-body.tsx"), "utf8");
    expect(host).not.toContain("FileLevelConflictCard");
    expect(markers).not.toContain("FileLevelConflictCard");
  });
});
