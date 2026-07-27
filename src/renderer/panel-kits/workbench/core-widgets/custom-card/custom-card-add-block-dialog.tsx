import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FIELD_GROUP_CLASS,
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
import { Field, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import i18next from "i18next";
import { useMemo, useRef, useState } from "react";
import { useContentDialogFooter } from "@/components/common/use-content-dialog-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import { useMetricDescriptors } from "@/lib/workbench/metric-registry.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { MetricPreviewValue } from "./custom-card-block-editor.tsx";
import {
  blockAcceptsMetric,
  type CustomCardBlock,
  type CustomCardBlockType,
  customCardBlockTypeSchema,
} from "./custom-card-params.ts";

const ADD_BLOCK_DIALOG_ID = "workbench.custom-card.add-block";

function AddBlockDialogBody({
  close,
  setFooter,
  onConfirm,
}: AppContentDialogRenderProps & {
  onConfirm: (block: CustomCardBlock) => void;
}) {
  const t = useT();
  const locale = i18next.language || "en";
  const metrics = useMetricDescriptors();
  const [type, setType] = useState<CustomCardBlockType>("kpi");
  const [metricId, setMetricId] = useState("");
  const [label, setLabel] = useState("");

  const compatibleMetrics = useMemo(
    () => metrics.filter((descriptor) => blockAcceptsMetric(type, descriptor)),
    [metrics, type]
  );
  const metricValid = compatibleMetrics.some((d) => d.id === metricId);

  const blockTypeLabel = (blockType: CustomCardBlockType): string =>
    t(`workbench.widget.customCard.blockType.${blockType}`);

  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const formId = "custom-card-add-block-form";

  const submitAdd = (): void => {
    if (!metricValid) return;
    const trimmedLabel = label.trim();
    onConfirmRef.current({
      id: crypto.randomUUID(),
      metricId,
      type,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
    });
    close(true);
  };

  const footer = useMemo(
    () => (
      <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
        <Button
          onClick={() => {
            close(null);
          }}
          type="button"
          variant="outline"
        >
          {t("dialog.cancel")}
        </Button>
        <Button
          data-testid="custom-card-settings-add-confirm"
          disabled={!metricValid}
          form={formId}
          type="submit"
        >
          {t("workbench.widget.customCard.addConfirm")}
        </Button>
      </div>
    ),
    [close, metricValid, t]
  );
  useContentDialogFooter(setFooter, footer);

  return (
    <form
      className={DIALOG_COMMIT_FORM_CLASS}
      data-slot="dialog-commit-form"
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submitAdd();
      }}
    >
      <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
        <Field>
          <FieldLabel htmlFor="custom-card-add-block-type">
            {t("workbench.widget.customCard.blockTypeLabel")}
          </FieldLabel>
          <Select
            onValueChange={(next) => {
              setType(customCardBlockTypeSchema.parse(next));
              setMetricId("");
            }}
            value={type}
          >
            <SelectTrigger className="w-full" id="custom-card-add-block-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {customCardBlockTypeSchema.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {blockTypeLabel(option)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="custom-card-add-metric">
            {t("workbench.widget.customCard.metricLabel")}
          </FieldLabel>
          <Select
            onValueChange={setMetricId}
            value={metricValid ? metricId : ""}
          >
            <SelectTrigger
              className="w-full"
              data-testid="custom-card-settings-metric"
              id="custom-card-add-metric"
            >
              <SelectValue
                placeholder={
                  compatibleMetrics.length === 0
                    ? t("workbench.widget.customCard.noCompatibleMetrics", {
                        type: blockTypeLabel(type),
                      })
                    : t("workbench.widget.customCard.metricPlaceholder")
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {compatibleMetrics.map((descriptor) => (
                  <SelectItem key={descriptor.id} value={descriptor.id}>
                    {t(descriptor.titleKey)}
                    <MetricPreviewValue
                      descriptorId={descriptor.id}
                      format={descriptor.format}
                      locale={locale}
                    />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="custom-card-add-label">
            {t("workbench.widget.customCard.labelLabel")}
          </FieldLabel>
          <Input
            id="custom-card-add-label"
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("workbench.widget.customCard.labelPlaceholder")}
            value={label}
          />
        </Field>
      </FieldGroup>
    </form>
  );
}

export function openAddBlockDialog(
  onConfirm: (block: CustomCardBlock) => void
): void {
  openAppContentDialog({
    content: (props) => <AddBlockDialogBody {...props} onConfirm={onConfirm} />,
    description: i18next.t("workbench.widget.customCard.addDialogDescription"),
    id: ADD_BLOCK_DIALOG_ID,
    size: "default",
    title: i18next.t("workbench.widget.customCard.addDialogTitle"),
  });
}
