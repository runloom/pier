const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function kindFromFileName(name: string): "image" | "file" {
  return IMAGE_EXT.test(name) ? "image" : "file";
}
