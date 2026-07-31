import type { ActionInvocation } from "@/lib/actions/types.ts";
import { hasSpecializedEditPipeline } from "./surface-profiles.ts";

export type SelectionTextProvider = () => string;
export type SelectionSelectAllProvider = () => boolean;

interface SelectionTextRegistration {
  panelId: string;
  provider: SelectionTextProvider;
}

interface SelectionSelectAllRegistration {
  panelId: string;
  provider: SelectionSelectAllProvider;
}

const selectionTextProviders = new Set<SelectionTextRegistration>();
const selectionSelectAllProviders = new Set<SelectionSelectAllRegistration>();

/**
 * 注册非 DOM 选区提供者（如 Pierre Diff 行选区），按 panelId 作用域隔离。
 * 返回 disposer；popup 前只取匹配 panelId 的第一个非空文本。
 */
export function registerSelectionTextProvider(
  panelId: string,
  provider: SelectionTextProvider
): () => void {
  const registration = { panelId, provider };
  selectionTextProviders.add(registration);
  return () => {
    selectionTextProviders.delete(registration);
  };
}

/**
 * 注册面板级「全选」实现（如 Pierre Diff selectAll），按 panelId 作用域隔离。
 */
export function registerSelectionSelectAllProvider(
  panelId: string,
  provider: SelectionSelectAllProvider
): () => void {
  const registration = { panelId, provider };
  selectionSelectAllProviders.add(registration);
  return () => {
    selectionSelectAllProviders.delete(registration);
  };
}

function captureProviderSelectionText(panelId: string | undefined): string {
  if (!panelId) {
    return "";
  }
  for (const registration of selectionTextProviders) {
    if (registration.panelId !== panelId) {
      continue;
    }
    try {
      const text = registration.provider().replace(/\u00a0/g, " ");
      if (text.length > 0) {
        return text;
      }
    } catch {
      // 单个 provider 失败不阻断其它路径
    }
  }
  return "";
}

/**
 * 右键打开菜单瞬间的选区文本。
 * 有 panelId 时优先该面板 provider → DOM 选区。
 */
export function captureDomSelectionText(panelId?: string): string {
  const fromProvider = captureProviderSelectionText(panelId);
  if (fromProvider.length > 0) {
    return fromProvider;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    const text = selection.toString().replace(/\u00a0/g, " ");
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

function runDomSelectAll(): boolean {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    if (active.disabled || active.readOnly) {
      return false;
    }
    active.select();
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    const range = document.createRange();
    range.selectNodeContents(active);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}

export function runSelectionSelectAll(panelId?: string): boolean {
  if (panelId) {
    for (const registration of selectionSelectAllProviders) {
      if (registration.panelId !== panelId) {
        continue;
      }
      try {
        if (registration.provider()) {
          return true;
        }
      } catch {
        // 单个 provider 失败不阻断其它路径
      }
    }
  }
  return runDomSelectAll();
}

export function selectedTextFromInvocation(
  invocation?: ActionInvocation
): string {
  const raw = invocation?.metadata?.selectedText;
  return typeof raw === "string" ? raw : "";
}

/**
 * 自带编辑管线的 surface 隐藏共享 copy/selectAll。
 * 树等 object surface 靠 mergeEdit=false，不再假标「有本地复制」。
 */
export function hasSpecializedEditPipelineSurface(
  surface: string | undefined
): boolean {
  return hasSpecializedEditPipeline(surface);
}

/**
 * @deprecated 使用 hasSpecializedEditPipelineSurface；树不再返回 true。
 */
export function surfaceHasLocalCopyAction(
  surface: string | undefined
): boolean {
  return hasSpecializedEditPipeline(surface);
}
