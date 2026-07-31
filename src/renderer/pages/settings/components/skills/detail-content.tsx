import { Button } from "@pier/ui/button.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { MarkdownSourceEditor } from "@/components/code-editor/markdown-source.tsx";
import { SkillContentBody } from "./readonly-detail.tsx";
import type { Translate } from "./shared.tsx";

/** Managed / system SKILL.md body for the skill detail dialog or page. */
export function ManagedSkillContent({
  content,
  displayPath,
  editorText,
  hasEditDraft,
  isSystem,
  loadFailed,
  onDiscard,
  onDraftChange,
  onRetry,
  onSave,
  showEditActions = true,
  t,
  writesDisabled,
}: {
  content: { skillMd: string; truncated: boolean } | null;
  displayPath: string;
  editorText: string;
  hasEditDraft: boolean;
  isSystem: boolean;
  loadFailed: boolean;
  onDiscard: () => void;
  onDraftChange: (next: string) => void;
  onRetry: () => void;
  onSave: () => void;
  /** When false, Discard/Save live in the sticky DialogFooter instead. */
  showEditActions?: boolean;
  t: Translate;
  writesDisabled: boolean;
}) {
  if (isSystem) {
    return (
      <SkillContentBody
        content={content}
        displayPath={displayPath}
        loadFailed={loadFailed}
        onRetry={onRetry}
        t={t}
      />
    );
  }
  if (content === null && !loadFailed) {
    return <Skeleton className="min-h-60 w-full" />;
  }
  if (loadFailed) {
    return (
      <SkillContentBody
        content={null}
        displayPath={displayPath}
        loadFailed
        onRetry={onRetry}
        t={t}
      />
    );
  }
  return (
    <>
      <MarkdownSourceEditor
        ariaLabel={t("settings.skills.contentTitle")}
        autoHeight
        onChange={onDraftChange}
        value={editorText}
      />
      {showEditActions ? (
        <div className="flex justify-end gap-2">
          <Button
            disabled={!hasEditDraft || writesDisabled}
            onClick={onDiscard}
            type="button"
            variant="outline"
          >
            {t("settings.skills.editDiscard")}
          </Button>
          <Button
            disabled={
              !hasEditDraft || editorText.trim().length === 0 || writesDisabled
            }
            onClick={onSave}
            type="button"
          >
            {t("settings.skills.editSave")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
