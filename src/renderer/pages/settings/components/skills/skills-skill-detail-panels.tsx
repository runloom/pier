import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import type { SkillEffectiveCell } from "@shared/contracts/project-skills.ts";
import type { PierDiscoveryChannelId } from "@shared/project-skills-pier-channels.ts";
import { Copy, Trash2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { SkillDetailSection } from "./skill-detail-section.tsx";
import { SkillsDiscoveryChannelEditor } from "./skills-discovery-channel-editor.tsx";
import { SkillsEffectMatrixCard } from "./skills-readonly-detail.tsx";
import {
  formatBytes,
  SkillMdScopeNotice,
  type Translate,
} from "./skills-shared.tsx";
import { ManagedSkillContent } from "./skills-skill-detail-content.tsx";

/** Identity facts only — no enable/delete. */
function SkillIdentityFields({
  adoptCurrentFiles,
  copyLibraryPath,
  description,
  drifted,
  fileCount,
  hasRisk,
  libraryPath,
  riskLine,
  sourceBadge,
  t,
  totalBytes,
  writesDisabled,
}: {
  adoptCurrentFiles: () => Promise<void>;
  copyLibraryPath: () => Promise<void>;
  description: string;
  drifted: boolean;
  fileCount: number;
  hasRisk: boolean;
  libraryPath: string;
  riskLine: string;
  sourceBadge?: ReactNode;
  t: Translate;
  totalBytes: number;
  writesDisabled: boolean;
}) {
  return (
    <>
      {drifted ? (
        <Alert variant="destructive">
          <AlertTitle>{t("settings.skills.driftTitle")}</AlertTitle>
          <AlertDescription>
            <span className="flex flex-col gap-2">
              {t("settings.skills.driftBody")}
              <span className="flex justify-end">
                <Button
                  disabled={writesDisabled}
                  onClick={() => {
                    adoptCurrentFiles().catch(() => undefined);
                  }}
                  size="sm"
                  type="button"
                >
                  {t("settings.skills.driftUseCurrent")}
                </Button>
              </span>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {sourceBadge}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate font-mono text-muted-foreground text-xs">
            {libraryPath}
          </span>
          <Button
            aria-label={t("settings.skills.copyPath")}
            onClick={() => {
              copyLibraryPath().catch(() => undefined);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Copy data-icon="inline-start" />
          </Button>
        </div>
      </div>
      <p className="font-mono text-muted-foreground text-xs">
        {t("settings.skills.metadataFiles", {
          count: fileCount,
          size: formatBytes(totalBytes),
        })}
      </p>
      {fileCount > 1 ? (
        <p className="text-muted-foreground text-xs">
          {t("settings.skills.metadataCompanionHint")}
        </p>
      ) : null}
      {hasRisk ? (
        <p
          className="flex items-center gap-1 text-status-warning-fg text-xs"
          title={t("settings.skills.riskDisclaimer")}
        >
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {riskLine}
        </p>
      ) : null}
    </>
  );
}

function SkillDeleteAction({
  onDelete,
  t,
  writesDisabled,
}: {
  onDelete: () => void;
  t: Translate;
  writesDisabled: boolean;
}) {
  return (
    <div className="flex">
      <Button
        disabled={writesDisabled}
        onClick={onDelete}
        size="sm"
        type="button"
        variant="destructive"
      >
        <Trash2 data-icon="inline-start" />
        {t("settings.skills.deleteSkill")}
      </Button>
    </div>
  );
}

function SkillsManagedDiscoverySection({
  effects,
  enabled,
  onChannelChange,
  plain,
  projectDelivery,
  skillDelivery,
  t,
  writesDisabled,
}: {
  effects: readonly SkillEffectiveCell[];
  enabled: boolean;
  onChannelChange: (channel: PierDiscoveryChannelId, checked: boolean) => void;
  plain: boolean;
  projectDelivery: { agents: boolean; claude: boolean };
  skillDelivery: { agents: boolean; claude: boolean } | null;
  t: Translate;
  writesDisabled: boolean;
}) {
  const body = (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {t("settings.skills.discoveryChannelsHint")}
      </p>
      <SkillsDiscoveryChannelEditor
        disabled={writesDisabled}
        effects={effects}
        enabled={enabled}
        onChannelChange={onChannelChange}
        projectDelivery={projectDelivery}
        skillDelivery={skillDelivery}
        t={t}
      />
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

/** Form-dialog body: identity → discovery channels → content → quiet delete. */
export function SkillsSkillDetailPanels({
  adoptCurrentFiles,
  content,
  copyLibraryPath,
  description,
  drifted,
  editorText,
  effects,
  enabled,
  fileCount,
  hasEditDraft,
  hasRisk,
  isSystem,
  libraryPath,
  loadFailed,
  onChannelChange,
  onDelete,
  onDiscard,
  onDraftChange,
  onRetry,
  onSave,
  presentation,
  projectDelivery,
  riskLine,
  skillDelivery,
  sourceBadge,
  t,
  totalBytes,
  writesDisabled,
}: {
  adoptCurrentFiles: () => Promise<void>;
  content: { skillMd: string; truncated: boolean } | null;
  copyLibraryPath: () => Promise<void>;
  description: string;
  drifted: boolean;
  editorText: string;
  effects: readonly SkillEffectiveCell[];
  enabled: boolean;
  fileCount: number;
  hasEditDraft: boolean;
  hasRisk: boolean;
  isSystem: boolean;
  libraryPath: string;
  loadFailed: boolean;
  onChannelChange: (channel: PierDiscoveryChannelId, checked: boolean) => void;
  onDelete: () => void;
  onDiscard: () => void;
  onDraftChange: (next: string) => void;
  onRetry: () => void;
  onSave: () => void;
  presentation: "page" | "dialog";
  projectDelivery: { agents: boolean; claude: boolean };
  riskLine: string;
  skillDelivery: { agents: boolean; claude: boolean } | null;
  /** Dialog-only: source badge next to path (page keeps badge in the title row). */
  sourceBadge?: ReactNode;
  t: Translate;
  totalBytes: number;
  writesDisabled: boolean;
}) {
  const showLifecycle = !isSystem;
  const plain = presentation === "dialog";
  const identity = (
    <SkillIdentityFields
      adoptCurrentFiles={adoptCurrentFiles}
      copyLibraryPath={copyLibraryPath}
      description={description}
      drifted={drifted}
      fileCount={fileCount}
      hasRisk={hasRisk}
      libraryPath={libraryPath}
      riskLine={riskLine}
      sourceBadge={presentation === "dialog" ? sourceBadge : undefined}
      t={t}
      totalBytes={totalBytes}
      writesDisabled={writesDisabled}
    />
  );
  const skillMd = (
    <ManagedSkillContent
      content={content}
      displayPath={libraryPath}
      editorText={editorText}
      hasEditDraft={hasEditDraft}
      isSystem={isSystem}
      loadFailed={loadFailed}
      onDiscard={onDiscard}
      onDraftChange={onDraftChange}
      onRetry={onRetry}
      onSave={onSave}
      showEditActions={presentation === "page"}
      t={t}
      writesDisabled={writesDisabled}
    />
  );
  const matrix = showLifecycle ? (
    <SkillsManagedDiscoverySection
      effects={effects}
      enabled={enabled}
      onChannelChange={onChannelChange}
      plain={plain}
      projectDelivery={projectDelivery}
      skillDelivery={skillDelivery}
      t={t}
      writesDisabled={writesDisabled}
    />
  ) : (
    <SkillsEffectMatrixCard effects={effects} plain={plain} t={t} />
  );

  if (presentation === "dialog") {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-2">{identity}</div>
        {matrix}
        <SkillDetailSection title={t("settings.skills.contentTitle")}>
          <SkillMdScopeNotice t={t} />
          {skillMd}
        </SkillDetailSection>
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.skills.metadataTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">{identity}</CardContent>
      </Card>
      {matrix}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.skills.contentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <SkillMdScopeNotice t={t} />
          {skillMd}
        </CardContent>
      </Card>
      {showLifecycle ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.skills.removeTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {t("settings.skills.removeBody")}
            </p>
            <SkillDeleteAction
              onDelete={onDelete}
              t={t}
              writesDisabled={writesDisabled}
            />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
