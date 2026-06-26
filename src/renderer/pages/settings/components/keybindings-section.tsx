import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/primitives/button.tsx";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/primitives/card.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/primitives/field.tsx";
import { Separator } from "@/components/primitives/separator.tsx";
import { ShortcutInput } from "@/components/primitives/shortcut-input.tsx";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import {
  formatChordParts,
  stringifyChord,
} from "@/lib/keybindings/formatter.ts";
import { chordFromEvent } from "@/lib/keybindings/matcher.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { useKeybindingPreferencesStore } from "@/stores/keybinding-preferences.store.ts";

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

const CONFLICT_PREFIX = "Shortcut already used by ";
const PIER_ACTION_ID_PREFIX = /^pier\./;

function hasModifier(chord: ReturnType<typeof chordFromEvent>): boolean {
  return chord.cmdOrCtrl || chord.ctrl || chord.alt || chord.shift;
}

function useActions(): readonly Action[] {
  useSyncExternalStore(
    (cb) => actionRegistry.subscribe(cb),
    () => actionRegistry.getVersion(),
    () => 0
  );
  useSyncExternalStore(
    (cb) => keybindingRegistry.subscribe(cb),
    () => keybindingRegistry.getVersion(),
    () => 0
  );
  return actionRegistry
    .list()
    .filter((action) => action.id.startsWith("pier."))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.title().localeCompare(b.title()) ||
        a.id.localeCompare(b.id)
    );
}

function currentShortcutParts(actionId: string): readonly string[] {
  const binding = keybindingRegistry.getBindingsFor(actionId)[0];
  return binding ? formatChordParts(binding.chord) : [];
}

function localizedDescription(
  action: Action,
  t: ReturnType<typeof useT>
): string {
  const key = `settings.keybindings.description.${action.id.replace(
    PIER_ACTION_ID_PREFIX,
    ""
  )}`;
  const label = t(key);
  if (label !== key) {
    return label;
  }
  const categoryKey = `commandPalette.category.${action.category.toLowerCase()}`;
  const category = t(categoryKey);
  return t("settings.keybindings.descriptionDefault", {
    category: category === categoryKey ? action.category : category,
  });
}

function localizedError(
  raw: string,
  actionsById: ReadonlyMap<string, Action>,
  t: ReturnType<typeof useT>
): string {
  if (raw.startsWith(CONFLICT_PREFIX)) {
    const commandId = raw.slice(CONFLICT_PREFIX.length);
    return t("settings.keybindings.errorConflict", {
      command: actionsById.get(commandId)?.title() ?? commandId,
    });
  }
  return raw;
}

export function KeybindingsSection() {
  const t = useT();
  const actions = useActions();
  const actionsById = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions]
  );
  const [rowError, setRowError] = useState<{
    commandId: string;
    message: string;
  } | null>(null);
  const recordingCommandId = useKeybindingPreferencesStore(
    (s) => s.recordingCommandId
  );
  const startRecording = useKeybindingPreferencesStore((s) => s.startRecording);
  const cancelRecording = useKeybindingPreferencesStore(
    (s) => s.cancelRecording
  );
  const clearBinding = useKeybindingPreferencesStore((s) => s.clearBinding);
  const resetBinding = useKeybindingPreferencesStore((s) => s.resetBinding);
  const resetAllBindings = useKeybindingPreferencesStore(
    (s) => s.resetAllBindings
  );
  const setBinding = useKeybindingPreferencesStore((s) => s.setBinding);
  const hasUserEntry = useKeybindingPreferencesStore((s) => s.hasUserEntry);
  const hasAnyUserEntry = useKeybindingPreferencesStore(
    (s) => s.userKeymap.length > 0
  );

  useEffect(() => {
    if (!recordingCommandId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRowError(null);
        cancelRecording();
        return;
      }
      if (MODIFIER_CODES.has(event.code)) {
        return;
      }
      const chord = chordFromEvent(event);
      if (!hasModifier(chord)) {
        setRowError({
          commandId: recordingCommandId,
          message: t("settings.keybindings.errorNeedsModifier"),
        });
        return;
      }
      setBinding(recordingCommandId, stringifyChord(chord), "global")
        .then((result) => {
          if (result.ok) {
            setRowError(null);
            return;
          }
          setRowError({
            commandId: recordingCommandId,
            message: localizedError(
              result.error ?? t("settings.keybindings.errorUnknown"),
              actionsById,
              t
            ),
          });
        })
        .catch((err) => {
          setRowError({
            commandId: recordingCommandId,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actionsById, cancelRecording, recordingCommandId, setBinding, t]);

  return (
    <div className="px-4 pb-4" id="keybindings">
      <h1 className="mb-4 text-xl">{t("settings.section.keybindings")}</h1>
      <Card size="sm">
        <CardContent className="px-0">
          <div>
            {actions.map((action, index) => {
              const title = action.title();
              const isRecording = recordingCommandId === action.id;
              const custom = hasUserEntry(action.id);
              const hasBinding =
                keybindingRegistry.getBindingsFor(action.id).length > 0;
              const error =
                rowError?.commandId === action.id ? rowError.message : null;
              return (
                <Fragment key={action.id}>
                  {index > 0 ? <Separator className="bg-border/70" /> : null}
                  <div
                    className="px-4 py-3"
                    data-testid={`keybinding-row-${action.id}`}
                  >
                    <Field
                      className="items-start gap-4"
                      data-invalid={error ? true : undefined}
                      orientation="horizontal"
                    >
                      <FieldContent className="min-w-0 gap-1">
                        <FieldLabel>{title}</FieldLabel>
                        <FieldDescription className="text-xs">
                          {localizedDescription(action, t)}
                        </FieldDescription>
                        {error ? <FieldError>{error}</FieldError> : null}
                      </FieldContent>
                      <ShortcutInput
                        canClear={hasBinding}
                        canReset={custom}
                        clearLabel={`${t("settings.keybindings.clear")} ${title}`}
                        isRecording={isRecording}
                        keyParts={currentShortcutParts(action.id)}
                        onClear={() => {
                          setRowError(null);
                          clearBinding(action.id).catch(() => undefined);
                        }}
                        onRecord={() => {
                          setRowError(null);
                          startRecording(action.id);
                        }}
                        onReset={() => {
                          setRowError(null);
                          resetBinding(action.id).catch(() => undefined);
                        }}
                        placeholder={t("settings.keybindings.unassigned")}
                        recordingLabel={t("settings.keybindings.recording")}
                        recordLabel={`${t("settings.keybindings.record")} ${title}`}
                        resetLabel={`${t("settings.keybindings.reset")} ${title}`}
                        tooltipLabel={t("settings.keybindings.change")}
                      />
                    </Field>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </CardContent>
        <CardFooter className="justify-end border-border/70 border-t px-4 py-3">
          <Button
            disabled={!hasAnyUserEntry}
            onClick={() => {
              setRowError(null);
              resetAllBindings().catch(() => undefined);
            }}
            type="button"
            variant="outline"
          >
            {t("settings.keybindings.resetAll")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
