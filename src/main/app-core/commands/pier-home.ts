import { realpath as fsRealpath, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { shell } from "electron";
import { PierHomeSkillsError } from "../../services/pier-home/skills-library.ts";
import { listPierHomeUserGlobalSkills } from "../../services/pier-home/user-global-skills.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listUserSkillRoots,
} from "../../services/project-skills/adapters.ts";
import {
  readUserGlobalSkillContent,
  SkillContentReadError,
} from "../../services/project-skills/content.ts";
import { expandUserRoot } from "../../services/project-skills/enumeration.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

async function readInstalledAgents(
  services: PierCoreServices
): Promise<ReadonlySet<string> | undefined> {
  try {
    const { detectedIds } = await services.agentDetection.detect();
    return new Set(detectedIds);
  } catch {
    return;
  }
}

async function safeRealpath(path: string): Promise<string> {
  try {
    return await fsRealpath(path);
  } catch {
    return resolve(path);
  }
}

async function assertRevealAllowed(
  absolutePath: string,
  homeRoot: string
): Promise<string> {
  const target = await safeRealpath(absolutePath);
  const home = await safeRealpath(homeRoot);
  if (target === home || target.startsWith(`${home}/`)) {
    return target;
  }
  const userHome = homedir();
  for (const { root } of listUserSkillRoots(
    createSkillDiscoveryAdapterRegistry()
  )) {
    const rootAbs = await safeRealpath(expandUserRoot(root, userHome));
    if (target === rootAbs || target.startsWith(`${rootAbs}/`)) {
      return target;
    }
  }
  throw new Error("path is outside Pier Home library and agent skill roots");
}

export async function executePierHomeCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  if (!services.pierHome) {
    return null;
  }
  const home = services.pierHome;
  try {
    switch (command.type) {
      case "pierHome.info": {
        return success(requestId, await home.info());
      }
      case "pierHome.reveal": {
        const info = await home.ensure();
        shell.showItemInFolder(info.rootPath);
        return success(requestId, { revealed: true, rootPath: info.rootPath });
      }
      case "pierHome.skills.list": {
        await home.ensure();
        // Library skills are not project-projected; no agent availability strip.
        return success(requestId, { skills: await home.skills.list() });
      }
      case "pierHome.skills.snapshot": {
        await home.ensure();
        const installedAgents = await readInstalledAgents(services);
        const [library, userGlobal] = await Promise.all([
          home.skills.list(),
          listPierHomeUserGlobalSkills(
            installedAgents === undefined ? {} : { installedAgents }
          ),
        ]);
        return success(requestId, { library, userGlobal });
      }
      case "pierHome.skills.create": {
        await home.ensure();
        const skill = await home.skills.create({
          skillId: command.skillId,
          ...(command.description === undefined
            ? {}
            : { description: command.description }),
          ...(command.alwaysInclude === undefined
            ? {}
            : { alwaysInclude: command.alwaysInclude }),
          ...(command.delivery === undefined
            ? {}
            : { delivery: command.delivery }),
        });
        return success(requestId, { skill });
      }
      case "pierHome.skills.read": {
        await home.ensure();
        if (command.skillId) {
          return success(requestId, {
            skillId: command.skillId,
            skillMd: await home.skills.readSkillMd(command.skillId),
          });
        }
        if (command.root && command.directoryName) {
          const content = await readUserGlobalSkillContent({
            root: command.root,
            directoryName: command.directoryName,
          });
          return success(requestId, {
            root: command.root,
            directoryName: command.directoryName,
            skillMd: content.skillMd,
            truncated: content.truncated,
          });
        }
        if (!command.absolutePath) {
          throw new Error("provide skillId, discovery ref, or absolutePath");
        }
        const allowed = await assertRevealAllowed(
          command.absolutePath,
          home.rootPath()
        );
        const skillMd = await readFile(allowed, "utf8");
        return success(requestId, {
          absolutePath: allowed,
          skillMd,
        });
      }
      case "pierHome.skills.write": {
        await home.ensure();
        const skill = await home.skills.writeSkillMd(
          command.skillId,
          command.skillMd
        );
        let converge: {
          converged: string[];
          failed: Array<{ message: string; rootKey: string }>;
        } = { converged: [], failed: [] };
        if (services.projectSkills) {
          converge = await services.projectSkills.convergePierBindings({
            kind: "skill",
            skillId: command.skillId,
          });
        }
        return success(requestId, { skill, converge });
      }
      case "pierHome.skills.setAlwaysInclude": {
        await home.ensure();
        const skill = await home.skills.setAlwaysInclude(
          command.skillId,
          command.alwaysInclude,
          command.delivery
        );
        let converge: {
          converged: string[];
          failed: Array<{ message: string; rootKey: string }>;
        } = { converged: [], failed: [] };
        if (services.projectSkills) {
          converge = await services.projectSkills.convergePierBindings({
            kind: "all-known-projects",
          });
        }
        return success(requestId, { skill, converge });
      }
      case "pierHome.skills.delete": {
        await home.ensure();
        // unbind → delete catalog → converge (catalog drives alwaysInclude).
        if (services.pierBindings) {
          await services.pierBindings.unbindEverywhere(command.skillId);
        }
        await home.skills.delete(command.skillId);
        let converge: {
          converged: string[];
          failed: Array<{ message: string; rootKey: string }>;
        } = { converged: [], failed: [] };
        if (services.projectSkills) {
          converge = await services.projectSkills.convergePierBindings({
            kind: "skill",
            skillId: command.skillId,
          });
        }
        return success(requestId, {
          deleted: true,
          skillId: command.skillId,
          converge,
        });
      }
      case "pierHome.skills.reveal": {
        await home.ensure();
        let absolutePath: string;
        if (command.skillId) {
          absolutePath = join(
            home.skills.contentDir(command.skillId),
            "SKILL.md"
          );
        } else if (command.absolutePath) {
          absolutePath = command.absolutePath;
        } else {
          throw new Error("provide skillId or absolutePath");
        }
        const allowed = await assertRevealAllowed(
          absolutePath,
          home.rootPath()
        );
        shell.showItemInFolder(allowed);
        return success(requestId, { revealed: true, path: allowed });
      }
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof PierHomeSkillsError) {
      return failure(
        requestId,
        "invalid_command",
        `${err.code}: ${err.message}`
      );
    }
    if (err instanceof SkillContentReadError) {
      return failure(
        requestId,
        "invalid_command",
        `${err.code}: ${err.message}`
      );
    }
    if (err instanceof Error) {
      return failure(requestId, "invalid_command", err.message);
    }
    throw err;
  }
}
