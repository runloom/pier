import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { ProjectSkillsApplyError } from "../services/project-skills/apply-service.ts";
import { ProjectSkillsImportError } from "../services/project-skills/import-service.ts";
import { ProjectSkillsLockBusy } from "../services/project-skills/lock.ts";
import { ProjectSkillsRepairError } from "../services/project-skills/repair-service.ts";
import {
  ProjectSkillsGenerationConflict,
  ProjectSkillsLedgerCorrupt,
  ProjectSkillsOperationConflict,
  ProjectSkillsStagingConflict,
} from "../services/project-skills/store.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

function mapSkillsError(
  requestId: string,
  err: unknown
): PierCommandResult | null {
  if (err instanceof ProjectSkillsLockBusy) {
    return failure(requestId, "invalid_command", err.message);
  }
  if (err instanceof ProjectSkillsApplyError) {
    return failure(requestId, "invalid_command", `${err.code}: ${err.message}`);
  }
  if (err instanceof ProjectSkillsRepairError) {
    return failure(requestId, "invalid_command", `${err.code}: ${err.message}`);
  }
  if (err instanceof ProjectSkillsImportError) {
    return failure(requestId, "invalid_command", `${err.code}: ${err.message}`);
  }
  if (err instanceof ProjectSkillsOperationConflict) {
    return failure(requestId, "invalid_command", err.message);
  }
  if (err instanceof ProjectSkillsGenerationConflict) {
    return failure(requestId, "invalid_command", err.message);
  }
  if (err instanceof ProjectSkillsLedgerCorrupt) {
    return failure(requestId, "invalid_command", `${err.code}: ${err.message}`);
  }
  if (err instanceof ProjectSkillsStagingConflict) {
    return failure(requestId, "invalid_command", err.message);
  }
  if (err instanceof Error) {
    return failure(requestId, "invalid_command", err.message);
  }
  return null;
}

export async function executeProjectSkillsCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  const skills = services.projectSkills;
  if (!skills) {
    // Service not wired — only claim skills.* types so router can report unsupported.
    switch (command.type) {
      case "skills.projects.snapshot":
      case "skills.snapshot":
      case "skills.import.prepare":
      case "skills.import.prepareFromDiscovery":
      case "skills.import.prepareTemplate":
      case "skills.import.prepareContentUpdate":
      case "skills.import.prepareDriftAcceptance":
      case "skills.import.discard":
      case "skills.plan":
      case "skills.apply":
      case "skills.repair.plan":
      case "skills.repair":
      case "skills.doctor":
      case "skills.skill.read":
      case "skills.operation.status":
        return failure(
          requestId,
          "invalid_command",
          "project skills service unavailable"
        );
      case "agent.launch.continue":
        return failure(
          requestId,
          "invalid_command",
          "agent launch gate unavailable"
        );
      default:
        return null;
    }
  }

  try {
    switch (command.type) {
      case "skills.projects.snapshot": {
        return success(
          requestId,
          await skills.projectsSnapshot(command.projectRootPath)
        );
      }
      case "skills.snapshot": {
        const { type: _, ...request } = command;
        return success(requestId, await skills.snapshot(request.projectRef));
      }
      case "skills.import.prepare": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.importPrepare(request.projectRef, request.globalSource)
        );
      }
      case "skills.import.prepareFromDiscovery": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.importPrepareFromDiscovery(
            request.projectRef,
            request.relativeSource
          )
        );
      }
      case "skills.import.prepareTemplate": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.importPrepareTemplate(request.projectRef, {
            skillId: request.skillId,
            description: request.description,
          })
        );
      }
      case "skills.import.prepareContentUpdate": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.importPrepareContentUpdate(request.projectRef, {
            skillId: request.skillId,
            baseContentDigest: request.baseContentDigest,
            skillMd: request.skillMd,
          })
        );
      }
      case "skills.import.prepareDriftAcceptance": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.importPrepareDriftAcceptance(request.projectRef, {
            skillId: request.skillId,
          })
        );
      }
      case "skills.import.discard": {
        const { type: _, ...request } = command;
        await skills.importDiscard(request.projectRef, request.token);
        return success(requestId, { discarded: true });
      }
      case "skills.plan": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.plan(
            request.projectRef,
            request.observedRevision,
            request.draft
          )
        );
      }
      case "skills.apply": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.apply({
            projectRef: request.projectRef,
            observedRevision: request.observedRevision,
            draft: request.draft,
            planDigest: request.planDigest,
            operationId: request.operationId,
            acknowledgements: request.acknowledgements,
          })
        );
      }
      case "skills.repair.plan": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.repairPlan(
            request.projectRef,
            request.observedRevision,
            request.continuationOf
          )
        );
      }
      case "skills.repair": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.repair({
            projectRef: request.projectRef,
            observedRevision: request.observedRevision,
            operationId: request.operationId,
            repairPlanDigest: request.repairPlanDigest,
            acknowledgements: request.acknowledgements,
            ...(request.continuationOf === undefined
              ? {}
              : { continuationOf: request.continuationOf }),
          })
        );
      }
      case "skills.doctor": {
        const { type: _, ...request } = command;
        return success(requestId, await skills.doctor(request.projectRef));
      }
      case "skills.skill.read": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.skillRead(request.projectRef, request.ref)
        );
      }
      case "skills.operation.status": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await skills.operationStatus(request.projectRef, request.operationId)
        );
      }
      case "agent.launch.continue": {
        const gate = services.agentLaunchGate;
        if (!gate) {
          return failure(
            requestId,
            "invalid_command",
            "agent launch gate unavailable"
          );
        }
        const { type: _, ...request } = command;
        return success(
          requestId,
          await gate.continueLaunch({
            launchAttemptId: request.launchAttemptId,
            decision: request.decision,
            ...(request.acknowledgements
              ? { acknowledgements: request.acknowledgements }
              : {}),
          })
        );
      }
      default:
        return null;
    }
  } catch (err) {
    const mapped = mapSkillsError(requestId, err);
    if (mapped) return mapped;
    throw err;
  }
}
