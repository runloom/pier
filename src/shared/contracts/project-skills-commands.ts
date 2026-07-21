import { z } from "zod";
import {
  agentLaunchContinueRequestSchema,
  skillsApplyRequestSchema,
  skillsDoctorRequestSchema,
  skillsImportDiscardRequestSchema,
  skillsImportPrepareContentUpdateRequestSchema,
  skillsImportPrepareDriftAcceptanceRequestSchema,
  skillsImportPrepareFromDiscoveryRequestSchema,
  skillsImportPrepareRequestSchema,
  skillsImportPrepareTemplateRequestSchema,
  skillsOperationStatusRequestSchema,
  skillsPlanRequestSchema,
  skillsProjectsSnapshotRequestSchema,
  skillsRepairPlanRequestSchema,
  skillsRepairRequestSchema,
  skillsSkillReadRequestSchema,
  skillsSnapshotRequestSchema,
} from "./project-skills.ts";

export const skillsProjectsSnapshotCommandSchema =
  skillsProjectsSnapshotRequestSchema.extend({
    type: z.literal("skills.projects.snapshot"),
  });

export const skillsSnapshotCommandSchema = skillsSnapshotRequestSchema.extend({
  type: z.literal("skills.snapshot"),
});

export const skillsSkillReadCommandSchema = skillsSkillReadRequestSchema.extend(
  {
    type: z.literal("skills.skill.read"),
  }
);

export const skillsImportPrepareCommandSchema =
  skillsImportPrepareRequestSchema.extend({
    type: z.literal("skills.import.prepare"),
  });

export const skillsImportPrepareFromDiscoveryCommandSchema =
  skillsImportPrepareFromDiscoveryRequestSchema.extend({
    type: z.literal("skills.import.prepareFromDiscovery"),
  });

export const skillsImportPrepareTemplateCommandSchema =
  skillsImportPrepareTemplateRequestSchema.extend({
    type: z.literal("skills.import.prepareTemplate"),
  });

export const skillsImportPrepareContentUpdateCommandSchema =
  skillsImportPrepareContentUpdateRequestSchema.extend({
    type: z.literal("skills.import.prepareContentUpdate"),
  });

export const skillsImportPrepareDriftAcceptanceCommandSchema =
  skillsImportPrepareDriftAcceptanceRequestSchema.extend({
    type: z.literal("skills.import.prepareDriftAcceptance"),
  });

export const skillsImportDiscardCommandSchema =
  skillsImportDiscardRequestSchema.extend({
    type: z.literal("skills.import.discard"),
  });

export const skillsPlanCommandSchema = skillsPlanRequestSchema.extend({
  type: z.literal("skills.plan"),
});

export const skillsApplyCommandSchema = skillsApplyRequestSchema.extend({
  type: z.literal("skills.apply"),
});

export const skillsRepairPlanCommandSchema =
  skillsRepairPlanRequestSchema.extend({
    type: z.literal("skills.repair.plan"),
  });

export const skillsRepairCommandSchema = skillsRepairRequestSchema.extend({
  type: z.literal("skills.repair"),
});

export const skillsDoctorCommandSchema = skillsDoctorRequestSchema.extend({
  type: z.literal("skills.doctor"),
});

export const skillsOperationStatusCommandSchema =
  skillsOperationStatusRequestSchema.extend({
    type: z.literal("skills.operation.status"),
  });

export const agentLaunchContinueCommandSchema =
  agentLaunchContinueRequestSchema.extend({
    type: z.literal("agent.launch.continue"),
  });

export const projectSkillsCommandSchemas = [
  skillsProjectsSnapshotCommandSchema,
  skillsSnapshotCommandSchema,
  skillsImportPrepareCommandSchema,
  skillsImportPrepareFromDiscoveryCommandSchema,
  skillsImportPrepareTemplateCommandSchema,
  skillsImportPrepareContentUpdateCommandSchema,
  skillsImportPrepareDriftAcceptanceCommandSchema,
  skillsImportDiscardCommandSchema,
  skillsPlanCommandSchema,
  skillsApplyCommandSchema,
  skillsRepairPlanCommandSchema,
  skillsRepairCommandSchema,
  skillsDoctorCommandSchema,
  skillsSkillReadCommandSchema,
  skillsOperationStatusCommandSchema,
  agentLaunchContinueCommandSchema,
] as const;
