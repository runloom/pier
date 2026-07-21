/**
 * Public content-preview entry — host fullscreen stage (not a dialog card).
 *
 * Use `openContentPreview` for new call sites (images, later mermaid / flows).
 * `openImagePreview` remains as an image convenience wrapper.
 */
export {
  type ContentPreviewImageSource,
  type ContentPreviewPayload,
  closeContentPreview,
  closeImagePreview,
  type ImageLightboxRequest as OpenImagePreviewOptions,
  type ImageLightboxSource as OpenImagePreviewSource,
  type OpenContentPreviewRequest,
  openContentPreview,
  openImagePreview,
} from "@/stores/content-preview.store.ts";
