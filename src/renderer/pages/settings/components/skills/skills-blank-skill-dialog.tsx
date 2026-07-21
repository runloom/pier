import { Button } from "@pier/ui/button.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";

export interface BlankSkillFormResult {
  description: string;
  skillId: string;
}

/** Mirrors the shared skillIdSchema shape closely enough for inline feedback. */
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function BlankSkillForm({
  close,
}: AppContentDialogRenderProps<BlankSkillFormResult>) {
  const t = useT();
  const [skillId, setSkillId] = useState("");
  const [description, setDescription] = useState("");

  const idInvalid = skillId.length > 0 && !SKILL_ID_RE.test(skillId);
  const canCreate = SKILL_ID_RE.test(skillId) && description.trim().length > 0;

  function submit() {
    if (!canCreate) {
      return;
    }
    close({ skillId: skillId.trim(), description: description.trim() });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FieldSet>
        <FieldGroup>
          <Field data-invalid={idInvalid || undefined}>
            <FieldLabel htmlFor="skills-blank-id">
              {t("settings.skills.blankIdTitle")}
            </FieldLabel>
            <Input
              aria-describedby={
                idInvalid
                  ? "skills-blank-id-help skills-blank-id-error"
                  : "skills-blank-id-help"
              }
              aria-invalid={idInvalid || undefined}
              aria-required
              autoFocus
              id="skills-blank-id"
              onChange={(event) => {
                setSkillId(event.target.value);
              }}
              required
              value={skillId}
            />
            <FieldDescription id="skills-blank-id-help">
              {t("settings.skills.blankIdBody")}
            </FieldDescription>
            {idInvalid ? (
              <FieldError id="skills-blank-id-error">
                {t("settings.skills.blankIdInvalid")}
              </FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="skills-blank-description">
              {t("settings.skills.blankDescriptionTitle")}
            </FieldLabel>
            <Input
              aria-describedby="skills-blank-description-help"
              aria-required
              id="skills-blank-description"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              required
              value={description}
            />
            <FieldDescription id="skills-blank-description-help">
              {t("settings.skills.blankDescriptionBody")}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>
      <div className="flex justify-end gap-2">
        <Button
          onClick={() => {
            close(null);
          }}
          type="button"
          variant="outline"
        >
          {t("dialog.cancel")}
        </Button>
        <Button disabled={!canCreate} type="submit">
          {t("settings.skills.create")}
        </Button>
      </div>
    </form>
  );
}

/**
 * New-blank-skill form (design v8 §7.5) as a host content dialog (decision
 * tree rule 6: two fields + inline validation outgrow showAppPrompt).
 * Resolves with the entered values, or null when cancelled.
 */
export function promptNewBlankSkill(
  title: string
): Promise<BlankSkillFormResult | null> {
  return openAppContentDialog<BlankSkillFormResult>({
    content: BlankSkillForm,
    id: "skills-new-blank",
    title,
  }).result;
}
