import type { ComponentType } from "react";
import { create } from "zustand";

export type AppContentDialogSize = "sm" | "default" | "lg";

export interface AppContentDialogRenderProps<TResult = unknown> {
  close: (result?: TResult | null) => void;
  id: string;
  setDescription: (description?: string) => void;
  setDismissible: (dismissible: boolean) => void;
  setTitle: (title: string) => void;
}

export interface AppContentDialogOpenRequest<TResult = unknown> {
  closeOnOverlayClick?: boolean;
  content: ComponentType<AppContentDialogRenderProps<TResult>>;
  description?: string;
  dismissible?: boolean;
  id: string;
  namespace?: string;
  size?: AppContentDialogSize;
  title: string;
}

export interface AppContentDialogHandle<TResult = unknown> {
  close(result?: TResult | null): void;
  id: string;
  result: Promise<TResult | null>;
  update(patch: {
    title?: string;
    description?: string;
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
  }): void;
}

export interface AppContentDialogLayer {
  closeOnOverlayClick: boolean;
  content: ComponentType<AppContentDialogRenderProps<unknown>>;
  description?: string;
  dismissible: boolean;
  id: string;
  resolve: (result: unknown) => void;
  size: AppContentDialogSize;
  title: string;
}

interface State {
  stack: AppContentDialogLayer[];
}

export const useAppContentDialogStore = create<State>(() => ({ stack: [] }));

function qualifyId(id: string, namespace?: string): string {
  return namespace ? `${namespace}:${id}` : id;
}

export function openAppContentDialog<TResult = unknown>(
  request: AppContentDialogOpenRequest<TResult>
): AppContentDialogHandle<TResult> {
  const id = qualifyId(request.id, request.namespace);
  let resolve!: (result: TResult | null) => void;
  const result = new Promise<TResult | null>((res) => {
    resolve = res;
  });

  const layer: AppContentDialogLayer = {
    id,
    title: request.title,
    ...(request.description === undefined
      ? {}
      : { description: request.description }),
    size: request.size ?? "default",
    dismissible: request.dismissible ?? true,
    closeOnOverlayClick: request.closeOnOverlayClick ?? false,
    content: request.content as ComponentType<
      AppContentDialogRenderProps<unknown>
    >,
    resolve: (value) => resolve((value as TResult | null) ?? null),
  };

  useAppContentDialogStore.setState((state) => {
    const without = state.stack.filter((item) => item.id !== id);
    // Replacing same id re-resolves previous waiter as null.
    const previous = state.stack.find((item) => item.id === id);
    previous?.resolve(null);
    return { stack: [...without, layer] };
  });

  return {
    id,
    result,
    update: (patch) => updateAppContentDialog(id, patch),
    close: (value) => closeAppContentDialog(id, value),
  };
}

export function updateAppContentDialog(
  id: string,
  patch: {
    title?: string;
    description?: string;
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
  }
): void {
  useAppContentDialogStore.setState((state) => ({
    stack: state.stack.map((layer) => {
      if (layer.id !== id) return layer;
      return {
        ...layer,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...("description" in patch ? { description: patch.description } : {}),
        ...(patch.dismissible === undefined
          ? {}
          : { dismissible: patch.dismissible }),
        ...(patch.closeOnOverlayClick === undefined
          ? {}
          : { closeOnOverlayClick: patch.closeOnOverlayClick }),
      };
    }),
  }));
}

export function closeAppContentDialog(id: string, result?: unknown): void {
  const layer = useAppContentDialogStore
    .getState()
    .stack.find((item) => item.id === id);
  if (!layer) return;
  useAppContentDialogStore.setState((state) => ({
    stack: state.stack.filter((item) => item.id !== id),
  }));
  layer.resolve(result ?? null);
}

export function resetAppContentDialogForTests(): void {
  for (const layer of useAppContentDialogStore.getState().stack) {
    layer.resolve(null);
  }
  useAppContentDialogStore.setState({ stack: [] });
}
