import { Badge } from "@pier/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { cn } from "@pier/ui/utils.ts";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { SkillEffectiveCell } from "@shared/contracts/project-skills.ts";
import { SkillDetailSection } from "./detail-section.tsx";
import { effectLabel, type Translate } from "./shared.tsx";

function agentDisplayLabel(agentKind: string): string {
  return getAgentCatalogEntry(agentKind as AgentKind)?.label ?? agentKind;
}

function matrixCellRank(cell: SkillEffectiveCell): number {
  if (cell.effect.state === "discoverable") return 0;
  if (
    cell.effect.state === "shadowed-by-user" ||
    cell.effect.state === "overridden" ||
    cell.effect.state === "duplicate" ||
    cell.effect.state === "unknown-version"
  ) {
    return 1;
  }
  return 2;
}

function matrixCellAttention(cell: SkillEffectiveCell): boolean {
  return matrixCellRank(cell) === 1;
}

/**
 * Detail-page effect matrix: discoverable agents grouped by discovery root
 * with path labels; attention states keep a compact warning badge.
 */
export function SkillsEffectMatrixCard({
  effects,
  t,
  plain = false,
}: {
  effects: readonly SkillEffectiveCell[];
  t: Translate;
  /** Dialog body: section title only, no Card chrome. */
  plain?: boolean;
}) {
  const visible = effects
    .filter(
      (cell) =>
        cell.effect.state !== "agent-not-installed" &&
        cell.effect.state !== "not-applicable"
    )
    .toSorted((a, b) => {
      const byRank = matrixCellRank(a) - matrixCellRank(b);
      if (byRank !== 0) return byRank;
      return a.agentKind.localeCompare(b.agentKind);
    });
  const notInstalledCount = effects.filter(
    (cell) => cell.effect.state === "agent-not-installed"
  ).length;
  const groups = groupMatrixCells(visible);

  const body = (
    <div className="flex flex-col gap-3">
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("settings.skills.effectSummaryNone")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <MatrixEffectGroup
              group={group}
              key={group.key}
              soleGroup={groups.length === 1}
              t={t}
            />
          ))}
        </div>
      )}
      {notInstalledCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("settings.skills.matrixNotInstalled", {
            count: notInstalledCount,
          })}
        </p>
      ) : null}
    </div>
  );

  if (plain) {
    return (
      <SkillDetailSection title={t("settings.skills.matrixTitle")}>
        {body}
      </SkillDetailSection>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.skills.matrixTitle")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

interface MatrixGroup {
  attention: boolean;
  cells: SkillEffectiveCell[];
  key: string;
  sample: SkillEffectiveCell;
  viaRoot: string | null;
}

function groupMatrixCells(cells: readonly SkillEffectiveCell[]): MatrixGroup[] {
  const buckets = new Map<string, SkillEffectiveCell[]>();
  for (const cell of cells) {
    const viaRoot =
      "viaRoot" in cell.effect ? (cell.effect.viaRoot ?? null) : null;
    const key = `${cell.effect.state}\0${viaRoot ?? ""}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(cell);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, groupCells]) => {
      const sample = groupCells[0];
      if (!sample) {
        return null;
      }
      return {
        key,
        cells: groupCells,
        sample,
        viaRoot:
          "viaRoot" in sample.effect ? (sample.effect.viaRoot ?? null) : null,
        attention: matrixCellAttention(sample),
      };
    })
    .filter((group): group is MatrixGroup => group !== null)
    .toSorted((a, b) => matrixCellRank(a.sample) - matrixCellRank(b.sample));
}

function MatrixEffectGroup({
  group,
  soleGroup,
  t,
}: {
  group: MatrixGroup;
  /** True when this is the only effect group — enables §7.4 uniform collapse copy. */
  soleGroup: boolean;
  t: Translate;
}) {
  const label = effectLabel(group.sample, t);

  if (group.attention) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="warning">
          <span className="inline-flex items-center gap-0.5">
            {group.cells.map((cell) => (
              <span
                aria-label={agentDisplayLabel(cell.agentKind)}
                className="inline-flex items-center"
                key={cell.agentKind}
                role="img"
              >
                <AgentIcon agentId={cell.agentKind as AgentKind} size={14} />
              </span>
            ))}
          </span>
          {group.cells.length === 1
            ? label
            : t("settings.skills.matrixGroupState", {
                count: group.cells.length,
                state: label,
              })}
        </Badge>
      </div>
    );
  }

  const muted = group.sample.effect.state !== "discoverable";
  let summary: string = label;
  if (group.sample.effect.state === "discoverable") {
    summary = group.viaRoot
      ? t("settings.skills.discoveryChannelSummary", {
          count: group.cells.length,
          path: group.viaRoot,
        })
      : t("settings.skills.discoveryChannelSummaryNoPath", {
          count: group.cells.length,
        });
  } else if (group.cells.length > 1) {
    summary = soleGroup
      ? t("settings.skills.matrixAllSameState", {
          count: group.cells.length,
          state: label,
        })
      : t("settings.skills.matrixGroupState", {
          count: group.cells.length,
          state: label,
        });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1">
        {group.cells.map((cell) => (
          <span
            aria-label={agentDisplayLabel(cell.agentKind)}
            className={cn(
              "inline-flex size-5 items-center justify-center",
              muted && "opacity-35 grayscale"
            )}
            key={cell.agentKind}
            role="img"
          >
            <AgentIcon agentId={cell.agentKind as AgentKind} size={14} />
          </span>
        ))}
      </span>
      <span className="text-muted-foreground text-xs">{summary}</span>
    </div>
  );
}
