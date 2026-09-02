import type { Translate } from "../copy/index.ts";
import type {
  TaskBoardModel,
  TaskCardModel,
  TaskColumnId,
} from "../tracker-board/hooks.ts";

export type DagSectionId =
  | "cycle"
  | "done"
  | "inProgress"
  | "ready"
  | "waiting";

export interface DagSection {
  danger?: boolean;
  id: DagSectionId;
  keys: readonly string[];
  waitingSteps?: number;
}

export function columnIdForCard(
  board: TaskBoardModel | null,
  key: string
): TaskColumnId {
  const column = board?.columns.find((entry) =>
    entry.items.some((item) => item.key === key)
  );
  return column?.id ?? "todo";
}

export function dagSectionLabel(section: DagSection, t: Translate): string {
  if (section.id === "waiting") {
    return section.waitingSteps && section.waitingSteps > 1
      ? t("dag.waitingSteps", { n: section.waitingSteps })
      : t("dag.waiting");
  }
  if (section.id === "cycle") {
    return t("dag.cycle");
  }
  if (section.id === "ready") {
    return t("dag.ready");
  }
  if (section.id === "inProgress") {
    return t("dag.inProgress");
  }
  return t("dag.done");
}

/** Layer 0 splits by what the user can do; deeper layers wait on blockers. */
export function dagSections(input: {
  cardByKey: ReadonlyMap<string, TaskCardModel>;
  cycleKeys: ReadonlySet<string>;
  doneKeys: ReadonlySet<string>;
  layers: readonly (readonly string[])[];
}): DagSection[] {
  const sections: DagSection[] = [];
  input.layers.forEach((layer, index) => {
    if (input.cycleKeys.size > 0 && layer.every((k) => input.cycleKeys.has(k))) {
      sections.push({ danger: true, id: "cycle", keys: layer });
      return;
    }
    if (index === 0) {
      const done = layer.filter((k) => input.doneKeys.has(k));
      const inProgress = layer.filter(
        (k) => !input.doneKeys.has(k) && Boolean(input.cardByKey.get(k)?.work)
      );
      const ready = layer.filter(
        (k) => !(input.doneKeys.has(k) || input.cardByKey.get(k)?.work)
      );
      if (ready.length > 0) {
        sections.push({ id: "ready", keys: ready });
      }
      if (inProgress.length > 0) {
        sections.push({ id: "inProgress", keys: inProgress });
      }
      if (done.length > 0) {
        sections.push({ id: "done", keys: done });
      }
      return;
    }
    sections.push({
      id: "waiting",
      keys: layer,
      waitingSteps: index,
    });
  });
  return sections;
}
