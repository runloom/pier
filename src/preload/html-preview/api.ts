import type {
  HtmlPreviewTicketIssueRequest,
  HtmlPreviewTicketIssueResult,
  HtmlPreviewTicketReleaseRequest,
} from "@shared/contracts/file/html-preview-ticket.ts";
import { htmlPreviewTicketIssueResultSchema } from "@shared/contracts/file/html-preview-ticket.ts";

export interface PierHtmlPreviewApi {
  issue(
    request: HtmlPreviewTicketIssueRequest
  ): Promise<HtmlPreviewTicketIssueResult>;
  release(request: HtmlPreviewTicketReleaseRequest): Promise<boolean>;
  touch(request: HtmlPreviewTicketReleaseRequest): Promise<boolean>;
}

export interface HtmlPreviewApiDependencies {
  invokeIssue(request: HtmlPreviewTicketIssueRequest): Promise<unknown>;
  invokeRelease(request: HtmlPreviewTicketReleaseRequest): Promise<unknown>;
  invokeTouch(request: HtmlPreviewTicketReleaseRequest): Promise<unknown>;
}

export function createHtmlPreviewApi(
  dependencies: HtmlPreviewApiDependencies
): PierHtmlPreviewApi {
  return {
    async issue(request) {
      try {
        const parsed = htmlPreviewTicketIssueResultSchema.safeParse(
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
    async touch(request) {
      try {
        return (await dependencies.invokeTouch(request)) === true;
      } catch {
        return false;
      }
    },
  };
}
