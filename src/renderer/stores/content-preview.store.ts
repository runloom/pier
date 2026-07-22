import { create } from "zustand";

/**
 * Host fullscreen content preview.
 *
 * Payload is a discriminated union so markdown diagrams / flow charts can be
 * added later without renaming the public entry (`openContentPreview`).
 */

export type ContentPreviewImageSource =
  | { kind: "absolutePath"; path: string }
  | { kind: "url"; src: string };

export interface ContentPreviewPayload {
  alt?: string;
  source: ContentPreviewImageSource;
  type: "image";
}
// Extend later, e.g.:
// | { type: "diagram"; format: "mermaid"; markup: string };

export interface OpenContentPreviewRequest {
  id?: string;
  /**
   * Invoked when this preview closes or is replaced by another open.
   * Use for releasing file-preview tickets owned by the fullscreen session.
   */
  onClose?: () => void;
  payload: ContentPreviewPayload;
  /** Required i18n title from the call site. */
  title: string;
}

/** @deprecated Prefer OpenContentPreviewRequest — kept for image call-site typing. */
export type ImageLightboxSource = ContentPreviewImageSource;
/** @deprecated Prefer OpenContentPreviewRequest. */
export interface ImageLightboxRequest {
  alt?: string;
  id?: string;
  onClose?: () => void;
  source: ContentPreviewImageSource;
  title: string;
}

interface ContentPreviewState {
  id: string;
  onClose: (() => void) | null;
  open: boolean;
  payload: ContentPreviewPayload | null;
  title: string;
}

const INITIAL: ContentPreviewState = {
  id: "content-preview",
  onClose: null,
  open: false,
  payload: null,
  title: "",
};

export const useContentPreviewStore = create<ContentPreviewState>(() => ({
  ...INITIAL,
}));

/**
 * Open the host fullscreen content preview (not a content dialog).
 * Call sites must pass an i18n title.
 */
export function openContentPreview(request: OpenContentPreviewRequest): void {
  const previousOnClose = useContentPreviewStore.getState().onClose;
  useContentPreviewStore.setState({
    id: request.id ?? "content-preview",
    onClose: request.onClose ?? null,
    open: true,
    payload: request.payload,
    title: request.title,
  });
  previousOnClose?.();
}

export function closeContentPreview(): void {
  const onClose = useContentPreviewStore.getState().onClose;
  useContentPreviewStore.setState({ ...INITIAL });
  onClose?.();
}

/**
 * Image convenience wrapper — composer / markdown image clicks.
 * Prefer `openContentPreview` for new non-image kinds.
 */
export function openImagePreview(request: ImageLightboxRequest): void {
  openContentPreview({
    ...(request.id ? { id: request.id } : {}),
    ...(request.onClose ? { onClose: request.onClose } : {}),
    payload: {
      type: "image",
      source: request.source,
      ...(request.alt ? { alt: request.alt } : {}),
    },
    title: request.title,
  });
}

/** @deprecated Use closeContentPreview. */
export function closeImagePreview(): void {
  closeContentPreview();
}
