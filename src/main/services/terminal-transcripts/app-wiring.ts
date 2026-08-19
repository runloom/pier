import { join } from "node:path";
import { taskOutputTranscriptLifecycleId } from "./index.ts";
import { createTerminalTranscriptsService } from "./service.ts";

export function createAppTerminalTranscripts(userDataDir: string) {
  const service = createTerminalTranscriptsService({
    logger: console,
    rootDir: join(userDataDir, "terminal-transcripts"),
  });
  service.start();
  return {
    service,
    taskSink: {
      append(runId: string, taskId: string, text: string): void {
        service.append(taskOutputTranscriptLifecycleId(runId, taskId), text);
      },
      seal(runId: string, taskId: string): void {
        service
          .seal(taskOutputTranscriptLifecycleId(runId, taskId))
          .catch((error: unknown) => {
            console.error("[tasks] transcript seal failed:", error);
          });
      },
    },
  };
}
