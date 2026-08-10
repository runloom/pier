import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
import { Field, FieldDescription, FieldLabel } from "@pier/ui/field.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useContentDialogFooter } from "@/components/common/dialogs/use-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import type { ComposerAttachment } from "./composer-attachments-model.ts";

export type PasteEditDialogResult =
  | { action: "save"; text: string }
  | { action: "delete" };

/**
 * Open paste attachment editor (content dialog).
 * - Save non-empty → write disk + update memory
 * - Save empty → delete attachment
 */
export function openComposerPasteEditDialog(input: {
  attachment: ComposerAttachment;
}): Promise<PasteEditDialogResult | null> {
  const { attachment } = input;
  const initial = attachment.pasteContent ?? "";

  function Body({
    close,
    setFooter,
    setOnDismissRequest,
    setTitle,
  }: AppContentDialogRenderProps<PasteEditDialogResult>) {
    const t = useT();
    const [draft, setDraft] = useState(initial);
    const [saving, setSaving] = useState(false);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const savingRef = useRef(saving);
    savingRef.current = saving;

    useEffect(() => {
      setTitle(t("terminal.composer.editPasteTitle"));
    }, [setTitle, t]);

    useEffect(() => {
      setOnDismissRequest(() => !savingRef.current);
      return () => {
        setOnDismissRequest(null);
      };
    }, [setOnDismissRequest]);

    async function save() {
      if (savingRef.current) {
        return;
      }
      const next = draftRef.current;
      if (next.length === 0) {
        close({ action: "delete" });
        return;
      }
      setSaving(true);
      try {
        const result = await window.pier.terminal.writeComposerPasteText({
          path: attachment.path,
          text: next,
        });
        if (!result.ok) {
          await showAppAlert({
            body: result.error,
            title: t("terminal.composer.editPasteSaveFailed"),
          });
          setSaving(false);
          return;
        }
        close({ action: "save", text: next });
      } catch (error: unknown) {
        await showAppAlert({
          body: error instanceof Error ? error.message : String(error),
          title: t("terminal.composer.editPasteSaveFailed"),
        });
        setSaving(false);
      }
    }

    const saveRef = useRef(save);
    saveRef.current = save;

    const footer = useMemo(
      () => (
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            disabled={saving}
            onClick={() => close(null)}
            type="button"
            variant="outline"
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              saveRef.current().catch(() => undefined);
            }}
            type="button"
          >
            {t("terminal.composer.editPasteSave")}
          </Button>
        </div>
      ),
      [close, saving, t]
    );
    useContentDialogFooter(setFooter, footer);

    return (
      <div className={DIALOG_COMMIT_FORM_CLASS}>
        <Field>
          <FieldLabel htmlFor="composer-paste-edit">
            {t("terminal.composer.editPasteLabel")}
          </FieldLabel>
          <Textarea
            className="min-h-48 font-mono text-sm"
            disabled={saving}
            id="composer-paste-edit"
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <FieldDescription>
            {t("terminal.composer.editPasteEmptyHint")}
          </FieldDescription>
        </Field>
      </div>
    );
  }

  const handle = openAppContentDialog<PasteEditDialogResult>({
    content: Body,
    id: `composer-paste-edit:${attachment.id}`,
    size: "lg",
    title: "", // Body sets via setTitle + i18n
  });
  return handle.result;
}
