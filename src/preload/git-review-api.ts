import type {
  GitReviewCancelRequest,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewIndexRequest,
  GitReviewIndexResult,
  GitReviewMutationRequest,
  GitReviewMutationResult,
  GitReviewPathMutationRequest,
} from "@shared/contracts/git-review.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierGitReviewAPI {
  applyReviewMutation: (
    request: GitReviewMutationRequest
  ) => Promise<GitReviewMutationResult>;
  applyReviewPathMutation: (
    request: GitReviewPathMutationRequest
  ) => Promise<GitReviewMutationResult>;
  cancelReviewRequest: (request: GitReviewCancelRequest) => Promise<void>;
  getReviewFileDocument: (
    request: GitReviewFileDocumentRequest
  ) => Promise<GitReviewFileDocumentResult>;
  getReviewIndex: (
    request: GitReviewIndexRequest
  ) => Promise<GitReviewIndexResult>;
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
};
