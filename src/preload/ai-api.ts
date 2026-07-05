import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
  AiStatusResult,
} from "@shared/contracts/ai.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierAiAPI {
  generateText(request: AiGenerateTextRequest): Promise<AiGenerateTextResult>;
  status(): Promise<AiStatusResult>;
}

export const aiApi: PierAiAPI = {
  generateText: (request) =>
    invokePierCommand<AiGenerateTextResult>({
      projectRootPath: request.projectRootPath,
      prompt: request.prompt,
      type: "ai.generateText",
    }),
  status: () => invokePierCommand<AiStatusResult>({ type: "ai.status" }),
};
