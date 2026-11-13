import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import type { FilesTranslate } from "../../i18n.ts";

export function SheetTabs(props: {
  activeIndex: number;
  names: readonly string[];
  onSelect: (index: number) => void;
  t: FilesTranslate;
}) {
  return (
    <div
      // 36px 外壳与终端 composer chrome 同档：28px track 居中，上下各 4px
      // 呼吸位；比 FilePanelHeader（40px）少 4px，footer 只有 tabs 不抢 header 高度。
      className="flex h-9 shrink-0 items-center border-border border-t bg-background px-2"
      data-slot="document-preview-sheet-tabs"
    >
      <Tabs
        className="w-full min-w-0 shrink-0 gap-0"
        onValueChange={(value) => props.onSelect(Number(value))}
        value={String(props.activeIndex)}
      >
        <TabsList
          aria-label={props.t(
            "filePanel.documentPreview.xlsx.sheetTabsLabel",
            "Worksheets"
          )}
          className="w-full justify-start overflow-x-auto px-1 py-0"
          variant="line"
        >
          {props.names.map((name, index) => (
            <TabsTrigger
              // 与审查 surface switcher 共用 line tab 语法（28px / text-xs /
              // px-2.5 / gap-4）；这里只反转选中线到内容侧，其他不外溢。
              className="text-xs aria-selected:after:top-0 aria-selected:after:bottom-auto"
              key={name}
              value={String(index)}
            >
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
