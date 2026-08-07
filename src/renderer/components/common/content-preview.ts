/**
 * Public content-preview entry — host fullscreen stage (not a dialog card).
 *
 * Use `openContentPreview` / `openNodeGraphPreview` for new call sites.
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
  type OpenNodeGraphPreviewRequest,
  openContentPreview,
  openImagePreview,
  openNodeGraphPreview,
} from "@/stores/content-preview.store.ts";
