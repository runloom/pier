import type {
  ApplyResult,
  LaunchGateDecision,
  ProjectRootRef,
  ProjectSkillsAcknowledgement,
  ProjectSkillsDraft,
  ProjectSkillsInvalidatedEvent,
  SkillContentRef,
  SkillContentResult,
} from "@shared/contracts/project-skills.ts";
import type { SkillsLaunchContinueResult } from "@shared/contracts/terminal.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

/** Preload surface for project skills commands + invalidation broadcast. */
export interface PierProjectSkillsAPI {
  apply(request: {
    projectRef: ProjectRootRef;
    observedRevision: string;
    draft: ProjectSkillsDraft;
    planDigest: string;
    operationId: string;
    acknowledgements: readonly ProjectSkillsAcknowledgement[];
  }): Promise<ApplyResult>;
  doctor(projectRef: ProjectRootRef): Promise<unknown>;
  importDiscard(projectRef: ProjectRootRef, token: string): Promise<void>;
  importPrepare(
    projectRef: ProjectRootRef,
    globalSource?: { root: string; directoryName: string }
  ): Promise<unknown>;
  importPrepareContentUpdate(
    projectRef: ProjectRootRef,
    args: { skillId: string; baseContentDigest: string; skillMd: string }
  ): Promise<unknown>;
  importPrepareDriftAcceptance(
    projectRef: ProjectRootRef,
    args: { skillId: string }
  ): Promise<unknown>;
  importPrepareFromDiscovery(
    projectRef: ProjectRootRef,
    relativeSource: string
  ): Promise<unknown>;
  importPrepareTemplate(
    projectRef: ProjectRootRef,
    args: { skillId: string; description: string }
  ): Promise<unknown>;
  launchContinue(request: {
    launchAttemptId: string;
    decision: LaunchGateDecision;
    acknowledgements?: readonly ProjectSkillsAcknowledgement[];
  }): Promise<SkillsLaunchContinueResult>;
  onInvalidated(cb: (event: ProjectSkillsInvalidatedEvent) => void): () => void;
  operationStatus(
    projectRef: ProjectRootRef,
    operationId: string
  ): Promise<unknown>;
  plan(
    projectRef: ProjectRootRef,
    observedRevision: string,
    draft: ProjectSkillsDraft
  ): Promise<unknown>;
  projectsSnapshot(projectRootPath?: string): Promise<unknown>;
  repair(request: {
    projectRef: ProjectRootRef;
    observedRevision: string;
    operationId: string;
    repairPlanDigest: string;
    acknowledgements: readonly ProjectSkillsAcknowledgement[];
    continuationOf?: string;
  }): Promise<unknown>;
  repairPlan(
    projectRef: ProjectRootRef,
    observedRevision: string,
    continuationOf?: string
  ): Promise<unknown>;
  skillRead(
    projectRef: ProjectRootRef,
    ref: SkillContentRef
  ): Promise<SkillContentResult>;
  snapshot(projectRef: ProjectRootRef): Promise<unknown>;
}

export const projectSkillsApi: PierProjectSkillsAPI = {
  apply: (request) =>
    invokePierCommand<ApplyResult>({
      ...request,
      acknowledgements: [...request.acknowledgements],
      type: "skills.apply",
    }),
  doctor: (projectRef) =>
    invokePierCommand({ projectRef, type: "skills.doctor" }),
  importDiscard: async (projectRef, token) => {
    await invokePierCommand({
      projectRef,
      token,
      type: "skills.import.discard",
    });
  },
  importPrepare: (projectRef, globalSource) =>
    invokePierCommand({
      projectRef,
      ...(globalSource === undefined ? {} : { globalSource }),
      type: "skills.import.prepare",
    }),
  importPrepareFromDiscovery: (projectRef, relativeSource) =>
    invokePierCommand({
      projectRef,
      relativeSource,
      type: "skills.import.prepareFromDiscovery",
    }),
  importPrepareTemplate: (projectRef, args) =>
    invokePierCommand({
      projectRef,
      skillId: args.skillId,
      description: args.description,
      type: "skills.import.prepareTemplate",
    }),
  importPrepareContentUpdate: (projectRef, args) =>
    invokePierCommand({
      projectRef,
      skillId: args.skillId,
      baseContentDigest: args.baseContentDigest,
      skillMd: args.skillMd,
      type: "skills.import.prepareContentUpdate",
    }),
  importPrepareDriftAcceptance: (projectRef, args) =>
    invokePierCommand({
      projectRef,
      skillId: args.skillId,
      type: "skills.import.prepareDriftAcceptance",
    }),
  launchContinue: (request) =>
    invokePierCommand<SkillsLaunchContinueResult>({
      launchAttemptId: request.launchAttemptId,
      decision: request.decision,
      ...(request.acknowledgements === undefined
        ? {}
        : { acknowledgements: [...request.acknowledgements] }),
      type: "agent.launch.continue",
    }),
  onInvalidated: (cb) =>
    subscribeIpc<ProjectSkillsInvalidatedEvent>(
      PIER_BROADCAST.PROJECT_SKILLS_INVALIDATED,
      cb
    ),
  operationStatus: (projectRef, operationId) =>
    invokePierCommand({
      operationId,
      projectRef,
      type: "skills.operation.status",
    }),
  plan: (projectRef, observedRevision, draft) =>
    invokePierCommand({
      draft,
      observedRevision,
      projectRef,
      type: "skills.plan",
    }),
  projectsSnapshot: (projectRootPath) =>
    invokePierCommand({
      ...(projectRootPath === undefined ? {} : { projectRootPath }),
      type: "skills.projects.snapshot",
    }),
  skillRead: (projectRef, ref) =>
    invokePierCommand<SkillContentResult>({
      projectRef,
      ref,
      type: "skills.skill.read",
    }),
  repair: (request) =>
    invokePierCommand({
      ...request,
      acknowledgements: [...request.acknowledgements],
      type: "skills.repair",
    }),
  repairPlan: (projectRef, observedRevision, continuationOf) =>
    invokePierCommand({
      ...(continuationOf === undefined ? {} : { continuationOf }),
      observedRevision,
      projectRef,
      type: "skills.repair.plan",
    }),
  snapshot: (projectRef) =>
    invokePierCommand({ projectRef, type: "skills.snapshot" }),
};
