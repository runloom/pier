import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import type {
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { ArrowLeft, Copy, Import } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  noopContentDialogSetFooter,
  useContentDialogFooter,
} from "@/components/common/use-content-dialog-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { SkillDetailSection } from "./skill-detail-section.tsx";
import { SkillsEffectMatrixCard } from "./skills-effect-matrix-card.tsx";
import { SkillMdScopeNotice } from "./skills-shared.tsx";
import { SkillContentBody } from "./skills-skill-content-body.tsx";

export { SkillsEffectMatrixCard } from "./skills-effect-matrix-card.tsx";
export { SkillContentBody } from "./skills-skill-content-body.tsx";

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
  presentation = "page",
  setFooter,
}: {
  target:
    | { kind: "project"; entry: UnmanagedSkillView }
    | { kind: "user-global"; entry: UserGlobalSkillView };
  onBack: () => void;
  onAdopt: (entry: UnmanagedSkillView) => void;
  adoptPending: boolean;
  presentation?: "page" | "dialog";
  setFooter?: (footer: ReactNode | null) => void;
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
  const canAdopt =
    target.kind === "project" &&
    (target.entry as UnmanagedSkillView).kind === "real-directory";

  // Footer only for Adopt — Close is the header X (shadcn dismissible dialog).
  const dialogFooter = useMemo(() => {
    if (!(presentation === "dialog" && canAdopt)) return null;
    return (
      <Button
        disabled={adoptPending}
        onClick={() => {
          onAdopt(target.entry as UnmanagedSkillView);
        }}
        size="sm"
        type="button"
      >
        <Import data-icon="inline-start" />
        {t("settings.skills.importAsManaged")}
      </Button>
    );
  }, [adoptPending, canAdopt, onAdopt, presentation, t, target.entry]);
  useContentDialogFooter(setFooter ?? noopContentDialogSetFooter, dialogFooter);

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
      {presentation === "page" ? (
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
          {canAdopt ? (
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
      ) : null}

      {presentation === "dialog" ? (
        <>
          <SkillDetailSection title={t("settings.skills.metadataTitle")}>
            {entry.description ? (
              <p className="text-sm">{entry.description}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {t("settings.skills.readOnlyNotice")}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant="outline">{t(badgeKey)}</Badge>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <span className="truncate font-mono text-muted-foreground text-xs">
                  {displayPath}
                </span>
                <Button
                  aria-label={t("settings.skills.copyPath")}
                  onClick={() => {
                    navigator.clipboard
                      .writeText(displayPath)
                      .then(() => {
                        toast.success(t("settings.skills.copySuccess"));
                      })
                      .catch(() => {
                        toast.error(t("settings.skills.copyFailed"));
                      });
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Copy data-icon="inline-start" />
                </Button>
              </div>
            </div>
          </SkillDetailSection>
          <SkillsEffectMatrixCard effects={entry.effects} plain t={t} />
          <SkillDetailSection title={t("settings.skills.contentTitle")}>
            <SkillMdScopeNotice t={t} />
            <SkillContentBody
              content={content}
              displayPath={displayPath}
              loadFailed={loadFailed}
              onRetry={() => {
                setRetryNonce((value) => value + 1);
              }}
              t={t}
            />
          </SkillDetailSection>
        </>
      ) : (
        <>
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
              <SkillMdScopeNotice t={t} />
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
        </>
      )}
    </div>
  );
}
