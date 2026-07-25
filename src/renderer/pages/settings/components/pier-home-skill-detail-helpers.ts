import type {
  PierBindingsConvergeResult,
  PierHomeSkillDelivery,
  PierHomeSkillView,
} from "@shared/contracts/pier-home.ts";
import type { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

export const EMPTY_DELIVERY: PierHomeSkillDelivery = {
  agents: false,
  claude: false,
};

export const DEFAULT_ALWAYS_INCLUDE_DELIVERY: PierHomeSkillDelivery = {
  agents: true,
  claude: false,
};

export const HOME_PROJECT_DELIVERY: PierHomeSkillDelivery = {
  agents: true,
  claude: true,
};

export const EMPTY_CONVERGE: PierBindingsConvergeResult = {
  converged: [],
  failed: [],
};

export function deliveryEqual(
  a: PierHomeSkillDelivery,
  b: PierHomeSkillDelivery
): boolean {
  return a.agents === b.agents && a.claude === b.claude;
}

export function storedDelivery(
  skill: PierHomeSkillView
): PierHomeSkillDelivery {
  return skill.delivery ?? EMPTY_DELIVERY;
}

export function defaultDeliveryForAlwaysInclude(
  skill: PierHomeSkillView
): PierHomeSkillDelivery {
  const stored = storedDelivery(skill);
  return stored.agents || stored.claude
    ? stored
    : { ...DEFAULT_ALWAYS_INCLUDE_DELIVERY };
}

export function normalizeSkillMutationResult(value: unknown): {
  converge: PierBindingsConvergeResult;
  skill: PierHomeSkillView;
} {
  if (value && typeof value === "object" && "skill" in value) {
    const record = value as {
      converge?: PierBindingsConvergeResult | null;
      skill: PierHomeSkillView;
    };
    return {
      skill: record.skill,
      converge: record.converge ?? EMPTY_CONVERGE,
    };
  }
  return {
    skill: value as PierHomeSkillView,
    converge: EMPTY_CONVERGE,
  };
}

export async function alertConvergeFailures(
  t: ReturnType<typeof useT>,
  converge: PierBindingsConvergeResult | null | undefined
): Promise<void> {
  const failed = converge?.failed;
  if (!failed || failed.length === 0) return;
  const onlyNoProjects =
    failed.length === 1 &&
    failed[0]?.rootKey === "(none)" &&
    failed[0].message.toLowerCase().includes("no known projects");
  if (onlyNoProjects) {
    await showAppAlert({
      title: t("settings.projects.pierHomeSkillsConvergeNoProjects"),
    });
    return;
  }
  await showAppAlert({
    title: t("settings.projects.pierHomeSkillsConvergeFailed"),
    body: failed.map((item) => `${item.rootKey}: ${item.message}`).join("\n"),
  });
}
