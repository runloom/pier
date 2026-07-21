import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  SkillEffectiveCell,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { ArrowLeft, Import } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { useT } from "@/i18n/use-t.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { effectLabel, type Translate } from "./skills-shared.tsx";

function agentDisplayLabel(agentKind: string): string {
  return getAgentCatalogEntry(agentKind as AgentKind)?.label ?? agentKind;
}

/**
 * Read-only skill detail for discovered entries Pier does not own
 * (project-directory layer 5 and user-global layer 3). Industry form:
 * Cursor opens any listed skill's file read-only. Shows metadata, the full
 * per-agent matrix, and the SKILL.md content; the only action is adoption
 * for project real directories.
 */
export function SkillsReadonlyDetail({
  target,
  onBack,
  onAdopt,
  adoptPending,
}: {
  target:
    | { kind: "project"; entry: UnmanagedSkillView }
    | { kind: "user-global"; entry: UserGlobalSkillView };
  onBack: () => void;
  onAdopt: (entry: UnmanagedSkillView) => void;
  adoptPending: boolean;
}) {
  const t = useT();
  const projectRef = useProjectSkillsStore((s) => s.projectRef);
  const [content, setContent] = useState<{
    skillMd: string;
    truncated: boolean;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const contentRequestRef = useRef(0);

  const entry = target.entry;
  const displayPath = `${entry.root}/${entry.directoryName}`;
  const badgeKey =
    target.kind === "project"
      ? "settings.skills.unmanagedBadge"
      : "settings.skills.userGlobalBadge";

  useEffect(() => {
    let cancelled = false;
    const requestId = retryNonce;
    contentRequestRef.current = requestId;
    setContent(null);
    setLoadFailed(false);
    if (!projectRef) {
      return;
    }
    window.pier.projectSkills
      .skillRead(projectRef, {
        kind: target.kind,
        root: entry.root,
        directoryName: entry.directoryName,
      })
      .then((result) => {
        if (!cancelled && contentRequestRef.current === requestId) {
          setContent(result);
        }
      })
      .catch(() => {
        if (!cancelled && contentRequestRef.current === requestId) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectRef, target.kind, entry.root, entry.directoryName, retryNonce]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          aria-label={t("settings.skills.skillDetailBack")}
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-lg" tabIndex={-1}>
            {entry.name || entry.directoryName}
            <Badge className="ml-2" variant="outline">
              {t(badgeKey)}
            </Badge>
          </h2>
          <span className="truncate font-mono text-muted-foreground text-xs">
            {displayPath}
          </span>
        </div>
        {target.kind === "project" &&
        (target.entry as UnmanagedSkillView).kind === "real-directory" ? (
          <Button
            disabled={adoptPending}
            onClick={() => {
              onAdopt(target.entry as UnmanagedSkillView);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Import data-icon="inline-start" />
            {t("settings.skills.importAsManaged")}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.skills.metadataTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {entry.description ? (
            <p className="text-sm">{entry.description}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {t("settings.skills.readOnlyNotice")}
          </p>
        </CardContent>
      </Card>

      <SkillsEffectMatrixCard effects={entry.effects} t={t} />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.skills.contentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <SkillContentBody
            content={content}
            displayPath={displayPath}
            loadFailed={loadFailed}
            onRetry={() => {
              setRetryNonce((value) => value + 1);
            }}
            t={t}
          />
        </CardContent>
      </Card>
    </div>
  );
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
 * Detail-page effect matrix (design v8 §7.4): same density as the list-row
 * `AgentEffectSummary` — icon strips + short labels, never one Item card
 * per agent. Groups by (state, viaRoot) so a uniform discoverable set
 * collapses to a single strip like the list page.
 */
export function SkillsEffectMatrixCard({
  effects,
  t,
}: {
  effects: readonly SkillEffectiveCell[];
  t: Translate;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.skills.matrixTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      </CardContent>
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
  const pathSuffix = group.viaRoot ? (
    <span className="font-mono"> · {group.viaRoot}</span>
  ) : null;

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
          {pathSuffix}
        </Badge>
      </div>
    );
  }

  const muted = group.sample.effect.state !== "discoverable";
  let summary: string = label;
  if (group.cells.length > 1) {
    if (group.sample.effect.state === "discoverable") {
      summary = t("settings.skills.effectSummaryDiscoverable", {
        count: group.cells.length,
      });
    } else if (soleGroup) {
      // Spec §7.4: "均为" only when every installed agent shares one state.
      summary = t("settings.skills.matrixAllSameState", {
        count: group.cells.length,
        state: label,
      });
    } else {
      summary = t("settings.skills.matrixGroupState", {
        count: group.cells.length,
        state: label,
      });
    }
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
      <span className="text-muted-foreground text-xs">
        {summary}
        {pathSuffix}
      </span>
    </div>
  );
}

/** Skeleton / error / capped read-only SKILL.md body, shared by details. */
export function SkillContentBody({
  content,
  loadFailed,
  onRetry,
  displayPath,
  t,
}: {
  content: { skillMd: string; truncated: boolean } | null;
  loadFailed: boolean;
  onRetry?: () => void;
  displayPath: string;
  t: Translate;
}) {
  if (content === null && !loadFailed) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (loadFailed) {
    return (
      <Alert variant="warning">
        <AlertTitle>{t("settings.skills.contentUnavailable")}</AlertTitle>
        {onRetry ? (
          <AlertDescription>
            <span className="flex justify-end">
              <Button onClick={onRetry} size="sm" type="button">
                {t("settings.skills.retry")}
              </Button>
            </span>
          </AlertDescription>
        ) : null}
      </Alert>
    );
  }
  if (!content) {
    return null;
  }
  return (
    <>
      {content.truncated ? (
        <Alert>
          <AlertTitle>{t("settings.skills.contentTruncated")}</AlertTitle>
          <AlertDescription>
            <span className="font-mono">{displayPath}/SKILL.md</span>
          </AlertDescription>
        </Alert>
      ) : null}
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
        {content.skillMd}
      </pre>
    </>
  );
}
