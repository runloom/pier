import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
  DIALOG_SECTION_TITLE_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
import { FieldLegend, FieldSet } from "@pier/ui/field.tsx";
import { ItemGroup } from "@pier/ui/item.tsx";
import type { WorkbenchWidgetSettingsProps } from "@plugins/api/renderer.ts";
import { Plus } from "lucide-react";
import { useMemo, useRef } from "react";
import { useContentDialogFooter } from "@/components/common/use-content-dialog-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import { ensureCoreMetricsRegistered } from "@/lib/workbench/core-metrics.ts";
import { useMetricDescriptors } from "@/lib/workbench/metric-registry.ts";
import { openAddBlockDialog } from "./custom-card-add-block-dialog.tsx";
import {
  blocksToJson,
  EditableBlockRow,
  moveBlock,
} from "./custom-card-block-editor.tsx";
import {
  type CustomCardBlock,
  parseCustomCardParams,
} from "./custom-card-params.ts";

ensureCoreMetricsRegistered();

/**
 * 自定义卡片设置主面：区块列表（即时改）。
 * 「添加区块」在 WorkbenchSettingsDialog sticky footer。
 * 添加表单走二级 content dialog（提交型）。
 */
export function CustomCardSettings({
  params,
  setFooter,
  updateParams,
}: WorkbenchWidgetSettingsProps) {
  const t = useT();
  const blocks = useMemo(() => parseCustomCardParams(params).blocks, [params]);
  const metrics = useMetricDescriptors();
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const persistBlocks = (next: CustomCardBlock[]): void => {
    updateParams({ blocks: blocksToJson(next) });
  };

  const updateBlock = (
    blockId: string,
    patch: Partial<Omit<CustomCardBlock, "id" | "type">>
  ): void => {
    persistBlocks(
      blocks.map((b) =>
        b.id === blockId ? { ...b, ...patch, id: b.id, type: b.type } : b
      )
    );
  };

  const openAddRef = useRef((): void => {
    /* filled below */
  });
  openAddRef.current = (): void => {
    openAddBlockDialog((block) => {
      persistBlocks([...blocksRef.current, block]);
    });
  };

  const panelFooter = useMemo(
    () => (
      <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
        <Button
          data-testid="custom-card-settings-add"
          onClick={() => {
            openAddRef.current();
          }}
          type="button"
          variant="default"
        >
          <Plus data-icon="inline-start" />
          {t("workbench.widget.customCard.addBlock")}
        </Button>
      </div>
    ),
    [t]
  );
  useContentDialogFooter(setFooter, panelFooter);

  return (
    <div
      className={DIALOG_COMMIT_FORM_CLASS}
      data-slot="workbench-live-preference-form"
    >
      <FieldSet className="gap-3">
        <FieldLegend className={DIALOG_SECTION_TITLE_CLASS} variant="label">
          {t("workbench.widget.customCard.blocksSection")}
        </FieldLegend>
        {blocks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("workbench.widget.customCard.noBlocks")}
          </p>
        ) : (
          <ItemGroup className="gap-3">
            {blocks.map((block, index) => (
              <EditableBlockRow
                block={block}
                descriptors={metrics}
                index={index}
                key={block.id}
                lastIndex={blocks.length - 1}
                onMove={(delta) =>
                  persistBlocks(moveBlock(blocks, index, delta))
                }
                onRemove={() =>
                  persistBlocks(blocks.filter((b) => b.id !== block.id))
                }
                onUpdate={(patch) => updateBlock(block.id, patch)}
                t={t}
              />
            ))}
          </ItemGroup>
        )}
      </FieldSet>
    </div>
  );
}
