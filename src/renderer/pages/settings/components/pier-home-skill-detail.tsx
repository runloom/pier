import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { DIALOG_FOOTER_ACTIONS_CLASS } from "@pier/ui/dialog-form-layout.ts";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type {
  PierBindingsConvergeResult,
  PierHomeSkillDelivery,
  PierHomeSkillView,
} from "@shared/contracts/pier-home.ts";
import type { PierDiscoveryChannelId } from "@shared/project-skills-pier-channels.ts";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownSourceEditor } from "@/components/code-editor/markdown-source.tsx";
import { useContentDialogFooter } from "@/components/common/dialogs/use-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  closeAppContentDialog,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import {
  alertConvergeFailures,
  defaultDeliveryForAlwaysInclude,
  deliveryEqual,
  EMPTY_CONVERGE,
  EMPTY_DELIVERY,
  HOME_PROJECT_DELIVERY,
  normalizeSkillMutationResult,
  storedDelivery,
} from "./pier-home-skill-detail-helpers.ts";
import { SkillDetailSection } from "./skills/detail-section.tsx";
import { SkillsDiscoveryChannelEditor } from "./skills/discovery-channel-editor.tsx";
import { SkillMdScopeNotice } from "./skills/shared.tsx";

export interface PierHomeLibrarySkillDialogResult {
  deleted?: boolean;
  saved?: boolean;
  skill?: PierHomeSkillView;
}

let libraryDialogDirty = false;
let libraryDialogId: string | null = null;

/** Settings leave guard: true while the library editor dialog has unsaved edits. */
export function isPierHomeLibrarySkillDialogDirty(): boolean {
  return libraryDialogDirty;
}

/** Discard drafts and close the library editor (settings leave / force). */
export function forceClosePierHomeLibrarySkillDialog(): void {
  libraryDialogDirty = false;
  if (libraryDialogId) {
    closeAppContentDialog(libraryDialogId, null);
    libraryDialogId = null;
  }
}

/**
 * Home · Pier library skill: always-include + discovery channels (when on) +
 * SKILL.md share one Save. Create flow is `openPierHomeCreateSkillDialog`.
 */
