import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { FileServiceError } from "../services/file-service.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 命令路由 switch,每个 case 都是同构的服务缺失守卫+转发,拆表不减复杂度。
export async function executeFileCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "file.list":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.list(command));
    case "file.readText":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.readText(command));
    case "file.writeText":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      try {
        return success(requestId, await services.files.writeText(command));
      } catch (error) {
        if (
          error instanceof FileServiceError &&
          error.code === "file_conflict"
        ) {
          return failure(requestId, "file_conflict", error.message);
        }
        throw error;
      }
    case "file.move":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.move(command));
    case "file.trash":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.trash(command));
    case "file.mkdir":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.mkdir(command));
    case "file.exists":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.exists(command));
    case "file.stat":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.stat(command));
    case "file.copy":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.copy(command));
    case "file.reveal":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.reveal(command));
    case "file.drafts.list":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      return success(requestId, await services.fileDrafts.list());
    case "file.drafts.set":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      await services.fileDrafts.set(command.key, command.value);
      return success(requestId, { ok: true });
    case "file.drafts.delete":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      await services.fileDrafts.delete(command.key);
      return success(requestId, { ok: true });
    default:
      return null;
  }
}
