import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardFooter } from "@pier/ui/card.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { ShortcutInput } from "@pier/ui/shortcut-input.tsx";
import { Fragment, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  actionRegistry,
  getActionRegistryVersion,
  subscribeActionRegistry,
} from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import {
  formatChordParts,
  stringifyChord,
} from "@/lib/keybindings/formatter.ts";
import { chordFromEvent } from "@/lib/keybindings/matcher.ts";
import {
  getKeybindingRegistryVersion,
  keybindingRegistry,
  subscribeKeybindingRegistry,
} from "@/lib/keybindings/registry.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
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
  const actionVersion = useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    () => 0
  );
  const keybindingVersion = useSyncExternalStore(
    subscribeKeybindingRegistry,
    getKeybindingRegistryVersion,
    () => 0
  );
  return useMemo(
    () =>
      readVersionedSnapshot(actionVersion + keybindingVersion, () =>
        actionRegistry
          .list()
          .filter((action) => action.id.startsWith("pier."))
          .sort(
            (a, b) =>
              a.category.localeCompare(b.category) ||
              a.title().localeCompare(b.title()) ||
              a.id.localeCompare(b.id)
          )
      ),
    [actionVersion, keybindingVersion]
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
        cancelRecording();
        return;
      }
      if (MODIFIER_CODES.has(event.code)) {
        return;
      }
      const chord = chordFromEvent(event);
      if (!hasModifier(chord)) {
        toast.error(t("settings.keybindings.errorNeedsModifier"));
        return;
      }
      setBinding(recordingCommandId, stringifyChord(chord), "global")
        .then((result) => {
          if (result.ok) {
            return;
          }
          toast.error(
            localizedError(
              result.error ?? t("settings.keybindings.errorUnknown"),
              actionsById,
              t
            )
          );
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : String(err));
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
              return (
                <Fragment key={action.id}>
                  {index > 0 ? (
                    <Separator className="mx-(--card-spacing) bg-border/70 data-horizontal:w-auto" />
                  ) : null}
                  <div
                    className="px-4 py-3"
                    data-testid={`keybinding-row-${action.id}`}
                  >
                    <Field
                      className="items-start gap-4"
                      orientation="horizontal"
                    >
                      <FieldContent className="min-w-0 gap-1">
                        <FieldLabel>{title}</FieldLabel>
                        <FieldDescription className="text-xs">
                          {localizedDescription(action, t)}
                        </FieldDescription>
                      </FieldContent>
                      <ShortcutInput
                        canClear={hasBinding}
                        canReset={custom}
                        clearLabel={`${t("settings.keybindings.clear")} ${title}`}
                        isRecording={isRecording}
                        keyParts={currentShortcutParts(action.id)}
                        onCancelRecord={cancelRecording}
                        onClear={() => {
                          clearBinding(action.id).catch(() => undefined);
                        }}
                        onRecord={() => {
                          startRecording(action.id);
                        }}
                        onReset={() => {
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
        <CardFooter className="justify-end border-border/70 border-t">
          <Button
            disabled={!hasAnyUserEntry}
            onClick={() => {
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
