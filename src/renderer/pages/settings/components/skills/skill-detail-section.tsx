import type { ReactNode } from "react";

/**
 * Flat section for skill open dialogs (no Card chrome).
 * Dialog shell is already a bordered surface — nesting Cards creates a
 * triple-frame look that fights shadcn form-dialog practice.
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
      <h3 className="font-medium text-sm">{title}</h3>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </section>
  );
}
