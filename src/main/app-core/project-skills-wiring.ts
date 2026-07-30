import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { dialog } from "electron";
import type { FilePathTransactionLock } from "../services/file-path-transaction-lock.ts";
import type { LocalEnvironmentService } from "../services/local-environments-service.ts";
import type { PanelContextService } from "../services/panel-context-service.ts";
import type { PierHomeService } from "../services/pier-home/service.ts";
import {
  createManagedAgentLaunchGate,
  type ManagedAgentLaunchGate,
} from "../services/project-skills/launch-gate.ts";
import {
  createPierBindingsChannel,
  type PierBindingsChannel,
} from "../services/project-skills/pier-bindings.ts";
import {
  createProjectSkillsService,
  type ProjectSkillsService,
} from "../services/project-skills/service.ts";
import {
  createSystemSkillsChannel,
  type SystemSkillsChannel,
} from "../services/project-skills/system-skills.ts";
import { bundledSystemSkillContributions } from "./bundled-system-skills.ts";

const execFileAsync = promisify(execFile);

/**
 * Git five-state inspection for projection targets (design v8 §3.6):
 * absent / ignored / untracked / tracked / unknown. Read-only `git` calls;
 * any failure degrades to "unknown" (plan then requires confirmation).
 */
async function inspectGitState(
  relativeTarget: string,
  projectRoot: string
): Promise<"absent" | "ignored" | "untracked" | "tracked" | "unknown"> {
  const absolute = join(projectRoot, ...relativeTarget.split("/"));
  try {
    await lstat(absolute);
  } catch {
    return "absent";
  }
  try {
    await execFileAsync(
      "git",
      ["-C", projectRoot, "ls-files", "--error-unmatch", "--", relativeTarget],
      { timeout: 5000 }
    );
    return "tracked";
  } catch {
    // Not tracked — distinguish ignored vs untracked below.
  }
  try {
    await execFileAsync(
      "git",
      ["-C", projectRoot, "check-ignore", "--quiet", "--", relativeTarget],
      { timeout: 5000 }
    );
    return "ignored";
  } catch (error) {
    const exitCode = (error as { code?: number | string }).code;
    // check-ignore exits 1 when the path is NOT ignored (i.e. untracked);
    // anything else (128 = not a repo, ENOENT = no git) is unknown.
    if (exitCode === 1) {
      return "untracked";
    }
    return "unknown";
  }
}

/**
 * Project skills wiring (design v8), split from app-core.ts (file-size cap):
 * system skills channel + skills service (shared project index from recent
 * panel contexts + local environments) + the managed agent launch gate.
 */
export function wireProjectSkills(args: {
  userData: string;
  isProduction: boolean;
  appVersion: string;
  resourcesRoot: string;
  transactionLock: FilePathTransactionLock;
  panelContexts: PanelContextService;
  localEnvironments: LocalEnvironmentService;
  pierHome?: PierHomeService;
  isPierHomeRoot?: (path: string) => Promise<boolean>;
  listInstalledAgents: () => Promise<readonly string[]>;
  onInvalidated: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
}): {
  projectSkills: ProjectSkillsService;
  agentLaunchGate: ManagedAgentLaunchGate;
  systemSkills: SystemSkillsChannel;
  pierBindings: PierBindingsChannel;
} {
  const isPierHomeRoot = args.isPierHomeRoot;
  const systemSkills = createSystemSkillsChannel({
    userData: args.userData,
    isProduction: args.isProduction,
    // First real contribution: bundled pier-canvas authoring skill.
    contributions: bundledSystemSkillContributions({
      appVersion: args.appVersion,
      resourcesRoot: args.resourcesRoot,
    }),
  });

  const pierBindings = createPierBindingsChannel({
    userData: args.userData,
    contentDirFor: (skillId) => {
      if (!args.pierHome) {
        throw new Error("pier home is not configured");
      }
      return args.pierHome.skills.contentDir(skillId);
    },
    listAlwaysIncludeSkills: async () => {
      if (!args.pierHome) return [];
      await args.pierHome.ensure();
      return args.pierHome.skills.listAlwaysIncludeSkills();
    },
    listLibrarySkillIds: async () => {
      if (!args.pierHome) return [];
      await args.pierHome.ensure();
      const list = await args.pierHome.skills.list();
      return list.map((skill) => skill.id);
    },
  });

  const projectSkills = createProjectSkillsService({
    userData: args.userData,
    transactionLock: args.transactionLock,
    sharedLockRoot: join(homedir(), ".pier", "project-skills-locks"),
    // Local folder import source picker (design v8 §7.5) — production wiring.
    showOpenDialog: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      return { canceled: result.canceled, filePaths: result.filePaths };
    },
    // Git five-state for projection targets — deletion confirmations show
    // the real tracked/untracked/ignored fact instead of "unknown".
    inspectGitState,
    ...(isPierHomeRoot ? { isPierHomeRoot } : {}),
    // Design v8 §3.3: shared local project index + recent panel contexts,
    // current-panel projects first. The index is an entry list, never an
    // authorization — every command re-resolves identity from realpath.
    listKnownProjectRoots: async () => {
      const roots: Array<{
        realPath: string;
        source: "panel" | "environment" | "unknown";
      }> = [];
      try {
        const recent = await args.panelContexts.listRecent();
        for (const context of recent) {
          if (!context.projectRootPath) continue;
          if (
            isPierHomeRoot &&
            (await isPierHomeRoot(context.projectRootPath))
          ) {
            continue;
          }
          roots.push({ realPath: context.projectRootPath, source: "panel" });
        }
      } catch {
        // Panel context state unavailable — index still serves entries.
      }
      const snapshot = await args.localEnvironments.snapshot();
      for (const project of snapshot.projects) {
        if (project.kind === "pier-home") continue;
        if (isPierHomeRoot && (await isPierHomeRoot(project.projectRootPath))) {
          continue;
        }
        roots.push({
          realPath: project.projectRootPath,
          source: "environment" as const,
        });
      }
      return roots;
    },
    listInstalledAgents: args.listInstalledAgents,
    systemSkills,
    pierBindings,
    onInvalidated: args.onInvalidated,
  });

  const agentLaunchGate = createManagedAgentLaunchGate({
    userData: args.userData,
    ...(isPierHomeRoot ? { isPierHomeRoot } : {}),
    ensureReady: (skillArgs) => projectSkills.ensureReady(skillArgs),
  });

  return { projectSkills, agentLaunchGate, systemSkills, pierBindings };
}
