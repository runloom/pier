import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git/exec.ts";
import type {
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewFileSource,
} from "@shared/contracts/git/review.ts";
import { afterEach, describe, expect, it } from "vitest";
import { TestGitReviewService as GitReviewService } from "./test-fixtures.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-image-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

function request(source: GitReviewFileSource): GitReviewFileDocumentRequest {
  return {
    operationId: randomUUID(),
    source,
  };
}

function source(root: string, path: string): GitReviewFileSource {
  return {
    contextId: "worktree:test",
    gitRootPath: root,
    oldPaths: [],
    path,
    target: { kind: "uncommitted" },
  };
}

function expectOk(
  result: GitReviewFileDocumentResult
): asserts result is Extract<GitReviewFileDocumentResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
}

describe("GitReviewService image document", () => {
  it("returns an image section for an untracked PNG", async () => {
    const root = await createRepository();
    await writeFile(join(root, "icon.png"), PNG_1X1);
    const result = await new GitReviewService().getFileDocument(
      request(source(root, "icon.png"))
    );
    expectOk(result);
    const section = result.sections.find((item) => item.kind === "image");
    expect(section?.kind).toBe("image");
    if (section?.kind !== "image") {
      return;
    }
    expect(section.before).toBeNull();
    expect(section.after?.kind).toBe("worktree");
    expect(section.after?.mime).toBe("image/png");
    expect(section.after?.width).toBe(1);
    expect(section.after?.height).toBe(1);
    expect(section.status).toBe("added");
  });

  it("returns an image section for a staged PNG blob", async () => {
    const root = await createRepository();
    await writeFile(join(root, "icon.png"), PNG_1X1);
    await execGit(["add", "--", "icon.png"], { cwd: root });
    const result = await new GitReviewService().getFileDocument(
      request(source(root, "icon.png"))
    );
    expectOk(result);
    const section = result.sections.find((item) => item.kind === "image");
    expect(section?.kind).toBe("image");
    if (section?.kind !== "image") {
      return;
    }
    expect(section.after?.kind).toBe("blob");
    expect(section.after?.mime).toBe("image/png");
  });

  it("returns an image section for an untracked JPEG without a NUL byte", async () => {
    const root = await createRepository();
    await writeFile(
      join(root, "photo.jpg"),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    );
    const result = await new GitReviewService().getFileDocument(
      request(source(root, "photo.jpg"))
    );
    expectOk(result);
    const section = result.sections.find((item) => item.kind === "image");
    expect(section?.kind).toBe("image");
    if (section?.kind !== "image") {
      return;
    }
    expect(section.before).toBeNull();
    expect(section.after?.kind).toBe("worktree");
    expect(section.after?.mime).toBe("image/jpeg");
  });

  it("returns an image section for an untracked SVG", async () => {
    const root = await createRepository();
    await writeFile(
      join(root, "mark.svg"),
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'></svg>"
    );
    const result = await new GitReviewService().getFileDocument(
      request(source(root, "mark.svg"))
    );
    expectOk(result);
    const section = result.sections.find((item) => item.kind === "image");
    expect(section?.kind).toBe("image");
    if (section?.kind !== "image") {
      return;
    }
    expect(section.before).toBeNull();
    expect(section.after?.kind).toBe("worktree");
    expect(section.after?.mime).toBe("image/svg+xml");
  });

  it("returns an image section for a staged SVG blob", async () => {
    const root = await createRepository();
    await writeFile(
      join(root, "mark.svg"),
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'></svg>"
    );
    await execGit(["add", "--", "mark.svg"], { cwd: root });
    const result = await new GitReviewService().getFileDocument(
      request(source(root, "mark.svg"))
    );
    expectOk(result);
    const section = result.sections.find((item) => item.kind === "image");
    expect(section?.kind).toBe("image");
    if (section?.kind !== "image") {
      return;
    }
    expect(section.after?.kind).toBe("blob");
    expect(section.after?.mime).toBe("image/svg+xml");
  });

  it("keeps non-image binary as a state notice", async () => {
    const root = await createRepository();
    await writeFile(join(root, "blob.dat"), Buffer.from([0, 1, 2]));
    const result = await new GitReviewService().getFileDocument(
      request(source(root, "blob.dat"))
    );
    expectOk(result);
    expect(
      result.sections.some(
        (section) => section.kind === "state" && section.reason === "binary"
      )
    ).toBe(true);
    expect(result.sections.some((section) => section.kind === "image")).toBe(
      false
    );
  });
});
