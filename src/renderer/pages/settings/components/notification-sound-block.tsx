/**
 * 通知设置 · 提示音子块（开关 / 音色 / 试听）。
 * soundEnabled=false 时仍可改音色与试听内置音；system 禁用应用内试听。
 */
import { Button } from "@pier/ui/button.tsx";
import { FieldDescription, FieldLegend, FieldSet } from "@pier/ui/field.tsx";
import { isPreviewableAttentionSoundId } from "@shared/attention-sound-catalog.ts";
import {
  ATTENTION_SOUND_IDS,
  type AttentionSoundId,
} from "@shared/contracts/agent-attention.ts";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { playAttentionSound } from "@/lib/attention/play-attention-sound.ts";
import { patchAttention } from "@/pages/settings/components/attention-patch.ts";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useAgentAttentionPreferencesStore } from "@/stores/agent-attention-preferences.store.ts";

export function NotificationSoundBlock() {
  const t = useT();
  const agentAttention = useAgentAttentionPreferencesStore(
    (s) => s.agentAttention
  );
  const setAgentAttention = useAgentAttentionPreferencesStore(
    (s) => s.setAgentAttention
  );
  const failedTitle = t("settings.notifications.saveFailed");
  const { soundEnabled, soundId } = agentAttention;
  const canPreview = isPreviewableAttentionSoundId(soundId);

  const soundOptions = ATTENTION_SOUND_IDS.map((id) => ({
    label: t(`settings.notifications.sound.${id}`),
    value: id,
  }));

  const preview = () => {
    if (!isPreviewableAttentionSoundId(soundId)) {
      return;
    }
    playAttentionSound(soundId, { force: true }).catch(() => {
      toast.error(t("settings.notifications.soundPreviewFailed"));
    });
  };

  return (
    <FieldSet className="gap-4">
      <div className="flex flex-col gap-1">
        <FieldLegend className="mb-0" variant="label">
          {t("settings.notifications.soundGroup")}
        </FieldLegend>
        <FieldDescription>
          {t("settings.notifications.soundGroupDesc")}
        </FieldDescription>
      </div>
      <SwitchRow
        checked={soundEnabled}
        description={t("settings.notifications.soundEnabledDesc")}
        id="settings-attention-sound-enabled"
        label={t("settings.notifications.soundEnabled")}
        onCheckedChange={(checked) => {
          patchAttention(
            { soundEnabled: checked },
            setAgentAttention,
            failedTitle
          ).catch(() => undefined);
        }}
      />
      <SelectRow<AttentionSoundId>
        description={t("settings.notifications.soundIdDesc")}
        id="settings-attention-sound-id"
        label={t("settings.notifications.soundId")}
        onChange={(next) => {
          patchAttention(
            { soundId: next },
            setAgentAttention,
            failedTitle
          ).catch(() => undefined);
        }}
        options={soundOptions}
        triggerWidth="w-[160px]"
        value={soundId}
      />
      <div className="flex flex-col gap-2">
        <Button
          className="w-fit"
          disabled={!canPreview}
          onClick={() => {
            preview();
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("settings.notifications.soundPreview")}
        </Button>
        {canPreview ? null : (
          <p className="text-muted-foreground text-sm">
            {t("settings.notifications.soundPreviewSystemHint")}
          </p>
        )}
      </div>
    </FieldSet>
  );
}
