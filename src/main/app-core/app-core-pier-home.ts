import type { ProjectSkillsInvalidatedEvent } from "@shared/contracts/project-skills.ts";
import { createAgentMcpCatalogService } from "../services/agent-mcp-catalog/service.ts";
import { createAgentRulesService } from "../services/agent-rules/service.ts";
import type { FilePathTransactionLock } from "../services/file-path-transaction-lock.ts";
import {
  createLocalEnvironmentService,
  type LocalEnvironmentService,
} from "../services/local-environments-service.ts";
import type { PanelContextService } from "../services/panel-context-service.ts";
import {
  createPierHomeService,
  type PierHomeService,
} from "../services/pier-home/service.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import { wireProjectSkills } from "./project-skills-wiring.ts";
import { broadcastEnvironmentsChanged } from "./window-broadcasts.ts";

export function wireAppCorePierHomeAndSkills(input: {
  appVersion: string;
  isProduction: boolean;
  listInstalledAgents: () => Promise<string[]>;
  onProjectSkillsInvalidated: (
    event: Omit<ProjectSkillsInvalidatedEvent, "type">
  ) => void;
  panelContexts: PanelContextService;
  processEnvironment: ProcessEnvironmentService;
  /** Electron resources root (`…/resources` in dev, `process.resourcesPath` in prod). */
  resourcesRoot: string;
  transactionLock: FilePathTransactionLock;
  userDataPath: string;
}): {
  agentLaunchGate: ReturnType<typeof wireProjectSkills>["agentLaunchGate"];
  agentMcpCatalog: ReturnType<typeof createAgentMcpCatalogService>;
  agentRules: ReturnType<typeof createAgentRulesService>;
  localEnvironments: LocalEnvironmentService;
  pierBindings: ReturnType<typeof wireProjectSkills>["pierBindings"];
  pierHome: PierHomeService;
  projectSkills: ReturnType<typeof wireProjectSkills>["projectSkills"];
} {
  let pierHomeRef: PierHomeService | null = null;
  const localEnvironments = createLocalEnvironmentService({
    processEnvironment: input.processEnvironment,
    isPierHomeRoot: (path) =>
      pierHomeRef?.isHomeRoot(path) ?? Promise.resolve(false),
  });
  const pierHome = createPierHomeService({
    userDataPath: input.userDataPath,
    onEnsured: async (info) => {
      await localEnvironments.upsertPierHome(info.rootPath);
    },
  });
  pierHomeRef = pierHome;
  const agentRules = createAgentRulesService({
    localEnvironments,
    pierHome,
  });
  const agentMcpCatalog = createAgentMcpCatalogService({
    localEnvironments,
    pierHome,
    listInstalledAgents: input.listInstalledAgents,
  });
  pierHome
    .ensure()
    .then(async () => {
      broadcastEnvironmentsChanged(await localEnvironments.snapshot());
    })
    .catch((err: unknown) => {
      console.error("[pier-home] ensure failed:", err);
    });
  const { projectSkills, agentLaunchGate, pierBindings } = wireProjectSkills({
    userData: input.userDataPath,
    isProduction: input.isProduction,
    appVersion: input.appVersion,
    resourcesRoot: input.resourcesRoot,
    transactionLock: input.transactionLock,
    panelContexts: input.panelContexts,
    localEnvironments,
    pierHome,
    isPierHomeRoot: (path) => pierHome.isHomeRoot(path),
    listInstalledAgents: input.listInstalledAgents,
    onInvalidated: (event) => {
      input.onProjectSkillsInvalidated(event);
    },
  });

  return {
    agentLaunchGate,
    agentMcpCatalog,
    agentRules,
    localEnvironments,
    pierBindings,
    pierHome,
    projectSkills,
  };
}
