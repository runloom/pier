/**
 * Public content-preview entry — host fullscreen stage (not a dialog card).
 *
 * Use `openContentPreview` / `openMermaidPreview` / `openHtmlWorldPreview`
 * for new call sites. `openImagePreview` remains as an image convenience wrapper.
 */
export {
  type ContentPreviewImageSource,
  type ContentPreviewPayload,
  closeContentPreview,
  closeImagePreview,
  type ImageLightboxRequest as OpenImagePreviewOptions,
  type ImageLightboxSource as OpenImagePreviewSource,
  type OpenContentPreviewRequest,
  type OpenHtmlWorldPreviewRequest,
  type OpenMermaidPreviewRequest,
  openContentPreview,
  openHtmlWorldPreview,
  openImagePreview,
  openMermaidPreview,
} from "@/stores/content-preview.store.ts";
