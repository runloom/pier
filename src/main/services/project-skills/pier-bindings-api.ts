import { randomUUID } from "node:crypto";
import type {
  PierBindingsConvergeResult,
  PierBoundSkillView,
  PierHomeSkillDelivery,
} from "../../../shared/contracts/pier-home-skills.ts";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../shared/contracts/project-skills.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
} from "./identity.ts";
import type { createProjectSkillsPaths } from "./paths.ts";
import type { PierBindingsChannel } from "./pier-bindings.ts";
import {
  createPierBindingsConverge,
  type PierBindingsConverge,
  type PierBindingsConvergeScope,
} from "./pier-bindings-converge.ts";
import type { ProjectSkillsRepairService } from "./repair-service.ts";
import type { ProjectSkillsStore } from "./store.ts";

type ProjectRef = ContractProjectRootRef | MainProjectRootRef;

export interface PierBindingsServiceApi {
  convergePierBindings(
    scope: PierBindingsConvergeScope
  ): Promise<PierBindingsConvergeResult>;
  pierBindingsBind(
    projectRef: ProjectRef,
    skillId: string,
    delivery?: PierHomeSkillDelivery
  ): Promise<PierBoundSkillView[]>;
  pierBindingsList(projectRef: ProjectRef): Promise<PierBoundSkillView[]>;
  pierBindingsUnbind(
    projectRef: ProjectRef,
    skillId: string
  ): Promise<PierBoundSkillView[]>;
}

export function unavailablePierBindingsApi(): PierBindingsServiceApi {
  const fail = async (): Promise<never> => {
    throw new Error("pier bindings channel is not configured");
  };
  return {
    pierBindingsList: fail,
    pierBindingsBind: fail,
    pierBindingsUnbind: fail,
    convergePierBindings: fail,
  };
}

export function createPierBindingsServiceApi(args: {
  assertNotPierHomeRef: (projectRef: ProjectRef) => Promise<void>;
  listAlwaysIncludeSkills: () => Promise<
    Array<{ id: string; delivery: PierHomeSkillDelivery }>
  >;
  listKnownProjectRoots: () => Promise<Array<{ realPath: string }>>;
  paths: ReturnType<typeof createProjectSkillsPaths>;
  pierBindings: PierBindingsChannel;
  repairService: ProjectSkillsRepairService;
  store: ProjectSkillsStore;
}): PierBindingsServiceApi {
  const convergeApi: PierBindingsConverge = createPierBindingsConverge({
    listAlwaysIncludeSkills: args.listAlwaysIncludeSkills,
    listKnownProjectRoots: args.listKnownProjectRoots,
    paths: args.paths,
    pierBindings: args.pierBindings,
    repairService: args.repairService,
    store: args.store,
  });

  async function rootKeyFor(projectRef: ProjectRef): Promise<string> {
    const claimed =
      "identity" in projectRef
        ? projectRef.identity
        : {
            realPath: projectRef.realPath,
            volumeId: projectRef.volumeIdentity,
            directoryIdentity: projectRef.directoryIdentity,
          };
    const live = await resolveStableProjectIdentity(claimed.realPath);
    return args.paths.rootKeyFor(live);
  }

  async function ensureBindingsReady(projectRef: ProjectRef): Promise<void> {
    const ready = await args.repairService.ensureReady({
      projectRef,
      agentId: "pier-home-bindings",
      launchAttemptId: randomUUID(),
    });
    if (ready.status === "ready") return;
    const detail =
      ready.issueSummary
        .map((issue) => issue.code)
        .slice(0, 3)
        .join(", ") || "blocked";
    throw new Error(`pier bindings ensureReady failed: ${detail}`);
  }

  return {
    async pierBindingsList(projectRef) {
      await args.assertNotPierHomeRef(projectRef);
      return args.pierBindings.views(await rootKeyFor(projectRef));
    },

    async pierBindingsBind(projectRef, skillId, delivery) {
      await args.assertNotPierHomeRef(projectRef);
      const rootKey = await rootKeyFor(projectRef);
      await args.pierBindings.bind({
        rootKey,
        skillId,
        ...(delivery === undefined ? {} : { delivery }),
      });
      await ensureBindingsReady(projectRef);
      return args.pierBindings.views(rootKey);
    },

    async pierBindingsUnbind(projectRef, skillId) {
      await args.assertNotPierHomeRef(projectRef);
      const rootKey = await rootKeyFor(projectRef);
      await args.pierBindings.unbind({ rootKey, skillId });
      await ensureBindingsReady(projectRef);
      return args.pierBindings.views(rootKey);
    },

    convergePierBindings(scope) {
      return convergeApi.converge(scope);
    },
  };
}
