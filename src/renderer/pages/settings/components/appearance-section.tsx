import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import { useT } from "@/i18n/use-t.ts";
import { CodeFontSizeRow } from "@/pages/settings/components/rows/code-font-size-row.tsx";
import { DocFontRow } from "@/pages/settings/components/rows/doc-font-row.tsx";
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
            <DocFontRow />
            <FieldSeparator />
            <MonoFontSizeRow />
            <FieldSeparator />
            <CodeFontSizeRow />
            <FieldSeparator />
            <LanguageRow />
          </FieldSet>
        </CardContent>
      </Card>
    </div>
  );
}
