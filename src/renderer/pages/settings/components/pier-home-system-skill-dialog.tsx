import { Badge } from "@pier/ui/badge.tsx";
import type { PierHomeSystemSkillView } from "@shared/contracts/pier-home.ts";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { pierHomeSystemProviderLabel } from "./pier-home-system-provider-label.ts";
import { SkillDetailSection } from "./skills/detail-section.tsx";
import { SkillContentBody } from "./skills/readonly-detail.tsx";
import { SkillMdScopeNotice } from "./skills/shared.tsx";

/**
 * Home · Pier system skill: read-only secondary dialog (no edit / delete).
 * Content comes from the immutable app/plugin contribution tree.
 */
export function openPierHomeSystemSkillDialog(
  skill: PierHomeSystemSkillView
): Promise<null> {
  const title = skill.name || skill.id;
  const skillId = skill.id;
  const description = skill.description;
  const providerId = skill.providerId;
  const providerVersion = skill.providerVersion;

  function SystemSkillBody(_props: AppContentDialogRenderProps) {
    const t = useT();
    const [content, setContent] = useState<{
      skillMd: string;
      truncated: boolean;
    } | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);
    const requestRef = useRef(0);

    useEffect(() => {
      let cancelled = false;
      const requestId = retryNonce;
      requestRef.current = requestId;
      setContent(null);
      setLoadFailed(false);
      setLoadError(null);
      window.pier.pierHomeSkills
        .read({ systemSkillId: skillId })
        .then((skillMd) => {
          if (!cancelled && requestRef.current === requestId) {
            setContent({ skillMd, truncated: false });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled && requestRef.current === requestId) {
            setLoadFailed(true);
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        });
      return () => {
        cancelled = true;
      };
    }, [retryNonce]);

    return (
      <div className="flex min-w-0 flex-col gap-5">
        <SkillDetailSection title={t("settings.skills.metadataTitle")}>
          {description ? <p className="text-sm">{description}</p> : null}
          <p className="text-muted-foreground text-xs">
            {t("settings.skills.readOnlyNotice")}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {t("settings.projects.pierHomeSystemBadge")}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {t("settings.projects.pierHomeSystemProvider", {
                provider: pierHomeSystemProviderLabel(providerId, t),
                version: providerVersion,
              })}
            </span>
          </div>
        </SkillDetailSection>

        <SkillDetailSection title={t("settings.skills.contentTitle")}>
          <SkillMdScopeNotice t={t} />
          <SkillContentBody
            content={content}
            displayPath={skillId}
            errorDetail={loadError}
            loadFailed={loadFailed}
            onRetry={() => {
              setRetryNonce((value) => value + 1);
            }}
            t={t}
          />
        </SkillDetailSection>
      </div>
    );
  }

  return openAppContentDialog({
    content: SystemSkillBody,
    id: `pier-home-system-skill:${skillId}`,
    size: "lg",
    title,
  }).result as Promise<null>;
}
