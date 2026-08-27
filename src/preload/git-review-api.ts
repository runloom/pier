import type {
  GitReviewCancelRequest,
  GitReviewConflictResolveRequest,
  GitReviewExcerptBatchRequest,
  GitReviewExcerptBatchResult,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewIndexRequest,
  GitReviewIndexResult,
  GitReviewMutationRequest,
  GitReviewMutationResult,
  GitReviewPathMutationRequest,
} from "@shared/contracts/git/review.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierGitReviewAPI {
  applyReviewMutation: (
    request: GitReviewMutationRequest
  ) => Promise<GitReviewMutationResult>;
  applyReviewPathMutation: (
    request: GitReviewPathMutationRequest
  ) => Promise<GitReviewMutationResult>;
  cancelReviewRequest: (request: GitReviewCancelRequest) => Promise<void>;
  getReviewExcerptBatch: (
    request: GitReviewExcerptBatchRequest
  ) => Promise<GitReviewExcerptBatchResult>;
  getReviewFileDocument: (
    request: GitReviewFileDocumentRequest
  ) => Promise<GitReviewFileDocumentResult>;
  getReviewIndex: (
    request: GitReviewIndexRequest
  ) => Promise<GitReviewIndexResult>;
  resolveReviewConflict: (
    request: GitReviewConflictResolveRequest
  ) => Promise<GitReviewMutationResult>;
}

export const gitReviewApi: PierGitReviewAPI = {
  applyReviewPathMutation: (request) =>
    invokePierCommand<GitReviewMutationResult>({
      request,
      type: "git.applyReviewPathMutation",
    }),
  applyReviewMutation: (request) =>
    invokePierCommand<GitReviewMutationResult>({
      request,
      type: "git.applyReviewMutation",
    }),
  cancelReviewRequest: (request) =>
    invokePierCommand<void>({
      request,
      type: "git.cancelReviewRequest",
    }),
  getReviewExcerptBatch: (request) =>
    invokePierCommand<GitReviewExcerptBatchResult>({
      request,
      type: "git.getReviewExcerptBatch",
    }),
  getReviewFileDocument: (request) =>
    invokePierCommand<GitReviewFileDocumentResult>({
      request,
      type: "git.getReviewFileDocument",
    }),
  getReviewIndex: (request) =>
    invokePierCommand<GitReviewIndexResult>({
      request,
      type: "git.getReviewIndex",
    }),
  resolveReviewConflict: (request) =>
    invokePierCommand<GitReviewMutationResult>({
      request,
      type: "git.resolveReviewConflict",
    }),
};
