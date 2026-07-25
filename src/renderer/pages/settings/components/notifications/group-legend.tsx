import { FieldDescription, FieldLegend } from "@pier/ui/field.tsx";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t.ts";

/** 设置卡分组标题（legend + 描述），通知设置三卡共用。 */
export function GroupLegend({
  descKey,
  titleKey,
}: {
  descKey: string;
  titleKey: string;
}): ReactNode {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <FieldLegend className="mb-0" variant="label">
        {t(titleKey)}
      </FieldLegend>
      <FieldDescription>{t(descKey)}</FieldDescription>
    </div>
  );
}
