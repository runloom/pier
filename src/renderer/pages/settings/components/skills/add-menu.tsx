import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  type ImportCandidateView,
  useProjectSkillsStore,
} from "@/stores/project-skills/store.ts";
import { openBindFromLibraryDialog } from "./bind-from-library-dialog.tsx";
import { discardPreparedCandidate } from "./candidate-lifecycle.ts";
import { openSkillsCreateSkillDialog } from "./create-dialog.tsx";
import { skillsErrorMessage } from "./error-copy.ts";

function isImportCandidate(value: unknown): value is ImportCandidateView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.token === "string" && typeof record.skillId === "string";
}

function beginReview(candidate: ImportCandidateView): void {
  useProjectSkillsStore.setState({ errorMessage: null });
  useProjectSkillsStore.getState().registerCandidate(candidate);
  useProjectSkillsStore.getState().setMode({
    kind: "import-review",
    candidate,
  });
}

/**
 * Primary “Add skill” control. Projects shell places this on the tab row
 * (same slot as Environment Save); standalone skills header keeps it too.
 */
export function SkillsAddMenu({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const projectRef = useProjectSkillsStore((s) => s.projectRef);
  const writesFrozen = useProjectSkillsStore((s) => s.writesFrozen);
  const reloadRequired = useProjectSkillsStore((s) => s.reloadRequired);
  const planPending = useProjectSkillsStore((s) => s.planPending);
  const applyPending = useProjectSkillsStore((s) => s.applyPending);
  const [preparePending, setPreparePending] = useState(false);
  const prepareMountedRef = useRef(true);
  const prepareRequestRef = useRef(0);

  useEffect(() => {
    prepareMountedRef.current = true;
    return () => {
      prepareMountedRef.current = false;
      prepareRequestRef.current += 1;
    };
  }, []);

  const writesDisabled =
    disabled ||
    !projectRef ||
    writesFrozen ||
    reloadRequired ||
    planPending ||
    applyPending ||
    preparePending;

  function reviewCandidate(raw: unknown): void {
    if (!isImportCandidate(raw)) {
      showAppAlert({
        title: t("settings.skills.importFailed"),
        body: t("settings.skills.importInvalid"),
      }).catch(() => undefined);
      return;
    }
    beginReview(raw);
  }

  async function handleImportFolder() {
    if (!projectRef || writesDisabled) return;
    const requestId = prepareRequestRef.current + 1;
    prepareRequestRef.current = requestId;
    const requestProject = projectRef;
    setPreparePending(true);
    try {
      const candidate =
        await window.pier.projectSkills.importPrepare(requestProject);
      if (!candidate) return;
      if (
        prepareRequestRef.current !== requestId ||
        useProjectSkillsStore.getState().projectRef?.realPath !==
          requestProject.realPath ||
        useProjectSkillsStore.getState().mode.kind !== "detail"
      ) {
        await discardPreparedCandidate(requestProject, candidate);
        return;
      }
      reviewCandidate(candidate);
    } catch (error) {
      if (prepareRequestRef.current === requestId) {
        await showAppAlert({
          title: t("settings.skills.importFailed"),
          body: skillsErrorMessage(
            error,
            t,
            "settings.skills.importFailedBody"
          ),
        });
      }
    } finally {
      if (prepareRequestRef.current === requestId) {
        setPreparePending(false);
      }
    }
  }

  async function handleNewBlank() {
    if (!projectRef || writesDisabled) return;
    await openSkillsCreateSkillDialog();
  }

  async function handleBindFromLibrary() {
    if (!projectRef || writesDisabled) return;
    await openBindFromLibraryDialog(
      projectRef,
      t("settings.skills.bindFromLibraryTitle")
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={writesDisabled} size="sm" type="button">
          <Plus data-icon="inline-start" />
          {t("settings.skills.addSkill")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              handleNewBlank().catch(() => undefined);
            }}
          >
            {t("settings.skills.addBlank")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              handleBindFromLibrary().catch(() => undefined);
            }}
          >
            {t("settings.skills.bindFromLibrary")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              handleImportFolder().catch(() => undefined);
            }}
          >
            {t("settings.skills.addFromFolder")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