export function openPierHomeLibrarySkillDialog(
  skill: PierHomeSkillView
): Promise<PierHomeLibrarySkillDialogResult | null> {
  const dialogId = `pier-home-library-skill:${skill.id}`;
  libraryDialogId = dialogId;
  libraryDialogDirty = false;

  function LibrarySkillBody({
    close,
    setFooter,
    setOnDismissRequest,
  }: AppContentDialogRenderProps<PierHomeLibrarySkillDialogResult>) {
    const t = useT();
    const alwaysIncludeId = useId();
    const [entry, setEntry] = useState(skill);
    const [content, setContent] = useState<string | null>(null);
    const [draft, setDraft] = useState<string | null>(null);
    const [alwaysIncludeDraft, setAlwaysIncludeDraft] = useState(
      skill.alwaysInclude
    );
    const [deliveryDraft, setDeliveryDraft] = useState<PierHomeSkillDelivery>(
      () => storedDelivery(skill)
    );
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);
    const [saving, setSaving] = useState(false);
    const requestRef = useRef(0);

    const contentDirty = draft !== null && draft !== content;
    const settingsDirty =
      alwaysIncludeDraft !== entry.alwaysInclude ||
      (alwaysIncludeDraft &&
        !deliveryEqual(deliveryDraft, storedDelivery(entry)));
    const dirty = contentDirty || settingsDirty;
    const editorText = contentDirty ? (draft ?? "") : (content ?? "");
    const displayPath = entry.absolutePath;
    const writesDisabled = saving;
    const saveDisabled =
      !dirty ||
      writesDisabled ||
      (contentDirty &&
        (content === null || loadFailed || editorText.trim().length === 0));

    useEffect(() => {
      libraryDialogDirty = dirty;
      setOnDismissRequest(async () => {
        if (!libraryDialogDirty) return true;
        const ok = await showAppConfirm({
          body: t("settings.skills.leaveEditBody"),
          intent: "destructive",
          title: t("settings.skills.leaveEditTitle"),
        });
        if (ok) {
          setDraft(null);
          setAlwaysIncludeDraft(entry.alwaysInclude);
          setDeliveryDraft(storedDelivery(entry));
        }
        return ok;
      });
      return () => {
        libraryDialogDirty = false;
        setOnDismissRequest(null);
      };
    }, [dirty, entry, setOnDismissRequest, t]);

    useEffect(() => {
      let cancelled = false;
      const requestId = retryNonce;
      requestRef.current = requestId;
      setContent(null);
      setDraft(null);
      setLoadFailed(false);
      setLoadError(null);
      window.pier.pierHomeSkills
        .read({ skillId: entry.id })
        .then((skillMd) => {
          if (!cancelled && requestRef.current === requestId) {
            setContent(skillMd);
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
    }, [entry.id, retryNonce]);

    async function copyPath(): Promise<void> {
      try {
        await navigator.clipboard.writeText(displayPath);
        toast.success(t("settings.skills.copySuccess"));
      } catch {
        toast.error(t("settings.skills.copyFailed"));
      }
    }

    async function save(): Promise<void> {
      if (saveDisabled) return;
      setSaving(true);
      try {
        let nextEntry = entry;
        const converges: PierBindingsConvergeResult[] = [];
        if (contentDirty && draft !== null) {
          const written = normalizeSkillMutationResult(
            await window.pier.pierHomeSkills.write(entry.id, draft)
          );
          nextEntry = written.skill;
          converges.push(written.converge);
          setContent(draft);
          setDraft(null);
        }
        if (settingsDirty) {
          const updated = normalizeSkillMutationResult(
            await window.pier.pierHomeSkills.setAlwaysInclude(
              entry.id,
              alwaysIncludeDraft,
              alwaysIncludeDraft ? deliveryDraft : undefined
            )
          );
          nextEntry = updated.skill;
          converges.push(updated.converge);
        }
        for (const converge of converges) {
          await alertConvergeFailures(t, converge);
        }
        setEntry(nextEntry);
        setAlwaysIncludeDraft(nextEntry.alwaysInclude);
        setDeliveryDraft(storedDelivery(nextEntry));
        libraryDialogDirty = false;
        libraryDialogId = null;
        close({ saved: true, skill: nextEntry });
      } catch (err) {
        await showAppAlert({
          title: t("settings.projects.pierHomeSkillsSaveFailed"),
          body: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setSaving(false);
      }
    }

    async function deleteLibrary(): Promise<void> {
      const confirmed = await showAppConfirm({
        title: t("settings.projects.pierHomeSkillsDeleteTitle"),
        body: t("settings.projects.pierHomeSkillsDeleteBody", {
          skill: entry.name || entry.id,
        }),
        confirmLabel: t("settings.projects.pierHomeSkillsDeleteConfirm"),
        intent: "destructive",
      });
      if (!confirmed) return;
      try {
        const raw = await window.pier.pierHomeSkills.delete(entry.id);
        const converge =
          raw && typeof raw === "object" && "failed" in raw
            ? (raw as PierBindingsConvergeResult)
            : EMPTY_CONVERGE;
        await alertConvergeFailures(t, converge);
        libraryDialogDirty = false;
        libraryDialogId = null;
        close({ deleted: true });
      } catch (err) {
        await showAppAlert({
          title: t("settings.projects.pierHomeSkillsDeleteFailed"),
          body: err instanceof Error ? err.message : String(err),
        });
      }
    }

    async function cancelDialog(): Promise<void> {
      if (dirty) {
        const ok = await showAppConfirm({
          body: t("settings.skills.leaveEditBody"),
          intent: "destructive",
          title: t("settings.skills.leaveEditTitle"),
        });
        if (!ok) return;
        setDraft(null);
        setAlwaysIncludeDraft(entry.alwaysInclude);
        setDeliveryDraft(storedDelivery(entry));
        libraryDialogDirty = false;
      }
      close(null);
    }

    const saveRef = useRef(save);
    saveRef.current = save;
    const deleteRef = useRef(deleteLibrary);
    deleteRef.current = deleteLibrary;
    const cancelRef = useRef(cancelDialog);
    cancelRef.current = cancelDialog;

    const footer = useMemo(
      () => (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            disabled={writesDisabled}
            onClick={() => {
              deleteRef.current().catch(() => undefined);
            }}
            type="button"
            variant="destructive"
          >
            <Trash2 data-icon="inline-start" />
            {t("settings.projects.pierHomeSkillsDeleteConfirm")}
          </Button>
          <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
            <Button
              disabled={writesDisabled}
              onClick={() => {
                cancelRef.current().catch(() => undefined);
              }}
              type="button"
              variant="outline"
            >
              {t("dialog.cancel")}
            </Button>
            <Button
              disabled={saveDisabled}
              onClick={() => {
                saveRef.current().catch(() => undefined);
              }}
              type="button"
            >
              {saving ? (
                <Loader2
                  aria-hidden
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {t("settings.skills.editSave")}
            </Button>
          </div>
        </div>
      ),
      [saveDisabled, saving, t, writesDisabled]
    );
    useContentDialogFooter(setFooter, footer);

    return (
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          {entry.description ? (
            <p className="text-muted-foreground text-sm">{entry.description}</p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {t("settings.skills.pierLibraryBadge")}
            </Badge>
            {alwaysIncludeDraft ? (
              <Badge variant="outline">
                {t("settings.skills.alwaysIncludeBadge")}
              </Badge>
            ) : null}
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
        </div>

        <Field className="!items-center" orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={alwaysIncludeId}>
              {t("settings.projects.pierHomeAlwaysIncludeLabel")}
            </FieldLabel>
            <FieldDescription>
              {t("settings.projects.pierHomeAlwaysIncludeHint")}
            </FieldDescription>
          </FieldContent>
          <Switch
            checked={alwaysIncludeDraft}
            disabled={writesDisabled}
            id={alwaysIncludeId}
            onCheckedChange={(checked) => {
              setAlwaysIncludeDraft(checked);
              setDeliveryDraft(
                checked
                  ? defaultDeliveryForAlwaysInclude(entry)
                  : EMPTY_DELIVERY
              );
            }}
          />
        </Field>

        {alwaysIncludeDraft ? (
          <SkillDetailSection title={t("settings.skills.matrixTitle")}>
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs">
                {t("settings.projects.pierHomeDiscoveryChannelsHint")}
              </p>
              <SkillsDiscoveryChannelEditor
                disabled={writesDisabled}
                effects={[]}
                enabled
                onChannelChange={(channel: PierDiscoveryChannelId, checked) => {
                  setDeliveryDraft((prev) => ({
                    ...prev,
                    [channel]: checked,
                  }));
                }}
                projectDelivery={HOME_PROJECT_DELIVERY}
                skillDelivery={deliveryDraft}
                t={t}
              />
            </div>
          </SkillDetailSection>
        ) : null}

        <SkillDetailSection title={t("settings.skills.contentTitle")}>
          <SkillMdScopeNotice t={t} />
          {content === null && !loadFailed ? (
            <Skeleton className="min-h-60 w-full" />
          ) : null}
          {loadFailed ? (
            <Alert variant="warning">
              <AlertTitle>{t("settings.skills.contentUnavailable")}</AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {loadError ? (
                    <span className="break-words text-muted-foreground text-xs">
                      {loadError}
                    </span>
                  ) : null}
                  <span className="flex justify-end">
                    <Button
                      onClick={() => {
                        setRetryNonce((value) => value + 1);
                      }}
                      size="sm"
                      type="button"
                    >
                      {t("settings.skills.retry")}
                    </Button>
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {content !== null && !loadFailed ? (
            <MarkdownSourceEditor
              ariaLabel={t("settings.skills.contentTitle")}
              autoHeight
              onChange={(next) => {
                if (writesDisabled) return;
                if (next === content) {
                  setDraft(null);
                } else {
                  setDraft(next);
                }
              }}
              value={editorText}
            />
          ) : null}
        </SkillDetailSection>
      </div>
    );
  }

  const handle = openAppContentDialog<PierHomeLibrarySkillDialogResult>({
    content: LibrarySkillBody,
    id: dialogId,
    size: "lg",
    title: skill.name || skill.id,
  });

  return handle.result.finally(() => {
    if (libraryDialogId === dialogId) {
      libraryDialogId = null;
      libraryDialogDirty = false;
    }
  });
}
