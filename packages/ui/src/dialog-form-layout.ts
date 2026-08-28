/**
 * Shared dialog form density tokens.
 *
 * Two interaction models only (see AGENTS.md 「弹窗表单规范」):
 * - Commit form: draft + sticky footer 取消|主按钮（content dialog）
 * - Live preference: change applies immediately, no primary footer
 *
 * Field layout for multi-field dialogs (content dialog) is the same
 * vertical stack — only save timing differs.
 * Settings *page* dense rows may still use horizontal *Row helpers.
 *
 * Import from `@pier/ui/dialog-form-layout.ts` so host and plugins share one
 * class vocabulary. Package exports must include this path (see package.json).
 * Do not invent parallel gap / footer stacks in call sites.
 */

/**
 * Outer stack for multi-field dialog forms (worktree, skill create, SSH).
 */
export const DIALOG_COMMIT_FORM_CLASS = "flex min-w-0 flex-col gap-6";

/** FieldGroup gap inside a vertical dialog form. */
export const DIALOG_COMMIT_FIELD_GROUP_CLASS = "gap-4";

/**
 * Outer stack for dense settings-page preference panels (horizontal rows).
 * Do not use this inside content-dialog forms (those stay vertical).
 */
export const DIALOG_PREFERENCE_FORM_CLASS = "flex min-w-0 flex-col gap-0";

/** FieldGroup gap for settings-page horizontal scalar rows. */
export const DIALOG_PREFERENCE_FIELD_GROUP_CLASS = "gap-3";

/**
 * Sticky footer action cluster (right-aligned).
 * Host `AppContentDialogHost` owns DialogFooter chrome; pass this as setFooter root.
 */
export const DIALOG_FOOTER_ACTIONS_CLASS =
  "flex w-full flex-wrap justify-end gap-2";

/**
 * Flat section title for dialog bodies (no nested Card chrome).
 * Dialog shell is already a bordered surface.
 */
export const DIALOG_SECTION_TITLE_CLASS = "mb-0 font-medium text-sm";
