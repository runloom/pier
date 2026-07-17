import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { fileWriteCommitReceiptStorageKey } from "@shared/contracts/file.ts";
import { FileServiceError } from "../services/file-service.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

interface FileCommandExecutionContext {
  windowRecordId?: string | undefined;
}

export async function executeFileCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: FileCommandExecutionContext = {}
): Promise<PierCommandResult | null> {
  const draftOwner = context.windowRecordId;
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
    case "file.readDocument":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.readDocument(command));
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
    case "file.writeDocument":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      {
        const result = await services.files.writeDocument(command);
        if (
          result.kind === "written" &&
          command.operationId &&
          draftOwner &&
          services.fileDrafts
        ) {
          try {
            const receipt = await services.fileDrafts.set(
              draftOwner,
              fileWriteCommitReceiptStorageKey(command.operationId),
              1,
              JSON.stringify(result)
            );
            if (receipt.kind !== "stored") {
              console.error(
                "[files] file write committed, but its recovery receipt was not stored:",
                receipt
              );
            }
          } catch (error) {
            console.error(
              "[files] file write committed, but its recovery receipt failed:",
              error
            );
          }
        }
        return success(requestId, result);
      }
    case "file.inspectWriteTarget":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(
        requestId,
        await services.files.inspectWriteTarget(command)
      );
    case "file.inspectPathImpact":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(
        requestId,
        await services.files.inspectPathImpact(command)
      );
    case "file.confirmDurability":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(
        requestId,
        await services.files.confirmDurability(command)
      );
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
    case "file.openPath":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.openPath(command));
    case "file.reveal":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.reveal(command));
    case "file.drafts.listKeys":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      if (!draftOwner) {
        return failure(
          requestId,
          "permission_denied",
          "file drafts require a desktop window owner"
        );
      }
      return success(requestId, await services.fileDrafts.listKeys(draftOwner));
    case "file.drafts.listDiagnostics":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      if (!draftOwner) {
        return failure(
          requestId,
          "permission_denied",
          "file drafts require a desktop window owner"
        );
      }
      return success(
        requestId,
        await services.fileDrafts.listDiagnostics(draftOwner)
      );
    case "file.drafts.get":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      if (!draftOwner) {
        return failure(
          requestId,
          "permission_denied",
          "file drafts require a desktop window owner"
        );
      }
      return success(
        requestId,
        await services.fileDrafts.get(draftOwner, command.key)
      );
    case "file.drafts.set":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      if (!draftOwner) {
        return failure(
          requestId,
          "permission_denied",
          "file drafts require a desktop window owner"
        );
      }
      return success(
        requestId,
        await services.fileDrafts.set(
          draftOwner,
          command.key,
          command.generation,
          command.value
        )
      );
    case "file.drafts.delete":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      if (!draftOwner) {
        return failure(
          requestId,
          "permission_denied",
          "file drafts require a desktop window owner"
        );
      }
      return success(
        requestId,
        await services.fileDrafts.delete(draftOwner, command.key)
      );
    case "file.drafts.claimLegacy":
      if (!services.fileDrafts) {
        return failure(
          requestId,
          "internal_error",
          "file drafts service unavailable"
        );
      }
      if (!draftOwner) {
        return failure(
          requestId,
          "permission_denied",
          "file drafts require a desktop window owner"
        );
      }
      return success(
        requestId,
        await services.fileDrafts.claimLegacy(draftOwner, command.key)
      );
    default:
      return null;
  }
}
