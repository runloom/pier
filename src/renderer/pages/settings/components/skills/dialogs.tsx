import type {
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { SkillsSkillDetail } from "./detail.tsx";
import { SkillsReadonlyDetail } from "./readonly-detail.tsx";

/**
 * Project · managed / system skill open — same secondary content-dialog shell
 * as Pier Home (list stays underneath; CodeMirror for SKILL.md).
 */
export function openSkillsManagedSkillDialog(skillId: string): Promise<null> {
  function Body({
    close,
    setFooter,
    setOnDismissRequest,
    setTitle,
  }: AppContentDialogRenderProps) {
    return (
      <SkillsSkillDetail
        onBack={() => {
          close(null);
        }}
        presentation="dialog"
        setFooter={setFooter}
        setOnDismissRequest={setOnDismissRequest}
        setTitle={setTitle}
        skillId={skillId}
      />
    );
  }

  return openAppContentDialog({
    content: Body,
    id: `project-managed-skill:${skillId}`,
    size: "lg",
    title: skillId,
  }).result as Promise<null>;
}

/**
 * Project · unmanaged discovery open (read-only). Same dialog shell as Home.
 */
export function openSkillsReadonlySkillDialog(
  target:
    | { kind: "project"; entry: UnmanagedSkillView }
    | { kind: "user-global"; entry: UserGlobalSkillView },
  options: {
    adoptPending: boolean;
    onAdopt: (entry: UnmanagedSkillView) => void;
  }
): Promise<null> {
  const title = target.entry.name || target.entry.directoryName;

  function Body({ close, setFooter }: AppContentDialogRenderProps) {
    return (
      <SkillsReadonlyDetail
        adoptPending={options.adoptPending}
        onAdopt={(entry) => {
          close(null);
          options.onAdopt(entry);
        }}
        onBack={() => {
          close(null);
        }}
        presentation="dialog"
        setFooter={setFooter}
        target={target}
      />
    );
  }

  return openAppContentDialog({
    content: Body,
    id: `project-readonly-skill:${target.kind}:${target.entry.root}/${target.entry.directoryName}`,
    size: "lg",
    title,
  }).result as Promise<null>;
}
