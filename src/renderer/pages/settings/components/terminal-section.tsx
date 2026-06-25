import type {
  TerminalCursorStyle,
  TerminalNewCwdPolicy,
} from "@shared/contracts/preferences.ts";
import { useState } from "react";
import { Card, CardContent } from "@/components/primitives/card.tsx";
import {
  FieldDescription,
  FieldSeparator,
  FieldSet,
} from "@/components/primitives/field.tsx";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";

const SCROLLBACK_MIN = 10;
const SCROLLBACK_MAX = 512;
const CURSOR_STYLE_OPTIONS = [
  "block",
  "bar",
  "underline",
] satisfies TerminalCursorStyle[];
const NEW_CWD_POLICY_OPTIONS = [
  "activeTerminal",
  "shellDefault",
] satisfies TerminalNewCwdPolicy[];

function clampScrollback(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, n));
}

function TerminalScrollbackRow() {
  const t = useT();
  const persisted = useTerminalPreferencesStore((s) => s.terminalScrollbackMb);
  const setTerminalScrollbackMb = useTerminalPreferencesStore(
    (s) => s.setTerminalScrollbackMb
  );
  const [draft, setDraft] = useState(String(persisted));
  const [prev, setPrev] = useState(persisted);
  if (persisted !== prev) {
    setPrev(persisted);
    setDraft(String(persisted));
  }
  return (
    <InputRow
      description={t("settings.row.terminalScrollbackMbDesc")}
      id="settings-terminal-scrollback-mb"
      inputClassName="w-24"
      inputMode="numeric"
      label={t("settings.row.terminalScrollbackMb")}
      max={SCROLLBACK_MAX}
      min={SCROLLBACK_MIN}
      onBlur={(raw) => {
        const next = clampScrollback(raw, persisted);
        setDraft(String(next));
        if (next !== persisted) {
          setTerminalScrollbackMb(next).catch(() => undefined);
        }
      }}
      onChange={setDraft}
      placeholder="64"
      step={1}
      type="number"
      value={draft}
    />
  );
}

export function TerminalSection() {
  const t = useT();
  const terminalCursorStyle = useTerminalPreferencesStore(
    (s) => s.terminalCursorStyle
  );
  const terminalCursorBlink = useTerminalPreferencesStore(
    (s) => s.terminalCursorBlink
  );
  const terminalPasteProtection = useTerminalPreferencesStore(
    (s) => s.terminalPasteProtection
  );
  const terminalNewCwdPolicy = useTerminalPreferencesStore(
    (s) => s.terminalNewCwdPolicy
  );
  const setTerminalCursorStyle = useTerminalPreferencesStore(
    (s) => s.setTerminalCursorStyle
  );
  const setTerminalCursorBlink = useTerminalPreferencesStore(
    (s) => s.setTerminalCursorBlink
  );
  const setTerminalPasteProtection = useTerminalPreferencesStore(
    (s) => s.setTerminalPasteProtection
  );
  const setTerminalNewCwdPolicy = useTerminalPreferencesStore(
    (s) => s.setTerminalNewCwdPolicy
  );

  return (
    <div className="px-4 pb-4" id="terminal">
      <h1 className="mb-4 text-xl">{t("settings.section.terminal")}</h1>
      <Card>
        <CardContent>
          <FieldSet>
            <SelectRow<TerminalCursorStyle>
              description={t("settings.row.terminalCursorStyleDesc")}
              id="settings-terminal-cursor-style"
              label={t("settings.row.terminalCursorStyle")}
              onChange={(next) => {
                setTerminalCursorStyle(next).catch(() => undefined);
              }}
              options={CURSOR_STYLE_OPTIONS.map((value) => ({
                value,
                label: t(`settings.terminal.cursorStyle.${value}`),
              }))}
              value={terminalCursorStyle}
            />
            <FieldSeparator />
            <SwitchRow
              checked={terminalCursorBlink}
              description={t("settings.row.terminalCursorBlinkDesc")}
              id="settings-terminal-cursor-blink"
              label={t("settings.row.terminalCursorBlink")}
              onCheckedChange={(next) => {
                setTerminalCursorBlink(next).catch(() => undefined);
              }}
            />
            <FieldSeparator />
            <TerminalScrollbackRow />
            <FieldDescription>
              {t("settings.row.terminalScrollbackRuntimeNote")}
            </FieldDescription>
            <FieldSeparator />
            <SwitchRow
              checked={terminalPasteProtection}
              description={t("settings.row.terminalPasteProtectionDesc")}
              id="settings-terminal-paste-protection"
              label={t("settings.row.terminalPasteProtection")}
              onCheckedChange={(next) => {
                setTerminalPasteProtection(next).catch(() => undefined);
              }}
            />
            <FieldSeparator />
            <SelectRow<TerminalNewCwdPolicy>
              description={t("settings.row.terminalNewCwdPolicyDesc")}
              id="settings-terminal-new-cwd-policy"
              label={t("settings.row.terminalNewCwdPolicy")}
              onChange={(next) => {
                setTerminalNewCwdPolicy(next).catch(() => undefined);
              }}
              options={NEW_CWD_POLICY_OPTIONS.map((value) => ({
                value,
                label: t(`settings.terminal.newCwdPolicy.${value}`),
              }))}
              triggerWidth="w-[180px]"
              value={terminalNewCwdPolicy}
            />
          </FieldSet>
        </CardContent>
      </Card>
    </div>
  );
}
