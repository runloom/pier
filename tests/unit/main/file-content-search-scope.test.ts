import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ContentSearchError,
  createRgContentSearchRunner,
} from "../../../src/main/services/file-query/content-search.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("content search scopeDir symlink containment", () => {
  it("rejects scopeDir that realpath-escapes the project root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pier-content-out-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.txt"), "SECRET\n");

    const root = await mkdtemp(join(tmpdir(), "pier-content-root-"));
    roots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "inside\n");
    await symlink(outside, join(root, "escape"));

    const runner = createRgContentSearchRunner({
      resolveRuntime: () => ({
        kind: "available",
        arch: "arm64",
        executablePath: process.execPath, // unused — fails before spawn on scope
        source: "inject",
      }),
    });

    await expect(
      runner({
        defaultExcludePatterns: "",
        onBatch: () => undefined,
        request: {
          mode: "content",
          owner: "content-search:t",
          query: "SECRET",
          queryId: "q1",
          root,
          options: { scopeDir: "escape" },
        },
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({
      code: "invalid-scope",
    } satisfies Partial<ContentSearchError>);
  });
});
