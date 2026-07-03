import type {
  AiStatusResult,
  AiSuggestBranchRequest,
  AiSuggestBranchResult,
} from "@shared/contracts/ai.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierAiAPI {
  status(): Promise<AiStatusResult>;
  suggestBranch(
    request: AiSuggestBranchRequest
  ): Promise<AiSuggestBranchResult>;
}

export const aiApi: PierAiAPI = {
  status: () => invokePierCommand<AiStatusResult>({ type: "ai.status" }),
  suggestBranch: (request) =>
    invokePierCommand<AiSuggestBranchResult>({
      text: request.text,
      type: "ai.suggestBranch",
    }),
};
