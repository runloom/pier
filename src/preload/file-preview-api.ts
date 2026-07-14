import type {
  FilePreviewRuntimeAcquireResult,
  FilePreviewTicketIssueRequest,
  FilePreviewTicketIssueResult,
} from "@shared/contracts/file-preview-ticket.ts";
import {
  filePreviewRuntimeAcquireResultSchema,
  filePreviewTicketIssueResultSchema,
} from "@shared/contracts/file-preview-ticket.ts";

export interface PierFilePreviewApi {
  acquire(recordId: string): Promise<FilePreviewRuntimeAcquireResult>;
  issue(
    request: FilePreviewTicketIssueRequest
  ): Promise<FilePreviewTicketIssueResult>;
  release(request: { leaseId: string; ticket: string }): Promise<boolean>;
  revoke(leaseId: string): Promise<boolean>;
}
export interface FilePreviewApiDependencies {
  invokeAcquire(request: { recordId: string }): Promise<unknown>;
  invokeIssue(request: FilePreviewTicketIssueRequest): Promise<unknown>;
  invokeRelease(request: { leaseId: string; ticket: string }): Promise<unknown>;
  invokeRevoke(request: { leaseId: string }): Promise<unknown>;
}

export function createFilePreviewApi(
  dependencies: FilePreviewApiDependencies
): PierFilePreviewApi {
  return {
    async acquire(recordId) {
      try {
        const parsed = filePreviewRuntimeAcquireResultSchema.safeParse(
          await dependencies.invokeAcquire({ recordId })
        );
        return parsed.success
          ? parsed.data
          : { acquired: false, reason: "unavailable" };
      } catch {
        return { acquired: false, reason: "unavailable" };
      }
    },
    async issue(request) {
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
    async release(request) {
      try {
        return (await dependencies.invokeRelease(request)) === true;
      } catch {
        return false;
      }
    },
    async revoke(leaseId) {
      try {
        return (await dependencies.invokeRevoke({ leaseId })) === true;
      } catch {
        return false;
      }
    },
  };
}
