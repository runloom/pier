import {
  commentAuthorSchema,
  commentFailureSchema,
  commentProjectStoreSchema,
  commentsCommandSchemas,
  commentsCreateThreadRequestSchema,
  commentTargetSchema,
  commentThreadSchema,
  gitDiffCommentTargetSchema,
  gitFileCommentTargetSchema,
} from "@shared/contracts/comments/index.ts";
import { describe, expect, it } from "vitest";

const SCOPE = {
  contextId: "ctx:abc123",
  gitRootPath: "/repo",
  target: { kind: "uncommitted" },
} as const;

const BLOB_OID = "0".repeat(40);
const THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
const COMMENT_ID = "660e8400-e29b-41d4-a716-446655440000";

const validDiffTarget = {
  blobOid: BLOB_OID,
  group: "unstaged",
  kind: "git-diff",
  line: 5,
  oldPath: null,
  path: "src/a.ts",
  scope: SCOPE,
  side: "new",
} as const;

const validComment = {
  author: { kind: "user" },
  body: "looks good",
  createdAt: 1000,
  id: COMMENT_ID,
} as const;

const validThread = {
  comments: [validComment],
  createdAt: 1000,
  id: THREAD_ID,
  state: "open",
  target: validDiffTarget,
  updatedAt: 2000,
} as const;

describe("comments contract schemas", () => {
  describe("gitDiffCommentTargetSchema", () => {
    it("accepts a valid diff anchor with blob oid", () => {
      expect(
        gitDiffCommentTargetSchema.safeParse(validDiffTarget).success
      ).toBe(true);
    });
    it("accepts without optional blobOid and anchor", () => {
      const { blobOid: _omit, ...withoutBlob } = validDiffTarget;
      expect(gitDiffCommentTargetSchema.safeParse(withoutBlob).success).toBe(
        true
      );
    });
    it("rejects a non-40-hex blob oid", () => {
      expect(
        gitDiffCommentTargetSchema.safeParse({
          ...validDiffTarget,
          blobOid: "xyz",
        }).success
      ).toBe(false);
    });
    it("rejects line <= 0", () => {
      expect(
        gitDiffCommentTargetSchema.safeParse({
          ...validDiffTarget,
          line: 0,
        }).success
      ).toBe(false);
    });
    it("rejects an unknown side", () => {
      expect(
        gitDiffCommentTargetSchema.safeParse({
          ...validDiffTarget,
          side: "middle",
        }).success
      ).toBe(false);
    });
    it("rejects an absolute path", () => {
      expect(
        gitDiffCommentTargetSchema.safeParse({
          ...validDiffTarget,
          path: "/abs/a.ts",
        }).success
      ).toBe(false);
    });
    it("rejects an unknown group", () => {
      expect(
        gitDiffCommentTargetSchema.safeParse({
          ...validDiffTarget,
          group: "unknown",
        }).success
      ).toBe(false);
    });
  });

  describe("gitFileCommentTargetSchema", () => {
    it("accepts a valid file anchor", () => {
      expect(
        gitFileCommentTargetSchema.safeParse({
          kind: "git-file",
          path: "src/a.ts",
          scope: SCOPE,
        }).success
      ).toBe(true);
    });
  });

  describe("commentTargetSchema", () => {
    it("dispatches by kind", () => {
      expect(commentTargetSchema.safeParse(validDiffTarget).success).toBe(true);
      expect(
        commentTargetSchema.safeParse({
          kind: "git-file",
          path: "src/a.ts",
          scope: SCOPE,
        }).success
      ).toBe(true);
    });
    it("rejects an unregistered target kind at schema layer", () => {
      expect(
        commentTargetSchema.safeParse({
          kind: "code",
          path: "src/a.ts",
        }).success
      ).toBe(false);
    });
  });

  describe("commentAuthorSchema", () => {
    it("accepts a user author", () => {
      expect(commentAuthorSchema.safeParse({ kind: "user" }).success).toBe(
        true
      );
    });
    it("accepts an agent author with id + displayName", () => {
      expect(
        commentAuthorSchema.safeParse({
          agentId: "claude",
          displayName: "Claude",
          kind: "agent",
        }).success
      ).toBe(true);
    });
    it("rejects an agent author missing displayName", () => {
      expect(
        commentAuthorSchema.safeParse({ agentId: "claude", kind: "agent" })
          .success
      ).toBe(false);
    });
  });

  describe("commentThreadSchema", () => {
    it("accepts an open thread (storage still freezes state: open)", () => {
      expect(commentThreadSchema.safeParse(validThread).success).toBe(true);
    });
    it("still accepts resolved in schema (legacy store rows; writers always open)", () => {
      // schema 冻结：历史 resolved 行可读；service 写入恒 open。
      expect(
        commentThreadSchema.safeParse({ ...validThread, state: "resolved" })
          .success
      ).toBe(true);
    });
    it("rejects an unknown state", () => {
      expect(
        commentThreadSchema.safeParse({ ...validThread, state: "closed" })
          .success
      ).toBe(false);
    });
    it("rejects an empty comment body", () => {
      expect(
        commentThreadSchema.safeParse({
          ...validThread,
          comments: [{ ...validComment, body: "" }],
        }).success
      ).toBe(false);
    });
  });

  describe("commentProjectStoreSchema", () => {
    it("accepts a v1 store with readState", () => {
      expect(
        commentProjectStoreSchema.safeParse({
          readState: { lastReadAt: 0 },
          threads: [validThread],
          version: 1,
          worktreeKey: "/repo",
        }).success
      ).toBe(true);
    });
    it("rejects an unknown store version", () => {
      expect(
        commentProjectStoreSchema.safeParse({
          readState: { lastReadAt: 0 },
          threads: [],
          version: 2,
          worktreeKey: "/repo",
        }).success
      ).toBe(false);
    });
  });

  describe("commentsCreateThreadRequestSchema", () => {
    it("accepts a create request with user author", () => {
      expect(
        commentsCreateThreadRequestSchema.safeParse({
          author: { kind: "user" },
          body: "new thread",
          target: validDiffTarget,
          worktreeKey: "/repo",
        }).success
      ).toBe(true);
    });
    it("rejects a request missing body", () => {
      expect(
        commentsCreateThreadRequestSchema.safeParse({
          author: { kind: "user" },
          target: validDiffTarget,
          worktreeKey: "/repo",
        }).success
      ).toBe(false);
    });
  });

  describe("commentFailureSchema", () => {
    it("accepts a failure with null message", () => {
      expect(
        commentFailureSchema.safeParse({
          kind: "error",
          message: null,
          reason: "internal",
          retryable: false,
        }).success
      ).toBe(true);
    });
    it("rejects an unknown reason", () => {
      expect(
        commentFailureSchema.safeParse({
          kind: "error",
          message: "boom",
          reason: "unknown",
          retryable: false,
        }).success
      ).toBe(false);
    });
  });

  describe("commentsCommandSchemas", () => {
    it("registers the five slim command types", () => {
      expect(commentsCommandSchemas).toHaveLength(5);
      expect(
        commentsCommandSchemas.map((schema) => schema.shape.type.value)
      ).toEqual([
        "comments.list",
        "comments.listProjects",
        "comments.createThread",
        "comments.updateComment",
        "comments.deleteComment",
      ]);
    });
  });
});
