import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useLspPreferencesStore } from "@/stores/lsp-preferences.store.ts";

const MAX_WORKSPACES = 32;
const IDLE_RELEASE_MINUTES_MAX = 24 * 60;
const IDLE_RELEASE_MINUTES_MIN = 1;
const MINUTE_MS = 60_000;

function normalizeWorkspaceLimit(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(MAX_WORKSPACES, Math.max(0, parsed));
}

function normalizeIdleReleaseMinutes(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(
    IDLE_RELEASE_MINUTES_MAX,
    Math.max(IDLE_RELEASE_MINUTES_MIN, parsed)
  );
}

function LspWorkspaceLimitRow({
  description,
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  description: string;
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: number) => Promise<void>;
  value: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [previous, setPrevious] = useState(value);
  if (value !== previous) {
    setPrevious(value);
    setDraft(String(value));
  }

  return (
    <InputRow
      description={description}
      disabled={disabled}
      id={id}
      inputClassName="w-24"
      inputMode="numeric"
      label={label}
      max={MAX_WORKSPACES}
      min={0}
      onBlur={(raw) => {
        const next = normalizeWorkspaceLimit(raw, value);
        setDraft(String(next));
        if (next !== value) {
          onChange(next).catch(() => undefined);
        }
      }}
      onChange={setDraft}
      step={1}
      type="number"
      value={draft}
    />
  );
}

function LspIdleReleaseRow({
  description,
  disabled,
  label,
  onChange,
  value,
}: {
  description: string;
  disabled: boolean;
  label: string;
  onChange: (value: number) => Promise<void>;
  value: number;
}) {
  const minutes = Math.round(value / MINUTE_MS);
  const [draft, setDraft] = useState(String(minutes));
  const [previous, setPrevious] = useState(minutes);
  if (minutes !== previous) {
    setPrevious(minutes);
    setDraft(String(minutes));
  }

  return (
    <InputRow
      description={description}
      disabled={disabled}
      id="settings-lsp-idle-release-minutes"
      inputClassName="w-24"
      inputMode="numeric"
      label={label}
      max={IDLE_RELEASE_MINUTES_MAX}
      min={IDLE_RELEASE_MINUTES_MIN}
      onBlur={(raw) => {
        const nextMinutes = normalizeIdleReleaseMinutes(raw, minutes);
        setDraft(String(nextMinutes));
        const nextMs = nextMinutes * MINUTE_MS;
        if (nextMs !== value) {
          onChange(nextMs).catch(() => undefined);
        }
      }}
      onChange={setDraft}
      step={1}
      type="number"
      value={draft}
    />
  );
}

/**
 * Host language-service policy only (enable + resource limits).
 * Language coverage is plugins + editor status chip — not a settings inventory
 * or user-authored server form.
 */
export function LspSettingsCard() {
  const t = useT();
  const enabled = useLspPreferencesStore((s) => s.enabled);
  const idleReleaseMs = useLspPreferencesStore((s) => s.idleReleaseMs);
  const worktreesEnabled = useLspPreferencesStore((s) => s.worktreesEnabled);
  const maxLocalWorkspaces = useLspPreferencesStore(
    (s) => s.maxLocalWorkspaces
  );
  const maxRemoteWorkspaces = useLspPreferencesStore(
    (s) => s.maxRemoteWorkspaces
  );
  const setEnabled = useLspPreferencesStore((s) => s.setEnabled);
  const setIdleReleaseMs = useLspPreferencesStore((s) => s.setIdleReleaseMs);
  const setWorktreesEnabled = useLspPreferencesStore(
    (s) => s.setWorktreesEnabled
  );
  const setMaxLocalWorkspaces = useLspPreferencesStore(
    (s) => s.setMaxLocalWorkspaces
  );
  const setMaxRemoteWorkspaces = useLspPreferencesStore(
    (s) => s.setMaxRemoteWorkspaces
  );
  const reportUpdateFailure = (error: unknown): void => {
    showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: t("settings.row.lspUpdateFailed"),
    }).catch(() => undefined);
  };

  return (
    <Card>
      <CardContent>
        <FieldSet>
          <div className="space-y-1">
            <p className="font-medium text-sm">
              {t("settings.row.lspHostSectionTitle")}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("settings.row.lspHostSectionDesc")}
            </p>
          </div>
          <SwitchRow
            checked={enabled}
            description={t("settings.row.lspEnabledDesc")}
            id="settings-lsp-enabled"
            label={t("settings.row.lspEnabled")}
            onCheckedChange={(next) => {
              setEnabled(next).catch(reportUpdateFailure);
            }}
          />
          <SwitchRow
            checked={worktreesEnabled}
            description={t("settings.row.lspWorktreesEnabledDesc")}
            disabled={!enabled}
            id="settings-lsp-worktrees-enabled"
            label={t("settings.row.lspWorktreesEnabled")}
            onCheckedChange={(next) => {
              setWorktreesEnabled(next).catch(reportUpdateFailure);
            }}
          />
          <FieldSeparator />
          <div className="space-y-1">
            <p className="font-medium text-sm">
              {t("settings.row.lspAdvancedTitle")}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("settings.row.lspAdvancedDesc")}
            </p>
          </div>
          <LspIdleReleaseRow
            description={t("settings.row.lspIdleReleaseMinutesDesc")}
            disabled={!enabled}
            label={t("settings.row.lspIdleReleaseMinutes")}
            onChange={async (next) => {
              try {
                await setIdleReleaseMs(next);
              } catch (error) {
                reportUpdateFailure(error);
              }
            }}
            value={idleReleaseMs}
          />
          <LspWorkspaceLimitRow
            description={t("settings.row.lspMaxLocalWorkspacesDesc")}
            disabled={!enabled}
            id="settings-lsp-max-local-workspaces"
            label={t("settings.row.lspMaxLocalWorkspaces")}
            onChange={async (next) => {
              try {
                await setMaxLocalWorkspaces(next);
              } catch (error) {
                reportUpdateFailure(error);
              }
            }}
            value={maxLocalWorkspaces}
          />
          <LspWorkspaceLimitRow
            description={t("settings.row.lspMaxRemoteWorkspacesDesc")}
            disabled={!enabled}
            id="settings-lsp-max-remote-workspaces"
            label={t("settings.row.lspMaxRemoteWorkspaces")}
            onChange={async (next) => {
              try {
                await setMaxRemoteWorkspaces(next);
              } catch (error) {
                reportUpdateFailure(error);
              }
            }}
            value={maxRemoteWorkspaces}
          />
        </FieldSet>
      </CardContent>
    </Card>
  );
}
