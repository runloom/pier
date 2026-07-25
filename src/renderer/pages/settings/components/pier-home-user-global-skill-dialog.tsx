import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import type { PierHomeUserGlobalSkillView } from "@shared/contracts/pier-home.ts";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { SkillDetailSection } from "./skills/skill-detail-section.tsx";
import {
  SkillContentBody,
  SkillsEffectMatrixCard,
} from "./skills/skills-readonly-detail.tsx";
import { SkillMdScopeNotice } from "./skills/skills-shared.tsx";

/**
 * Home · agent-global skill: read-only secondary dialog.
 * Dismiss via header X (no Close footer). Flat sections — no Card-in-Dialog.
 */
export function openPierHomeUserGlobalSkillDialog(
  entry: PierHomeUserGlobalSkillView
): Promise<null> {
  const displayPath = `${entry.root}/${entry.directoryName}`;
  const title = entry.name || entry.directoryName;
  const root = entry.root;
  const directoryName = entry.directoryName;
  const effects = entry.effects;
  const description = entry.description;

  function UserGlobalSkillBody(_props: AppContentDialogRenderProps) {
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
        .read({ root, directoryName })
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

    async function copyPath(): Promise<void> {
      try {
        await navigator.clipboard.writeText(displayPath);
        toast.success(t("settings.skills.copySuccess"));
      } catch {
        toast.error(t("settings.skills.copyFailed"));
      }
    }

    return (
      <div className="flex min-w-0 flex-col gap-5">
        <SkillDetailSection title={t("settings.skills.metadataTitle")}>
          {description ? <p className="text-sm">{description}</p> : null}
          <p className="text-muted-foreground text-xs">
            {t("settings.skills.readOnlyNotice")}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">
              {t("settings.skills.userGlobalBadge")}
            </Badge>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <span className="truncate font-mono text-muted-foreground text-xs">
                {displayPath}
              </span>
              <Button
                aria-label={t("settings.skills.copyPath")}
                onClick={() => {
                  copyPath().catch(() => undefined);
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

        <SkillsEffectMatrixCard effects={effects} plain t={t} />

        <SkillDetailSection title={t("settings.skills.contentTitle")}>
          <SkillMdScopeNotice t={t} />
          <SkillContentBody
            content={content}
            displayPath={displayPath}
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
    content: UserGlobalSkillBody,
    id: `pier-home-user-global-skill:${root}/${directoryName}`,
    size: "lg",
    title,
  }).result as Promise<null>;
}
