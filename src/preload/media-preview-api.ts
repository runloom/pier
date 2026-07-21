import type {
  FilePreviewTicketIssueResult,
  MediaPreviewAbsoluteIssueRequest,
  MediaPreviewAbsoluteReleaseRequest,
} from "@shared/contracts/file-preview-ticket.ts";
import { filePreviewTicketIssueResultSchema } from "@shared/contracts/file-preview-ticket.ts";

export interface PierMediaPreviewApi {
  issueAbsolute(
    request: MediaPreviewAbsoluteIssueRequest
  ): Promise<FilePreviewTicketIssueResult>;
  releaseAbsolute(
    request: MediaPreviewAbsoluteReleaseRequest
  ): Promise<boolean>;
}

export interface MediaPreviewApiDependencies {
  invokeIssue(request: MediaPreviewAbsoluteIssueRequest): Promise<unknown>;
  invokeRelease(request: MediaPreviewAbsoluteReleaseRequest): Promise<unknown>;
}

export function createMediaPreviewApi(
  dependencies: MediaPreviewApiDependencies
): PierMediaPreviewApi {
  return {
    async issueAbsolute(request) {
      try {
        const parsed = filePreviewTicketIssueResultSchema.safeParse(
          await dependencies.invokeIssue(request)
        );
        return parsed.success
          ? parsed.data
          : { issued: false, reason: "unavailable" };
      } catch {
        return { issued: false, reason: "unavailable" };
      }
    },
    async releaseAbsolute(request) {
      try {
        return (await dependencies.invokeRelease(request)) === true;
      } catch {
        return false;
      }
    },
  };
}
