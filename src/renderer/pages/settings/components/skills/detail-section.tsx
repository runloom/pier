import { DIALOG_SECTION_TITLE_CLASS } from "@pier/ui/dialog-form-layout.ts";
import type { ReactNode } from "react";

/**
 * Flat section for skill open dialogs (no Card chrome).
 * Dialog shell is already a bordered surface — nesting Cards creates a
 * triple-frame look that fights shadcn form-dialog practice.
 * Title class shared with workbench live-preference sections.
 */
export function SkillDetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className={DIALOG_SECTION_TITLE_CLASS}>{title}</h3>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </section>
  );
}
