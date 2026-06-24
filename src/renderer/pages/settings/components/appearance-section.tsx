import { Card, CardContent } from "@/components/primitives/card.tsx";
import { FieldSeparator, FieldSet } from "@/components/primitives/field.tsx";
import { useT } from "@/i18n/use-t.ts";
import { LanguageRow } from "@/pages/settings/components/rows/language-row.tsx";
import { MonoFontRow } from "@/pages/settings/components/rows/mono-font-row.tsx";
import { MonoFontSizeRow } from "@/pages/settings/components/rows/mono-font-size-row.tsx";
import { StyleRow } from "@/pages/settings/components/rows/style-row.tsx";
import { ThemeRow } from "@/pages/settings/components/rows/theme-row.tsx";
import { UiFontRow } from "@/pages/settings/components/rows/ui-font-row.tsx";

export function AppearanceSection() {
  const t = useT();
  return (
    <div className="px-4 pb-4">
      <h1 className="mb-4 text-xl">{t("settings.section.appearance")}</h1>
      <Card>
        <CardContent>
          <FieldSet>
            <ThemeRow />
            <FieldSeparator />
            <StyleRow />
            <FieldSeparator />
            <UiFontRow />
            <FieldSeparator />
            <MonoFontRow />
            <FieldSeparator />
            <MonoFontSizeRow />
            <FieldSeparator />
            <LanguageRow />
          </FieldSet>
        </CardContent>
      </Card>
    </div>
  );
}
